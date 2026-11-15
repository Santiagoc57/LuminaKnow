import fs from "node:fs";
import path from "node:path";
import { getDb } from "./db";
import { extractWebArticle } from "./web-article";

// Copia permanente: la versión limpia de cada página guardada (como hace Raindrop). Si la web desaparece
// o cambia, en Lúmina sigue su texto tal como estaba cuando lo guardaste.
function snapshotDirectory() {
  return path.join(process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data"), "snapshots");
}

export function snapshotPath(videoId: string) {
  return /^[a-zA-Z0-9_]+$/.test(videoId) ? path.join(snapshotDirectory(), `${videoId}.html`) : null;
}

const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

export function saveSnapshot(videoId: string, page: { title: string; url: string; byline: string; html: string }) {
  const file = snapshotPath(videoId);
  if (!file || !page.html.trim()) return;
  fs.mkdirSync(snapshotDirectory(), { recursive: true });
  const savedAt = new Date();
  const document = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(page.title)}</title>
<style>body{margin:0;background:#faf9f7;color:#1f1d1a;font:18px/1.7 "Iowan Old Style",Palatino,Georgia,serif}main{max-width:680px;margin:0 auto;padding:48px 22px 80px}header{margin-bottom:28px;padding:12px 16px;border-radius:10px;background:#f1efea;font:13px/1.5 -apple-system,sans-serif;color:#6d675f}h1{font-size:34px;line-height:1.2}img{max-width:100%;height:auto;border-radius:6px}a{color:#c84627}pre{white-space:pre-wrap}</style></head>
<body><main><header>Copia guardada por Lúmina el ${savedAt.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })} · Original: <a href="${escape(page.url)}">${escape(page.url)}</a></header><h1>${escape(page.title)}</h1>${page.byline ? `<p><em>${escape(page.byline)}</em></p>` : ""}${page.html}</main></body></html>`;
  fs.writeFileSync(file, document);
  getDb().prepare("UPDATE videos SET snapshot_saved_at = ? WHERE id = ?").run(savedAt.toISOString(), videoId);
}

// Para lo guardado antes de existir esta función: se lee de nuevo cada página (sin IA) y se guarda su copia.
export async function backfillSnapshots(limit = 60) {
  const rows = getDb().prepare("SELECT id, url FROM videos WHERE archived_at IS NULL AND source_type = 'web' AND url LIKE 'http%' AND snapshot_saved_at IS NULL LIMIT ?").all(limit) as Array<{ id: string; url: string }>;
  let saved = 0;
  for (const row of rows) {
    try {
      const article = await extractWebArticle(row.url);
      saveSnapshot(row.id, { title: article.title, url: article.url, byline: article.channel, html: article.readableHtml });
      saved += 1;
    } catch { /* página que ya no responde: queda sin copia */ }
  }
  return { saved, pending: rows.length - saved };
}
