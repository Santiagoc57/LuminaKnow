import { z } from "zod";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { MAX_IMAGE_BYTES, saveMedia, sniffImage } from "@/lib/media";
import { makeId } from "@/lib/utils";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

// Captura de pantalla de la página al guardarla (como mymind): se usa como portada de la tarjeta.
export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const body = z.object({ id: z.string().min(1), imageBase64: z.string().min(100), onlyIfMissing: z.boolean().default(false) }).parse(await request.json());
    const bytes = new Uint8Array(Buffer.from(body.imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64"));
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("La captura es demasiado grande.");
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("La captura no es una imagen válida.");
    const db = getDb();
    const row = db.prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(body.id) as { url: string } | undefined;
    if (!row) throw new Error("Fuente no encontrada.");
    if (body.onlyIfMissing && /^\/api\/media\/cover_/.test(row.url || "")) return extensionJson(request, { ok: true, kept: true });
    const { url } = saveMedia(makeId("cover"), bytes, kind);
    db.transaction(() => {
      db.prepare("UPDATE videos SET thumbnail_url = ?, updated_at = ? WHERE id = ?").run(url, new Date().toISOString(), body.id);
      db.prepare("UPDATE source_items SET preview_url = ? WHERE video_id = ? AND ordinal = 0").run(url, body.id);
    })();
    refreshVideoSearch(body.id);
    return extensionJson(request, { ok: true, url });
  } catch (error) { return extensionError(request, error); }
}
