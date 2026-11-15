import { getDb } from "./db";

const BUSY = ["queued", "extracting", "indexing", "summarizing"];

// Lo que el aviso de la extensión debe mostrar: las etiquetas reales de la fuente en LUMINA
// y si la IA aún está analizándola (entonces el aviso espera y vuelve a preguntar).
export function itemTagState(videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT status, COALESCE(NULLIF(custom_title, ''), title) AS title FROM videos WHERE id = ?").get(videoId) as { status: string; title: string } | undefined;
  if (!video) return { tags: [], analyzing: false };
  const tags = db.prepare(`
    SELECT t.name, t.level FROM video_tags vt JOIN tags t ON t.id = vt.tag_id
    WHERE vt.video_id = ? AND t.active = 1
    ORDER BY CASE t.level WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, t.sort_order, t.name
  `).all(videoId) as Array<{ name: string; level: string }>;
  return { tags: tags.slice(0, 6), analyzing: BUSY.includes(video.status) };
}
