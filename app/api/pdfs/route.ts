import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createPdfSource, MAX_PDF_BYTES, searchPdfText } from "@/lib/pdf";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireProfile();
    return NextResponse.json({ ids: searchPdfText(new URL(request.url).searchParams.get("q") ?? "") });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecciona un PDF.");
    if (file.size > MAX_PDF_BYTES) throw new Error("El PDF supera los 80 MB.");
    const result = await createPdfSource({ bytes: new Uint8Array(await file.arrayBuffer()), profileId: profile.id, fileName: file.name });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
