import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDb, refreshVideoSearch } from "./db";
import { loadVideoImage, saveMedia, type ImageKind } from "./media";
import { printFromBase64 } from "./similar";
import { makeId } from "./utils";

const execFileAsync = promisify(execFile);
const VISION_BINARY = process.env.LUMINA_VISION_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), "bin", "lumina-vision");

export type VisionResult = {
  text: string;
  labels: Array<{ id: string; confidence: number }>;
  colors: Array<{ hex: string; share: number }>;
  width: number;
  height: number;
  featurePrint?: string | null;
};

declare global {
  var __luminaVisionRunning: boolean | undefined;
}

export function visionAvailable() {
  return fs.existsSync(VISION_BINARY);
}

export async function analyzeImageFile(file: string): Promise<VisionResult> {
  const { stdout } = await execFileAsync(VISION_BINARY, [file], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout) as VisionResult;
}

export async function analyzeBytes(bytes: Uint8Array, kind: ImageKind) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-vision-"));
  const file = path.join(directory, `imagen.${kind.ext}`);
  try {
    fs.writeFileSync(file, bytes);
    return await analyzeImageFile(file);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function storeAnalysis(videoId: string, result: VisionResult | null, error = "") {
  getDb().prepare(`
    INSERT INTO visual_analysis(video_id, text, labels_json, colors_json, width, height, feature_print, error, analyzed_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET text = excluded.text, labels_json = excluded.labels_json, colors_json = excluded.colors_json,
      width = excluded.width, height = excluded.height, feature_print = excluded.feature_print, error = excluded.error, analyzed_at = excluded.analyzed_at
  `).run(videoId, result?.text || "", JSON.stringify(result?.labels || []), JSON.stringify(result?.colors || []), result?.width || 0, result?.height || 0, result?.featurePrint ? printFromBase64(result.featurePrint) : null, error, new Date().toISOString());
  refreshVideoSearch(videoId);
}

export async function analyzeVideoImage(videoId: string, thumbnailUrl: string) {
  try {
    const { bytes, kind } = await loadVideoImage(thumbnailUrl);
    storeAnalysis(videoId, await analyzeBytes(bytes, kind));
  } catch (error) {
    // Si ya tenía análisis (solo faltaba la huella), un fallo temporal no debe borrarlo.
    if ((getDb().prepare("SELECT error FROM visual_analysis WHERE video_id = ?").get(videoId) as { error: string } | undefined)?.error === "") return;
    storeAnalysis(videoId, null, error instanceof Error ? error.message.slice(0, 200) : "No se pudo analizar la imagen.");
  }
}

// Una imagen a la vez, en segundo plano: cubre las miniaturas de lo ya guardado y de lo que llegue después.
export function scheduleVisualBackfill() {
  if (global.__luminaVisionRunning || !visionAvailable()) return;
  global.__luminaVisionRunning = true;
  void (async () => {
    const pending = () => getDb().prepare(`
      SELECT v.id, v.thumbnail_url AS url FROM videos v
      LEFT JOIN visual_analysis a ON a.video_id = v.id
      WHERE (a.video_id IS NULL OR (a.feature_print IS NULL AND a.error = '')) AND v.thumbnail_url != '' ORDER BY v.created_at DESC
    `).all() as Array<{ id: string; url: string }>;
    // Una sola pasada por arranque: lo que falle se reintenta la próxima vez, sin bucles.
    const attempted = new Set<string>();
    for (let batch = pending().filter((item) => !attempted.has(item.id)); batch.length; batch = pending().filter((item) => !attempted.has(item.id))) {
      for (const item of batch) { attempted.add(item.id); await analyzeVideoImage(item.id, item.url); }
    }
  })().catch(() => undefined).finally(() => { global.__luminaVisionRunning = false; });
}

function titleFrom(input: string, result: VisionResult | null) {
  const given = input.replace(/\.[a-zA-Z0-9]{2,5}$/, "").trim();
  if (given) return given.slice(0, 200);
  return result?.text.split("\n").find((line) => line.trim().length >= 4)?.trim().slice(0, 120) || "Imagen guardada";
}

export async function createImageSource(input: { bytes: Uint8Array; kind: ImageKind; title: string; pageUrl?: string; profileId: string }) {
  const db = getDb();
  const hash = crypto.createHash("sha256").update(input.bytes).digest("hex").slice(0, 40);
  const existing = db.prepare("SELECT id FROM videos WHERE source_type = 'image' AND youtube_id = ?").get(hash) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const id = makeId("img");
  const { url: mediaUrl } = saveMedia(id, input.bytes, input.kind);
  let result: VisionResult | null = null;
  let analysisError = "";
  if (visionAvailable()) {
    try { result = await analyzeBytes(input.bytes, input.kind); }
    catch { analysisError = "Vision no pudo analizar esta imagen."; }
    // Si el Mac estaba ocupado, Vision puede agotar su tiempo: se reintenta sola en segundo plano.
    if (!result) setTimeout(() => { void analyzeVideoImage(id, mediaUrl); }, 20_000);
  }
  const now = new Date().toISOString();
  let host = "";
  try { host = input.pageUrl ? new URL(input.pageUrl).hostname.replace(/^www\./, "") : ""; } catch { /* la imagen queda sin sitio de origen */ }
  db.prepare(`
    INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at, ready_at)
    VALUES(?, ?, 'image', '', ?, ?, '', ?, ?, '', '', 'image', 'ready', ?, ?, ?, ?)
  `).run(id, hash, host ? input.pageUrl : `local://imagen/${id}`, titleFrom(input.title, result), host, mediaUrl, input.profileId, now, now, now);
  if (result || analysisError) storeAnalysis(id, result, analysisError);
  else refreshVideoSearch(id);
  // Descripción con IA en segundo plano: entiende la escena mucho mejor que las etiquetas genéricas de Vision.
  void import("./vision-ai").then(({ canAutoDescribeImages, describeImageWithAI }) => (canAutoDescribeImages() ? describeImageWithAI(id) : undefined)).catch(() => undefined);
  return { id, duplicate: false };
}

// Galería (carrusel de Instagram, por ejemplo): una sola tarjeta con todas sus fotos.
// La primera es la portada y la que se analiza; el resto se guarda como fotos de la galería.
export async function createGallerySource(input: { images: Array<{ bytes: Uint8Array; kind: ImageKind }>; title: string; pageUrl?: string; author?: string; profileId: string }) {
  if (!input.images.length) throw new Error("No llegaron imágenes de la galería.");
  const first = await createImageSource({ ...input.images[0], title: input.title, pageUrl: input.pageUrl, profileId: input.profileId });
  const db = getDb();
  const existingItems = (db.prepare("SELECT COUNT(*) AS count FROM source_items WHERE video_id = ?").get(first.id) as { count: number }).count;
  if (first.duplicate && existingItems >= input.images.length) return { ...first, images: existingItems };
  const now = new Date().toISOString();
  const cover = (db.prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(first.id) as { url: string }).url;
  db.transaction(() => {
    db.prepare("DELETE FROM source_items WHERE video_id = ?").run(first.id);
    const insert = db.prepare("INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at) VALUES(?, ?, ?, ?, ?, ?, '', '', ?, ?, ?)");
    input.images.forEach((image, index) => {
      const url = index === 0 ? cover : saveMedia(makeId("gal"), image.bytes, image.kind).url;
      insert.run(makeId("item"), first.id, `slide-${index + 1}`, index, input.pageUrl || "", input.author || "", url, JSON.stringify({ kind: "post", siteName: "gallery" }), now);
    });
    if (input.author) db.prepare("UPDATE videos SET channel = ? WHERE id = ?").run(input.author, first.id);
  })();
  refreshVideoSearch(first.id);
  return { ...first, images: input.images.length };
}
