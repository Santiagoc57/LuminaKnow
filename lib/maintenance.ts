import { getDb } from "./db";
import { assertPublicUrl } from "./web-article";

// Normaliza una dirección para comparar: sin «www», sin parámetros de seguimiento, sin barra final ni ancla.
export function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.hostname = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
    [...url.searchParams.keys()].forEach((key) => { if (/^(utm_|fbclid|gclid|igshid|si$|ref$|ref_src|s$|t$|feature$|share|mc_)/i.test(key)) url.searchParams.delete(key); });
    url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : "";
    return `${url.hostname}${url.pathname.replace(/\/+$/, "")}${url.search}`;
  } catch { return value.trim().toLowerCase(); }
}

function normalizeTitle(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type Row = { id: string; title: string; url: string; sourceType: string; createdAt: string; thumbnail: string };

// Duplicados: misma dirección normalizada, o mismo título largo en el mismo sitio.
export function findDuplicates() {
  const rows = getDb().prepare("SELECT id, COALESCE(NULLIF(custom_title, ''), title) AS title, url, source_type AS sourceType, created_at AS createdAt, thumbnail_url AS thumbnail FROM videos WHERE archived_at IS NULL AND url NOT LIKE 'local://%' ORDER BY created_at").all() as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const byUrl = `url:${normalizeUrl(row.url)}`;
    groups.set(byUrl, [...(groups.get(byUrl) ?? []), row]);
    const title = normalizeTitle(row.title);
    if (title.length >= 24) {
      let host = "";
      try { host = new URL(row.url).hostname.replace(/^www\./, ""); } catch { /* sin host */ }
      const byTitle = `title:${host}:${title}`;
      groups.set(byTitle, [...(groups.get(byTitle) ?? []), row]);
    }
  }
  const seen = new Set<string>();
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => ({ reason: key.startsWith("url:") ? "Misma dirección" : "Mismo título en el mismo sitio", items }))
    .filter((group) => { const signature = group.items.map((item) => item.id).sort().join(","); if (seen.has(signature)) return false; seen.add(signature); return true; });
}

// Enlaces rotos: se pide cada página (sin descargarla entera) y se guarda el resultado.
export async function checkLinks(limit = 200) {
  const db = getDb();
  const rows = db.prepare("SELECT id, url FROM videos WHERE archived_at IS NULL AND source_type IN ('web', 'pdf') AND url LIKE 'http%' ORDER BY COALESCE(link_checked_at, '') LIMIT ?").all(limit) as Array<{ id: string; url: string }>;
  const update = db.prepare("UPDATE videos SET link_status = ?, link_checked_at = ? WHERE id = ?");
  for (const row of rows) {
    let status = "ok";
    try {
      await assertPublicUrl(row.url);
      const response = await fetch(row.url, { method: "GET", redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; Lumina/1.0)", Range: "bytes=0-2048" }, signal: AbortSignal.timeout(12_000) });
      if (response.status === 404 || response.status === 410) status = "broken";
      else if (response.status >= 500) status = "error";
      else if (response.status === 403 || response.status === 401 || response.status === 429) status = "blocked";
      await response.body?.cancel().catch(() => undefined);
    } catch { status = "unreachable"; }
    update.run(status, new Date().toISOString(), row.id);
  }
  return listLinkProblems();
}

export function listLinkProblems() {
  return getDb().prepare("SELECT id, COALESCE(NULLIF(custom_title, ''), title) AS title, url, link_status AS status, link_checked_at AS checkedAt, snapshot_saved_at AS snapshotAt FROM videos WHERE archived_at IS NULL AND link_status IN ('broken', 'unreachable', 'error') ORDER BY link_checked_at DESC").all();
}
