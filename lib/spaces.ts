import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "./db";
import { removeCollection } from "./collections";
import type { SmartSpace } from "./types";
import { makeId } from "./utils";

// Carpetas y espacios son ahora una sola cosa: una carpeta guarda lo que metes a mano y, si tiene regla
// (una búsqueda guardada como «#Política tipo:video»), también se llena sola con todo lo que coincida.
// El resto de la app sigue llamándolas «espacios» por dentro (SmartSpace), pero viven en la tabla de colecciones.

const RANDOM_COLORS = ["#e75e3a", "#e0912f", "#8aa63a", "#3f9d6c", "#2f9c9c", "#3d86c6", "#5a6fd1", "#8560c9", "#c056a8", "#d9537a"];
const MERGED_FLAG = "spaces_merged_into_collections";

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

// Una sola vez: añade la regla a las carpetas y pasa los espacios antiguos a carpetas (sin borrar los originales).
export function ensureFolderRules(db = getDb()) {
  if (!hasColumn(db, "collections", "query")) db.exec("ALTER TABLE collections ADD COLUMN query TEXT NOT NULL DEFAULT ''");
  if (db.prepare("SELECT 1 FROM settings WHERE key = ?").get(MERGED_FLAG)) return;
  const hasSpaces = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'smart_spaces'").get());
  db.transaction(() => {
    if (hasSpaces) {
      const spaces = db.prepare("SELECT id, name, color, query, created_at AS createdAt FROM smart_spaces ORDER BY sort_order, created_at").all() as Array<{ id: string; name: string; color: string; query: string; createdAt: string }>;
      const now = new Date().toISOString();
      let order = (db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collections WHERE parent_id IS NULL").get() as { next: number }).next;
      for (const space of spaces) {
        let name = space.name;
        for (let attempt = 2; db.prepare("SELECT 1 FROM collections WHERE parent_id IS NULL AND name = ? COLLATE NOCASE").get(name); attempt += 1) name = `${space.name} ${attempt}`;
        const id = makeId("col");
        db.prepare("INSERT INTO collections(id, name, color, description, parent_id, sort_order, created_at, updated_at, query) VALUES(?, ?, ?, '', NULL, ?, ?, ?, ?)").run(id, name, space.color, order, space.createdAt || now, now, space.query || "");
        order += 1;
        db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) SELECT video_id, ? FROM space_items WHERE space_id = ?").run(id, space.id);
      }
    }
    db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(MERGED_FLAG, new Date().toISOString());
  })();
}

export function listSmartSpaces(): SmartSpace[] {
  const db = getDb();
  ensureFolderRules(db);
  const folders = db.prepare("SELECT id, name, color, query, created_at AS createdAt FROM collections ORDER BY sort_order, name").all() as Array<Omit<SmartSpace, "itemIds">>;
  const items = db.prepare("SELECT collection_id AS folderId, video_id AS videoId FROM video_collections").all() as Array<{ folderId: string; videoId: string }>;
  return folders.map((folder) => ({ ...folder, itemIds: items.filter((item) => item.folderId === folder.id).map((item) => item.videoId) }));
}

export function createSmartSpace(input: { name: string; color?: string; query?: string; videoId?: string }): SmartSpace {
  const db = getDb();
  ensureFolderRules(db);
  const name = input.name.trim();
  const query = input.query?.trim() || "";
  if (db.prepare("SELECT 1 FROM collections WHERE parent_id IS NULL AND name = ? COLLATE NOCASE").get(name)) throw new Error("Ya tienes un espacio con ese nombre.");
  const { next } = db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collections WHERE parent_id IS NULL").get() as { next: number };
  const now = new Date().toISOString();
  const folder = { id: makeId("col"), name, color: input.color || RANDOM_COLORS[crypto.randomInt(RANDOM_COLORS.length)], query, createdAt: now };
  db.transaction(() => {
    db.prepare("INSERT INTO collections(id, name, color, description, parent_id, sort_order, created_at, updated_at, query) VALUES(?, ?, ?, '', NULL, ?, ?, ?, ?)").run(folder.id, folder.name, folder.color, next, now, now, query);
    if (input.videoId) addSpaceItem(folder.id, input.videoId);
  })();
  return { ...folder, itemIds: input.videoId ? [input.videoId] : [] };
}

export function updateSmartSpace(id: string, input: { name?: string; query?: string; color?: string }) {
  const db = getDb();
  ensureFolderRules(db);
  const current = db.prepare("SELECT id, parent_id AS parentId FROM collections WHERE id = ?").get(id) as { id: string; parentId: string | null } | undefined;
  if (!current) throw new Error("Espacio no encontrado.");
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Ponle un nombre al espacio.");
    if (db.prepare("SELECT 1 FROM collections WHERE parent_id IS ? AND name = ? COLLATE NOCASE AND id <> ?").get(current.parentId, name, id)) throw new Error("Ya tienes un espacio con ese nombre.");
    db.prepare("UPDATE collections SET name = ?, updated_at = ? WHERE id = ?").run(name, new Date().toISOString(), id);
  }
  if (input.query !== undefined) db.prepare("UPDATE collections SET query = ?, updated_at = ? WHERE id = ?").run(input.query.trim(), new Date().toISOString(), id);
  if (input.color !== undefined) db.prepare("UPDATE collections SET color = ?, updated_at = ? WHERE id = ?").run(input.color, new Date().toISOString(), id);
}

export function deleteSmartSpace(id: string) {
  if (!getDb().prepare("SELECT 1 FROM collections WHERE id = ?").get(id)) return false;
  removeCollection(id);
  return true;
}

export function addSpaceItem(folderId: string, videoId: string) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM collections WHERE id = ?").get(folderId)) throw new Error("Espacio no encontrado.");
  if (!db.prepare("SELECT 1 FROM videos WHERE id = ?").get(videoId)) throw new Error("Fuente no encontrada.");
  db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)").run(videoId, folderId);
}

export function removeSpaceItem(folderId: string, videoId: string) {
  getDb().prepare("DELETE FROM video_collections WHERE collection_id = ? AND video_id = ?").run(folderId, videoId);
}

export function reorderSmartSpaces(ids: string[]) {
  const db = getDb();
  db.transaction(() => {
    const update = db.prepare("UPDATE collections SET sort_order = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index, id));
  })();
}
