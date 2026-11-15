import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { undoTaggingJob } from "@/lib/tagging";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    undoTaggingJob(id, profile.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
