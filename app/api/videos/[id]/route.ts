import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { deleteSourceEverywhere, getDb, refreshVideoSearch } from "@/lib/db";
import { getConversation, getVideo, getVideoTranscript } from "@/lib/data";
import { apiError } from "@/lib/http";
import { makeId } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";
import { suggestEarlySourceMetadata } from "@/lib/ai";
import { extractRedditPost } from "@/lib/reddit-post";
import { extractXPost } from "@/lib/x-post";
import { extractWebArticle } from "@/lib/web-article";
import { deleteMediaForVideo } from "@/lib/media";
import { addToShelf, removeFromShelf } from "@/lib/shelf";
import { noteConnections, renameLinksEverywhere } from "@/lib/notes";
import { relatedSources } from "@/lib/related";
import type { SourceType } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const video = getVideo(id);
    if (!video) return NextResponse.json({ error: "Video no encontrado." }, { status: 404 });
    return NextResponse.json({ video, transcript: getVideoTranscript(id), messages: getConversation(id, profile.id), connections: noteConnections(id), related: relatedSources(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const body = z.object({ action: z.enum(["retry", "regenerate_metadata", "archive", "unarchive", "keep", "consume", "unconsume", "pin", "unpin"]).optional(), title: z.string().trim().max(200).optional() }).parse(await request.json());
    if (body.title !== undefined) {
      if (!body.title) throw new Error("El título no puede estar vacío.");
      const previous = getDb().prepare("SELECT COALESCE(NULLIF(custom_title, ''), title) AS title FROM videos WHERE id = ?").get(id) as { title: string } | undefined;
      if (!previous) return NextResponse.json({ error: "Video no encontrado." }, { status: 404 });
      getDb().prepare("UPDATE videos SET custom_title = ?, updated_at = ? WHERE id = ?").run(body.title, new Date().toISOString(), id);
      renameLinksEverywhere(previous.title, body.title, profile.id);
      refreshVideoSearch(id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "pin") { addToShelf(id); return NextResponse.json({ ok: true }); }
    if (body.action === "unpin") { removeFromShelf(id); return NextResponse.json({ ok: true }); }
    if (body.action === "consume" || body.action === "unconsume") {
      const result = getDb().prepare("UPDATE videos SET consumed_at = ? WHERE id = ?").run(body.action === "consume" ? new Date().toISOString() : null, id);
      if (!result.changes) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "archive" || body.action === "unarchive" || body.action === "keep") {
      const now = new Date().toISOString();
      const result = getDb().prepare("UPDATE videos SET archived_at = ?, resurfaced_at = ? WHERE id = ?").run(body.action === "archive" ? now : null, now, id);
      if (body.action === "archive") removeFromShelf(id);
      if (!result.changes) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }
    const imageRow = getDb().prepare("SELECT source_type AS type, thumbnail_url AS thumbnail FROM videos WHERE id = ?").get(id) as { type: string; thumbnail: string } | undefined;
    if ((body.action === "retry" || body.action === "regenerate_metadata") && imageRow?.type === "image") {
      // Imagen: se vuelve a leer en el Mac y la IA rehace título, resumen y etiquetas.
      const { analyzeVideoImage } = await import("@/lib/vision");
      const { describeImageWithAI } = await import("@/lib/vision-ai");
      await analyzeVideoImage(id, imageRow.thumbnail);
      await describeImageWithAI(id);
      return NextResponse.json({ ok: true });
    }
    if ((body.action === "retry" || body.action === "regenerate_metadata") && (getDb().prepare("SELECT source_type AS type FROM videos WHERE id = ?").get(id) as { type: string } | undefined)?.type === "note") throw new Error("Las notas no se procesan: se guardan tal como las escribes.");
    if (body.action === "regenerate_metadata") {
      const db = getDb();
      const source = db.prepare("SELECT source_type AS sourceType, url, title, channel, description FROM videos WHERE id = ?").get(id) as { sourceType: SourceType; url: string; title: string; channel: string; description: string } | undefined;
      if (!source) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
      let metadata = { title: source.title, author: source.channel, content: source.description || "" };
      if (source.sourceType === "web") { const article = await extractWebArticle(source.url); metadata = { title: article.title, author: article.channel, content: [article.description, ...article.sections.slice(0, 4).map((section) => `${section.heading}\n${section.text}`)].filter(Boolean).join("\n\n") }; }
      else if (source.sourceType === "x") { const post = await extractXPost(source.url); metadata = { title: post.title, author: post.channel, content: post.description }; }
      else if (source.sourceType === "reddit") { const post = await extractRedditPost(source.url, 1); metadata = { title: post.title, author: post.channel, content: post.description }; }
      const suggestion = await suggestEarlySourceMetadata({ ...metadata, sourceType: source.sourceType });
      const selected = suggestion.tagIds.length ? db.prepare(`SELECT id, level FROM tags WHERE active = 1 AND catalog_key IN (${suggestion.tagIds.map(() => "?").join(",")})`).all(...suggestion.tagIds) as Array<{ id: string; level: string }> : [];
      const primary = selected.filter((tag) => tag.level === "primary").slice(0, 3);
      const secondary = selected.filter((tag) => tag.level === "secondary").slice(0, 2);
      db.transaction(() => { if (suggestion.title) db.prepare("UPDATE videos SET custom_title = ?, updated_at = ? WHERE id = ?").run(suggestion.title, new Date().toISOString(), id); db.prepare("DELETE FROM video_tags WHERE video_id = ? AND origin IN ('ai', 'early_ai') AND bulk_job_id IS NULL").run(id); [...primary, ...secondary].forEach((tag) => db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'early_ai', 0.82)").run(id, tag.id)); })();
      refreshVideoSearch(id);
      return NextResponse.json({ ok: true, title: suggestion.title, tagCount: primary.length + secondary.length });
    }
    if (body.action !== "retry") throw new Error("Acción no soportada.");
    const now = new Date().toISOString();
    const db = getDb();
    const source = db.prepare("SELECT source_type AS sourceType, (SELECT COUNT(*) FROM source_items WHERE video_id = videos.id) AS itemCount FROM videos WHERE id = ?").get(id) as { sourceType: SourceType; itemCount: number } | undefined;
    if (!source) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
    const pending = db.prepare("SELECT id FROM jobs WHERE video_id = ? AND status IN ('queued', 'running') LIMIT 1").get(id) as { id: string } | undefined;
    if (pending) return NextResponse.json({ ok: true, alreadyRunning: true });
    const jobId = makeId("job");
    // Tweets y posts ya leídos (desde la extensión o un análisis previo) se vuelven a analizar sin descargarlos otra vez.
    const jobKind = (source.sourceType === "x" || source.sourceType === "reddit") && source.itemCount > 0 ? "local-items" as const : source.sourceType === "pdf" ? "pdf" : source.sourceType === "x" ? source.itemCount > 1 ? "x-thread" : "x-metadata" : source.sourceType === "reddit" ? "reddit-thread" : source.sourceType === "web" ? "web-article" : "metadata";
    db.transaction(() => {
      db.prepare("UPDATE videos SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, id);
      db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(jobId, id, jobKind, now, now);
    })();
    scheduleJob(jobId, id, jobKind);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    deleteMediaForVideo(id);
    deleteSourceEverywhere(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
