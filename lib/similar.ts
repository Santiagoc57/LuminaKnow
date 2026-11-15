import { getDb } from "./db";

// Medido con tu biblioteca: lo parecido queda entre 0,69 y 1,0, y lo no relacionado por encima de 1,05.
export const MAX_SIMILAR_DISTANCE = 1.02;

export function printFromBase64(value: string | null | undefined) {
  return value ? Buffer.from(value, "base64") : Buffer.alloc(0);
}

function toFloats(blob: Buffer) {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export function printDistance(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

export function rankBySimilarity(seed: Float32Array, candidates: Array<{ id: string; print: Float32Array }>, limit: number) {
  return candidates
    .filter((candidate) => candidate.print.length === seed.length)
    .map((candidate) => ({ id: candidate.id, distance: printDistance(seed, candidate.print) }))
    .filter((candidate) => candidate.distance <= MAX_SIMILAR_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function findSimilarSources(videoId: string, limit = 24) {
  const rows = getDb().prepare(`
    SELECT v.id, a.feature_print AS print FROM videos v
    JOIN visual_analysis a ON a.video_id = v.id
    WHERE length(a.feature_print) > 0 AND (v.archived_at IS NULL OR v.id = ?)
  `).all(videoId) as Array<{ id: string; print: Buffer }>;
  const seed = rows.find((row) => row.id === videoId);
  if (!seed) return null;
  const candidates = rows.filter((row) => row.id !== videoId).map((row) => ({ id: row.id, print: toFloats(row.print) }));
  return rankBySimilarity(toFloats(seed.print), candidates, limit);
}
