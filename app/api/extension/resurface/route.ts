import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { validateCatalogAssignment } from "@/lib/canonical-tags";

export const runtime = "nodejs";

const requestSchema = z.object({
  url: z.string().trim().url(),
  title: z.string().trim().max(240).default(""),
  description: z.string().trim().max(2_000).default(""),
  tagCatalogKeys: z.array(z.string().trim().max(100)).max(5).default([]),
});

type CandidateRow = {
  id: string;
  url: string;
  title: string;
  customTitle: string;
  channel: string;
  description: string;
  sourceType: "youtube" | "x" | "reddit" | "web";
  thumbnailUrl: string;
  createdAt: string;
  tagIdsCsv: string;
  tagNamesCsv: string;
};

function hostname(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, "").toLocaleLowerCase(); } catch { return ""; }
}

function significantTokens(value: string) {
  const ignored = new Set(["para", "como", "sobre", "desde", "este", "esta", "estos", "estas", "that", "with", "from", "your", "this", "the", "and", "una", "unos", "unas", "del", "las", "los", "por", "con"]);
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").match(/[a-z0-9]{4,}/g)?.filter((token) => !ignored.has(token)) || []);
}

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const data = requestSchema.parse(await request.json());
    const catalogTags = validateCatalogAssignment(data.tagCatalogKeys);
    const db = getDb();
    const incomingRows = catalogTags.length ? db.prepare(`SELECT id, name, level FROM tags WHERE active = 1 AND catalog_key IN (${catalogTags.map(() => "?").join(",")})`).all(...catalogTags.map((tag) => tag.id)) as Array<{ id: string; name: string; level: string }> : [];
    const acceptedIds = new Set<string>();
    incomingRows.forEach((tag) => {
      acceptedIds.add(tag.id);
      if (tag.level === "primary") (db.prepare("SELECT child_tag_id AS id FROM tag_relations WHERE parent_tag_id = ?").all(tag.id) as Array<{ id: string }>).forEach((child) => acceptedIds.add(child.id));
    });
    const rows = db.prepare(`
      SELECT v.id, v.url, v.title, v.custom_title AS customTitle, v.channel, v.description,
        v.source_type AS sourceType, v.thumbnail_url AS thumbnailUrl, v.created_at AS createdAt,
        COALESCE(GROUP_CONCAT(t.id), '') AS tagIdsCsv,
        COALESCE(GROUP_CONCAT(t.name, '|||'), '') AS tagNamesCsv
      FROM videos v
      LEFT JOIN video_tags vt ON vt.video_id = v.id
      LEFT JOIN tags t ON t.id = vt.tag_id AND t.active = 1
      WHERE v.url != ?
      GROUP BY v.id
      ORDER BY v.created_at DESC
      LIMIT 500
    `).all(data.url) as CandidateRow[];
    const sourceDomain = hostname(data.url);
    const sourceTokens = significantTokens(`${data.title} ${data.description}`);
    const results = rows.map((row) => {
      const tagIds = row.tagIdsCsv ? row.tagIdsCsv.split(",") : [];
      const tagNames = row.tagNamesCsv ? row.tagNamesCsv.split("|||") : [];
      const sharedTagNames = tagIds.map((id, index) => acceptedIds.has(id) ? tagNames[index] : "").filter(Boolean);
      const candidateTokens = significantTokens(`${row.customTitle || row.title} ${row.channel} ${row.description}`);
      const sharedWords = [...sourceTokens].filter((token) => candidateTokens.has(token));
      const sameDomain = Boolean(sourceDomain && hostname(row.url) === sourceDomain);
      const ageDays = Math.max(0, (Date.now() - new Date(row.createdAt).getTime()) / 86_400_000);
      const score = sharedTagNames.length * 5 + Math.min(sharedWords.length, 4) * 1.25 + (sameDomain ? 1.5 : 0) + Math.min(ageDays / 365, 1);
      const reason = sharedTagNames.length ? `Comparte ${sharedTagNames.slice(0, 2).join(" y ")}` : sameDomain ? `También viene de ${sourceDomain}` : sharedWords.length ? `Coincide en ${sharedWords.slice(0, 2).join(" y ")}` : "";
      return { row, score, reason };
    }).filter((item) => item.score >= 2.5 && item.reason).sort((a, b) => b.score - a.score || new Date(a.row.createdAt).getTime() - new Date(b.row.createdAt).getTime()).slice(0, 3);
    return extensionJson(request, { items: results.map(({ row, reason }) => ({ id: row.id, title: row.customTitle || row.title, url: row.url, luminaUrl: `/?video=${encodeURIComponent(row.id)}`, sourceType: row.sourceType, thumbnailUrl: row.thumbnailUrl, savedAt: row.createdAt, reason })) });
  } catch (error) { return extensionError(request, error); }
}
