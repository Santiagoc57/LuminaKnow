import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

// «¿En qué video hablaban de inflación?»: busca en las transcripciones y devuelve el minuto exacto.
export async function GET(request: Request) {
  try {
    await requireProfile();
    const query = (new URL(request.url).searchParams.get("q") || "").trim();
    // Palabras de 3+ letras, sin operadores ni etiquetas (#…, tipo:…).
    const terms = query.split(/\s+/).filter((term) => !term.includes(":") && !term.startsWith("#")).join(" ").toLocaleLowerCase("es").match(/[\p{L}\p{N}]{3,}/gu)?.slice(0, 6) ?? [];
    if (!terms.length) return NextResponse.json({ moments: [] });
    const match = terms.map((term) => `"${term.replaceAll('"', "")}"*`).join(" AND ");
    let rows: Array<{ videoId: string; title: string; sourceType: string; youtubeId: string; url: string; thumbnailUrl: string; startSeconds: number; text: string; rank: number }> = [];
    try {
      rows = getDb().prepare(`
        SELECT r.video_id AS videoId, COALESCE(NULLIF(v.custom_title, ''), v.title) AS title, v.source_type AS sourceType, v.youtube_id AS youtubeId, v.url, v.thumbnail_url AS thumbnailUrl,
          r.start_seconds AS startSeconds, r.text, s.rank
        FROM retrieval_search s
        JOIN retrieval_units r ON r.id = s.unit_id
        JOIN videos v ON v.id = r.video_id
        WHERE retrieval_search MATCH ? AND r.source_kind = 'transcript' AND r.start_seconds IS NOT NULL AND v.source_type IN ('youtube', 'audio') AND v.archived_at IS NULL
        ORDER BY s.rank LIMIT 40
      `).all(match) as typeof rows;
    } catch { rows = []; }
    // Un momento por video (el mejor), máximo 8 videos.
    const seen = new Set<string>();
    const moments = rows.filter((row) => !seen.has(row.videoId) && seen.add(row.videoId)).slice(0, 8).map((row) => {
      const lower = row.text.toLocaleLowerCase("es");
      const at = Math.max(0, Math.min(...terms.map((term) => { const index = lower.indexOf(term); return index < 0 ? Number.MAX_SAFE_INTEGER : index; })));
      const start = at === Number.MAX_SAFE_INTEGER ? 0 : Math.max(0, at - 80);
      const snippet = `${start > 0 ? "…" : ""}${row.text.slice(start, start + 220).trim()}${start + 220 < row.text.length ? "…" : ""}`;
      return { videoId: row.videoId, title: row.title, sourceType: row.sourceType, thumbnailUrl: row.thumbnailUrl, startSeconds: Math.floor(row.startSeconds), snippet,
        link: row.sourceType === "youtube" ? `https://www.youtube.com/watch?v=${encodeURIComponent(row.youtubeId)}&t=${Math.floor(row.startSeconds)}s` : row.url };
    });
    return NextResponse.json({ moments, terms });
  } catch (error) { return apiError(error); }
}
