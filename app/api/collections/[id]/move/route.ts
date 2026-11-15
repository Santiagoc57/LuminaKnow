import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { moveCollectionVideos } from "@/lib/collections";
import { apiError } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const body = z.object({ destinationCollectionId: z.string().min(1), videoIds: z.array(z.string().min(1)).min(1).max(500) }).parse(await request.json());
    return NextResponse.json({ ok: true, videoIds: moveCollectionVideos(id, body.destinationCollectionId, body.videoIds) });
  } catch (error) {
    return apiError(error);
  }
}
