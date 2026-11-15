import { getDb, refreshVideoSearch } from "./db";
import type { Highlight } from "./types";
import { makeId } from "./utils";

const COLUMNS = "id, video_id AS videoId, quote, note, origin, created_at AS createdAt";

export function listHighlights(videoId: string): Highlight[] {
  return getDb().prepare(`SELECT ${COLUMNS} FROM highlights WHERE video_id = ? ORDER BY created_at`).all(videoId) as Highlight[];
}

export function createHighlight(input: { videoId: string; quote: string; origin: Highlight["origin"]; profileId: string }): Highlight {
  const db = getDb();
  const quote = input.quote.trim();
  const existing = db.prepare(`SELECT ${COLUMNS} FROM highlights WHERE video_id = ? AND quote = ?`).get(input.videoId, quote) as Highlight | undefined;
  if (existing) return existing;
  const highlight: Highlight = { id: makeId("hlt"), videoId: input.videoId, quote, note: "", origin: input.origin, createdAt: new Date().toISOString() };
  db.prepare("INSERT INTO highlights(id, video_id, quote, note, origin, created_by, created_at) VALUES(?, ?, ?, '', ?, ?, ?)")
    .run(highlight.id, highlight.videoId, highlight.quote, highlight.origin, input.profileId, highlight.createdAt);
  refreshVideoSearch(input.videoId);
  return highlight;
}

export function updateHighlightNote(videoId: string, id: string, note: string) {
  const changed = getDb().prepare("UPDATE highlights SET note = ? WHERE id = ? AND video_id = ?").run(note, id, videoId).changes > 0;
  if (changed) refreshVideoSearch(videoId);
  return changed;
}

export function deleteHighlight(videoId: string, id: string) {
  const changed = getDb().prepare("DELETE FROM highlights WHERE id = ? AND video_id = ?").run(id, videoId).changes > 0;
  if (changed) refreshVideoSearch(videoId);
  return changed;
}
