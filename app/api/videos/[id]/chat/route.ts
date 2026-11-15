import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { answerScopedChat } from "@/lib/scoped-chat";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const { question, modelId } = z.object({ question: z.string().trim().min(2).max(4_000), modelId: z.enum(["auto", "gemini", "openai"]).default("auto") }).parse(await request.json());
    const result = await answerScopedChat({ profileId: profile.id, question, scopeType: "video", scopeId: id, videoIds: [id], modelId });
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "delta", text: result.content })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done", citations: result.citations })}\n\n`));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
  } catch (error) {
    return apiError(error);
  }
}
