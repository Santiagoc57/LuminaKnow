import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { parseSourceUrl } from "@/lib/utils";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

// Los recortes que guardaste de esta página, para resaltarlos cuando vuelves a ella.
export async function GET(request: Request) {
  try {
    requireExtensionProfile(request);
    const url = new URL(request.url).searchParams.get("url") || "";
    let parsed: ReturnType<typeof parseSourceUrl> | null = null;
    try { parsed = parseSourceUrl(url); } catch { parsed = null; }
    if (!parsed) return extensionJson(request, { id: null, quotes: [] });
    const video = getDb().prepare("SELECT id FROM videos WHERE source_type = ? AND youtube_id = ?").get(parsed.sourceType, parsed.sourceId) as { id: string } | undefined;
    if (!video) return extensionJson(request, { id: null, quotes: [] });
    const quotes = (getDb().prepare("SELECT quote FROM highlights WHERE video_id = ? ORDER BY created_at").all(video.id) as Array<{ quote: string }>).map((row) => row.quote).filter((quote) => quote.trim().length >= 3).slice(0, 200);
    return extensionJson(request, { id: video.id, quotes });
  } catch (error) { return extensionError(request, error); }
}
