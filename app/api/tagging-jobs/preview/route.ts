import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createTaggingPreview } from "@/lib/tagging";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const body = z.object({ videoIds: z.array(z.string().min(1)).min(1).max(500), interests: z.string().trim().max(2_000).default(""), modelId: z.enum(["auto", "gemini", "openai"]).default("auto"), replaceExisting: z.boolean().default(false) }).parse(await request.json());
    return NextResponse.json(await createTaggingPreview({ profileId: profile.id, ...body }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
