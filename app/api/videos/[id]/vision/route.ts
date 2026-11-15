import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { describeImageWithAI } from "@/lib/vision-ai";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    await describeImageWithAI(id);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
