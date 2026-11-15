import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb, refreshVideoSearch } from "@/lib/db";
import { apiError } from "@/lib/http";
import { syncVideoMemberships } from "@/lib/knowledge";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const { tagIds } = z.object({ tagIds: z.array(z.string()).max(30) }).parse(await request.json());
    const db = getDb();
    const uniqueIds = [...new Set(tagIds)];
    const rows = uniqueIds.length ? db.prepare(`SELECT id, level FROM tags WHERE active = 1 AND (catalog_key IS NOT NULL OR level = 'free') AND id IN (${uniqueIds.map(() => "?").join(",")})`).all(...uniqueIds) as Array<{ id: string; level: string }> : [];
    if (rows.length !== uniqueIds.length) throw new Error("Una de las etiquetas ya no existe.");
    if (rows.filter((tag) => tag.level === "free").length > 12) throw new Error("Puedes asignar como máximo 12 etiquetas libres.");
    if (rows.filter((tag) => tag.level === "primary").length > 3) throw new Error("Puedes asignar como máximo 3 etiquetas principales.");
    if (rows.filter((tag) => tag.level === "secondary").length > 2) throw new Error("Puedes asignar como máximo 2 subetiquetas.");
    db.transaction(() => {
      // Las que ya estaban conservan su origen (IA o manual); solo las nuevas cuentan como tuyas.
      const kept = new Set(uniqueIds);
      (db.prepare("SELECT tag_id AS tagId FROM video_tags WHERE video_id = ?").all(id) as Array<{ tagId: string }>).forEach((row) => { if (!kept.has(row.tagId)) db.prepare("DELETE FROM video_tags WHERE video_id = ? AND tag_id = ?").run(id, row.tagId); });
      const insert = db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) VALUES(?, ?, 'manual', 1)");
      uniqueIds.forEach((tagId) => insert.run(id, tagId));
    })();
    syncVideoMemberships(id);
    refreshVideoSearch(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
