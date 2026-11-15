import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createHighlight } from "@/lib/highlights";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const { quote } = z.object({ quote: z.string().trim().min(2).max(10_000) }).parse(await request.json());
    if (!getDb().prepare("SELECT 1 FROM videos WHERE id = ?").get(id)) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
    return NextResponse.json({ highlight: createHighlight({ videoId: id, quote, origin: "reader", profileId: profile.id }) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
