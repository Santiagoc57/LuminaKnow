import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { scheduleTaggingJob } from "@/lib/tagging";
import { safeJson } from "@/lib/utils";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const row = getDb().prepare(`SELECT id, status, model_id AS modelId, interests, source_ids_json AS sourceIdsJson,
      estimated_units AS estimatedUnits, processed_count AS processedCount, error, created_at AS createdAt, updated_at AS updatedAt
      FROM bulk_tag_jobs WHERE id = ? AND profile_id = ?`).get(id, profile.id) as Record<string, unknown> & { sourceIdsJson: string; status: string } | undefined;
    if (!row) return NextResponse.json({ error: "Lote no encontrado." }, { status: 404 });
    if (row.status === "queued" || row.status === "running") scheduleTaggingJob(id);
    const { sourceIdsJson, ...job } = row;
    return NextResponse.json({ ...job, sourceCount: safeJson<string[]>(sourceIdsJson, []).length });
  } catch (error) {
    return apiError(error);
  }
}
