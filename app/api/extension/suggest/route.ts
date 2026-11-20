import { z } from "zod";
import { suggestEarlySourceMetadata } from "@/lib/ai";
import { LIBRARY_TAG_CATALOG } from "@/lib/canonical-tags";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { parseLibraryQuery } from "@/lib/library-query";
import { listSmartSpaces } from "@/lib/spaces";
import { parseSourceUrl } from "@/lib/utils";
import { relatedSources } from "@/lib/related";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

const text = (limit: number) => z.string().trim().default("").transform((value) => value.slice(0, limit));
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

// Qué espacio le va mejor: el que tiene una regla con esas etiquetas, o el que guarda cosas con las mismas etiquetas.
function suggestSpace(tagNames: string[]) {
  if (!tagNames.length) return null;
  const db = getDb();
  const wanted = new Set(tagNames.map(fold));
  let best: { id: string; name: string; score: number; reason: string } | null = null;
  for (const space of listSmartSpaces()) {
    let score = 0;
    let reason = "";
    if (space.query) {
      const ruleTags = parseLibraryQuery(space.query).tagTerms.map(fold);
      const hits = ruleTags.filter((term) => [...wanted].some((name) => name.includes(term)));
      if (hits.length) { score += 10 * hits.length; reason = "Encaja con su regla"; }
    }
    if (space.itemIds.length) {
      const rows = db.prepare(`SELECT t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id IN (${space.itemIds.map(() => "?").join(",")})`).all(...space.itemIds) as Array<{ name: string }>;
      const overlap = rows.filter((row) => wanted.has(fold(row.name))).length / space.itemIds.length;
      if (overlap > 0) { score += overlap * 4; reason ||= "Tiene cosas parecidas"; }
    }
    if (score >= 1.5 && (!best || score > best.score)) best = { id: space.id, name: space.name, score, reason };
  }
  return best ? { id: best.id, name: best.name, reason: best.reason } : null;
}

// «Ya tienes cosas sobre esto»: fuentes que comparten etiquetas sugeridas o palabras del título.
function similarSaved(tagKeys: string[], title: string, excludeId = "") {
  const db = getDb();
  const scores = new Map<string, number>();
  if (tagKeys.length) {
    const rows = db.prepare(`SELECT vt.video_id AS id, t.level FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE t.catalog_key IN (${tagKeys.map(() => "?").join(",")})`).all(...tagKeys) as Array<{ id: string; level: string }>;
    rows.forEach((row) => scores.set(row.id, (scores.get(row.id) ?? 0) + (row.level === "secondary" ? 3 : 1.5)));
  }
  const words = title.toLocaleLowerCase("es").match(/[\p{L}\p{N}]{5,}/gu)?.slice(0, 8) ?? [];
  if (words.length) {
    try {
      const rows = db.prepare("SELECT video_id AS id FROM library_search WHERE library_search MATCH ? LIMIT 20").all(words.map((word) => `"${word}"`).join(" OR ")) as Array<{ id: string }>;
      rows.forEach((row) => scores.set(row.id, (scores.get(row.id) ?? 0) + 2));
    } catch { /* búsqueda sin coincidencias */ }
  }
  scores.delete(excludeId);
  const ranked = [...scores].filter(([, score]) => score >= 3).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return ranked.map(([id]) => db.prepare("SELECT id, COALESCE(NULLIF(custom_title, ''), title) AS title, source_type AS sourceType FROM videos WHERE id = ? AND archived_at IS NULL").get(id) as { id: string; title: string; sourceType: string } | undefined)
    .filter((row): row is { id: string; title: string; sourceType: string } => Boolean(row)).map((row) => ({ ...row, luminaUrl: `/?video=${encodeURIComponent(row.id)}` }));
}

// Para el diálogo de guardado: etiquetas que sugiere la IA leyendo la página (también si ya está guardada: las que le faltan),
// el espacio que le va mejor y el catálogo completo para añadir a mano.
export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const body = z.object({ url: z.string().trim().url(), title: text(300), description: text(2_000), author: text(160), text: text(5_000) }).parse(await request.json());
    const db = getDb();
    const colors = new Map((db.prepare("SELECT catalog_key AS key, color FROM tags WHERE catalog_key IS NOT NULL").all() as Array<{ key: string; color: string }>).map((row) => [row.key, row.color]));
    const catalog = LIBRARY_TAG_CATALOG.map((tag) => ({ key: tag.id, name: tag.name, level: tag.level, parents: tag.parentNames, color: colors.get(tag.id) || "#d8d3ca" }));
    const byKey = new Map(catalog.map((tag) => [tag.key, tag]));
    let parsed: ReturnType<typeof parseSourceUrl> = null;
    try { parsed = parseSourceUrl(body.url); } catch { parsed = null; }
    const existingRow = parsed ? db.prepare("SELECT id, COALESCE(NULLIF(custom_title, ''), title) AS title, summary_json AS summaryJson FROM videos WHERE source_type = ? AND youtube_id = ?").get(parsed.sourceType, parsed.sourceId) as { id: string; title: string; summaryJson: string } | undefined : undefined;
    const existingTags = existingRow ? db.prepare("SELECT t.name, t.level, COALESCE(t.catalog_key, '') AS key, t.color FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id = ? ORDER BY CASE t.level WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END").all(existingRow.id) as Array<{ name: string; level: string; key: string; color: string }> : [];
    const summary = existingRow ? JSON.parse(existingRow.summaryJson || "{}") as { gist?: string } : {};
    const suggestion = await suggestEarlySourceMetadata({ title: body.title, author: body.author, content: [summary.gist, body.description, body.text].filter(Boolean).join("\n\n"), sourceType: parsed?.sourceType ?? "web" });
    const have = new Set(existingTags.map((tag) => tag.key).filter(Boolean));
    const suggested = suggestion.tagIds.map((key) => byKey.get(key)).filter((tag): tag is NonNullable<typeof tag> => Boolean(tag) && !have.has(tag!.key));
    const space = suggestSpace([...existingTags.map((tag) => tag.name), ...suggested.map((tag) => tag.name)]);
    const existing = existingRow ? { id: existingRow.id, title: existingRow.title, tags: existingTags, luminaUrl: `/?video=${encodeURIComponent(existingRow.id)}` } : null;
    const similar = existingRow
      ? relatedSources(existingRow.id, 3).map((item) => ({ id: item.id, title: item.title, sourceType: item.sourceType, luminaUrl: `/?video=${encodeURIComponent(item.id)}` }))
      : similarSaved(suggested.map((tag) => tag.key), suggestion.title || body.title);
    return extensionJson(request, { existing, suggested, similar, suggestedTitle: suggestion.title || "", suggestedSpace: space, usedAI: suggestion.usedAI, catalog });
  } catch (error) { return extensionError(request, error); }
}
