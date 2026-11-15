import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { assertPublicUrl } from "./web-article";

function mediaDirectory() {
  return path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "media");
}
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MEDIA_PREFIX = "/api/media/";

export type ImageKind = { ext: "jpg" | "png" | "gif" | "webp"; mime: string };

// Se decide por los bytes reales: la extensión o el tipo declarado pueden mentir.
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return { ext: "gif", mime: "image/gif" };
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export function mimeForMediaName(name: string) {
  const ext = name.split(".").pop();
  return ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : ext === "pdf" ? "application/pdf" : null;
}

export function mediaFilePath(name: string) {
  return path.join(mediaDirectory(), name);
}

export function saveMediaFile(name: string, bytes: Uint8Array) {
  fs.mkdirSync(mediaDirectory(), { recursive: true });
  fs.writeFileSync(mediaFilePath(name), bytes);
  return `${MEDIA_PREFIX}${name}`;
}

export function saveMedia(id: string, bytes: Uint8Array, kind: ImageKind) {
  fs.mkdirSync(mediaDirectory(), { recursive: true });
  const name = `${id}.${kind.ext}`;
  fs.writeFileSync(path.join(mediaDirectory(), name), bytes);
  return { name, url: `${MEDIA_PREFIX}${name}` };
}

export function mediaPathFromUrl(url: string) {
  if (!url.startsWith(MEDIA_PREFIX)) return null;
  const name = url.slice(MEDIA_PREFIX.length);
  return /^[a-zA-Z0-9_]+\.(jpg|png|gif|webp|pdf)$/.test(name) ? path.join(mediaDirectory(), name) : null;
}

export function deleteMediaForVideo(videoId: string) {
  const row = getDb().prepare("SELECT thumbnail_url AS url FROM videos WHERE id = ?").get(videoId) as { url: string } | undefined;
  const file = row ? mediaPathFromUrl(row.url) : null;
  if (file) fs.rmSync(file, { force: true });
  fs.rmSync(mediaFilePath(`${videoId}.pdf`), { force: true });
}

export async function fetchPublicBytes(input: string, maxBytes: number, accept: string) {
  const limit = `${Math.round(maxBytes / (1024 * 1024))} MB`;
  let current = input;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = await assertPublicUrl(current);
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; Lumina/1.0)", Accept: accept }, signal: AbortSignal.timeout(60_000) });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next) throw new Error("El enlace redirige a un destino inválido.");
      current = new URL(next, url).toString();
      continue;
    }
    if (!response.ok) throw new Error("No se pudo descargar el archivo.");
    if (Number(response.headers.get("content-length") || 0) > maxBytes) throw new Error(`El archivo supera los ${limit}.`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(`El archivo supera los ${limit}.`);
    return bytes;
  }
  throw new Error("El enlace redirige demasiadas veces.");
}

export async function fetchPublicImage(input: string) {
  const bytes = await fetchPublicBytes(input, MAX_IMAGE_BYTES, "image/*");
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("El enlace no apunta a una imagen compatible.");
  return { bytes, kind };
}

export async function loadVideoImage(thumbnailUrl: string) {
  const file = mediaPathFromUrl(thumbnailUrl);
  if (file) {
    const bytes = new Uint8Array(fs.readFileSync(/* turbopackIgnore: true */ file));
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("El archivo guardado no es una imagen compatible.");
    return { bytes, kind };
  }
  return fetchPublicImage(thumbnailUrl);
}
