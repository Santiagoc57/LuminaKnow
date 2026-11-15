import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { updateConversationSources } from "@/lib/conversations";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const sourceSelection = z.object({
      collectionIds: z.array(z.string().min(1)).max(100).default([]),
      tagIds: z.array(z.string().min(1)).max(100).default([]),
      videoIds: z.array(z.string().min(1)).max(100).default([]),
      excludedVideoIds: z.array(z.string().min(1)).max(100).default([]),
    }).parse(await request.json());
    return NextResponse.json(updateConversationSources(profile.id, (await context.params).id, sourceSelection));
  } catch (error) { return apiError(error); }
}
