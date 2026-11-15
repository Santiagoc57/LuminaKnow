import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { makeId } from "@/lib/utils";
import { removeCollection } from "@/lib/collections";

const palette = ["#e67852", "#7a9a82", "#6f82a5", "#b88774", "#8d7ba8"];

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { name, parentId } = z.object({ name: z.string().trim().min(1).max(48), parentId: z.string().trim().nullable().optional() }).parse(await request.json());
    const db = getDb();
    if (parentId && !db.prepare("SELECT 1 FROM collections WHERE id = ?").get(parentId)) throw new Error("La carpeta superior no existe.");
    const existing = db.prepare("SELECT id, name, color, description, parent_id AS parentId, sort_order AS sortOrder, updated_at AS updatedAt FROM collections WHERE name = ? COLLATE NOCASE AND parent_id IS ?").get(name, parentId ?? null);
    if (existing) return NextResponse.json(existing);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM collections").get() as { count: number }).count;
    const now = new Date().toISOString();
    const siblingCount = (db.prepare("SELECT COUNT(*) AS count FROM collections WHERE parent_id IS ?").get(parentId ?? null) as { count: number }).count;
    const collection = { id: makeId("col"), name, color: palette[count % palette.length], description: "", parentId: parentId ?? null, sortOrder: siblingCount, updatedAt: now };
    db.prepare("INSERT INTO collections(id, name, color, description, parent_id, sort_order, created_at, updated_at) VALUES(?, ?, ?, '', ?, ?, ?, ?)")
      .run(collection.id, collection.name, collection.color, collection.parentId, collection.sortOrder, now, now);
    return NextResponse.json(collection, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireProfile();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new Error("Colección no especificada.");
    removeCollection(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
