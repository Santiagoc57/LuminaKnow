import { getDb, refreshVideoSearch } from "./db";
import { makeId } from "./utils";
import { colorName } from "./visual-colors";

export type PaletteSwatch = { hex: string; share: number };

// Una paleta es su propia tarjeta (como en mymind): se saca de los colores que Vision midió en una imagen guardada.
export function createPaletteFromImage(sourceId: string, profileId: string) {
  const db = getDb();
  const source = db.prepare("SELECT id, title, custom_title AS customTitle, thumbnail_url AS thumbnail FROM videos WHERE id = ?").get(sourceId) as { id: string; title: string; customTitle: string; thumbnail: string } | undefined;
  if (!source) throw new Error("Esa imagen ya no está en Lúmina.");
  const visual = db.prepare("SELECT colors_json AS colors FROM visual_analysis WHERE video_id = ?").get(sourceId) as { colors: string } | undefined;
  const colors = (JSON.parse(visual?.colors || "[]") as PaletteSwatch[]).filter((swatch) => /^#[0-9a-f]{6}$/i.test(swatch.hex)).slice(0, 6);
  if (colors.length < 2) throw new Error("Esta imagen aún no tiene colores analizados.");
  const key = `palette-${source.id}`;
  const existing = db.prepare("SELECT id FROM videos WHERE youtube_id = ?").get(key) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const id = makeId("pal");
  const now = new Date().toISOString();
  const names = [...new Set(colors.map((swatch) => colorName(swatch.hex)))];
  const title = `Paleta · ${(source.customTitle || source.title).slice(0, 80)}`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at, ready_at)
      VALUES(?, ?, 'palette', '', ?, ?, '', '', '', ?, '', 'palette', 'ready', ?, ?, ?, ?)
    `).run(id, key, `local://paleta/${id}`, title, `Colores: ${names.join(", ")}. ${colors.map((swatch) => swatch.hex).join(" ")}`, profileId, now, now, now);
    db.prepare(`
      INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at)
      VALUES(?, ?, ?, 0, ?, '', ?, '', '', ?, ?)
    `).run(makeId("item"), id, source.id, source.thumbnail, colors.map((swatch) => swatch.hex).join(" "), JSON.stringify({ kind: "post" }), now);
    // Los colores van también al análisis visual, para que «color:azul» encuentre la paleta.
    db.prepare("INSERT INTO visual_analysis(video_id, text, labels_json, colors_json, width, height, analyzed_at) VALUES(?, '', '[]', ?, 0, 0, ?)").run(id, JSON.stringify(colors), now);
  })();
  refreshVideoSearch(id);
  return { id, duplicate: false };
}
