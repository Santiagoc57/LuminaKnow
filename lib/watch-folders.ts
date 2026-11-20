import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb } from "./db";
import { sniffImage } from "./media";

// Carpetas vigiladas (como Fabric): todo PDF o imagen nuevo que caiga en Descargas, Escritorio u otra carpeta
// que elijas entra solo a LUMINA. Solo cuenta lo que llegue después de activarla: lo que ya había no se toca.

type WatchConfig = { folders: Array<{ path: string; since: string }> };
const KEY = "watch_folders";
const EXTENSIONS = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"]);
const MAX_BYTES = 80 * 1024 * 1024;

export const SUGGESTED_FOLDERS = [
  { label: "Descargas", path: path.join(os.homedir(), "Downloads") },
  { label: "Escritorio", path: path.join(os.homedir(), "Desktop") },
];

export function watchConfig(): WatchConfig {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  try { return row ? JSON.parse(row.value) as WatchConfig : { folders: [] }; } catch { return { folders: [] }; }
}
function saveConfig(config: WatchConfig) {
  getDb().prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(config));
}

export function setWatchedFolder(folder: string, enabled: boolean) {
  const resolved = path.resolve(folder.replace(/^~(?=$|\/)/, os.homedir()));
  if (enabled && !fs.existsSync(resolved)) throw new Error("Esa carpeta no existe.");
  const config = watchConfig();
  config.folders = config.folders.filter((item) => item.path !== resolved);
  if (enabled) config.folders.push({ path: resolved, since: new Date().toISOString() });
  saveConfig(config);
  return watchStatus();
}

const recent: Array<{ name: string; at: string; folder: string }> = [];
let lastError = "";
export function watchStatus() {
  return { folders: watchConfig().folders, suggested: SUGGESTED_FOLDERS, recent: recent.slice(0, 8), lastError };
}

const seen = new Map<string, number>(); // archivo → tamaño visto la vuelta anterior (para no leerlo a medio descargar)
const done = new Set<string>();

async function importFile(file: string, profileId: string) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const name = path.basename(file);
  const title = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || name;
  if (path.extname(file).toLowerCase() === ".pdf") {
    const { createPdfSource } = await import("./pdf");
    return createPdfSource({ bytes, profileId, fileName: name });
  }
  const kind = sniffImage(bytes);
  if (!kind) return null;
  const { createImageSource } = await import("./vision");
  return createImageSource({ bytes, kind, title, profileId });
}

export async function scanWatchedFolders() {
  const { folders } = watchConfig();
  if (!folders.length) return 0;
  const profile = getDb().prepare("SELECT id FROM profiles ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  if (!profile) return 0;
  let imported = 0;
  for (const folder of folders) {
    let names: string[] = [];
    try { names = fs.readdirSync(folder.path); lastError = ""; }
    catch { lastError = `macOS no deja leer «${path.basename(folder.path)}». Da permiso en Ajustes del Sistema → Privacidad y seguridad → Archivos y carpetas.`; continue; }
    const since = Date.parse(folder.since);
    for (const name of names) {
      if (name.startsWith(".") || !EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      const file = path.join(folder.path, name);
      if (done.has(file)) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(file); } catch { continue; }
      if (!stat.isFile() || Math.max(stat.birthtimeMs, stat.mtimeMs) < since || stat.size > MAX_BYTES || !stat.size) { done.add(file); continue; }
      // Espera a que el tamaño no cambie entre dos vueltas (la descarga terminó).
      if (seen.get(file) !== stat.size || Date.now() - stat.mtimeMs < 3000) { seen.set(file, stat.size); continue; }
      done.add(file);
      seen.delete(file);
      try {
        const result = await importFile(file, profile.id);
        if (result && !result.duplicate) {
          imported += 1;
          recent.unshift({ name, at: new Date().toISOString(), folder: path.basename(folder.path) });
          recent.splice(20);
          console.log(`[LUMINA] Carpeta vigilada: «${name}» guardado.`);
        }
      } catch (error) { console.warn(`[LUMINA] No se pudo importar «${name}»:`, error instanceof Error ? error.message : error); }
    }
  }
  return imported;
}

export function scheduleWatchedFolders() {
  const timers = globalThis as { __luminaWatchTimer?: NodeJS.Timeout };
  if (timers.__luminaWatchTimer) return;
  let running = false;
  timers.__luminaWatchTimer = setInterval(() => {
    if (running) return;
    running = true;
    void scanWatchedFolders().catch(() => 0).finally(() => { running = false; });
  }, 5_000);
  timers.__luminaWatchTimer.unref();
}
