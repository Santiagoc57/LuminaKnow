import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { listVideos } from "@/lib/data";
import { upsertKnowledgeNode } from "@/lib/knowledge";
import { assertCollectionParent, refreshCollectionBranchSearch, removeCollection } from "@/lib/collections";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const collection = getDb().prepare("SELECT id, name, color, description, parent_id AS parentId, sort_order AS sortOrder, updated_at AS updatedAt FROM collections WHERE id = ?").get(id);
    if (!collection) return NextResponse.json({ error: "Colección no encontrada." }, { status: 404 });
    const videos = listVideos({ collectionId: id });
    return NextResponse.json({ collection, videos });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const data = z.object({ name: z.string().trim().min(1).max(48).optional(), description: z.string().trim().max(2_000).optional(), parentId: z.string().trim().nullable().optional(), sortOrder: z.number().int().min(0).optional() }).parse(await request.json());
    const db = getDb();
    const current = db.prepare("SELECT id, name, description, parent_id AS parentId, sort_order AS sortOrder FROM collections WHERE id = ?").get(id) as { id: string; name: string; description: string; parentId: string | null; sortOrder: number } | undefined;
    if (!current) return NextResponse.json({ error: "Colección no encontrada." }, { status: 404 });
    const now = new Date().toISOString();
    const name = data.name ?? current.name;
    const description = data.description ?? current.description;
    const parentId = data.parentId === undefined ? current.parentId : data.parentId;
    assertCollectionParent(id, parentId);
    db.prepare("UPDATE collections SET name = ?, description = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?").run(name, description, parentId, data.sortOrder ?? current.sortOrder, now, id);
    upsertKnowledgeNode({ nodeType: "collection", refId: id, label: name, description });
    refreshCollectionBranchSearch(id);
    return NextResponse.json({ id, name, description, parentId, sortOrder: data.sortOrder ?? current.sortOrder, updatedAt: now });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    removeCollection(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
