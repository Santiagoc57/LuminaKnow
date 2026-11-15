import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { findSimilarSources } from "@/lib/similar";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const similar = findSimilarSources(id);
    if (!similar) return NextResponse.json({ error: "Esta fuente aún no tiene una huella visual para comparar." }, { status: 404 });
    return NextResponse.json({ similar });
  } catch (error) { return apiError(error); }
}
