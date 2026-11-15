import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { deleteHighlight, updateHighlightNote } from "@/lib/highlights";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; highlightId: string }> };

export async function PATCH(request: Request, context: Params) {
  try {
    await requireProfile();
    const { id, highlightId } = await context.params;
    const { note } = z.object({ note: z.string().trim().max(5_000) }).parse(await request.json());
    if (!updateHighlightNote(id, highlightId, note)) return NextResponse.json({ error: "Subrayado no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: Params) {
  try {
    await requireProfile();
    const { id, highlightId } = await context.params;
    if (!deleteHighlight(id, highlightId)) return NextResponse.json({ error: "Subrayado no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
