import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createPaletteFromImage } from "@/lib/palette";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    return NextResponse.json(createPaletteFromImage(id, profile.id));
  } catch (error) {
    return apiError(error);
  }
}
