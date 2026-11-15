import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { replaceCollectionVideos } from "@/lib/collections";
import { apiError } from "@/lib/http";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const { videoIds } = z.object({ videoIds: z.array(z.string().min(1)).max(500) }).parse(await request.json());
    return NextResponse.json({ ok: true, videoIds: replaceCollectionVideos(id, videoIds) });
  } catch (error) {
    return apiError(error);
  }
}
