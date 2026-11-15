import { getDb, refreshVideoSearch } from "./db";
import { quotedText } from "./note-text";
import { syncRetrievalUnit } from "./knowledge";
import { extractNoteLinks, renameNoteLinks, titleFromContent } from "./note-text";
import type { NoteConnection, NoteVersion } from "./types";
import { makeId } from "./utils";

const VERSION_INTERVAL_MS = 10 * 60 * 1000;
const MAX_VERSIONS = 50;
const DISPLAY_TITLE = "COALESCE(NULLIF(custom_title, ''), title)";

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function storeVersion(videoId: string, content: string, profileId: string) {
  const db = getDb();
  db.prepare("INSERT INTO note_versions(id, video_id, content, created_by, created_at) VALUES(?, ?, ?, ?, ?)").run(makeId("nvr"), videoId, content, profileId, new Date().toISOString());
  db.prepare(`DELETE FROM note_versions WHERE video_id = ? AND id NOT IN (SELECT id FROM note_versions WHERE video_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_VERSIONS})`).run(videoId, videoId);
}

// Cuando cambia un título, los [[enlaces]] que lo citan se reescriben para no romperse.
export function renameLinksEverywhere(from: string, to: string, profileId: string) {
  if (!from.trim() || from.trim().toLocaleLowerCase("es") === to.trim().toLocaleLowerCase("es")) return;
  const db = getDb();
  const rows = db.prepare("SELECT video_id AS id, content FROM notes WHERE content LIKE ? ESCAPE '\\'").all(`%[[${escapeLike(from.trim())}]]%`) as Array<{ id: string; content: string }>;
  for (const row of rows) {
    const next = renameNoteLinks(row.content, from, to);
    if (next === row.content) continue;
    db.prepare("UPDATE notes SET content = ?, updated_by = ?, updated_at = ? WHERE video_id = ?").run(next, profileId, new Date().toISOString(), row.id);
    refreshVideoSearch(row.id);
  }
}

// Las notas se indexan solo en este Mac: nunca se envían a un proveedor de IA al guardar.
export function saveNoteContent(input: { videoId: string; profileId: string; content: string; forceVersion?: boolean }) {
  const db = getDb();
  const video = db.prepare(`SELECT source_type AS sourceType, custom_title AS customTitle, ${DISPLAY_TITLE} AS title FROM videos WHERE id = ?`).get(input.videoId) as { sourceType: string; customTitle: string; title: string } | undefined;
  if (!video) throw new Error("Fuente no encontrada.");
  const current = db.prepare("SELECT content FROM notes WHERE video_id = ?").get(input.videoId) as { content: string } | undefined;
  const now = new Date().toISOString();
  if (current?.content === input.content) return { changed: false, updatedAt: now };
  db.transaction(() => {
    if (current?.content.trim()) {
      const latest = db.prepare("SELECT created_at AS createdAt FROM note_versions WHERE video_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(input.videoId) as { createdAt: string } | undefined;
      if (input.forceVersion || !latest || Date.now() - new Date(latest.createdAt).getTime() >= VERSION_INTERVAL_MS) storeVersion(input.videoId, current.content, input.profileId);
    }
    db.prepare(`
      INSERT INTO notes(video_id, content, updated_by, updated_at) VALUES(?, ?, ?, ?)
      ON CONFLICT(video_id) DO UPDATE SET content = excluded.content, updated_by = excluded.updated_by, updated_at = excluded.updated_at
    `).run(input.videoId, input.content, input.profileId, now);
    db.prepare("UPDATE videos SET updated_at = ? WHERE id = ?").run(now, input.videoId);
    if (video.sourceType === "note" && !video.customTitle) {
      const title = titleFromContent(input.content);
      if (title !== video.title) {
        db.prepare("UPDATE videos SET title = ? WHERE id = ?").run(title, input.videoId);
        renameLinksEverywhere(video.title, title, input.profileId);
      }
    }
  })();
  if (video.sourceType === "note") syncRetrievalUnit({ id: `ret_note_${input.videoId}`, videoId: input.videoId, sourceKind: "note", sourceRef: "note", text: input.content, embedding: null, embeddingModel: "" });
  refreshVideoSearch(input.videoId);
  return { changed: true, updatedAt: now };
}

export function createNote(input: { content: string; profileId: string }) {
  const content = input.content.trim();
  if (!content) throw new Error("La nota está vacía.");
  const id = makeId("nte");
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at, ready_at)
    VALUES(?, ?, 'note', '', ?, ?, '', '', '', '', '', 'note', 'ready', ?, ?, ?, ?)
  `).run(id, id, `local://nota/${id}`, titleFromContent(content), input.profileId, now, now, now);
  saveNoteContent({ videoId: id, profileId: input.profileId, content });
  return { id };
}

export function appendSourceNote(videoId: string, profileId: string, text: string) {
  const addition = text.trim();
  if (!addition) return;
  const current = getDb().prepare("SELECT content FROM notes WHERE video_id = ?").get(videoId) as { content: string } | undefined;
  saveNoteContent({ videoId, profileId, content: current?.content.trim() ? `${current.content.trim()}\n\n${addition}` : addition });
}

export function noteConnections(videoId: string): { backlinks: NoteConnection[]; outgoing: NoteConnection[] } {
  const db = getDb();
  const video = db.prepare(`SELECT ${DISPLAY_TITLE} AS title FROM videos WHERE id = ?`).get(videoId) as { title: string } | undefined;
  if (!video) return { backlinks: [], outgoing: [] };
  const backlinks = db.prepare(`
    SELECT v.id, ${DISPLAY_TITLE} AS title, v.source_type AS sourceType FROM notes n
    JOIN videos v ON v.id = n.video_id
    WHERE n.content LIKE ? ESCAPE '\\' AND v.id != ? AND v.archived_at IS NULL
    ORDER BY n.updated_at DESC
  `).all(`%[[${escapeLike(video.title)}]]%`, videoId) as NoteConnection[];
  const note = db.prepare("SELECT content FROM notes WHERE video_id = ?").get(videoId) as { content: string } | undefined;
  const find = db.prepare(`SELECT id, ${DISPLAY_TITLE} AS title, source_type AS sourceType FROM videos WHERE ${DISPLAY_TITLE} = ? COLLATE NOCASE AND archived_at IS NULL LIMIT 1`);
  const outgoing = extractNoteLinks(note?.content ?? "").map((title) => (find.get(title) as NoteConnection | undefined) ?? { id: null, title, sourceType: null });
  return { backlinks, outgoing };
}

export function searchLinkTargets(query: string, excludeId = "") {
  return getDb().prepare(`
    SELECT id, ${DISPLAY_TITLE} AS title, source_type AS sourceType FROM videos
    WHERE archived_at IS NULL AND id != ? AND ${DISPLAY_TITLE} LIKE ? ESCAPE '\\'
    ORDER BY CASE source_type WHEN 'note' THEN 0 ELSE 1 END, updated_at DESC LIMIT 8
  `).all(excludeId, `%${escapeLike(query.trim())}%`) as NoteConnection[];
}

export function resolveLinkTarget(title: string) {
  return getDb().prepare(`SELECT id FROM videos WHERE ${DISPLAY_TITLE} = ? COLLATE NOCASE AND archived_at IS NULL LIMIT 1`).get(title.trim()) as { id: string } | undefined;
}

export function listNoteVersions(videoId: string): NoteVersion[] {
  return getDb().prepare("SELECT id, content, created_at AS createdAt FROM note_versions WHERE video_id = ? ORDER BY created_at DESC, rowid DESC").all(videoId) as NoteVersion[];
}

// Restaurar nunca pierde nada: lo actual queda guardado como otra versión.
export function restoreNoteVersion(videoId: string, versionId: string, profileId: string) {
  const version = getDb().prepare("SELECT content FROM note_versions WHERE id = ? AND video_id = ?").get(versionId, videoId) as { content: string } | undefined;
  if (!version) throw new Error("Esa versión ya no existe.");
  saveNoteContent({ videoId, profileId, content: version.content, forceVersion: true });
  return { content: version.content };
}

// Un recorte entre comillas se guarda como cita, con enlace a la página de donde salió.
export function createQuoteFromClip(input: { clip: string; title: string; url: string; profileId: string }) {
  const quote = quotedText(input.clip);
  if (!quote) return null;
  const credit = quote.includes("\n\n— ") ? "" : `\n\n— [${input.title.replace(/[[\]]/g, "").slice(0, 120) || "Fuente"}](${input.url})`;
  return createNote({ content: quote + credit, profileId: input.profileId });
}
