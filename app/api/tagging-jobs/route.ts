import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { startTaggingJob } from "@/lib/tagging";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const tag = z.object({ tagId: z.string().trim().min(1).max(100), level: z.enum(["primary", "secondary"]), confidence: z.number().min(0).max(1) });
    const body = z.object({ previewJobId: z.string().min(1), approved: z.array(z.object({ videoId: z.string().min(1), tags: z.array(tag).min(2).max(5) })).max(500) }).parse(await request.json());
    startTaggingJob(body.previewJobId, profile.id, body.approved);
    return NextResponse.json({ id: body.previewJobId, status: "queued" }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
