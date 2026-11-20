import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { databasePath, getDb } from "./db";

// Sincronización por turnos con iCloud Drive: cada Mac tiene su LUMINA completa; al cambiar algo se sube una copia
// a iCloud y el otro Mac la baja cuando no tiene cambios propios. Si los dos cambiaron (usaste ambos a la vez sin
// sincronizar), gana el Mac donde estás y la otra versión se guarda aparte, sin perderse.

const dataDirectory = path.dirname(databasePath);
const statePath = path.join(dataDirectory, "sync-state.json");
export const cloudDirectory = () => process.env.LUMINA_SYNC_DIR || path.join(os.homedir(), "Library", "Mobile Documents", "com~apple~CloudDocs", "LUMINA");
const SYNCED_FOLDERS = ["media", "snapshots"];

type LocalState = { enabled: boolean; version: number; fingerprint: string; syncedAt: string; lastError?: string; conflicts?: string[] };
type CloudState = { version: number; machine: string; savedAt: string };

export function machineName() {
  try { return execFileSync("scutil", ["--get", "ComputerName"], { encoding: "utf8" }).trim() || os.hostname(); } catch { return os.hostname(); }
}

function readJson<T>(file: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(file, "utf8")) as T; } catch { return fallback; }
}
function writeJson(file: string, value: unknown) {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

export function localState(): LocalState {
  return readJson<LocalState>(statePath, { enabled: false, version: 0, fingerprint: "", syncedAt: "" });
}
function saveLocalState(patch: Partial<LocalState>) {
  writeJson(statePath, { ...localState(), ...patch });
}
function cloudState(): CloudState | null {
  return readJson<CloudState | null>(path.join(cloudDirectory(), "state.json"), null);
}
export function iCloudAvailable() {
  return fs.existsSync(path.dirname(cloudDirectory()));
}

// Huella de lo que tú cambias (fuentes, notas, subrayados, etiquetas, carpetas, chats). No incluye tareas de fondo
// (ajustes, trabajos, uso), para que el Mac que solo está encendido no «gane» con cambios que no hiciste.
export function libraryFingerprint() {
  const db = getDb();
  const one = (sql: string) => { try { return JSON.stringify(Object.values(db.prepare(sql).get() as object)); } catch { return "-"; } };
  return [
    one("SELECT COUNT(*), MAX(created_at), MAX(updated_at), SUM(consumed_at IS NOT NULL), SUM(top_position IS NOT NULL), SUM(archived_at IS NOT NULL), SUM(LENGTH(custom_title)) FROM videos"),
    one("SELECT COUNT(*), MAX(updated_at), SUM(LENGTH(content)) FROM notes"),
    one("SELECT COUNT(*), MAX(created_at), SUM(LENGTH(note)) FROM highlights"),
    one("SELECT COUNT(*) FROM video_tags"),
    one("SELECT COUNT(*), MAX(created_at) FROM tags"),
    one("SELECT COUNT(*), MAX(updated_at), SUM(LENGTH(query)) FROM collections"),
    one("SELECT COUNT(*) FROM video_collections"),
    one("SELECT COUNT(*), MAX(created_at) FROM messages"),
  ].join("|");
}

// Copia los archivos que faltan en un sentido (imágenes y copias web). No borra nada.
function mirror(from: string, to: string) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith(".") || name.endsWith(".icloud")) continue;
    const source = path.join(from, name);
    const target = path.join(to, name);
    const stat = fs.statSync(source);
    if (stat.isDirectory()) { copied += mirror(source, target); continue; }
    if (fs.existsSync(target) && fs.statSync(target).size === stat.size) continue;
    fs.copyFileSync(source, target);
    copied += 1;
  }
  return copied;
}

function snapshotDatabase(target: string) {
  const db = getDb();
  db.pragma("wal_checkpoint(TRUNCATE)");
  const temporary = `${target}.tmp`;
  fs.copyFileSync(databasePath, temporary);
  fs.renameSync(temporary, target);
}

export function push(reason = "cambios") {
  const state = localState();
  if (!state.enabled || !iCloudAvailable()) return { pushed: false };
  const cloud = cloudState();
  const fingerprint = libraryFingerprint();
  if (fingerprint === state.fingerprint && (cloud?.version ?? 0) <= state.version && cloud) return { pushed: false };
  const dir = cloudDirectory();
  fs.mkdirSync(dir, { recursive: true });
  const conflicts = state.conflicts ?? [];
  // Otro Mac subió algo que este no ha bajado, y aquí también hubo cambios: su versión se guarda aparte.
  if (cloud && cloud.version > state.version && fs.existsSync(path.join(dir, "library.sqlite"))) {
    const backups = path.join(dataDirectory, "conflictos");
    fs.mkdirSync(backups, { recursive: true });
    const name = `desde-${cloud.machine.replace(/[^\p{L}\p{N} _-]/gu, "")}-${cloud.savedAt.replace(/[:.]/g, "-")}.sqlite`;
    fs.copyFileSync(path.join(dir, "library.sqlite"), path.join(backups, name));
    conflicts.push(name);
  }
  snapshotDatabase(path.join(dir, "library.sqlite"));
  for (const folder of SYNCED_FOLDERS) mirror(path.join(dataDirectory, folder), path.join(dir, folder));
  const secrets = path.join(dataDirectory, "secrets.json");
  if (fs.existsSync(secrets) && !fs.existsSync(path.join(dir, "secrets.json"))) fs.copyFileSync(secrets, path.join(dir, "secrets.json"));
  const version = Math.max(cloud?.version ?? 0, state.version) + 1;
  writeJson(path.join(dir, "state.json"), { version, machine: machineName(), savedAt: new Date().toISOString() } satisfies CloudState);
  saveLocalState({ version, fingerprint, syncedAt: new Date().toISOString(), lastError: "", conflicts });
  console.log(`[LUMINA] Subida a iCloud (v${version}, ${reason}).`);
  return { pushed: true, version };
}

// Baja la versión de iCloud si es más nueva y aquí no hay cambios sin subir. Cambia la base de datos en caliente.
export function pull(options: { force?: boolean } = {}) {
  const state = localState();
  if (!state.enabled || !iCloudAvailable()) return { pulled: false };
  const cloud = cloudState();
  const dir = cloudDirectory();
  const file = path.join(dir, "library.sqlite");
  if (!cloud || cloud.version <= state.version || !fs.existsSync(file)) return { pulled: false };
  const hasLocalDb = fs.existsSync(databasePath);
  if (hasLocalDb && !options.force) {
    // Nunca se pisa una biblioteca con contenido que aún no se ha sincronizado (p. ej. al activar por primera vez).
    const hasContent = Boolean((getDb().prepare("SELECT COUNT(*) AS count FROM videos").get() as { count: number }).count);
    if (state.fingerprint ? libraryFingerprint() !== state.fingerprint : hasContent) return { pulled: false, localChanges: true };
  }
  for (const folder of SYNCED_FOLDERS) mirror(path.join(dir, folder), path.join(dataDirectory, folder));
  const secrets = path.join(dataDirectory, "secrets.json");
  if (!fs.existsSync(secrets) && fs.existsSync(path.join(dir, "secrets.json"))) fs.copyFileSync(path.join(dir, "secrets.json"), secrets);
  // Copia de seguridad de lo que había aquí, por si acaso.
  if (hasLocalDb) {
    const backups = path.join(dataDirectory, "conflictos");
    fs.mkdirSync(backups, { recursive: true });
    try { getDb().pragma("wal_checkpoint(TRUNCATE)"); } catch { /* sin base abierta */ }
    fs.copyFileSync(databasePath, path.join(backups, "antes-de-bajar.sqlite"));
  }
  if (global.__luminaDb) { try { global.__luminaDb.close(); } catch { /* ya cerrada */ } global.__luminaDb = undefined; }
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.copyFileSync(file, `${databasePath}.tmp`);
  fs.renameSync(`${databasePath}.tmp`, databasePath);
  saveLocalState({ version: cloud.version, fingerprint: libraryFingerprint(), syncedAt: new Date().toISOString(), lastError: "" });
  console.log(`[LUMINA] Bajada de iCloud la versión ${cloud.version} (de ${cloud.machine}).`);
  return { pulled: true, version: cloud.version, from: cloud.machine };
}

export function syncNow() {
  try {
    const pulled = pull();
    if (pulled.pulled) return { ...pulled, pushed: false };
    return { pulled: false, ...push() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveLocalState({ lastError: message.slice(0, 300) });
    return { pulled: false, pushed: false, error: message };
  }
}

// Publica también el programa en iCloud (para instalarlo en el otro Mac). Solo desde el Mac donde se desarrolla (con git).
function publishProgram() {
  const root = process.cwd();
  const script = path.join(/* turbopackIgnore: true */ root, "scripts", "app", "publish-to-icloud.sh");
  if (!fs.existsSync(path.join(root, ".git")) || !fs.existsSync(script)) return;
  const logs = path.join(os.homedir(), "Library", "Logs", "LUMINA");
  fs.mkdirSync(logs, { recursive: true });
  const out = fs.openSync(path.join(logs, "server.log"), "a");
  spawn("/bin/zsh", [script], { detached: true, stdio: ["ignore", out, out] }).unref();
}

export function setSyncEnabled(enabled: boolean) {
  saveLocalState({ enabled });
  if (!enabled) return { pulled: false, pushed: false };
  publishProgram();
  return syncNow();
}

export function syncStatus() {
  const state = localState();
  const cloud = cloudState();
  return { available: iCloudAvailable(), enabled: state.enabled, machine: machineName(), localVersion: state.version, cloud, syncedAt: state.syncedAt, lastError: state.lastError || "", conflicts: state.conflicts ?? [] };
}

export function scheduleICloudSync() {
  const timers = globalThis as { __luminaSyncTimer?: NodeJS.Timeout; __luminaSyncExit?: boolean };
  if (timers.__luminaSyncTimer) return;
  // Al arrancar: lo más nuevo de iCloud antes de nada.
  try { pull(); } catch (error) { console.warn("[LUMINA] No se pudo bajar de iCloud:", error instanceof Error ? error.message : error); }
  timers.__luminaSyncTimer = setInterval(() => { syncNow(); }, 60_000);
  timers.__luminaSyncTimer.unref();
  if (!timers.__luminaSyncExit) {
    timers.__luminaSyncExit = true;
    // Al cerrar LUMINA (o apagar el Mac): sube lo último.
    for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { try { push("al cerrar"); } catch { /* sin conexión con iCloud */ } process.exit(0); });
  }
}
