import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { hasAIKey } from "@/lib/ai";
import { apiError } from "@/lib/http";
import { makeId } from "@/lib/utils";
import { scheduleJob } from "@/lib/worker";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    if (!hasAIKey()) throw new Error("Configura una clave de Gemini antes de transcribir audio.");
    const { id } = await context.params;
    const db = getDb();
    const video = db.prepare("SELECT id FROM videos WHERE id = ?").get(id);
    if (!video) throw new Error("Video no encontrado.");
    const pending = db.prepare("SELECT id FROM jobs WHERE video_id = ? AND status IN ('queued', 'running') LIMIT 1").get(id) as { id: string } | undefined;
    if (pending) return NextResponse.json({ ok: true, alreadyRunning: true });
    const now = new Date().toISOString();
    const jobId = makeId("job");
    db.prepare("INSERT INTO jobs(id, video_id, kind, status, created_at, updated_at) VALUES(?, ?, 'audio', 'queued', ?, ?)")
      .run(jobId, id, now, now);
    scheduleJob(jobId, id, "audio");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
