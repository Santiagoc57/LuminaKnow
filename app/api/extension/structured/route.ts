import { z } from "zod";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { itemTagState } from "@/lib/extension-item";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { assignEarlyTags } from "@/lib/early-tags";
import { validateCatalogAssignment } from "@/lib/canonical-tags";
import { createHighlight } from "@/lib/highlights";
import { createQuoteFromClip } from "@/lib/notes";
import { makeId, parseRedditUrl, parseWebUrl, parseXUrl } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";

export const runtime = "nodejs";

// Lo que la extensión lee directamente de la página abierta: Reddit y X bloquean la lectura desde el servidor,
// pero en tu Firefox el contenido ya está cargado con tu sesión.
const text = (limit: number) => z.string().trim().default("").transform((value) => value.slice(0, limit));
const itemSchema = z.object({
  externalId: text(80),
  url: z.string().trim().url().catch(""),
  authorName: text(160),
  authorHandle: text(80),
  avatarUrl: z.string().trim().url().catch(""),
  text: text(20_000),
  publishedAt: text(80),
  previewUrl: z.string().trim().url().catch(""),
  depth: z.number().int().min(0).max(30).catch(0),
});
const schema = z.object({
  kind: z.enum(["reddit-thread", "reddit-comment", "tweet", "x-thread", "facebook-post"]),
  url: z.string().trim().url(),
  title: text(300),
  channel: text(200),
  description: text(4_000),
  imageUrl: z.string().trim().url().catch(""),
  publishedAt: text(80),
  parentTitle: text(300),
  parentUrl: z.string().trim().url().catch(""),
  items: z.array(itemSchema).max(400).default([]),
  clip: z.string().trim().max(10_000).default(""),
  tagCatalogKeys: z.array(z.string().trim().max(100)).max(5).default([]),
  analyze: z.boolean().default(true),
});

function identity(data: z.infer<typeof schema>) {
  if (data.kind === "facebook-post") {
    // Facebook no deja leer publicaciones desde el servidor: se guarda lo que la extensión leyó, como página social.
    const page = parseWebUrl(data.url);
    if (!page || !/(^|\.)facebook\.com$/.test(new URL(page.url).hostname)) throw new Error("No se reconoció la publicación de Facebook.");
    return { sourceType: "web" as const, sourceId: page.pageId, url: page.url };
  }
  if (data.kind === "tweet" || data.kind === "x-thread") {
    const post = parseXUrl(data.url);
    if (!post) throw new Error("No se reconoció la publicación de X.");
    return { sourceType: "x" as const, sourceId: post.postId, url: post.url };
  }
  const post = parseRedditUrl(data.kind === "reddit-comment" ? data.parentUrl || data.url : data.url);
  if (!post) throw new Error("No se reconoció la publicación de Reddit.");
  if (data.kind === "reddit-thread") return { sourceType: "reddit" as const, sourceId: post.postId, url: post.url };
  const commentId = data.items[0]?.externalId.replace(/^t1_/, "");
  if (!commentId) throw new Error("No se reconoció el comentario.");
  return { sourceType: "reddit" as const, sourceId: `${post.postId}_c_${commentId}`, url: data.url };
}

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const data = schema.parse(await request.json());
    const items = data.items.filter((item) => item.text.trim() || item.previewUrl);
    if (!items.length) throw new Error("No se encontró texto para guardar en esta publicación.");
    const source = identity({ ...data, items });
    const catalogTags = validateCatalogAssignment(data.tagCatalogKeys);
    const db = getDb();
    const tagIds = catalogTags.length ? (db.prepare(`SELECT id FROM tags WHERE active = 1 AND catalog_key IN (${catalogTags.map(() => "?").join(",")})`).all(...catalogTags.map((tag) => tag.id)) as Array<{ id: string }>).map((tag) => tag.id) : [];
    const existing = db.prepare("SELECT id, status FROM videos WHERE source_type = ? AND youtube_id = ?").get(source.sourceType, source.sourceId) as { id: string; status: string } | undefined;
    const id = existing?.id ?? makeId("vid");
    const now = new Date().toISOString();
    const previousCount = existing ? (db.prepare("SELECT COUNT(*) AS count FROM source_items WHERE video_id = ?").get(id) as { count: number }).count : 0;
    // Un hilo vuelto a guardar con más comentarios cargados reemplaza la copia anterior; con menos, se conserva.
    const replaceItems = !existing || items.length >= previousCount;
    const busy = existing && ["queued", "extracting", "indexing", "summarizing"].includes(existing.status);
    const analyze = data.analyze && !busy && (!existing || replaceItems || existing.status === "saved" || existing.status === "failed");
    const jobId = analyze ? makeId("job") : null;
    const kindLabel = data.kind === "reddit-comment" ? "comment" : data.kind === "reddit-thread" ? "thread" : "post";
    db.transaction(() => {
      if (!existing) {
        db.prepare(`
          INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at, thread_status)
          VALUES(?, ?, ?, ?, ?, ?, '', ?, ?, ?, '', 'browser-extension', ?, ?, ?, ?, ?)
        `).run(id, source.sourceId, source.sourceType, data.publishedAt, source.url, data.title || "Publicación guardada", data.channel, data.imageUrl, data.description, jobId ? "queued" : "saved", profile.id, now, now, items.length > 1 ? "complete" : "single");
      } else if (replaceItems) {
        db.prepare("UPDATE videos SET title = ?, channel = ?, thumbnail_url = CASE WHEN ? <> '' THEN ? ELSE thumbnail_url END, description = ?, source_published_at = ?, thread_status = ?, status = ?, error = '', updated_at = ? WHERE id = ?")
          .run(data.title || "Publicación guardada", data.channel, data.imageUrl, data.imageUrl, data.description, data.publishedAt, items.length > 1 ? "complete" : "single", jobId ? "queued" : existing.status, now, id);
      }
      if (replaceItems) {
        db.prepare("DELETE FROM source_items WHERE video_id = ?").run(id);
        const insert = db.prepare(`
          INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at)
          VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        items.forEach((item, index) => insert.run(makeId("item"), id, item.externalId || `item-${index}`, index, item.url || source.url, item.authorName, item.authorHandle, item.text, item.publishedAt, item.previewUrl, JSON.stringify({
          avatarUrl: item.avatarUrl, depth: item.depth, kind: index === 0 ? kindLabel : "reply", parentTitle: data.parentTitle, parentUrl: data.parentUrl, capturedBy: "extension",
        }), now));
      }
      if (jobId) db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, 'local-items', 'queued', ?, ?)").run(jobId, id, now, now);
    })();
    assignEarlyTags(id, tagIds, { analysisQueued: Boolean(jobId), fromExtension: true });
    if (data.clip && !createQuoteFromClip({ clip: data.clip, title: data.title, url: data.url, profileId: profile.id })) createHighlight({ videoId: id, quote: data.clip, origin: "clip", profileId: profile.id });
    refreshVideoSearch(id);
    if (jobId) scheduleJob(jobId, id, "local-items");
    return extensionJson(request, { id, duplicate: Boolean(existing), items: items.length, ...itemTagState(id), luminaUrl: `/?video=${encodeURIComponent(id)}` }, { status: existing ? 200 : 201 });
  } catch (error) { return extensionError(request, error); }
}
