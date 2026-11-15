import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { answerScopedChat, getScopedConversation } from "@/lib/scoped-chat";
import { answerConversationTurn } from "@/lib/conversations";
import { apiError } from "@/lib/http";
import { getDb } from "@/lib/db";
import type { ChatScopeType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const scopeSchema = z.enum(["video", "collection", "tag", "selection"]);

export async function GET(request: Request) {
  try {
    const profile = await requireProfile();
    const url = new URL(request.url);
    const scopeType = scopeSchema.parse(url.searchParams.get("scopeType"));
    const scopeId = z.string().min(1).max(128).parse(url.searchParams.get("scopeId"));
    return NextResponse.json(getScopedConversation(profile.id, scopeType, scopeId));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const body = z.object({
      question: z.string().trim().min(2).max(4_000).optional(),
      conversationId: z.string().min(1).max(128).optional(),
      turnId: z.string().min(1).max(128).optional(),
      scopeType: scopeSchema.optional(),
      scopeId: z.string().min(1).max(128).optional(),
      videoIds: z.array(z.string().min(1)).min(1).max(100).optional(),
      modelId: z.enum(["auto", "gemini", "openai"]).default("auto"),
    }).refine((value) => (value.conversationId && value.turnId) || (value.question && value.videoIds && (value.conversationId || (value.scopeType && value.scopeId))), { message: "Indica una conversación o un alcance válido." }).parse(await request.json());
    if (body.conversationId && body.turnId) {
      const result = await answerConversationTurn({ profileId: profile.id, conversationId: body.conversationId, turnId: body.turnId });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: result.content })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId: body.conversationId, citations: result.citations })}\n\n`));
        controller.close();
      } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
    }
    let scopeType = body.scopeType as ChatScopeType | undefined;
    let scopeId = body.scopeId;
    if (body.conversationId) {
      const conversation = getDb().prepare("SELECT scope_type AS scopeType, scope_id AS scopeId FROM conversations WHERE id = ? AND profile_id = ?").get(body.conversationId, profile.id) as { scopeType: ChatScopeType; scopeId: string } | undefined;
      if (!conversation) throw new Error("La conversación no existe para este perfil.");
      scopeType = conversation.scopeType;
      scopeId = conversation.scopeId;
    }
    const result = await answerScopedChat({ profileId: profile.id, question: body.question!, scopeType: scopeType!, scopeId: scopeId!, videoIds: body.videoIds!, modelId: body.modelId });
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: result.content })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", conversationId: result.conversationId, citations: result.citations })}\n\n`));
        controller.close();
      },
    }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
  } catch (error) {
    return apiError(error);
  }
}
