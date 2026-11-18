import { z } from "zod";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { itemTagState } from "@/lib/extension-item";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { assignEarlyTags } from "@/lib/early-tags";
import { validateCatalogAssignment } from "@/lib/canonical-tags";
import { createHighlight } from "@/lib/highlights";
import { createQuoteFromClip } from "@/lib/notes";
import { importPdfLink } from "@/lib/pdf";
import { pdfLinkFrom } from "@/lib/pdf-link";
import { makeId, parseSourceUrl } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";
import type { SourceType } from "@/lib/types";

export const runtime = "nodejs";

// Las páginas reales traen metadatos largos o incompletos: se recortan en vez de impedir el guardado.
const clipped = (limit: number) => z.string().trim().default("").transform((value) => value.slice(0, limit));

const captureSchema = z.object({
  url: z.string().trim().url(),
  title: clipped(240),
  description: clipped(2_000),
  imageUrl: z.string().trim().url().catch(""),
  author: clipped(160),
  siteName: clipped(160),
  publishedAt: clipped(80),
  clip: z.string().trim().max(10_000).default(""),
  tagCatalogKeys: z.array(z.string().trim().max(100)).max(5).default([]),
  mode: z.enum(["save", "process"]).default("save"),
});

function jobKindFor(sourceType: SourceType) {
  return sourceType === "x" ? "x-metadata" as const : sourceType === "reddit" ? "reddit-thread" as const : sourceType === "web" ? "web-article" as const : "metadata" as const;
}

function fallbackTitle(sourceType: SourceType) {
  return sourceType === "youtube" ? "Video guardado" : sourceType === "audio" ? "Audio guardado" : sourceType === "reddit" ? "Publicación de Reddit" : sourceType === "x" ? "Publicación de X" : "Página guardada";
}

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const data = captureSchema.parse(await request.json());
    const pdfLink = pdfLinkFrom(data.url);
    if (pdfLink) {
      const result = await importPdfLink(pdfLink, profile.id, data.title.toLowerCase().endsWith(".pdf") ? undefined : data.title);
      if (data.clip && !createQuoteFromClip({ clip: data.clip, title: data.title, url: data.url, profileId: profile.id })) createHighlight({ videoId: result.id, quote: data.clip, origin: "clip", profileId: profile.id });
      return extensionJson(request, { ...result, ...itemTagState(result.id), luminaUrl: `/?video=${encodeURIComponent(result.id)}` }, { status: result.duplicate ? 200 : 201 });
    }
    const parsed = parseSourceUrl(data.url);
    if (!parsed) throw new Error("La página actual no es una fuente pública compatible con Lúmina.");
    const catalogTags = validateCatalogAssignment(data.tagCatalogKeys);
    const db = getDb();
    const tagRows = catalogTags.length ? db.prepare(`SELECT id FROM tags WHERE active = 1 AND catalog_key IN (${catalogTags.map(() => "?").join(",")})`).all(...catalogTags.map((tag) => tag.id)) as Array<{ id: string }> : [];
    const tagIds = tagRows.map((tag) => tag.id);
    const duplicate = db.prepare("SELECT id, status FROM videos WHERE source_type = ? AND youtube_id = ?").get(parsed.sourceType, parsed.sourceId) as { id: string; status: string } | undefined;
    const now = new Date().toISOString();
    if (duplicate) {
      assignEarlyTags(duplicate.id, tagIds, { fromExtension: true });
      if (data.clip && !createQuoteFromClip({ clip: data.clip, title: data.title, url: data.url, profileId: profile.id })) createHighlight({ videoId: duplicate.id, quote: data.clip, origin: "clip", profileId: profile.id });
      if (data.mode === "process" && duplicate.status === "saved") {
        const jobId = makeId("job");
        const jobKind = jobKindFor(parsed.sourceType);
        db.transaction(() => {
          db.prepare("UPDATE videos SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, duplicate.id);
          db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(jobId, duplicate.id, jobKind, now, now);
        })();
        scheduleJob(jobId, duplicate.id, jobKind);
      }
      return extensionJson(request, { id: duplicate.id, duplicate: true, ...itemTagState(duplicate.id), luminaUrl: `/?video=${encodeURIComponent(duplicate.id)}` });
    }

    const id = makeId("vid");
    const title = data.title || fallbackTitle(parsed.sourceType);
    const channel = data.author ? `${data.author}${data.siteName && data.siteName !== data.author ? ` · ${data.siteName}` : ""}` : data.siteName;
    const thumbnailUrl = data.imageUrl || (parsed.sourceType === "youtube" ? `https://i.ytimg.com/vi/${parsed.sourceId}/hqdefault.jpg` : "");
    const status = data.mode === "process" ? "queued" : "saved";
    const jobId = data.mode === "process" ? makeId("job") : null;
    const jobKind = jobKindFor(parsed.sourceType);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', ?, ?, ?, ?, ?)
      `).run(id, parsed.sourceId, parsed.sourceType, data.publishedAt, parsed.url, title, channel, thumbnailUrl, data.description, "browser-extension", status, profile.id, now, now);
      if (parsed.sourceType !== "youtube") db.prepare(`
        INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at)
        VALUES(?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).run(makeId("item"), id, parsed.sourceId, parsed.url, channel, data.description, data.publishedAt, thumbnailUrl, JSON.stringify({ siteName: data.siteName, sourceKind: "web", capturedBy: "extension" }), now);
      if (jobId) db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(jobId, id, jobKind, now, now);
    })();
    assignEarlyTags(id, tagIds, { analysisQueued: Boolean(jobId), fromExtension: true });
    if (data.clip && !createQuoteFromClip({ clip: data.clip, title: data.title, url: data.url, profileId: profile.id })) createHighlight({ videoId: id, quote: data.clip, origin: "clip", profileId: profile.id });
    refreshVideoSearch(id);
    if (jobId) scheduleJob(jobId, id, jobKind);
    return extensionJson(request, { id, duplicate: false, ...itemTagState(id), luminaUrl: `/?video=${encodeURIComponent(id)}` }, { status: 201 });
  } catch (error) { return extensionError(request, error); }
}
