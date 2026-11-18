import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listVideos } from "@/lib/data";
import { getAIProvider, getMonthlyUsage, hasAIKey, listAvailableModels } from "@/lib/ai";
import { recoverPendingJobs } from "@/lib/worker";
import { apiError } from "@/lib/http";
import { getGeminiKey, getOpenAIKey } from "@/lib/secrets";
import { recoverTaggingJobs } from "@/lib/tagging";
import { hasExtensionToken } from "@/lib/extension-auth";
import { listSmartSpaces } from "@/lib/spaces";
import { scheduleVisualBackfill } from "@/lib/vision";
import { maintenanceReport } from "@/lib/weekly-maintenance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

declare global { var __luminaLocalWarm: boolean | undefined; }

export async function GET(request: Request) {
  try {
    const profile = await requireProfile();
    recoverPendingJobs();
    recoverTaggingJobs();
    scheduleVisualBackfill();
    // Calienta el modelo local de búsqueda por significado para que la primera búsqueda no espere.
    if (!globalThis.__luminaLocalWarm) { globalThis.__luminaLocalWarm = true; void import("@/lib/local-embeddings").then((module) => module.syncLocalVectors()).catch(() => { globalThis.__luminaLocalWarm = false; }); }
    const query = new URL(request.url).searchParams.get("q") || "";
    const db = getDb();
    const collections = db.prepare("SELECT id, name, color, description, parent_id AS parentId, sort_order AS sortOrder, updated_at AS updatedAt FROM collections ORDER BY parent_id, sort_order, name").all();
    const tags = db.prepare(`
      SELECT t.id, COALESCE(t.catalog_key, '') AS catalogKey, t.name, t.color, t.kind, t.level,
        t.sort_order AS sortOrder, t.active,
        COALESCE((SELECT GROUP_CONCAT(parent_tag_id) FROM tag_relations WHERE child_tag_id = t.id), '') AS parentIdsCsv
      FROM tags t WHERE t.active = 1 AND t.level IN ('primary', 'secondary')
      ORDER BY CASE t.level WHEN 'primary' THEN 0 ELSE 1 END, t.sort_order, t.name
    `).all().map((tag) => {
      const item = tag as Record<string, unknown> & { parentIdsCsv: string; active: number };
      const { parentIdsCsv, ...rest } = item;
      return { ...rest, active: Boolean(item.active), parentIds: parentIdsCsv ? parentIdsCsv.split(",") : [] };
    });
    return NextResponse.json({
      profile,
      videos: listVideos(query),
      archived: listVideos({ archived: true }),
      spaces: listSmartSpaces(),
      // Último fallo de la IA al resumir (para el aviso del inicio): solo el mensaje, sin datos de la fuente.
      aiLastError: (() => { const error = (globalThis as { __luminaLastSummaryError?: unknown }).__luminaLastSummaryError; return error instanceof Error ? error.message.slice(0, 180) : ""; })(),
      collections,
      tags,
      maintenance: maintenanceReport(),
      usage: getMonthlyUsage(),
      hasAiKey: hasAIKey(),
      aiProvider: getAIProvider(),
      models: listAvailableModels(),
      hasGeminiKey: Boolean(getGeminiKey()),
      hasOpenAIKey: Boolean(getOpenAIKey()),
      extensionConnected: hasExtensionToken(profile.id),
    });
  } catch (error) {
    return apiError(error);
  }
}
