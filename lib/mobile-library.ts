import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { listVideos } from "./data";
import { listSmartSpaces } from "./spaces";
import { spaceQueryMatches } from "./library-query";
import type { AppVideo, LibraryTag } from "./types";

// Copia ligera de la biblioteca para el celular: lo necesario para buscar y leer sin conexión
// (sin transcripciones, sin vectores, sin conversaciones). Viaja solo por la red de casa.

export type MobileItem = {
  id: string;
  title: string;
  author: string;
  type: string;
  url: string;
  createdAt: string;
  consumedAt: string | null;
  pinned: boolean;
  status: string;
  gist: string;
  points: string[];
  takeaways: string[];
  imageText: string;
  tags: Array<{ name: string; catalog: boolean }>;
  folderIds: string[];
  note: { content: string; updatedAt: string } | null;
  highlights: Array<{ quote: string; note: string }>;
  thumb: string;
};

export function listCatalogTags(): LibraryTag[] {
  return (getDb().prepare(`
    SELECT t.id, COALESCE(t.catalog_key, '') AS catalogKey, t.name, t.color, t.level, t.sort_order AS sortOrder, t.active,
      COALESCE((SELECT GROUP_CONCAT(parent_tag_id) FROM tag_relations WHERE child_tag_id = t.id), '') AS parentIdsCsv
    FROM tags t WHERE t.active = 1 AND t.level IN ('primary', 'secondary')
  `).all() as Array<Omit<LibraryTag, "parentIds" | "active"> & { parentIdsCsv: string; active: number }>).map(({ parentIdsCsv, ...tag }) => ({ ...tag, active: Boolean(tag.active), parentIds: parentIdsCsv ? parentIdsCsv.split(",") : [] }));
}

// Cambia cuando cambia la imagen: el celular solo vuelve a bajar las miniaturas nuevas.
export function thumbVersion(thumbnailUrl: string) {
  return thumbnailUrl ? crypto.createHash("sha1").update(thumbnailUrl).digest("hex").slice(0, 12) : "";
}

function points(video: AppVideo) {
  const summary = video.summary;
  if (!summary) return [];
  const fromSections = (summary.sections ?? []).flatMap((section) => section.points.map((point) => point.text));
  return (fromSections.length ? fromSections : summary.keyPoints.map((point) => point.text)).filter(Boolean).slice(0, 10);
}

export function toMobileItem(video: AppVideo, folderIds: string[]): MobileItem {
  return {
    id: video.id,
    title: video.title,
    author: video.channel,
    type: video.sourceType,
    url: video.sourceType === "note" || video.url.startsWith("lumina:") ? "" : video.url,
    createdAt: video.createdAt,
    consumedAt: video.consumedAt ?? null,
    pinned: video.topPosition !== null && video.topPosition !== undefined,
    status: video.status,
    gist: video.summary?.cardSummary || video.summary?.gist || (video.sourceType === "note" ? "" : video.description.slice(0, 400)),
    points: points(video),
    takeaways: (video.summary?.takeaways ?? []).slice(0, 6),
    imageText: video.visual?.description || "",
    tags: video.tags.map((tag) => ({ name: tag.name, catalog: tag.level !== "free" })),
    folderIds,
    note: video.note?.content.trim() ? { content: video.note.content, updatedAt: video.note.updatedAt } : null,
    highlights: (video.highlights ?? []).slice(0, 30).map((highlight) => ({ quote: highlight.quote, note: highlight.note })),
    thumb: thumbVersion(video.thumbnailUrl),
  };
}

export function mobileLibrary() {
  const videos = listVideos("");
  const catalog = listCatalogTags();
  const folders = listSmartSpaces();
  const membership = new Map<string, string[]>();
  for (const folder of folders) {
    const manual = new Set(folder.itemIds);
    for (const video of videos) {
      if (!manual.has(video.id) && !(folder.query && spaceQueryMatches(folder.query, video, catalog))) continue;
      membership.set(video.id, [...(membership.get(video.id) ?? []), folder.id]);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    folders: folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color })),
    items: videos.map((video) => toMobileItem(video, membership.get(video.id) ?? [])),
  };
}

// Las miniaturas del celular de fuentes borradas (o con otra imagen) no se quedan en el disco.
export function pruneMobileThumbs(keep: string[]) {
  const dir = path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "mobile-thumbs");
  if (!fs.existsSync(dir)) return;
  const wanted = new Set(keep);
  for (const name of fs.readdirSync(dir)) if (!wanted.has(name)) fs.rmSync(path.join(dir, name), { force: true });
}
