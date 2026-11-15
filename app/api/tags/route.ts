import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { ensureFreeTag } from "@/lib/free-tags";

// Etiquetas libres ordenadas por uso, para sugerirlas mientras escribes.
export async function GET() {
  try {
    await requireProfile();
    const tags = getDb().prepare(`
      SELECT t.id, '' AS catalogKey, t.name, t.color, t.level, t.sort_order AS sortOrder, 1 AS active, COUNT(vt.video_id) AS uses
      FROM tags t LEFT JOIN video_tags vt ON vt.tag_id = t.id
      WHERE t.active = 1 AND t.level = 'free' GROUP BY t.id ORDER BY uses DESC, t.name COLLATE NOCASE LIMIT 2000
    `).all().map((tag) => ({ ...(tag as object), active: true, parentIds: [] }));
    return NextResponse.json({ tags });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { name } = z.object({ name: z.string().trim().min(1).max(48) }).parse(await request.json());
    const db = getDb();
    const existing = db.prepare(`SELECT id, COALESCE(catalog_key, '') AS catalogKey, name, color, kind, level,
      sort_order AS sortOrder, active FROM tags WHERE name = ? COLLATE NOCASE AND active = 1 AND level IN ('primary', 'secondary')`).get(name);
    if (existing) return NextResponse.json(existing);
    const tag = ensureFreeTag(name, "manual");
    return NextResponse.json(db.prepare("SELECT id, COALESCE(catalog_key, '') AS catalogKey, name, color, kind, level, sort_order AS sortOrder, active FROM tags WHERE id = ?").get(tag.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireProfile();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Etiqueta no especificada.");
    const tag = getDb().prepare("SELECT catalog_key AS catalogKey FROM tags WHERE id = ?").get(id) as { catalogKey: string | null } | undefined;
    if (!tag) return NextResponse.json({ error: "Etiqueta no encontrada." }, { status: 404 });
    return NextResponse.json({ error: "Las etiquetas del catálogo no se eliminan; se administran mediante la taxonomía de Lúmina." }, { status: 422 });
  } catch (error) {
    return apiError(error);
  }
}
