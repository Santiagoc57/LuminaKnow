import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { mediaPathFromUrl } from "./media";
import { thumbVersion } from "./mobile-library";

// Miniaturas WebP locales: cargan al instante y siguen ahí aunque la imagen original desaparezca de la web.
const MAX_BYTES = 15 * 1024 * 1024;

function cacheDir() {
  const dir = path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "thumbs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function originalBytes(url: string) {
  const local = mediaPathFromUrl(url);
  if (local) return fs.existsSync(local) ? fs.readFileSync(/* turbopackIgnore: true */ local) : null;
  if (!/^https:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "follow" });
  if (!response.ok || !(response.headers.get("content-type") || "").startsWith("image/")) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length > MAX_BYTES ? null : bytes;
}

const pending = new Map<string, Promise<Buffer | null>>();

export async function thumbnailFor(videoId: string, width: number) {
  const row = getDb().prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(videoId) as { url: string } | undefined;
  if (!row?.url) return null;
  const file = path.join(cacheDir(), `${videoId.replace(/[^a-zA-Z0-9_]/g, "")}-${thumbVersion(row.url)}-${width}.webp`);
  if (fs.existsSync(file)) return fs.readFileSync(/* turbopackIgnore: true */ file);
  // Si varias tarjetas piden la misma miniatura a la vez, se genera una sola vez.
  if (!pending.has(file)) pending.set(file, (async () => {
    const original = await originalBytes(row.url).catch(() => null);
    if (!original) return null;
    const sharp = (await import("sharp")).default;
    const bytes = await sharp(original, { animated: false }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
    fs.writeFileSync(file, bytes);
    return bytes;
  })().catch(() => null).finally(() => pending.delete(file)));
  return pending.get(file)!;
}
