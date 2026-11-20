import { NextResponse } from "next/server";
import { sharedSpace } from "@/lib/space-share";
import { thumbnailFor } from "@/lib/thumbs";

export const runtime = "nodejs";

// Imagen de una tarjeta de un espacio compartido: solo si el enlace es válido y la tarjeta está en ese espacio.
export async function GET(_: Request, context: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await context.params;
  const space = sharedSpace(token);
  if (!space?.items.some((item) => item.id === id)) return NextResponse.json({ error: "No disponible." }, { status: 404 });
  const bytes = await thumbnailFor(id, 640).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Sin imagen." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
