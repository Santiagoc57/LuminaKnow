import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { thumbnailFor } from "@/lib/thumbs";

export const runtime = "nodejs";

// Miniatura WebP de una fuente para el mosaico (ancho 320, 640 o 960).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const requested = Number(new URL(request.url).searchParams.get("w") || 640);
    const width = [320, 640, 960].includes(requested) ? requested : 640;
    const bytes = await thumbnailFor(id, width);
    if (!bytes) return NextResponse.json({ error: "Sin imagen." }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=2592000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
