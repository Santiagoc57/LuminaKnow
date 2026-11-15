import { getDb } from "./db";
import { listHighlights } from "./highlights";
import visionLabels from "./vision-labels-es.json";
import type { AppVideo, LibraryCollection, SourceItem, SourceType } from "./types";
import { safeJson } from "./utils";
import { normalizeSummary, summaryNeedsTimestampNormalization } from "./summary";

type VideoRow = {
  id: string;
  youtube_id: string;
  source_type: AppVideo["sourceType"];
  source_published_at: string;
  thread_status: AppVideo["threadStatus"];
  url: string;
  title: string;
  custom_title: string;
  channel: string;
  thumbnail_url: string;
  duration_seconds: number;
  description: string;
  source_language: string;
  status: AppVideo["status"];
  summary_json: string | null;
  transcript_source: string;
  error: string;
  archived_at: string | null;
  resurfaced_at: string | null;
  consumed_at: string | null;
  snapshot_saved_at?: string | null;
  link_status?: string | null;
  top_position: number | null;
  created_at: string;
  updated_at: string;
  added_by_name: string;
};

export type LibraryFilters = {
  q?: string;
  sourceType?: SourceType;
  collectionId?: string;
  tagIds?: string[];
  author?: string;
  statuses?: AppVideo["status"][];
  dateFrom?: string;
  dateTo?: string;
  publishedFrom?: string;
  publishedTo?: string;
  hasNotes?: boolean;
  hasSummary?: boolean;
  thread?: "thread" | "single";
  sort?: "recent" | "oldest" | "title" | "author";
  archived?: boolean;
};

export function listCollections(): LibraryCollection[] {
  return getDb().prepare(`
    SELECT id, name, color, description, parent_id AS parentId, sort_order AS sortOrder, updated_at AS updatedAt
    FROM collections ORDER BY parent_id, sort_order, name COLLATE NOCASE
  `).all() as LibraryCollection[];
}

export function collectionDescendantIds(collectionId: string) {
  return (getDb().prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM collections WHERE id = ?
      UNION ALL
      SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id
    ) SELECT id FROM descendants
  `).all(collectionId) as Array<{ id: string }>).map((item) => item.id);
}

export function tagDescendantIds(tagId: string) {
  return (getDb().prepare(`
    SELECT ? AS id
    UNION
    SELECT child_tag_id AS id FROM tag_relations WHERE parent_tag_id = ?
  `).all(tagId, tagId) as Array<{ id: string }>).map((item) => item.id);
}

export function listVideos(input: string | LibraryFilters = ""): AppVideo[] {
  const db = getDb();
  const filters: LibraryFilters = typeof input === "string" ? { q: input } : input;
  const query = filters.q?.trim() || "";
  let rows: VideoRow[];
  if (query) {
    try {
      rows = db.prepare(`
        SELECT v.*, p.name AS added_by_name
        FROM library_search s
        JOIN videos v ON v.id = s.video_id
        JOIN profiles p ON p.id = v.added_by
        WHERE library_search MATCH ?
        ORDER BY rank
      `).all(query.split(/\s+/).map((part) => `${part.replace(/["']/g, "")}*`).join(" ")) as VideoRow[];
    } catch {
      rows = [];
    }
  } else {
    rows = db.prepare(`
      SELECT v.*, p.name AS added_by_name
      FROM videos v JOIN profiles p ON p.id = v.added_by
      ORDER BY v.created_at DESC
    `).all() as VideoRow[];
  }
  let videos = rows.filter((row) => Boolean(row.archived_at) === Boolean(filters.archived)).map((row) => hydrateVideo(row));
  if (filters.sourceType) videos = videos.filter((video) => video.sourceType === filters.sourceType);
  if (filters.statuses?.length) videos = videos.filter((video) => filters.statuses!.includes(video.status));
  if (filters.author) videos = videos.filter((video) => video.channel.toLocaleLowerCase().includes(filters.author!.toLocaleLowerCase()));
  if (filters.tagIds?.length) {
    const acceptedByFilter = filters.tagIds.map((id) => new Set(tagDescendantIds(id)));
    videos = videos.filter((video) => acceptedByFilter.every((accepted) => video.tags.some((tag) => accepted.has(tag.id))));
  }
  if (filters.collectionId) {
    const ids = new Set(collectionDescendantIds(filters.collectionId));
    videos = videos.filter((video) => video.collections.some((collection) => ids.has(collection.id)));
  }
  const inDateRange = (value: string, from?: string, to?: string) => {
    if (!value && (from || to)) return false;
    const time = value ? new Date(value).getTime() : 0;
    if (from && time < new Date(from).getTime()) return false;
    if (to && time > new Date(`${to}T23:59:59.999`).getTime()) return false;
    return true;
  };
  videos = videos.filter((video) => inDateRange(video.createdAt, filters.dateFrom, filters.dateTo));
  videos = videos.filter((video) => inDateRange(video.sourcePublishedAt, filters.publishedFrom, filters.publishedTo));
  if (filters.hasNotes != null) videos = videos.filter((video) => Boolean(video.note?.content.trim()) === filters.hasNotes);
  if (filters.hasSummary != null) videos = videos.filter((video) => Boolean(video.summary) === filters.hasSummary);
  if (filters.thread) videos = videos.filter((video) => {
    if (video.sourceType !== "x" && video.sourceType !== "reddit") return false;
    return (video.sourceItems.length > 1 ? "thread" : "single") === filters.thread;
  });
  return videos.sort((a, b) => {
    if (filters.sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (filters.sort === "title") return a.title.localeCompare(b.title, "es");
    if (filters.sort === "author") return a.channel.localeCompare(b.channel, "es");
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function getVideo(id: string) {
  const row = getDb().prepare(`
    SELECT v.*, p.name AS added_by_name
    FROM videos v JOIN profiles p ON p.id = v.added_by
    WHERE v.id = ?
  `).get(id) as VideoRow | undefined;
  return row ? hydrateVideo(row, true) : null;
}

function visualAnalysis(videoId: string): AppVideo["visual"] {
  const row = getDb().prepare("SELECT text, labels_json AS labels, colors_json AS colors, width, height, description, objects_json AS objects, ai_model AS aiModel, error, length(feature_print) > 0 AS hasPrint FROM visual_analysis WHERE video_id = ?").get(videoId) as { text: string; labels: string; colors: string; width: number; height: number; description: string; objects: string; aiModel: string; error: string; hasPrint: number } | undefined;
  if (!row) return null;
  const names = visionLabels as Record<string, string>;
  return {
    text: row.text,
    labels: safeJson<Array<{ id: string; confidence: number }>>(row.labels, []).map((label) => ({ ...label, name: names[label.id] || label.id.replaceAll("_", " ") })),
    colors: safeJson<Array<{ hex: string; share: number }>>(row.colors, []),
    width: row.width,
    height: row.height,
    description: row.description,
    objects: safeJson<string[]>(row.objects, []),
    aiModel: row.aiModel,
    error: row.error,
    hasPrint: Boolean(row.hasPrint),
  };
}

const PDF_LIST_TEXT_LIMIT = 20_000;

// Un PDF puede tener cientos de páginas: los listados llevan solo el inicio y el detalle lo trae completo.
function trimPdfItems(items: SourceItem[]) {
  let budget = PDF_LIST_TEXT_LIMIT;
  const kept: SourceItem[] = [];
  for (const item of items) {
    if (budget <= 0) break;
    kept.push({ ...item, text: item.text.slice(0, budget) });
    budget -= item.text.length;
  }
  return kept;
}

function hydrateVideo(row: VideoRow, full = false): AppVideo {
  const db = getDb();
  const tags = db.prepare(`
    SELECT t.id, COALESCE(t.catalog_key, '') AS catalogKey, t.name, t.color, t.level,
      t.sort_order AS sortOrder, t.active,
      COALESCE((SELECT GROUP_CONCAT(parent_tag_id) FROM tag_relations WHERE child_tag_id = t.id), '') AS parentIdsCsv
    FROM tags t
    JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ?
      AND t.active = 1 AND t.level IN ('primary', 'secondary', 'free')
    ORDER BY CASE t.level WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END, CASE WHEN vt.origin = 'manual' THEN 0 ELSE 1 END, vt.confidence DESC, t.sort_order, t.name COLLATE NOCASE
  `).all(row.id).map((tag) => {
    const item = tag as Omit<AppVideo["tags"][number], "parentIds" | "active"> & { parentIdsCsv: string; active: number };
    const { parentIdsCsv, ...rest } = item;
    return { ...rest, parentIds: parentIdsCsv ? parentIdsCsv.split(",") : [], active: Boolean(item.active) };
  }) as AppVideo["tags"];
  const collections = db.prepare(`
    SELECT c.id, c.name, c.color FROM collections c
    JOIN video_collections vc ON vc.collection_id = c.id WHERE vc.video_id = ? ORDER BY c.name
  `).all(row.id) as AppVideo["collections"];
  const note = db.prepare(`
    SELECT n.content, n.updated_at AS updatedAt, p.name AS updatedByName
    FROM notes n JOIN profiles p ON p.id = n.updated_by WHERE n.video_id = ?
  `).get(row.id) as AppVideo["note"] | undefined;
  const sourceItemRows = db.prepare(`
    SELECT id, external_id AS externalId, ordinal, url, author_name AS authorName,
      author_handle AS authorHandle, text, published_at AS publishedAt, preview_url AS previewUrl,
      metadata_json AS metadataJson
    FROM source_items WHERE video_id = ? ORDER BY ordinal
  `).all(row.id) as Array<Omit<SourceItem, "metadata"> & { metadataJson: string }>;
  const allItems = sourceItemRows.map(({ metadataJson, ...item }) => ({ ...item, metadata: safeJson<SourceItem["metadata"]>(metadataJson, {}) }));
  const sourceItems = row.source_type === "pdf" && !full ? trimPdfItems(allItems) : allItems;
  const rawSummary = safeJson<unknown>(row.summary_json, null);
  const needsSummaryNormalization = summaryNeedsTimestampNormalization(rawSummary);
  const evidenceChunks = needsSummaryNormalization
    ? db.prepare("SELECT start_seconds AS startSeconds, text FROM transcript_chunks WHERE video_id = ? ORDER BY ordinal").all(row.id) as Array<{ startSeconds: number; text: string }>
    : [];
  const summary = normalizeSummary(rawSummary, evidenceChunks);
  if (needsSummaryNormalization && summary) db.prepare("UPDATE videos SET summary_json = ? WHERE id = ?").run(JSON.stringify(summary), row.id);
  return {
    id: row.id,
    youtubeId: row.youtube_id,
    sourceType: row.source_type || "youtube",
    sourcePublishedAt: row.source_published_at || "",
    url: row.url,
    title: row.custom_title || row.title,
    channel: row.channel,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds,
    description: row.description,
    sourceLanguage: row.source_language,
    status: row.status,
    summary,
    transcriptSource: row.transcript_source,
    error: row.error,
    highlights: listHighlights(row.id),
    visual: visualAnalysis(row.id),
    archivedAt: row.archived_at ?? null,
    resurfacedAt: row.resurfaced_at ?? null,
    consumedAt: row.consumed_at ?? null,
    snapshotSavedAt: row.snapshot_saved_at ?? null,
    linkStatus: row.link_status ?? null,
    topPosition: row.top_position ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    addedByName: row.added_by_name,
    tags,
    collections,
    note: note ?? null,
    sourceItems,
    threadStatus: row.thread_status || (sourceItems.length > 1 ? "complete" : "single"),
  };
}

export function getVideoTranscript(videoId: string) {
  return getDb().prepare(`
    SELECT id, ordinal, start_seconds AS startSeconds, end_seconds AS endSeconds, text
    FROM transcript_chunks WHERE video_id = ? ORDER BY ordinal
  `).all(videoId);
}

export function getConversation(videoId: string, profileId: string) {
  const db = getDb();
  const conversation = db.prepare("SELECT id FROM conversations WHERE video_id = ? AND profile_id = ?")
    .get(videoId, profileId) as { id: string } | undefined;
  if (!conversation) return [];
  return db.prepare(`
    SELECT id, role, content, citations_json AS citationsJson, created_at AS createdAt
    FROM messages WHERE conversation_id = ? ORDER BY created_at
  `).all(conversation.id).map((message) => {
    const item = message as Record<string, string>;
    return { ...item, citations: safeJson(item.citationsJson, []) };
  });
}
