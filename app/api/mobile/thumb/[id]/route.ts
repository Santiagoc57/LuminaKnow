import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError } from "@/lib/extension-http";
import { mediaPathFromUrl } from "@/lib/media";
import { thumbVersion } from "@/lib/mobile-library";

export const runtime = "nodejs";

const MAX_BYTES = 12 * 1024 * 1024;

function cacheDir() {
  const dir = path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "mobile-thumbs");
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

// Miniatura pequeña (400 px de ancho, WebP) para el celular: carga rápido y ocupa poco en la copia sin conexión.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireExtensionProfile(request);
    const { id } = await context.params;
    const row = getDb().prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(id) as { url: string } | undefined;
    if (!row?.url) return NextResponse.json({ error: "Sin imagen." }, { status: 404 });
    const version = thumbVersion(row.url);
    const cached = path.join(cacheDir(), `${id.replace(/[^a-zA-Z0-9_]/g, "")}-${version}.webp`);
    let bytes = fs.existsSync(cached) ? fs.readFileSync(/* turbopackIgnore: true */ cached) : null;
    let type = "image/webp";
    if (!bytes) {
      const original = await originalBytes(row.url).catch(() => null);
      if (!original) return NextResponse.json({ error: "Sin imagen." }, { status: 404 });
      try {
        const sharp = (await import("sharp")).default;
        bytes = await sharp(original, { animated: false }).rotate().resize({ width: 400, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
        fs.writeFileSync(cached, bytes);
      } catch {
        bytes = original;
        type = "application/octet-stream";
      }
    }
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return extensionError(request, error); }
}
