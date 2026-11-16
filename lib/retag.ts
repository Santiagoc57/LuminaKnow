import { getDb } from "./db";
import { getVideo } from "./data";
import { decideCatalogTags } from "./tag-decisions";
import { refreshVideoSearch } from "./db";

// Reetiqueta toda la biblioteca con la API Decisions, sin volver a resumir: usa el resumen y el texto ya guardados.
// Solo cambia las etiquetas del catálogo que puso la IA; las que pusiste tú y las libres se conservan.
type RetagState = { running: boolean; total: number; done: number; changed: number; failed: number; startedAt: string; finishedAt: string };
const state = ((globalThis as unknown as { __luminaRetag?: RetagState }).__luminaRetag ??= { running: false, total: 0, done: 0, changed: 0, failed: 0, startedAt: "", finishedAt: "" });

// Cambia solo las etiquetas del catálogo puestas por la IA (no las libres ni las tuyas).
function syncCatalogTags(videoId: string, catalogKeys: string[]) {
  const db = getDb();
  const rows = catalogKeys.length ? db.prepare(`SELECT id, name, level FROM tags WHERE active = 1 AND catalog_key IN (${catalogKeys.map(() => "?").join(",")})`).all(...catalogKeys) as Array<{ id: string; name: string; level: string }> : [];
  const selected = [...rows.filter((tag) => tag.level === "primary").slice(0, 3), ...rows.filter((tag) => tag.level === "secondary").slice(0, 2)];
  db.transaction(() => {
    db.prepare("DELETE FROM video_tags WHERE video_id = ? AND origin IN ('ai', 'early_ai') AND bulk_job_id IS NULL AND tag_id IN (SELECT id FROM tags WHERE level IN ('primary', 'secondary'))").run(videoId);
    selected.forEach((tag) => db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'ai', 0.8)").run(videoId, tag.id));
  })();
  return selected.map((tag) => tag.name);
}

export function retagStatus() { return { ...state }; }

export function startRetagLibrary() {
  if (state.running) return retagStatus();
  const db = getDb();
  const ids = (db.prepare("SELECT id FROM videos WHERE status = 'ready' AND archived_at IS NULL AND source_type <> 'palette' ORDER BY created_at DESC").all() as Array<{ id: string }>).map((row) => row.id);
  Object.assign(state, { running: true, total: ids.length, done: 0, changed: 0, failed: 0, startedAt: new Date().toISOString(), finishedAt: "" });
  void (async () => {
    for (const id of ids) {
      try {
        const video = getVideo(id);
        if (!video) continue;
        const text = (db.prepare("SELECT transcript_text AS text FROM videos WHERE id = ?").get(id) as { text: string | null } | undefined)?.text
          || [video.description, ...video.sourceItems.map((item) => item.text), video.note?.content, video.visual?.description, video.visual?.text].filter(Boolean).join("\n");
        const summary = [video.summary?.gist, video.summary?.cardSummary, video.visual?.description].filter(Boolean).join(" ");
        const before = video.tags.filter((tag) => tag.level === "primary" || tag.level === "secondary").map((tag) => tag.name).sort().join("|");
        const decided = await decideCatalogTags({ title: video.title, author: video.channel, summary, content: text || "" });
        if (!decided?.length) { state.failed += 1; continue; }
        const after = syncCatalogTags(id, decided).sort().join("|");
        if (after !== before) state.changed += 1;
        refreshVideoSearch(id);
      } catch { state.failed += 1; }
      finally { state.done += 1; }
    }
    state.running = false;
    state.finishedAt = new Date().toISOString();
  })();
  return retagStatus();
}
