import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { apiError } from "@/lib/http";
import { makeId } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";
import { previewXThread } from "@/lib/x-thread";
import { assignEarlyTags } from "@/lib/early-tags";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const body = z.object({
      url: z.string().trim().min(1),
      additionalUrls: z.array(z.string().trim().min(1)).max(99).default([]),
      mode: z.enum(["save", "process"]).default("process"),
      title: z.string().trim().max(200).optional(),
      tagIds: z.array(z.string().trim().min(1).max(80)).max(5).default([]),
    }).parse(await request.json());
    const preview = await previewXThread(body.url, body.additionalUrls);
    const root = preview.items[0];
    const db = getDb();
    const duplicate = db.prepare("SELECT id, status FROM videos WHERE source_type = 'x' AND youtube_id = ?").get(root.postId) as { id: string; status: string } | undefined;
    const id = duplicate?.id ?? makeId("vid");
    const now = new Date().toISOString();
    const description = preview.items.map((item, index) => `${index + 1}. ${item.description}`).join("\n\n");
    const status = body.mode === "process" ? "queued" : "saved";
    const jobId = body.mode === "process" ? makeId("job") : null;
    db.transaction(() => {
      if (duplicate) {
        db.prepare("UPDATE videos SET title = ?, custom_title = COALESCE(NULLIF(?, ''), custom_title), channel = ?, thumbnail_url = ?, description = ?, source_published_at = ?, thread_status = ?, status = ?, error = '', updated_at = ? WHERE id = ?")
          .run(root.title, body.title || "", root.channel, root.previewUrl, description, root.publishedAt, preview.status, status, now, id);
        db.prepare("DELETE FROM source_items WHERE video_id = ?").run(id);
      } else {
        db.prepare(`
          INSERT INTO videos(id, youtube_id, source_type, source_published_at, thread_status, url, title, custom_title, channel, thumbnail_url, description, transcript_source, status, added_by, created_at, updated_at)
          VALUES(?, ?, 'x', ?, ?, ?, ?, ?, ?, ?, ?, 'x-public', ?, ?, ?, ?)
        `).run(id, root.postId, root.publishedAt, preview.status, root.url, root.title, body.title || "", root.channel, root.previewUrl, description, status, profile.id, now, now);
      }
      const insert = db.prepare(`
        INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      preview.items.forEach((item, ordinal) => insert.run(makeId("item"), id, item.postId, ordinal, item.url, item.channel, item.authorHandle, item.description, item.publishedAt, item.previewUrl, JSON.stringify({ avatarUrl: item.avatarUrl }), now));
      if (jobId) db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, 'x-thread', 'queued', ?, ?)").run(jobId, id, now, now);
    })();
    assignEarlyTags(id, body.tagIds);
    refreshVideoSearch(id);
    if (jobId) scheduleJob(jobId, id, "x-thread");
    return NextResponse.json({ id, duplicate: Boolean(duplicate), preview });
  } catch (error) {
    return apiError(error);
  }
}
