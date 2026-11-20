import { prefersAIHeadline } from "./headline";
import { getDb, refreshVideoSearch } from "./db";
import { currentEmbeddingModel, embedTexts, getAIProvider, summarizeVideo, transcribeFiles } from "./ai";
import { chunkCues, friendlyJobError, makeId } from "./utils";
import { AUDIO_SEGMENT_SECONDS, downloadAudioSegments, extractYoutube, removeTemporaryAudio } from "./transcript";
import { maybeCreateDailyBackup } from "./backup";
import { averageEmbeddings, syncRetrievalUnit, syncVideoKnowledge } from "./knowledge";
import type { SourceType, TranscriptCue } from "./types";
import { extractXPost } from "./x-post";
import { extractRedditPost } from "./reddit-post";
import { syncAiFreeTags } from "./free-tags";
import { decideCatalogTags } from "./tag-decisions";
import { saveSnapshot } from "./snapshots";
import { loadVideoImage } from "./media";
import { extractWebArticle } from "./web-article";

export type JobKind = "metadata" | "x-metadata" | "x-thread" | "local-items" | "reddit-thread" | "web-article" | "audio" | "pdf";

const PDF_ANALYSIS_CHAR_LIMIT = 400_000;

declare global {
  var __luminaJobs: Map<string, Promise<void>> | undefined;
  var __luminaRecovered: boolean | undefined;
}

const activeJobs = global.__luminaJobs ?? new Map<string, Promise<void>>();
global.__luminaJobs = activeJobs;

function updateJob(jobId: string, status: string, error = "") {
  getDb().prepare("UPDATE jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .run(status, error, new Date().toISOString(), jobId);
}

function updateVideo(videoId: string, status: string, values: Record<string, unknown> = {}) {
  const db = getDb();
  const keys = Object.keys(values);
  const assignments = keys.map((key) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE videos SET status = ?, ${assignments ? `${assignments},` : ""} updated_at = ? WHERE id = ?`)
    .run(status, ...keys.map((key) => values[key]), new Date().toISOString(), videoId);
}

function replaceChunks(videoId: string, cues: TranscriptCue[], embeddings: Array<number[] | null>) {
  const db = getDb();
  const remove = db.prepare("DELETE FROM transcript_chunks WHERE video_id = ?");
  const insert = db.prepare(`
    INSERT INTO transcript_chunks(video_id, ordinal, start_seconds, end_seconds, text, embedding)
    VALUES(?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    const oldIds = db.prepare("SELECT id FROM transcript_chunks WHERE video_id = ?").all(videoId) as Array<{ id: number }>;
    try {
      const removeVector = db.prepare("DELETE FROM chunk_vectors WHERE rowid = ?");
      oldIds.forEach(({ id }) => removeVector.run(id));
    } catch { /* vec extension is optional at runtime */ }
    const oldUnits = db.prepare("SELECT id FROM retrieval_units WHERE video_id = ? AND source_kind = 'transcript'").all(videoId) as Array<{ id: string }>;
    oldUnits.forEach(({ id }) => db.prepare("DELETE FROM retrieval_search WHERE unit_id = ?").run(id));
    db.prepare("DELETE FROM retrieval_units WHERE video_id = ? AND source_kind = 'transcript'").run(videoId);
    remove.run(videoId);
    cues.forEach((cue, index) => {
      const embedding = embeddings[index];
      const binary = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null;
      const result = insert.run(videoId, index, cue.startSeconds, cue.endSeconds, cue.text, binary);
      if (embedding) {
        try {
          db.prepare("INSERT INTO chunk_vectors(rowid, embedding) VALUES(?, ?)").run(Number(result.lastInsertRowid), new Float32Array(embedding));
        } catch { /* in-memory fallback remains available */ }
      }
      syncRetrievalUnit({
        id: `ret_transcript_${videoId}_${index}`,
        videoId,
        sourceKind: "transcript",
        sourceRef: String(result.lastInsertRowid),
        startSeconds: cue.startSeconds,
        endSeconds: cue.endSeconds,
        text: cue.text,
        embedding,
        embeddingModel: embedding ? currentEmbeddingModel() : "",
      });
    });
  })();
}

function syncTags(videoId: string, catalogKeys: string[]) {
  const db = getDb();
  const rows = catalogKeys.length ? db.prepare(`SELECT id, name, level FROM tags WHERE active = 1 AND catalog_key IN (${catalogKeys.map(() => "?").join(",")})`).all(...catalogKeys) as Array<{ id: string; name: string; level: string }> : [];
  const selected = [...rows.filter((tag) => tag.level === "primary").slice(0, 3), ...rows.filter((tag) => tag.level === "secondary").slice(0, 2)];
  db.transaction(() => {
    db.prepare("DELETE FROM video_tags WHERE video_id = ? AND origin IN ('ai', 'early_ai') AND bulk_job_id IS NULL").run(videoId);
    selected.forEach((tag) => db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'ai', 0.8)").run(videoId, tag.id));
  })();
  return selected.map((tag) => tag.name);
}

// Muchos tweets y posts dicen poco en texto y todo en la imagen (una gráfica, un pantallazo).
// Vision lee el texto de la imagen en este Mac; con clave de OpenAI, además se describe lo que muestra.
async function imageContext(videoId: string, sourceType: SourceType): Promise<TranscriptCue[]> {
  if (sourceType !== "x" && sourceType !== "reddit") return [];
  const db = getDb();
  const rows = db.prepare("SELECT preview_url AS url FROM source_items WHERE video_id = ? AND preview_url <> '' ORDER BY ordinal LIMIT 4").all(videoId) as Array<{ url: string }>;
  const thumbnail = (db.prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(videoId) as { url: string } | undefined)?.url || "";
  const urls = [...new Set([...rows.map((row) => row.url), thumbnail].filter((url) => /^https?:|^\/api\/media\//.test(url)))].slice(0, 3);
  const { analyzeBytes, visionAvailable } = await import("./vision");
  const { canAutoDescribeImages, describeImageBytes } = await import("./vision-ai");
  const notes: TranscriptCue[] = [];
  for (const [index, url] of urls.entries()) {
    try {
      const { bytes, kind } = await loadVideoImage(url);
      const ocr = visionAvailable() ? (await analyzeBytes(bytes, kind).catch(() => null))?.text.trim() || "" : "";
      const described = canAutoDescribeImages() ? await describeImageBytes(bytes, kind).catch(() => null) : null;
      const parts = [described?.description && `Lo que muestra: ${described.description}`, ocr && `Texto dentro de la imagen: ${ocr.slice(0, 2_000)}`].filter(Boolean);
      if (parts.length) notes.push({ startSeconds: 0, endSeconds: 0, text: `[Imagen adjunta ${index + 1}] ${parts.join(" ")}` });
    } catch { /* una imagen que no se puede leer no detiene el análisis */ }
  }
  return notes;
}

async function analyze(videoId: string, cues: TranscriptCue[], metadata: { title: string; channel: string; description: string }, sourceType: SourceType = "youtube") {
  cues = [...cues, ...(await imageContext(videoId, sourceType).catch(() => []))];
  const chunks = chunkCues(cues);
  updateVideo(videoId, "indexing", { transcript_text: chunks.map((chunk) => chunk.text).join("\n") });
  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  replaceChunks(videoId, chunks, embeddings);
  updateVideo(videoId, "summarizing");
  const { summary, tags: summaryTags, topics, entities, relations } = await summarizeVideo(metadata.title, metadata.channel, metadata.description, chunks, sourceType);
  // Título claro escrito por la IA donde la fuente no trae uno útil (sin tocar lo que hayas renombrado tú).
  if (summary.headline) {
    const row = getDb().prepare("SELECT url, youtube_id AS sourceId, custom_title AS customTitle FROM videos WHERE id = ?").get(videoId) as { url: string; sourceId: string; customTitle: string } | undefined;
    if (row && !row.customTitle && prefersAIHeadline({ sourceType, title: metadata.title, url: row.url, sourceId: row.sourceId })) updateVideo(videoId, "summarizing", { title: summary.headline });
  }
  // Con OpenAI, las etiquetas del catálogo las decide la API Decisions (probabilidad por etiqueta, con umbral).
  const decided = await decideCatalogTags({ title: metadata.title, author: metadata.channel, summary: [summary.gist, summary.cardSummary].filter(Boolean).join(" "), content: chunks.map((chunk) => chunk.text).join("\n") }).catch(() => null);
  const tags = decided?.length ? decided : summaryTags;
  const tagNames = [...syncTags(videoId, tags), ...syncAiFreeTags(videoId, topics ?? [])];
  const summaryText = [summary.gist, ...(summary.sections ?? []).flatMap((section) => [section.title, ...section.points.map((point) => point.text)]), ...summary.keyPoints.map((point) => point.text), ...summary.chapters.map((chapter) => `${chapter.title}. ${chapter.summary}`), ...summary.takeaways].join("\n");
  const [summaryEmbedding] = await embedTexts([summaryText]);
  const embeddingModel = currentEmbeddingModel();
  syncRetrievalUnit({ id: `ret_summary_${videoId}`, videoId, sourceKind: "summary", sourceRef: "summary", text: summaryText, embedding: summaryEmbedding, embeddingModel: summaryEmbedding ? embeddingModel : "" });
  syncVideoKnowledge({ videoId, summary, tags: tagNames, entities, relations, videoEmbedding: averageEmbeddings(embeddings), embeddingModel: embeddings.some(Boolean) ? embeddingModel : "" });
  updateVideo(videoId, "ready", { summary_json: JSON.stringify(summary), error: "", ready_at: new Date().toISOString() });
  refreshVideoSearch(videoId);
}

async function runXMetadataJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT url FROM videos WHERE id = ?").get(videoId) as { url: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  const post = await extractXPost(video.url);
  updateVideo(videoId, "indexing", {
    title: post.title,
    channel: post.channel,
    thumbnail_url: post.previewUrl,
    description: post.description,
    source_published_at: post.publishedAt,
    transcript_source: "x-oembed",
  });
  db.prepare(`
    INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at)
    VALUES(?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, ordinal) DO UPDATE SET url = excluded.url, author_name = excluded.author_name,
      author_handle = excluded.author_handle, text = excluded.text, published_at = excluded.published_at,
      preview_url = excluded.preview_url
  `).run(makeId("item"), videoId, post.postId, post.url, post.channel, post.authorHandle, post.description, post.publishedAt, post.previewUrl, JSON.stringify({ avatarUrl: post.avatarUrl }), new Date().toISOString());
  await analyze(videoId, [{ startSeconds: 0, endSeconds: 0, text: post.description }], post, "x");
  updateJob(jobId, "complete");
}

async function runRedditThreadJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT url FROM videos WHERE id = ?").get(videoId) as { url: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  const post = await extractRedditPost(video.url);
  updateVideo(videoId, "indexing", {
    title: post.title,
    channel: post.channel,
    description: post.description,
    thumbnail_url: post.previewUrl,
    source_published_at: post.publishedAt,
    transcript_source: "reddit-public-thread",
    thread_status: post.items.length > 1 ? "complete" : "single",
  });
  db.transaction(() => {
    db.prepare("DELETE FROM source_items WHERE video_id = ?").run(videoId);
    const insert = db.prepare(`
      INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `);
    post.items.forEach((item, index) => insert.run(makeId("item"), videoId, item.externalId, index, item.url, item.authorName, item.authorHandle, item.text, item.publishedAt, item.previewUrl, new Date().toISOString()));
  })();
  const cues = post.items.map((item, index) => ({ startSeconds: index, endSeconds: index, text: item.text })).filter((item) => item.text.trim());
  await analyze(videoId, cues, post, "reddit");
  updateJob(jobId, "complete");
}

// Analiza lo que la extensión ya leyó en la página (hilo de X, publicación o comentario de Reddit) sin volver a descargarlo.
async function runLocalItemsJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT title, channel, description, source_type AS sourceType FROM videos WHERE id = ?").get(videoId) as { title: string; channel: string; description: string; sourceType: SourceType } | undefined;
  if (!video) return;
  const items = db.prepare("SELECT text FROM source_items WHERE video_id = ? ORDER BY ordinal").all(videoId) as Array<{ text: string }>;
  updateJob(jobId, "running");
  updateVideo(videoId, "indexing", { error: "", transcript_source: video.sourceType === "x" ? "x-thread-public" : "browser-extension" });
  const cues = items.map((item, index) => ({ startSeconds: index, endSeconds: index, text: item.text })).filter((item) => item.text.trim());
  await analyze(videoId, cues, video, video.sourceType);
  updateJob(jobId, "complete");
}

async function runWebArticleJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT url, thumbnail_url AS thumbnailUrl FROM videos WHERE id = ?").get(videoId) as { url: string; thumbnailUrl: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  const article = await extractWebArticle(video.url);
  // Si al guardar se tomó una captura de la página (o pusiste tú la portada), se conserva.
  const keptCover = /^\/api\/media\/cover_/.test(video.thumbnailUrl || "") ? video.thumbnailUrl : "";
  updateVideo(videoId, "indexing", {
    title: article.title,
    channel: article.channel,
    description: article.description,
    thumbnail_url: keptCover || article.thumbnailUrl,
    source_published_at: article.publishedAt,
    source_language: article.sourceLanguage,
    transcript_source: `${article.sourceKind}-readability`,
    thread_status: "single",
    url: article.url,
  });
  db.transaction(() => {
    db.prepare("DELETE FROM source_items WHERE video_id = ?").run(videoId);
    const insert = db.prepare(`
      INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    article.sections.forEach((section, index) => insert.run(
      makeId("item"), videoId, section.externalId, index, section.url,
      article.author || article.siteName, section.text, article.publishedAt,
      index === 0 ? keptCover || article.thumbnailUrl : "",
      JSON.stringify({ heading: section.heading, siteName: article.siteName, sourceKind: article.sourceKind, language: article.sourceLanguage, faviconUrl: article.faviconUrl, ...(index === 0 && article.product ? { product: { price: article.product.price, currency: article.product.currency, brand: article.product.brand } } : {}), ...(index === 0 && article.movie ? { movie: article.movie } : {}) }),
      new Date().toISOString(),
    ));
  })();
  try { saveSnapshot(videoId, { title: article.title, url: article.url, byline: article.channel, html: article.readableHtml }); } catch { /* la copia es un extra: no frena el análisis */ }
  const cues = article.sections.map((section, index) => ({ startSeconds: index, endSeconds: index, text: `${section.heading}\n${section.text}` }));
  await analyze(videoId, cues, article, "web");
  updateJob(jobId, "complete");
}

// Solo corre si se pide: es lo único que envía el texto del PDF al proveedor de IA.
async function runPdfJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT title, channel, description FROM videos WHERE id = ?").get(videoId) as { title: string; channel: string; description: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  const items = db.prepare("SELECT ordinal, text, metadata_json AS metadata FROM source_items WHERE video_id = ? ORDER BY ordinal").all(videoId) as Array<{ ordinal: number; text: string }>;
  let budget = PDF_ANALYSIS_CHAR_LIMIT;
  const cues: TranscriptCue[] = [];
  for (const item of items) {
    if (budget <= 0) break;
    cues.push({ startSeconds: item.ordinal, endSeconds: item.ordinal, text: item.text.slice(0, budget) });
    budget -= item.text.length;
  }
  if (!cues.length) throw new Error("Este PDF no tiene texto legible para analizar.");
  await analyze(videoId, cues, video, "web");
  updateJob(jobId, "complete");
}

async function runMetadataJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT url, source_type AS sourceType FROM videos WHERE id = ?").get(videoId) as { url: string; sourceType: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  // Videos de YouTube y también podcasts o audios (yt-dlp sabe leer ambos).
  const extracted = await extractYoutube(video.url, video.sourceType === "audio" ? "audio" : "youtube");
  updateVideo(videoId, extracted.cues.length ? "indexing" : "needs_transcript", {
    title: extracted.title,
    channel: extracted.channel,
    thumbnail_url: extracted.thumbnailUrl,
    duration_seconds: extracted.durationSeconds,
    description: extracted.description,
    source_language: extracted.sourceLanguage,
    transcript_source: extracted.transcriptSource,
  });
  if (!extracted.cues.length) {
    // Sin subtítulos: si hay IA configurada, se escucha el audio y se transcribe solo.
    if (getAIProvider() !== "none") {
      try {
        await transcribeAudio(videoId, video.url, extracted);
        updateJob(jobId, "complete");
        return;
      } catch (error) {
        updateVideo(videoId, "needs_transcript", { error: `No se pudo transcribir el audio: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500) });
      }
    }
    refreshVideoSearch(videoId);
    updateJob(jobId, "complete");
    return;
  }
  await analyze(videoId, extracted.cues, extracted);
  updateJob(jobId, "complete");
}

async function runAudioJob(jobId: string, videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT url, title, channel, description FROM videos WHERE id = ?").get(videoId) as { url: string; title: string; channel: string; description: string } | undefined;
  if (!video) return;
  updateJob(jobId, "running");
  updateVideo(videoId, "extracting", { error: "" });
  await transcribeAudio(videoId, video.url, video);
  updateJob(jobId, "complete");
}

async function transcribeAudio(videoId: string, url: string, video: { title: string; channel: string; description: string }) {
  updateVideo(videoId, "extracting", { error: "" });
  const temporary = await downloadAudioSegments(url);
  try {
    const cues = await transcribeFiles(temporary.files, AUDIO_SEGMENT_SECONDS);
    if (!cues.length) throw new Error("El audio no tiene habla reconocible.");
    updateVideo(videoId, "indexing", { transcript_source: "audio-ai" });
    await analyze(videoId, cues, video);
    updateVideo(videoId, "ready", { transcript_source: "audio-ai" });
  } finally {
    await removeTemporaryAudio(temporary.directory);
  }
}

export function scheduleJob(jobId: string, videoId: string, kind: JobKind) {
  if (activeJobs.has(jobId)) return;
  const task = (kind === "pdf" ? runPdfJob(jobId, videoId) : kind === "audio" ? runAudioJob(jobId, videoId) : kind === "web-article" ? runWebArticleJob(jobId, videoId) : kind === "reddit-thread" ? runRedditThreadJob(jobId, videoId) : kind === "x-thread" || kind === "local-items" ? runLocalItemsJob(jobId, videoId) : kind === "x-metadata" ? runXMetadataJob(jobId, videoId) : runMetadataJob(jobId, videoId))
    .catch((error: unknown) => {
      const message = friendlyJobError(error);
      updateJob(jobId, "failed", message);
      updateVideo(videoId, "failed", { error: message });
    })
    .finally(() => activeJobs.delete(jobId));
  activeJobs.set(jobId, task);
}

export function recoverPendingJobs() {
  if (global.__luminaRecovered) return;
  global.__luminaRecovered = true;
  const rows = getDb().prepare("SELECT id, video_id AS videoId, kind FROM jobs WHERE status IN ('queued', 'running') ORDER BY created_at")
    .all() as Array<{ id: string; videoId: string; kind: JobKind }>;
  rows.forEach((job) => scheduleJob(job.id, job.videoId, job.kind));
  void maybeCreateDailyBackup().catch(() => undefined);
}
