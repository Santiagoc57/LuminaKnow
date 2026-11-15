import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { currentEmbeddingModel, embedTexts } from "@/lib/ai";
import { syncRetrievalUnit } from "@/lib/knowledge";
import { saveNoteContent } from "@/lib/notes";

export const runtime = "nodejs";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const { content } = z.object({ content: z.string().max(100_000) }).parse(await request.json());
    const { changed, updatedAt } = saveNoteContent({ videoId: id, profileId: profile.id, content });
    const source = getDb().prepare("SELECT source_type AS sourceType FROM videos WHERE id = ?").get(id) as { sourceType: string };
    // Las notas propias nunca salen del Mac; las anotaciones sobre otras fuentes siguen indexándose como antes.
    if (changed && source.sourceType !== "note") {
      const [embedding] = content.trim() ? await embedTexts([content]) : [null];
      syncRetrievalUnit({ id: `ret_note_${id}`, videoId: id, sourceKind: "note", sourceRef: "note", text: content, embedding, embeddingModel: embedding ? currentEmbeddingModel() : "" });
    }
    return NextResponse.json({ content, updatedAt, updatedByName: profile.name });
  } catch (error) {
    return apiError(error);
  }
}
