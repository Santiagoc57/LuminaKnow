import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { apiError } from "@/lib/http";
import { MAX_IMAGE_BYTES, saveMedia, sniffImage } from "@/lib/media";
import { makeId } from "@/lib/utils";

// Cambiar la foto principal de una tarjeta (por ejemplo, un producto): se arrastra una imagen encima.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Falta la imagen.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error("La imagen supera los 20 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("Ese archivo no es una imagen compatible.");
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM videos WHERE id = ?").get(id)) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
    const { url } = saveMedia(makeId("cover"), bytes, kind);
    db.transaction(() => {
      db.prepare("UPDATE videos SET thumbnail_url = ?, updated_at = ? WHERE id = ?").run(url, new Date().toISOString(), id);
      db.prepare("UPDATE source_items SET preview_url = ? WHERE video_id = ? AND ordinal = 0").run(url, id);
    })();
    refreshVideoSearch(id);
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    return apiError(error);
  }
}

// Regenerar la portada de una web: nueva captura de la página (o su imagen para compartir).
export async function PUT(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const db = getDb();
    const row = db.prepare("SELECT url FROM videos WHERE id = ?").get(id) as { url: string } | undefined;
    if (!row) return NextResponse.json({ error: "Fuente no encontrada." }, { status: 404 });
    const { screenshotPage, shareImage } = await import("@/lib/page-shot");
    const bytes = (await screenshotPage(row.url)) ?? (await shareImage(row.url));
    const kind = bytes ? sniffImage(bytes) : null;
    if (!bytes || !kind) throw new Error("No se pudo tomar una nueva portada de esta página.");
    const { url } = saveMedia(makeId("cover"), bytes, kind);
    db.transaction(() => {
      db.prepare("UPDATE videos SET thumbnail_url = ?, updated_at = ? WHERE id = ?").run(url, new Date().toISOString(), id);
      db.prepare("UPDATE source_items SET preview_url = ? WHERE video_id = ? AND ordinal = 0").run(url, id);
    })();
    refreshVideoSearch(id);
    return NextResponse.json({ ok: true, url });
  } catch (error) {
    return apiError(error);
  }
}
