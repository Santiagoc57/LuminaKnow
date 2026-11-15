import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { deleteConversation, getConversation, renameConversation, setConversationPinned } from "@/lib/conversations";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    return NextResponse.json(getConversation(profile.id, (await context.params).id));
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { title, pinned } = z.object({
      title: z.string().trim().min(1).max(72).optional(),
      pinned: z.boolean().optional(),
    }).refine((value) => value.title !== undefined || value.pinned !== undefined, "No hay cambios para guardar.").parse(await request.json());
    const id = (await context.params).id;
    if (title !== undefined) renameConversation(profile.id, id, title);
    if (pinned !== undefined) setConversationPinned(profile.id, id, pinned);
    return NextResponse.json(getConversation(profile.id, id));
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    deleteConversation(profile.id, (await context.params).id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
