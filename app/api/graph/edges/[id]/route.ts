import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const data = z.object({ status: z.enum(["suggested", "confirmed", "hidden"]).optional(), relationType: z.string().trim().min(1).max(64).optional(), explanation: z.string().trim().max(1_000).optional() }).parse(await request.json());
    const db = getDb();
    const current = db.prepare("SELECT id, status, relation_type AS relationType, explanation FROM knowledge_edges WHERE id = ?").get(id) as { id: string; status: string; relationType: string; explanation: string } | undefined;
    if (!current) return NextResponse.json({ error: "Conexión no encontrada." }, { status: 404 });
    const updated = { status: data.status ?? current.status, relationType: data.relationType ?? current.relationType, explanation: data.explanation ?? current.explanation, updatedAt: new Date().toISOString() };
    db.prepare("UPDATE knowledge_edges SET status = ?, relation_type = ?, explanation = ?, updated_at = ? WHERE id = ?").run(updated.status, updated.relationType, updated.explanation, updated.updatedAt, id);
    return NextResponse.json({ id, ...updated });
  } catch (error) {
    return apiError(error);
  }
}
