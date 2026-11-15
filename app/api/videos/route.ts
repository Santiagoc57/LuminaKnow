import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { listVideos } from "@/lib/data";
import { apiError } from "@/lib/http";
import { importPdfLink } from "@/lib/pdf";
import { pdfLinkFrom } from "@/lib/pdf-link";
import { makeId, parseSourceUrl } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";
import { extractXPost } from "@/lib/x-post";
import { extractRedditPost } from "@/lib/reddit-post";
import { assignEarlyTags } from "@/lib/early-tags";
import type { SourceType, VideoStatus } from "@/lib/types";
import { extractWebArticle, type ExtractedWebSection } from "@/lib/web-article";

export const runtime = "nodejs";

type BookmarkMetadata = { title: string; channel: string; thumbnailUrl: string; faviconUrl?: string; avatarUrl?: string; authorHandle?: string; siteName?: string; description?: string; publishedAt?: string; sourceLanguage?: string; sourceKind?: "substack" | "web" | "product" | "movie"; sections?: ExtractedWebSection[] };

function jobKindFor(sourceType: SourceType) {
  return sourceType === "x" ? "x-metadata" as const : sourceType === "reddit" ? "reddit-thread" as const : sourceType === "web" ? "web-article" as const : "metadata" as const;
}

async function getYouTubeBookmarkMetadata(url: string): Promise<BookmarkMetadata | null> {
  try {
    const endpoint = new URL("https://www.youtube.com/oembed");
    endpoint.searchParams.set("url", url);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return null;
    const body = await response.json() as { title?: string; author_name?: string; thumbnail_url?: string };
    return {
      title: body.title?.trim() || "Video guardado",
      channel: body.author_name?.trim() || "",
      thumbnailUrl: body.thumbnail_url?.trim() || "",
    };
  } catch {
    return null;
  }
}

async function getBookmarkMetadata(sourceType: SourceType, url: string): Promise<BookmarkMetadata | null> {
  if (sourceType === "youtube") return getYouTubeBookmarkMetadata(url);
  try {
    if (sourceType === "reddit") {
      const post = await extractRedditPost(url, 1);
      return { title: post.title, channel: post.channel, thumbnailUrl: post.previewUrl, description: post.description, publishedAt: post.publishedAt };
    }
    if (sourceType === "web") {
      const article = await extractWebArticle(url);
      return { title: article.title, channel: article.channel, thumbnailUrl: article.thumbnailUrl, faviconUrl: article.faviconUrl, siteName: article.siteName, description: article.description, publishedAt: article.publishedAt, sourceLanguage: article.sourceLanguage, sourceKind: article.sourceKind, sections: article.sections };
    }
    const post = await extractXPost(url);
    return { title: post.title, channel: post.channel, thumbnailUrl: post.previewUrl, avatarUrl: post.avatarUrl, authorHandle: post.authorHandle, description: post.description, publishedAt: post.publishedAt };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    await requireProfile();
    const params = new URL(request.url).searchParams;
    const booleanParam = (name: string) => params.has(name) ? params.get(name) === "true" : undefined;
    const allowedStatuses: VideoStatus[] = ["saved", "queued", "extracting", "indexing", "summarizing", "ready", "needs_transcript", "failed"];
    const statuses = params.getAll("status").filter((value): value is VideoStatus => allowedStatuses.includes(value as VideoStatus));
    return NextResponse.json({ videos: listVideos({
      q: params.get("q") || "",
      sourceType: ["youtube", "x", "reddit", "web"].includes(params.get("sourceType") || "") ? params.get("sourceType") as SourceType : undefined,
      collectionId: params.get("collectionId") || undefined,
      tagIds: params.getAll("tagId"),
      author: params.get("author") || undefined,
      statuses,
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      publishedFrom: params.get("publishedFrom") || undefined,
      publishedTo: params.get("publishedTo") || undefined,
      hasNotes: booleanParam("hasNotes"),
      hasSummary: booleanParam("hasSummary"),
      thread: params.get("thread") === "thread" || params.get("thread") === "single" ? params.get("thread") as "thread" | "single" : undefined,
      sort: ["recent", "oldest", "title", "author"].includes(params.get("sort") || "") ? params.get("sort") as "recent" | "oldest" | "title" | "author" : "recent",
    }) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const { url, mode, title, tagIds } = z.object({
      url: z.string().trim().min(1),
      mode: z.enum(["save", "process"]).default("process"),
      title: z.string().trim().max(200).optional(),
      tagIds: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
    }).parse(await request.json());
    const db = getDb();
    const pdfLink = pdfLinkFrom(url);
    if (pdfLink) {
      const result = await importPdfLink(pdfLink, profile.id, title);
      assignEarlyTags(result.id, tagIds);
      // "Analizar" lo pide quien pega el enlace; guardar nunca envía el texto a la IA.
      if (mode === "process" && !result.duplicate) {
        const now = new Date().toISOString();
        const jobId = makeId("job");
        db.transaction(() => {
          db.prepare("UPDATE videos SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, result.id);
          db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, 'pdf', 'queued', ?, ?)").run(jobId, result.id, now, now);
        })();
        scheduleJob(jobId, result.id, "pdf");
      }
      return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
    }
    const parsed = parseSourceUrl(url);
    if (!parsed) throw new Error("Pega un enlace público válido de YouTube, X, Reddit, Substack o una página web.");
    const duplicate = db.prepare("SELECT id, status FROM videos WHERE source_type = ? AND youtube_id = ?").get(parsed.sourceType, parsed.sourceId) as { id: string; status: string } | undefined;
    if (duplicate) {
      const now = new Date().toISOString();
      if (title) {
        db.prepare("UPDATE videos SET custom_title = ?, updated_at = ? WHERE id = ?").run(title, now, duplicate.id);
        refreshVideoSearch(duplicate.id);
      }
      if (mode === "process" && duplicate.status === "saved") {
        const jobId = makeId("job");
        const jobKind = jobKindFor(parsed.sourceType);
        db.transaction(() => {
          db.prepare("UPDATE videos SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, duplicate.id);
          db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(jobId, duplicate.id, jobKind, now, now);
        })();
        scheduleJob(jobId, duplicate.id, jobKind);
      }
      assignEarlyTags(duplicate.id, tagIds);
      return NextResponse.json({ id: duplicate.id, duplicate: true }, { status: 200 });
    }
    const id = makeId("vid");
    const now = new Date().toISOString();
    const metadata = mode === "save" ? await getBookmarkMetadata(parsed.sourceType, parsed.url) : null;
    const storedTitle = metadata?.title || (parsed.sourceType === "youtube" ? "Video guardado" : parsed.sourceType === "reddit" ? "Publicación de Reddit" : parsed.sourceType === "web" ? "Artículo guardado" : "Publicación guardada");
    const thumbnailUrl = metadata?.thumbnailUrl || (parsed.sourceType === "youtube" ? `https://i.ytimg.com/vi/${parsed.sourceId}/hqdefault.jpg` : "");
    const status = mode === "save" ? "saved" : "queued";
    const jobId = mode === "process" ? makeId("job") : null;
    const jobKind = jobKindFor(parsed.sourceType);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, parsed.sourceId, parsed.sourceType, metadata?.publishedAt || "", parsed.url, storedTitle, title || "", metadata?.channel || "", thumbnailUrl, metadata?.description || "", metadata?.sourceLanguage || "", parsed.sourceType === "x" && metadata ? "x-oembed" : parsed.sourceType === "reddit" && metadata ? "reddit-public" : parsed.sourceType === "web" && metadata ? `${metadata.sourceKind || "web"}-readability` : "", status, profile.id, now, now);
      if (parsed.sourceType === "web" && metadata?.sections?.length) {
        const insertItem = db.prepare(`
          INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        metadata.sections.forEach((section, index) => insertItem.run(makeId("item"), id, section.externalId, index, section.url, metadata.channel, section.text, metadata.publishedAt || "", index === 0 ? metadata.thumbnailUrl || "" : "", JSON.stringify({ heading: section.heading, siteName: metadata.siteName || metadata.channel, sourceKind: metadata.sourceKind || "web", language: metadata.sourceLanguage || "", faviconUrl: metadata.faviconUrl || "" }), now));
      } else if (parsed.sourceType !== "youtube") db.prepare(`
          INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at)
          VALUES(?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(makeId("item"), id, parsed.sourceId, parsed.url, metadata?.channel || "", metadata?.authorHandle || "", metadata?.description || "", metadata?.publishedAt || "", metadata?.thumbnailUrl || "", JSON.stringify({ avatarUrl: metadata?.avatarUrl || "" }), now);
      if (jobId) db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)")
        .run(jobId, id, jobKind, now, now);
    })();
    assignEarlyTags(id, tagIds);
    refreshVideoSearch(id);
    if (jobId) scheduleJob(jobId, id, jobKind);
    return NextResponse.json({ id, duplicate: false }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
