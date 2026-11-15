import { getDb } from "./db";
import { makeId } from "./utils";

// Tercera capa de etiquetas: libres, sin icono, creadas por la IA o por ti (personas, marcas, temas concretos).
// Se unifican por su forma normalizada para que «Deportes», «deporte» y «deportes» sean una sola.
export const FREE_TAG_COLOR = "#a8a197";
export const MAX_FREE_TAGS_PER_SOURCE = 8;

export function freeTagKey(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es")
    .replace(/^#+/, "").replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)).join(" ");
}

export function cleanFreeTagName(name: string) {
  const clean = name.replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return clean && clean === clean.toLocaleUpperCase("es") && clean.length > 4 ? clean.charAt(0) + clean.slice(1).toLocaleLowerCase("es") : clean;
}

type TagRow = { id: string; name: string; level: string };

function tagsByKey() {
  const rows = getDb().prepare("SELECT id, name, level FROM tags WHERE active = 1 AND level IN ('primary', 'secondary', 'free', 'legacy')").all() as TagRow[];
  const map = new Map<string, TagRow>();
  // Las del catálogo ganan: si la IA propone «Fútbol», se usa la subetiqueta que ya existe.
  const rank = (level: string) => (level === "primary" ? 0 : level === "secondary" ? 1 : level === "free" ? 2 : 3);
  rows.sort((a, b) => rank(a.level) - rank(b.level)).forEach((row) => { const key = freeTagKey(row.name); if (key && !map.has(key)) map.set(key, row); });
  return map;
}

export function existingFreeTagNames(limit = 150) {
  return (getDb().prepare(`
    SELECT t.name FROM tags t LEFT JOIN video_tags vt ON vt.tag_id = t.id
    WHERE t.active = 1 AND t.level = 'free' GROUP BY t.id ORDER BY COUNT(vt.video_id) DESC, t.name LIMIT ?
  `).all(limit) as Array<{ name: string }>).map((row) => row.name);
}

export function ensureFreeTag(rawName: string, kind: "ai" | "manual" = "manual", known = tagsByKey()) {
  const name = cleanFreeTagName(rawName);
  const key = freeTagKey(name);
  if (!key) throw new Error("Escribe un nombre para la etiqueta.");
  const db = getDb();
  const existing = known.get(key) ?? (db.prepare("SELECT id, name, level FROM tags WHERE name = ? COLLATE NOCASE").get(name) as TagRow | undefined);
  if (existing) {
    if (existing.level === "legacy") db.prepare("UPDATE tags SET level = 'free', active = 1, color = ? WHERE id = ?").run(FREE_TAG_COLOR, existing.id);
    else if (!["primary", "secondary", "free"].includes(existing.level)) db.prepare("UPDATE tags SET active = 1 WHERE id = ?").run(existing.id);
    const row = { ...existing, level: existing.level === "legacy" ? "free" : existing.level };
    known.set(key, row);
    return row;
  }
  const id = makeId("tag");
  db.prepare("INSERT INTO tags(id, name, color, created_at, kind, level, sort_order, active) VALUES(?, ?, ?, ?, ?, 'free', 0, 1)").run(id, name, FREE_TAG_COLOR, new Date().toISOString(), kind);
  const row = { id, name, level: "free" };
  known.set(key, row);
  return row;
}

// Reemplaza las etiquetas libres que puso la IA sin tocar las que añadiste tú.
export function syncAiFreeTags(videoId: string, topics: string[]) {
  const db = getDb();
  const known = tagsByKey();
  const unique = new Map<string, string>();
  topics.map(cleanFreeTagName).filter(Boolean).forEach((name) => { const key = freeTagKey(name); if (key && !unique.has(key)) unique.set(key, name); });
  const names = [...unique.values()].slice(0, MAX_FREE_TAGS_PER_SOURCE);
  db.transaction(() => {
    db.prepare("DELETE FROM video_tags WHERE video_id = ? AND origin = 'ai' AND tag_id IN (SELECT id FROM tags WHERE level = 'free')").run(videoId);
    const insert = db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'ai', 0.7)");
    names.forEach((name) => {
      const tag = ensureFreeTag(name, "ai", known);
      if (tag.level === "free") insert.run(videoId, tag.id);
    });
  })();
  return names;
}
