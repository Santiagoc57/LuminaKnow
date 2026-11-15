import { getDb } from "./db";

export const SHELF_LIMIT = 6;

export function addToShelf(videoId: string) {
  const db = getDb();
  db.transaction(() => {
    const current = db.prepare("SELECT top_position AS position FROM videos WHERE id = ?").get(videoId) as { position: number | null } | undefined;
    if (!current) throw new Error("Fuente no encontrada.");
    if (current.position !== null) return;
    const { count, last } = db.prepare("SELECT COUNT(*) AS count, COALESCE(MAX(top_position), -1) AS last FROM videos WHERE top_position IS NOT NULL").get() as { count: number; last: number };
    if (count >= SHELF_LIMIT) throw new Error(`"En mente" admite ${SHELF_LIMIT} fuentes. Quita una para añadir otra.`);
    db.prepare("UPDATE videos SET top_position = ? WHERE id = ?").run(last + 1, videoId);
  })();
}

export function removeFromShelf(videoId: string) {
  getDb().prepare("UPDATE videos SET top_position = NULL WHERE id = ?").run(videoId);
}

export function reorderShelf(ids: string[]) {
  const db = getDb();
  db.transaction(() => {
    const current = (db.prepare("SELECT id FROM videos WHERE top_position IS NOT NULL").all() as Array<{ id: string }>).map((row) => row.id);
    if (current.length !== ids.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) throw new Error("La repisa cambió. Recarga e intenta de nuevo.");
    const update = db.prepare("UPDATE videos SET top_position = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index, id));
  })();
}
