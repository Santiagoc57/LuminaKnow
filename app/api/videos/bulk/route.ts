import { z } from "zod";
import { deleteMediaForVideo } from "@/lib/media";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { deleteSourceEverywhere, getDb, refreshVideoSearch } from "@/lib/db";
import { apiError } from "@/lib/http";
import { syncVideoMemberships } from "@/lib/knowledge";
import { makeId } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";
import type { SourceType } from "@/lib/types";

const schema = z.object({
  videoIds: z.array(z.string().min(1)).min(1).max(500),
  action: z.enum(["add_collection", "move_collection", "remove_collection", "add_tags", "remove_tags", "process", "delete", "archive", "add_space"]),
  spaceId: z.string().optional(),
  collectionId: z.string().optional(),
  fromCollectionId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = schema.parse(await request.json());
    const requested = [...new Set(body.videoIds)];
    const db = getDb();
    const placeholders = requested.map(() => "?").join(",");
    const existing = db.prepare(`SELECT id, source_type AS sourceType, status, (SELECT COUNT(*) FROM source_items WHERE video_id = videos.id) AS itemCount FROM videos WHERE id IN (${placeholders})`).all(...requested) as Array<{ id: string; sourceType: SourceType; status: string; itemCount: number }>;
    const existingIds = new Set(existing.map((item) => item.id));
    const missingIds = requested.filter((id) => !existingIds.has(id));
    const failed: Array<{ id: string; error: string }> = missingIds.map((id) => ({ id, error: "La fuente ya no existe." }));
    if (!existing.length) return NextResponse.json({ updatedIds: [], failed });

    if (["add_collection", "move_collection", "remove_collection"].includes(body.action)) {
      if (!body.collectionId || !db.prepare("SELECT 1 FROM collections WHERE id = ?").get(body.collectionId)) throw new Error("Elige una carpeta válida.");
      if (body.action === "move_collection" && body.fromCollectionId && !db.prepare("SELECT 1 FROM collections WHERE id = ?").get(body.fromCollectionId)) throw new Error("La carpeta de origen ya no existe.");
    }
    if (["add_tags", "remove_tags"].includes(body.action)) {
      const tagIds = [...new Set(body.tagIds ?? [])];
      if (!tagIds.length) throw new Error("Elige al menos una etiqueta.");
      const tagCount = (db.prepare(`SELECT COUNT(*) AS count FROM tags WHERE active = 1 AND catalog_key IS NOT NULL AND id IN (${tagIds.map(() => "?").join(",")})`).get(...tagIds) as { count: number }).count;
      if (tagCount !== tagIds.length) throw new Error("Una de las etiquetas ya no existe.");
    }

    if (body.action === "add_space" && (!body.spaceId || !db.prepare("SELECT 1 FROM smart_spaces WHERE id = ?").get(body.spaceId))) throw new Error("Elige un espacio válido.");

    const now = new Date().toISOString();
    const jobs: Array<{ id: string; videoId: string; kind: "metadata" | "x-metadata" | "x-thread" | "reddit-thread" | "web-article" | "pdf" }> = [];
    db.transaction(() => {
      for (const video of existing) {
        if (body.action === "add_collection") db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)").run(video.id, body.collectionId);
        if (body.action === "remove_collection") db.prepare("DELETE FROM video_collections WHERE video_id = ? AND collection_id = ?").run(video.id, body.collectionId);
        if (body.action === "move_collection") {
          db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)").run(video.id, body.collectionId);
          if (body.fromCollectionId) db.prepare("DELETE FROM video_collections WHERE video_id = ? AND collection_id = ?").run(video.id, body.fromCollectionId);
        }
        if (body.action === "add_tags") {
          const combined = db.prepare(`SELECT DISTINCT t.id, t.level FROM tags t JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ? UNION SELECT id, level FROM tags WHERE id IN (${(body.tagIds ?? []).map(() => "?").join(",")})`).all(video.id, ...(body.tagIds ?? [])) as Array<{ id: string; level: string }>;
          if (combined.filter((tag) => tag.level === "primary").length > 3 || combined.filter((tag) => tag.level === "secondary").length > 2) { failed.push({ id: video.id, error: "La fuente superaría el máximo de 3 etiquetas principales y 2 subetiquetas." }); continue; }
          for (const tagId of body.tagIds ?? []) db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'manual', 1)").run(video.id, tagId);
        }
        if (body.action === "remove_tags") for (const tagId of body.tagIds ?? []) db.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(video.id, tagId);
        if (body.action === "process") {
          if (video.sourceType === "image" || video.sourceType === "note") { failed.push({ id: video.id, error: "Las imágenes y notas no se procesan por lote." }); continue; }
          if (video.status !== "saved" && video.status !== "failed") { failed.push({ id: video.id, error: "Esta fuente ya está procesándose o lista." }); continue; }
          const jobId = makeId("job");
          const kind = video.sourceType === "pdf" ? "pdf" as const : video.sourceType === "x" ? video.itemCount > 1 ? "x-thread" : "x-metadata" : video.sourceType === "reddit" ? "reddit-thread" : video.sourceType === "web" ? "web-article" : "metadata";
          db.prepare("UPDATE videos SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(now, video.id);
          db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, ?, 'queued', ?, ?)").run(jobId, video.id, kind, now, now);
          jobs.push({ id: jobId, videoId: video.id, kind });
        }
        if (body.action === "archive") db.prepare("UPDATE videos SET archived_at = ?, resurfaced_at = ?, top_position = NULL WHERE id = ?").run(now, now, video.id);
        if (body.action === "add_space") db.prepare("INSERT OR IGNORE INTO space_items(space_id, video_id, added_at) VALUES(?, ?, ?)").run(body.spaceId, video.id, now);
        if (body.action === "delete") { deleteMediaForVideo(video.id); deleteSourceEverywhere(video.id); }
      }
    })();

    const failedIds = new Set(failed.map((item) => item.id));
    const updatedIds = existing.map((item) => item.id).filter((id) => !failedIds.has(id));
    if (body.action !== "delete") updatedIds.forEach((id) => { syncVideoMemberships(id); refreshVideoSearch(id); });
    jobs.forEach((job) => scheduleJob(job.id, job.videoId, job.kind));
    return NextResponse.json({ updatedIds, failed });
  } catch (error) {
    return apiError(error);
  }
}
