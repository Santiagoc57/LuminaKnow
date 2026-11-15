import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { askGhostReader } from "@/lib/ghost";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

const ghostSchema = z.object({
  action: z.enum(["ask", "explain", "define", "simplify"]),
  selection: z.string().trim().max(6_000).default(""),
  question: z.string().trim().max(1_000).default(""),
}).refine((body) => body.action === "ask" ? Boolean(body.question) : Boolean(body.selection), "Selecciona un texto o escribe una pregunta.");

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const body = ghostSchema.parse(await request.json());
    return NextResponse.json({ answer: await askGhostReader({ videoId: id, ...body }) });
  } catch (error) { return apiError(error); }
}
