import { getDb, refreshVideoSearch } from "./db";
import { syncVideoMemberships } from "./knowledge";
// Etiquetas que propone la extensión con una regla por palabras y por sitio (x.com → «Redes sociales»…).
// Son solo un adelanto: no se guardan si la IA va a analizar la fuente, ni sobre una fuente que ya tiene etiquetas.
export function assignEarlyTags(videoId: string, rawIds: string[], options: { analysisQueued?: boolean; fromExtension?: boolean } = {}) {
  const ids = [...new Set(rawIds)].slice(0, 5);
  if (!ids.length || options.analysisQueued) return;
  const db = getDb();
  if (options.fromExtension && db.prepare("SELECT 1 FROM video_tags WHERE video_id = ? LIMIT 1").get(videoId)) return;
  const tags = db.prepare(`SELECT id, level FROM tags WHERE active = 1 AND catalog_key IS NOT NULL AND id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Array<{ id: string; level: string }>;
  const selected = [...tags.filter((tag) => tag.level === "primary").slice(0, 3), ...tags.filter((tag) => tag.level === "secondary").slice(0, 2)];
  db.transaction(() => selected.forEach((tag) => db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'early_ai', 0.72)").run(videoId, tag.id)))();
  refreshVideoSearch(videoId);
  syncVideoMemberships(videoId);
}
