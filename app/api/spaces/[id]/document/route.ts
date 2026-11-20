import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { spaceDocument } from "@/lib/space-document";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const body = z.object({ format: z.enum(["informe", "guion", "post", "resumen"]).default("informe"), focus: z.string().trim().max(500).default("") }).parse(await request.json());
    return NextResponse.json(await spaceDocument(id, body.format, body.focus));
  } catch (error) { return apiError(error); }
}
