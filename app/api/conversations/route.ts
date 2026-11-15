import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { createConversation, listConversations } from "@/lib/conversations";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sourceSelectionSchema = z.object({
  collectionIds: z.array(z.string().min(1)).max(100).default([]),
  tagIds: z.array(z.string().min(1)).max(100).default([]),
  videoIds: z.array(z.string().min(1)).max(100).default([]),
  excludedVideoIds: z.array(z.string().min(1)).max(100).default([]),
});

export async function GET() {
  try {
    const profile = await requireProfile();
    return NextResponse.json({ conversations: listConversations(profile.id) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const body = z.object({
      question: z.string().trim().min(2).max(4_000),
      title: z.string().trim().min(1).max(72).optional(),
      sourceSelection: sourceSelectionSchema,
      modelId: z.enum(["auto", "gemini", "openai"]).default("auto"),
    }).parse(await request.json());
    return NextResponse.json(createConversation({ profileId: profile.id, question: body.question, title: body.title, selection: body.sourceSelection, modelId: body.modelId }), { status: 201 });
  } catch (error) { return apiError(error); }
}
