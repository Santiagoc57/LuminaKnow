import crypto from "node:crypto";
import { getDb } from "./db";
import { listVideos } from "./data";
import { listSmartSpaces } from "./spaces";
import { listCatalogTags } from "./mobile-library";
import { spaceQueryMatches } from "./library-query";
import { lanAddresses } from "./mobile-https";

// Enlace de solo lectura para compartir un espacio. Muestra títulos, imágenes, resúmenes y enlaces,
// nunca tus notas, subrayados ni chats. Funciona para quien esté en tu misma red (LUMINA vive en tu Mac).

function ensureColumn() {
  const db = getDb();
  const columns = db.prepare("PRAGMA table_info(collections)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "share_token")) db.exec("ALTER TABLE collections ADD COLUMN share_token TEXT");
  return db;
}

export function shareBaseUrl() {
  const port = process.env.PORT || "3000";
  const address = lanAddresses()[0] || "localhost";
  return `http://${address}${port === "80" ? "" : `:${port}`}`;
}

export function spaceShare(spaceId: string) {
  const row = ensureColumn().prepare("SELECT share_token AS token FROM collections WHERE id = ?").get(spaceId) as { token: string | null } | undefined;
  if (!row) throw new Error("Espacio no encontrado.");
  return { enabled: Boolean(row.token), url: row.token ? `${shareBaseUrl()}/s/${row.token}` : "" };
}

export function setSpaceShared(spaceId: string, enabled: boolean) {
  const db = ensureColumn();
  if (!db.prepare("SELECT 1 FROM collections WHERE id = ?").get(spaceId)) throw new Error("Espacio no encontrado.");
  // Al volver a activarlo se crea un enlace nuevo: el anterior deja de funcionar.
  db.prepare("UPDATE collections SET share_token = ? WHERE id = ?").run(enabled ? crypto.randomBytes(18).toString("base64url") : null, spaceId);
  return spaceShare(spaceId);
}

export type SharedItem = { id: string; title: string; type: string; author: string; url: string; gist: string; hasImage: boolean; createdAt: string };

export function sharedSpace(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const db = ensureColumn();
  const row = db.prepare("SELECT id FROM collections WHERE share_token = ?").get(token) as { id: string } | undefined;
  if (!row) return null;
  const space = listSmartSpaces().find((item) => item.id === row.id);
  if (!space) return null;
  const catalog = listCatalogTags();
  const manual = new Set(space.itemIds);
  const items: SharedItem[] = listVideos("").filter((video) => manual.has(video.id) || (space.query && spaceQueryMatches(space.query, video, catalog))).map((video) => ({
    id: video.id,
    title: video.title,
    type: video.sourceType,
    author: video.channel,
    url: video.sourceType === "note" || /^(lumina:|local:)/.test(video.url) ? "" : video.url,
    gist: (video.summary?.cardSummary || video.summary?.gist || (video.sourceType === "note" ? "" : video.description) || "").slice(0, 320),
    hasImage: Boolean(video.thumbnailUrl),
    createdAt: video.createdAt,
  }));
  return { name: space.name, color: space.color, items };
}
