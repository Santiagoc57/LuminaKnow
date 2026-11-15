import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { addConversationMessage } from "@/lib/conversations";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const body = z.object({ question: z.string().trim().min(2).max(4_000), modelId: z.enum(["auto", "gemini", "openai"]).default("auto") }).parse(await request.json());
    return NextResponse.json(addConversationMessage({ profileId: profile.id, conversationId: (await context.params).id, question: body.question, modelId: body.modelId }), { status: 201 });
  } catch (error) { return apiError(error); }
}
