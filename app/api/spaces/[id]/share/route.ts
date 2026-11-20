import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { setSpaceShared, spaceShare } from "@/lib/space-share";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try { await requireProfile(); const { id } = await context.params; return NextResponse.json(spaceShare(id)); } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());
    return NextResponse.json(setSpaceShared(id, enabled));
  } catch (error) { return apiError(error); }
}
