import crypto from "node:crypto";
import path from "node:path";
import { getDb } from "./db";

// Búsqueda por significado sin internet: un modelo pequeño multilingüe (multilingual-e5-small) que corre
// en este Mac con Transformers.js. Se descarga una sola vez (~120 MB) a la carpeta de datos de Lúmina.
export const LOCAL_MODEL = "Xenova/multilingual-e5-small";

type Extractor = (texts: string[], options: { pooling: "mean"; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
declare global { var __luminaLocalExtractor: Promise<Extractor> | undefined; }

function modelDirectory() {
  return path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "models");
}

async function extractor() {
  if (!global.__luminaLocalExtractor) {
    global.__luminaLocalExtractor = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = modelDirectory();
      env.allowRemoteModels = process.env.LUMINA_LOCAL_MODEL_OFFLINE !== "1";
      return (await pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" })) as unknown as Extractor;
    })();
    global.__luminaLocalExtractor.catch(() => { global.__luminaLocalExtractor = undefined; });
  }
  return global.__luminaLocalExtractor;
}

// e5 distingue preguntas («query:») de textos guardados («passage:»).
export async function embedLocal(texts: string[], kind: "query" | "passage") {
  const run = await extractor();
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += 32) {
    const batch = texts.slice(start, start + 32).map((text) => `${kind}: ${text.replace(/\s+/g, " ").slice(0, 2_000)}`);
    vectors.push(...(await run(batch, { pooling: "mean", normalize: true })).tolist());
  }
  return vectors;
}

const hash = (text: string) => crypto.createHash("sha1").update(text).digest("hex").slice(0, 16);

// Mantiene al día las huellas locales: de cada fragmento ya indexado y, para lo que nunca pasó por la IA,
// de su título y descripción. Así la búsqueda cubre toda la biblioteca.
export async function syncLocalVectors() {
  const db = getDb();
  const units = db.prepare(`
    SELECT r.id AS unitId, r.video_id AS videoId, r.text FROM retrieval_units r JOIN videos v ON v.id = r.video_id WHERE v.archived_at IS NULL AND length(r.text) > 0
    UNION ALL
    SELECT 'basic_' || v.id AS unitId, v.id AS videoId, trim(COALESCE(NULLIF(v.custom_title, ''), v.title) || '. ' || v.description || ' ' || COALESCE((SELECT group_concat(text, ' ') FROM (SELECT text FROM source_items s WHERE s.video_id = v.id ORDER BY ordinal LIMIT 3)), '') || ' ' || COALESCE((SELECT description FROM visual_analysis a WHERE a.video_id = v.id), '')) AS text
    FROM videos v WHERE v.archived_at IS NULL
  `).all() as Array<{ unitId: string; videoId: string; text: string }>;
  const known = new Map((db.prepare("SELECT unit_id AS unitId, text_hash AS textHash FROM local_vectors").all() as Array<{ unitId: string; textHash: string }>).map((row) => [row.unitId, row.textHash]));
  const pending = units.filter((unit) => unit.text.trim() && known.get(unit.unitId) !== hash(unit.text));
  if (pending.length) {
    const vectors = await embedLocal(pending.map((unit) => unit.text), "passage");
    const upsert = db.prepare("INSERT INTO local_vectors(unit_id, video_id, text_hash, vector) VALUES(?, ?, ?, ?) ON CONFLICT(unit_id) DO UPDATE SET video_id = excluded.video_id, text_hash = excluded.text_hash, vector = excluded.vector");
    db.transaction(() => pending.forEach((unit, index) => upsert.run(unit.unitId, unit.videoId, hash(unit.text), Buffer.from(new Float32Array(vectors[index]).buffer))))();
  }
  const alive = new Set(units.map((unit) => unit.unitId));
  const stale = [...known.keys()].filter((id) => !alive.has(id));
  if (stale.length) db.transaction(() => stale.forEach((id) => db.prepare("DELETE FROM local_vectors WHERE unit_id = ?").run(id)))();
  return { added: pending.length, total: units.length };
}
