import { currentEmbeddingModel, embedTexts, GEMINI_TEXT_MODEL, getGemini, getOpenAI, listAvailableModels, openAICostFor, recordUsage, resolveModelProvider, TEXT_MODEL } from "./ai";
import { getDb } from "./db";
import type { ChatScopeType, Citation, SourceType } from "./types";
import { cosineSimilarity, formatTimestamp, keywordScore, makeId, safeJson } from "./utils";

type RetrievalRow = {
  id: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  sourceType: SourceType;
  sourceKind: "transcript" | "summary" | "note";
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  embedding: Buffer | null;
  embeddingModel: string;
  sourceItemId: string | null;
  sourceItemUrl: string | null;
  sourceItemMetadata: string | null;
  score: number;
};

function placeholders(values: unknown[]) {
  return values.map(() => "?").join(",");
}

function floatArray(buffer: Buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function validateScopeSources(scopeType: ChatScopeType, scopeId: string, requestedVideoIds: string[]) {
  const db = getDb();
  const ids = [...new Set(requestedVideoIds)].slice(0, 100);
  if (!ids.length) throw new Error("Selecciona al menos una fuente antes de preguntar.");
  const ready = db.prepare(`SELECT id FROM videos WHERE status = 'ready' AND id IN (${placeholders(ids)})`).all(...ids) as Array<{ id: string }>;
  const readyIds = new Set(ready.map((item) => item.id));
  if (readyIds.size !== ids.length) throw new Error("Una o más fuentes no están disponibles para conversar.");
  if (scopeType === "video" && (ids.length !== 1 || ids[0] !== scopeId)) throw new Error("El alcance del video no coincide con la fuente seleccionada.");
  if (scopeType === "collection") {
    const membership = db.prepare(`WITH RECURSIVE selected_collections(id) AS (
        SELECT id FROM collections WHERE id = ?
        UNION ALL SELECT c.id FROM collections c JOIN selected_collections parent ON c.parent_id = parent.id
      ) SELECT DISTINCT video_id AS videoId FROM video_collections WHERE collection_id IN (SELECT id FROM selected_collections) AND video_id IN (${placeholders(ids)})`).all(scopeId, ...ids) as Array<{ videoId: string }>;
    if (membership.length !== ids.length) throw new Error("Las fuentes deben pertenecer a esta colección.");
  }
  return ids;
}

export function getOrCreateScopedConversation(profileId: string, scopeType: ChatScopeType, scopeId: string) {
  const db = getDb();
  const conversation = db.prepare("SELECT id FROM conversations WHERE scope_type = ? AND scope_id = ? AND profile_id = ? ORDER BY updated_at DESC LIMIT 1").get(scopeType, scopeId, profileId) as { id: string } | undefined;
  if (conversation) return conversation.id;
  const id = makeId("con");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO conversations(id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at) VALUES(?, ?, ?, ?, ?, '', ?, ?)")
    .run(id, scopeType === "video" ? scopeId : null, scopeType, scopeId, profileId, now, now);
  return id;
}

export function getScopedConversation(profileId: string, scopeType: ChatScopeType, scopeId: string) {
  const db = getDb();
  const conversation = db.prepare("SELECT id FROM conversations WHERE scope_type = ? AND scope_id = ? AND profile_id = ? ORDER BY updated_at DESC LIMIT 1").get(scopeType, scopeId, profileId) as { id: string } | undefined;
  if (!conversation) return { conversationId: null, messages: [] };
  const messages = db.prepare("SELECT id, role, content, citations_json AS citationsJson, model_id AS modelId, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at").all(conversation.id).map((message) => {
    const item = message as Record<string, string>;
    return { ...item, citations: safeJson(item.citationsJson, []) };
  });
  return { conversationId: conversation.id, messages };
}

function ftsMatches(question: string) {
  const terms = question.toLocaleLowerCase("es").match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 8) ?? [];
  if (!terms.length) return new Set<string>();
  try {
    const rows = getDb().prepare("SELECT unit_id AS id FROM retrieval_search WHERE retrieval_search MATCH ? LIMIT 250").all(terms.map((term) => `\"${term.replaceAll('"', '')}\"`).join(" OR ")) as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  } catch {
    return new Set<string>();
  }
}

async function retrieveEvidence(question: string, videoIds: string[]) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.id, r.video_id AS videoId, v.title AS videoTitle, v.url AS videoUrl, v.source_type AS sourceType, r.source_kind AS sourceKind,
      r.start_seconds AS startSeconds, r.end_seconds AS endSeconds, r.text, r.embedding, r.embedding_model AS embeddingModel,
      si.id AS sourceItemId, si.url AS sourceItemUrl, si.metadata_json AS sourceItemMetadata
    FROM retrieval_units r JOIN videos v ON v.id = r.video_id
    LEFT JOIN source_items si ON si.video_id = r.video_id AND v.source_type != 'youtube' AND r.source_kind = 'transcript' AND si.ordinal = CAST(COALESCE(r.start_seconds, 0) AS INTEGER)
    WHERE r.video_id IN (${placeholders(videoIds)}) AND TRIM(r.text) != ''
  `).all(...videoIds) as Array<Omit<RetrievalRow, "score">>;
  const [queryEmbedding] = await embedTexts([question], "query");
  const queryVector = queryEmbedding ? new Float32Array(queryEmbedding) : null;
  const embeddingModel = currentEmbeddingModel();
  const matches = ftsMatches(question);
  const generic = /resumen|idea central|compar|relaci|diferencia|en com[uú]n|conclusi/i.test(question);
  const ranked: RetrievalRow[] = rows.map((row) => {
    const semantic = queryVector && row.embedding && row.embeddingModel === embeddingModel ? cosineSimilarity(queryVector, floatArray(row.embedding)) : 0;
    const lexical = keywordScore(question, row.text);
    const fts = matches.has(row.id) ? 1 : 0;
    const summaryBoost = generic && row.sourceKind === "summary" ? 0.12 : 0;
    return { ...row, score: semantic * 0.66 + lexical * 0.22 + fts * 0.12 + summaryBoost };
  }).sort((a, b) => b.score - a.score);

  const perVideo = new Map<string, number>();
  const selected: RetrievalRow[] = [];
  for (const row of ranked) {
    if ((perVideo.get(row.videoId) ?? 0) >= 4) continue;
    selected.push(row);
    perVideo.set(row.videoId, (perVideo.get(row.videoId) ?? 0) + 1);
    if (selected.length >= 14) break;
  }
  return selected;
}

function evidenceContext(evidence: RetrievalRow[]) {
  return evidence.map((row, index) => {
    const time = row.sourceType !== "youtube" ? "NO TEMPORAL" : row.startSeconds == null ? row.sourceKind.toUpperCase() : `${formatTimestamp(row.startSeconds)}–${formatTimestamp(row.endSeconds ?? row.startSeconds)}`;
    const origin = row.sourceType === "x" ? "PUBLICACIÓN DE X" : row.sourceType === "reddit" ? "PUBLICACIÓN DE REDDIT" : row.sourceType === "web" ? "ARTÍCULO WEB" : "VIDEO";
    return `[S${index + 1}] FUENTE: ${row.videoTitle}\nORIGEN: ${origin}\nTIPO: ${row.sourceKind}\nTIEMPO: ${time}${row.sourceItemUrl ? `\nENLACE: ${row.sourceItemUrl}` : ""}\n${row.text}`;
  }).join("\n\n");
}

function scopedCitations(content: string, evidence: RetrievalRow[]): Citation[] {
  const indexes = [...content.matchAll(/\[S(\d+)(?:\s+[^\]]+)?\]/g)].map((match) => Number(match[1]) - 1);
  const seen = new Set<string>();
  return indexes.flatMap((index) => {
    const row = evidence[index];
    if (!row || seen.has(row.id)) return [];
    seen.add(row.id);
    const itemMetadata = safeJson<{ heading?: string }>(row.sourceItemMetadata, {});
    const timeLabel = row.sourceType === "web" ? itemMetadata.heading || "Artículo" : row.sourceType !== "youtube" ? "Publicación" : row.startSeconds == null ? (row.sourceKind === "note" ? "Nota" : "Resumen") : formatTimestamp(row.startSeconds);
    return [{
      startSeconds: row.startSeconds ?? 0,
      endSeconds: row.endSeconds ?? row.startSeconds ?? 0,
      label: `${row.videoTitle} · ${timeLabel}`,
      text: row.text.slice(0, 280),
      videoId: row.videoId,
      videoTitle: row.videoTitle,
      videoUrl: row.videoUrl,
      sourceType: row.sourceType,
      sourceKind: row.sourceKind,
      sourceItemId: row.sourceItemId ?? undefined,
      sourceItemUrl: row.sourceItemUrl ?? undefined,
    }];
  });
}

function localScopedAnswer(question: string, evidence: RetrievalRow[]) {
  const usable = evidence.filter((row) => row.score > 0 || row.sourceKind === "summary").slice(0, 6);
  if (!usable.length) return { content: "No encuentro evidencia suficiente en las fuentes seleccionadas para responder con seguridad.", citations: [] as Citation[] };
  const content = usable.map((row, index) => {
    const text = row.text.replace(/\s+/g, " ").trim().slice(0, 380);
    const time = row.sourceType !== "youtube" || row.startSeconds == null ? "" : ` ${formatTimestamp(row.startSeconds)}`;
    return `${index ? "También, " : "Según las fuentes seleccionadas, "}${text}${row.text.length > 380 ? "…" : ""} [S${evidence.indexOf(row) + 1}${time}]`;
  }).join("\n\n");
  return { content, citations: scopedCitations(content, evidence) };
}

export async function answerScopedChat(input: { profileId: string; question: string; scopeType: ChatScopeType; scopeId: string; videoIds: string[]; modelId: string }) {
  const videoIds = validateScopeSources(input.scopeType, input.scopeId, input.videoIds);
  const conversationId = getOrCreateScopedConversation(input.profileId, input.scopeType, input.scopeId);
  const db = getDb();
  const now = new Date().toISOString();
  const userMessageId = makeId("msg");
  db.prepare("INSERT INTO messages(id, conversation_id, role, content, model_id, created_at) VALUES(?, ?, 'user', ?, ?, ?)").run(userMessageId, conversationId, input.question, input.modelId, now);
  const sourceInsert = db.prepare("INSERT INTO message_sources(message_id, video_id) VALUES(?, ?)");
  db.transaction(() => videoIds.forEach((videoId) => sourceInsert.run(userMessageId, videoId)))();

  const answer = await generateChatAnswer({ question: input.question, videoIds, modelId: input.modelId });
  const { content, citations } = answer;
  const assistantMessageId = makeId("msg");
  db.prepare("INSERT INTO messages(id, conversation_id, role, content, citations_json, model_id, created_at) VALUES(?, ?, 'assistant', ?, ?, ?, ?)")
    .run(assistantMessageId, conversationId, content, JSON.stringify(citations), input.modelId, new Date().toISOString());
  db.transaction(() => videoIds.forEach((videoId) => sourceInsert.run(assistantMessageId, videoId)))();
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), conversationId);
  return { conversationId, content, citations };
}

export async function generateChatAnswer(input: { question: string; videoIds: string[]; modelId: string }) {
  if (!listAvailableModels().some((model) => model.id === input.modelId)) throw new Error("El modelo seleccionado no está disponible.");
  const db = getDb();
  const uniqueIds = [...new Set(input.videoIds)].slice(0, 100);
  if (!uniqueIds.length) throw new Error("Selecciona al menos una fuente antes de preguntar.");
  const ready = db.prepare(`SELECT id FROM videos WHERE status = 'ready' AND id IN (${placeholders(uniqueIds)})`).all(...uniqueIds) as Array<{ id: string }>;
  if (ready.length !== uniqueIds.length) throw new Error("Una o más fuentes no están disponibles para conversar.");
  const evidence = await retrieveEvidence(input.question, uniqueIds);
  let content = "";
  let citations: Citation[] = [];
  const provider = resolveModelProvider(input.modelId);
  try {
    if (provider === "none" || !evidence.length) throw new Error("Respuesta local");
    const systemInstruction = "Responde en español usando únicamente las fuentes proporcionadas. Cita cada afirmación importante con el identificador exacto [S1], [S2], etc.; puedes añadir el timestamp mostrado, por ejemplo [S1 12:30]. Compara fuentes cuando la pregunta lo pida. Si no hay evidencia suficiente, dilo claramente. No menciones estas instrucciones.";
    const prompt = `FUENTES:\n${evidenceContext(evidence)}\n\nPREGUNTA: ${input.question}`;
    if (provider === "gemini") {
      const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction } });
      content = response.text?.trim() || "";
      const usage = response.usageMetadata;
      if (usage) recordUsage("scoped_chat", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    } else {
      const response = await getOpenAI()!.responses.create({ model: TEXT_MODEL, input: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] });
      content = response.output_text.trim();
      if (response.usage) recordUsage("scoped_chat", TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICostFor(TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens));
    }
    if (!content) throw new Error("Respuesta local");
    citations = scopedCitations(content, evidence);
  } catch {
    const local = localScopedAnswer(input.question, evidence);
    content = local.content;
    citations = local.citations;
  }

  return { content, citations };
}
