import { z } from "zod";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { syncVideoMemberships } from "@/lib/knowledge";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

// Desde el diálogo de la extensión: cambiar el título o añadir etiquetas del catálogo a algo ya guardado.
export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const body = z.object({ id: z.string().min(1), title: z.string().trim().max(200).optional(), tagKeys: z.array(z.string().max(100)).max(5).default([]) }).parse(await request.json());
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM videos WHERE id = ?").get(body.id)) throw new Error("Fuente no encontrada.");
    if (body.title) db.prepare("UPDATE videos SET custom_title = ?, updated_at = ? WHERE id = ?").run(body.title, new Date().toISOString(), body.id);
    if (body.tagKeys.length) {
      const insert = db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) SELECT ?, id, 'manual', 1 FROM tags WHERE catalog_key = ? AND active = 1");
      body.tagKeys.forEach((key) => insert.run(body.id, key));
      syncVideoMemberships(body.id);
    }
    refreshVideoSearch(body.id);
    return extensionJson(request, { ok: true });
  } catch (error) { return extensionError(request, error); }
}
