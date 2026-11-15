import { embedTexts, currentEmbeddingModel, hasAIKey } from "./ai";
import { getDb } from "./db";
import { cosineSimilarity } from "./utils";

// Búsqueda por significado: compara la pregunta con las «huellas» (embeddings) de resúmenes, transcripciones,
// notas y descripciones de imágenes. Encuentra «sillas de roble» al buscar «madera» aunque la palabra no aparezca.
const queryCache = new Map<string, Float32Array>();
const MIN_SCORE = Number(process.env.LUMINA_SEMANTIC_MIN_SCORE ?? 0.65);
// Si hay una coincidencia muy fuerte, solo se muestran las que están cerca de ella.
const RELATIVE_WINDOW = 0.08;

function vector(buffer: Buffer) {
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

async function queryVector(query: string) {
  const key = query.trim().toLocaleLowerCase("es");
  const cached = queryCache.get(key);
  if (cached) return cached;
  const [embedding] = await embedTexts([query], "query");
  if (!embedding) return null;
  const result = new Float32Array(embedding);
  queryCache.set(key, result);
  if (queryCache.size > 300) queryCache.delete(queryCache.keys().next().value!);
  return result;
}

// Por defecto la búsqueda por significado corre en este Mac (sin internet ni Gemini).
// LUMINA_SEMANTIC_PROVIDER=gemini vuelve a usar las huellas de Gemini.
const LOCAL_MIN_SCORE = Number(process.env.LUMINA_LOCAL_MIN_SCORE ?? 0.84);
const LOCAL_WINDOW = 0.035;
let lastSync = 0;

async function localSearch(query: string, limit: number) {
  const { embedLocal, syncLocalVectors } = await import("./local-embeddings");
  if (Date.now() - lastSync > 20_000) { await syncLocalVectors(); lastSync = Date.now(); }
  const [target] = await embedLocal([query], "query");
  const rows = getDb().prepare("SELECT l.video_id AS videoId, l.vector FROM local_vectors l JOIN videos v ON v.id = l.video_id WHERE v.archived_at IS NULL").all() as Array<{ videoId: string; vector: Buffer }>;
  const goal = new Float32Array(target);
  const best = new Map<string, number>();
  for (const row of rows) {
    const score = cosineSimilarity(goal, vector(row.vector));
    if (score > (best.get(row.videoId) ?? -1)) best.set(row.videoId, score);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const cutoff = Math.max(LOCAL_MIN_SCORE, (ranked[0]?.[1] ?? 0) - LOCAL_WINDOW);
  return ranked.filter(([, score]) => score >= cutoff).slice(0, limit).map(([id, score]) => ({ id, score: Math.round(score * 1000) / 1000 }));
}

export async function semanticSearch(query: string, limit = 40) {
  if (query.trim().length < 3) return [];
  if ((process.env.LUMINA_SEMANTIC_PROVIDER || "local") === "local") {
    try { return await localSearch(query, limit); }
    catch { /* sin modelo local (por ejemplo, sin haberlo descargado): se intenta con Gemini */ }
  }
  if (!hasAIKey()) return [];
  const model = currentEmbeddingModel();
  const target = await queryVector(query);
  if (!target) return [];
  const rows = getDb().prepare(`
    SELECT r.video_id AS videoId, r.embedding FROM retrieval_units r JOIN videos v ON v.id = r.video_id
    WHERE r.embedding IS NOT NULL AND r.embedding_model = ? AND v.archived_at IS NULL
  `).all(model) as Array<{ videoId: string; embedding: Buffer }>;
  const best = new Map<string, number>();
  for (const row of rows) {
    const candidate = vector(row.embedding);
    if (candidate.length !== target.length) continue;
    const score = cosineSimilarity(target, candidate);
    if (score > (best.get(row.videoId) ?? -1)) best.set(row.videoId, score);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const cutoff = Math.max(MIN_SCORE, (ranked[0]?.[1] ?? 0) - RELATIVE_WINDOW);
  return ranked.filter(([, score]) => score >= cutoff).slice(0, limit).map(([id, score]) => ({ id, score: Math.round(score * 1000) / 1000 }));
}
