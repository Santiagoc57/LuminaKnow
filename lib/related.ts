import { getDb } from "./db";

export type RelatedReason = { kind: "tag" | "collection" | "author"; label: string };
export type RelatedSource = { id: string; title: string; thumbnailUrl: string; sourceType: string; channel: string; gist: string; score: number; reasons: RelatedReason[] };

// Fuentes de tu biblioteca que comparten etiquetas, colecciones o autor con esta. Las etiquetas pesan más.
export function relatedSources(videoId: string, limit = 12): RelatedSource[] {
  const db = getDb();
  const self = db.prepare("SELECT channel FROM videos WHERE id = ?").get(videoId) as { channel: string } | undefined;
  if (!self) return [];
  const scores = new Map<string, { score: number; reasons: RelatedReason[] }>();
  const add = (id: string, points: number, reason: RelatedReason) => {
    const entry = scores.get(id) ?? { score: 0, reasons: [] };
    if (entry.reasons.some((item) => item.kind === reason.kind && item.label === reason.label)) return;
    entry.score += points;
    entry.reasons.push(reason);
    scores.set(id, entry);
  };
  (db.prepare(`
    SELECT other.video_id AS id, t.name FROM video_tags mine
    JOIN video_tags other ON other.tag_id = mine.tag_id AND other.video_id <> mine.video_id
    JOIN tags t ON t.id = mine.tag_id AND t.active = 1
    WHERE mine.video_id = ?
  `).all(videoId) as Array<{ id: string; name: string }>).forEach((row) => add(row.id, 3, { kind: "tag", label: row.name }));
  (db.prepare(`
    SELECT other.video_id AS id, c.name FROM video_collections mine
    JOIN video_collections other ON other.collection_id = mine.collection_id AND other.video_id <> mine.video_id
    JOIN collections c ON c.id = mine.collection_id
    WHERE mine.video_id = ?
  `).all(videoId) as Array<{ id: string; name: string }>).forEach((row) => add(row.id, 2, { kind: "collection", label: row.name }));
  if (self.channel.trim()) {
    (db.prepare("SELECT id FROM videos WHERE channel = ? AND id <> ? LIMIT 50").all(self.channel, videoId) as Array<{ id: string }>)
      .forEach((row) => add(row.id, 2, { kind: "author", label: self.channel }));
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit * 2);
  if (!ranked.length) return [];
  const rows = db.prepare(`
    SELECT id, COALESCE(NULLIF(custom_title, ''), title) AS title, thumbnail_url AS thumbnailUrl, source_type AS sourceType, channel, summary_json AS summaryJson
    FROM videos WHERE archived_at IS NULL AND id IN (${ranked.map(() => "?").join(",")})
  `).all(...ranked.map(([id]) => id)) as Array<{ id: string; title: string; thumbnailUrl: string; sourceType: string; channel: string; summaryJson: string | null }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ranked.flatMap(([id, entry]) => {
    const row = byId.get(id);
    if (!row) return [];
    let gist = "";
    try { const summary = JSON.parse(row.summaryJson || "null") as { gist?: string; cardSummary?: string } | null; gist = summary?.gist || summary?.cardSummary || ""; } catch { gist = ""; }
    return [{ id: row.id, title: row.title, thumbnailUrl: row.thumbnailUrl || "", sourceType: row.sourceType, channel: row.channel || "", gist: gist.slice(0, 220), score: entry.score, reasons: entry.reasons }];
  }).slice(0, limit);
}
