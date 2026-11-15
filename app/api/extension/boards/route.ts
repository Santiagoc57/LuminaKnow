import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { makeId } from "@/lib/utils";

export const runtime = "nodejs";

const PALETTE = ["#e75e3a", "#e0912f", "#8aa63a", "#3f9d6c", "#2f9c9c", "#3d86c6", "#5a6fd1", "#8560c9", "#c056a8", "#d9537a"];

// Carpetas para el selector de la extensión (como los tableros de Pinterest): portada, cantidad y última vez usada.
export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function GET(request: Request) {
  try {
    requireExtensionProfile(request);
    const boards = getDb().prepare(`
      SELECT c.id, c.name, c.color, c.parent_id AS parentId,
        COUNT(vc.video_id) AS count,
        MAX(v.created_at) AS lastUsedAt,
        (SELECT COALESCE(NULLIF(v2.thumbnail_url, ''), (SELECT si.preview_url FROM source_items si WHERE si.video_id = v2.id AND si.preview_url <> '' ORDER BY si.ordinal LIMIT 1), '')
           FROM video_collections vc2 JOIN videos v2 ON v2.id = vc2.video_id
           WHERE vc2.collection_id = c.id AND v2.archived_at IS NULL AND (v2.thumbnail_url <> '' OR EXISTS (SELECT 1 FROM source_items si WHERE si.video_id = v2.id AND si.preview_url <> ''))
           ORDER BY v2.created_at DESC LIMIT 1) AS cover
      FROM collections c
      LEFT JOIN video_collections vc ON vc.collection_id = c.id
      LEFT JOIN videos v ON v.id = vc.video_id
      GROUP BY c.id ORDER BY c.name COLLATE NOCASE
    `).all();
    return extensionJson(request, { boards });
  } catch (error) { return extensionError(request, error); }
}

export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const { name } = z.object({ name: z.string().trim().min(1, "Escribe un nombre.").max(48) }).parse(await request.json());
    const db = getDb();
    const existing = db.prepare("SELECT id, name, color FROM collections WHERE name = ? COLLATE NOCASE AND parent_id IS NULL").get(name);
    if (existing) return extensionJson(request, existing);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM collections").get() as { count: number }).count;
    const siblings = (db.prepare("SELECT COUNT(*) AS count FROM collections WHERE parent_id IS NULL").get() as { count: number }).count;
    const now = new Date().toISOString();
    const board = { id: makeId("col"), name, color: PALETTE[count % PALETTE.length] };
    db.prepare("INSERT INTO collections(id, name, color, description, parent_id, sort_order, created_at, updated_at) VALUES(?, ?, ?, '', NULL, ?, ?, ?)").run(board.id, board.name, board.color, siblings, now, now);
    return extensionJson(request, board, { status: 201 });
  } catch (error) { return extensionError(request, error); }
}
