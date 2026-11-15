import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getDb, refreshVideoSearch } from "./db";
import { fetchPublicBytes, saveMediaFile } from "./media";
import { parseArxivEntry, usablePdfTitle, type PdfLink } from "./pdf-link";
import { makeId } from "./utils";

const execFileAsync = promisify(execFile);
const VISION_BINARY = process.env.LUMINA_VISION_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), "bin", "lumina-vision");

export const MAX_PDF_BYTES = 80 * 1024 * 1024;

type Extracted = { title: string; author: string; pageCount: number; truncated: boolean; pages: Array<{ text: string; ocr: boolean }> };

export function isPdfBytes(bytes: Uint8Array) {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

// Se lee en este Mac con PDFKit; las páginas escaneadas pasan por Vision. Nada sale del equipo.
async function extractPdf(bytes: Uint8Array) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-pdf-"));
  const file = path.join(directory, "documento.pdf");
  const thumbnail = path.join(directory, "portada.png");
  try {
    fs.writeFileSync(file, bytes);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(VISION_BINARY, ["--pdf", file, thumbnail], { timeout: 5 * 60_000, maxBuffer: 256 * 1024 * 1024 }));
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      if (stderr?.includes("protegido")) throw new Error("Este PDF está protegido con contraseña.");
      throw new Error(stderr || "No se pudo leer este PDF.");
    }
    return { extracted: JSON.parse(stdout) as Extracted, thumbnail: fs.existsSync(thumbnail) ? new Uint8Array(fs.readFileSync(thumbnail)) : null };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function createPdfSource(input: { bytes: Uint8Array; profileId: string; fileName?: string; title?: string; author?: string; description?: string; publishedAt?: string; originUrl?: string }) {
  if (!isPdfBytes(input.bytes)) throw new Error("Ese archivo no es un PDF.");
  if (input.bytes.length > MAX_PDF_BYTES) throw new Error("El PDF supera los 80 MB.");
  const db = getDb();
  const hash = crypto.createHash("sha256").update(input.bytes).digest("hex").slice(0, 40);
  const existing = db.prepare("SELECT id FROM videos WHERE source_type = 'pdf' AND youtube_id = ?").get(hash) as { id: string } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const { extracted, thumbnail } = await extractPdf(input.bytes);
  const id = makeId("pdf");
  const pages = extracted.pages.map((page, index) => ({ ...page, number: index + 1 })).filter((page) => page.text.trim());
  const firstLine = pages[0]?.text.split("\n").map((line) => line.trim()).find((line) => line.length >= 4)?.slice(0, 160) ?? "";
  const fileTitle = input.fileName?.replace(/\.pdf$/i, "").trim() ?? "";
  const title = input.title?.trim() || usablePdfTitle(extracted.title) || firstLine || fileTitle || "Documento PDF";
  const author = input.author?.trim() || extracted.author.trim().slice(0, 200);
  const description = (input.description?.trim() || pages[0]?.text.replace(/\s+/g, " ").trim() || "").slice(0, 1_200);
  saveMediaFile(`${id}.pdf`, input.bytes);
  const thumbnailUrl = thumbnail ? saveMediaFile(`${id}.png`, thumbnail) : "";
  const now = new Date().toISOString();
  const url = input.originUrl || `local://pdf/${id}`;
  db.transaction(() => {
    db.prepare(`
      INSERT INTO videos(id, youtube_id, source_type, source_published_at, url, title, custom_title, channel, thumbnail_url, description, source_language, transcript_source, status, added_by, created_at, updated_at)
      VALUES(?, ?, 'pdf', ?, ?, ?, '', ?, ?, ?, '', 'pdf', 'saved', ?, ?, ?)
    `).run(id, hash, input.publishedAt || "", url, title, author, thumbnailUrl, description, input.profileId, now, now);
    const insert = db.prepare("INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, metadata_json, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)");
    pages.forEach((page, index) => insert.run(makeId("item"), id, `page-${page.number}`, index, url, author, page.text, input.publishedAt || "", JSON.stringify({ page: page.number, pageCount: extracted.pageCount, ocr: page.ocr, truncated: extracted.truncated }), now));
  })();
  refreshVideoSearch(id);
  return { id, duplicate: false };
}

async function arxivMetadata(arxivId: string) {
  try {
    const response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; Lumina/1.0)" }, signal: AbortSignal.timeout(10_000) });
    return response.ok ? parseArxivEntry(await response.text()) : null;
  } catch {
    return null;
  }
}

export async function previewPdfLink(link: PdfLink) {
  if (link.arxivId) {
    const metadata = await arxivMetadata(link.arxivId);
    if (metadata) return { title: metadata.title, author: metadata.authors.join(", ") };
  }
  const name = decodeURIComponent(new URL(link.url).pathname.split("/").pop() ?? "").replace(/\.pdf$/i, "");
  return { title: name, author: "" };
}

export async function importPdfLink(link: PdfLink, profileId: string, title?: string) {
  const metadata = link.arxivId ? await arxivMetadata(link.arxivId) : null;
  const bytes = await fetchPublicBytes(link.url, MAX_PDF_BYTES, "application/pdf");
  return createPdfSource({
    bytes,
    profileId,
    title: title || metadata?.title,
    author: metadata?.authors.join(", "),
    description: metadata?.abstract,
    publishedAt: metadata?.publishedAt,
    originUrl: link.arxivId ? `https://arxiv.org/abs/${link.arxivId}` : link.url,
    fileName: decodeURIComponent(new URL(link.url).pathname.split("/").pop() ?? ""),
  });
}

// La biblioteca solo recibe el inicio de cada PDF: el texto completo se busca aquí, en el servidor.
export function searchPdfText(query: string) {
  const match = query.trim().split(/\s+/).map((part) => part.replace(/["'*^:()-]/g, "")).filter(Boolean).map((part) => `${part}*`).join(" ");
  if (!match) return [];
  try {
    return (getDb().prepare(`
      SELECT v.id FROM library_search s JOIN videos v ON v.id = s.video_id
      WHERE library_search MATCH ? AND v.source_type = 'pdf' AND v.archived_at IS NULL
    `).all(match) as Array<{ id: string }>).map((row) => row.id);
  } catch {
    return [];
  }
}
