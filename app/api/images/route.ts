import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/media";
import { createImageSource } from "@/lib/vision";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Selecciona una imagen.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("La imagen supera los 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("Formato no compatible. Usa JPG, PNG, GIF o WebP.");
    const result = await createImageSource({ bytes, kind, title: file.name === "image.png" ? "" : file.name, profileId: profile.id });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return apiError(error); }
}
