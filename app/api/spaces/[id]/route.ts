import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { deleteSmartSpace, updateSmartSpace } from "@/lib/spaces";

export const runtime = "nodejs";

// Las carpetas (antes «espacios»): renombrar, cambiar o quitar su regla, y borrar.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const body = z.object({ name: z.string().trim().max(60).optional(), query: z.string().trim().max(300).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(await request.json());
    updateSmartSpace(id, body);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    if (!deleteSmartSpace(id)) return NextResponse.json({ error: "Espacio no encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
