import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { addSpaceItem, removeSpaceItem } from "@/lib/spaces";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string; videoId: string }> };

export async function PUT(_: Request, context: Params) {
  try {
    await requireProfile();
    const { id, videoId } = await context.params;
    addSpaceItem(id, videoId);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: Params) {
  try {
    await requireProfile();
    const { id, videoId } = await context.params;
    removeSpaceItem(id, videoId);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
