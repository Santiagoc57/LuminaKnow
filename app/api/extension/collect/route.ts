import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { syncVideoMemberships } from "@/lib/knowledge";

export const runtime = "nodejs";

// Añade lo recién guardado a una carpeta (sin quitarlo de las que ya tenía).
export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const { id, collectionId } = z.object({ id: z.string().min(1), collectionId: z.string().min(1) }).parse(await request.json());
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM videos WHERE id = ?").get(id)) throw new Error("Eso ya no está en Lúmina.");
    const board = db.prepare("SELECT name FROM collections WHERE id = ?").get(collectionId) as { name: string } | undefined;
    if (!board) throw new Error("Esa carpeta ya no existe.");
    db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)").run(id, collectionId);
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), collectionId);
    syncVideoMemberships(id);
    return extensionJson(request, { ok: true, board: board.name });
  } catch (error) { return extensionError(request, error); }
}
