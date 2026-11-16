import fs from "node:fs/promises";
import path from "node:path";
import { databasePath, getDb } from "./db";

const KEEP_BACKUPS = 14;
const backupDirectory = process.env.LUMINA_BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "backups");

export async function createBackup() {
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = path.join(backupDirectory, `lumina-${stamp}.sqlite`);
  await getDb().backup(destination);
  // Se conservan las 14 copias automáticas más recientes. Solo se poda «lumina-…»: las copias de seguridad
  // previas a una migración («pre-…») no se tocan (antes, al ordenar por nombre, se borraban las nuevas).
  const backups = (await fs.readdir(backupDirectory))
    .filter((file) => file.startsWith("lumina-") && file.endsWith(".sqlite"))
    .sort()
    .reverse();
  await Promise.all(backups.slice(KEEP_BACKUPS).map((file) => fs.rm(path.join(backupDirectory, file), { force: true })));
  return { destination, databasePath };
}

export async function maybeCreateDailyBackup() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const last = (db.prepare("SELECT value FROM settings WHERE key = 'last_backup_date'").get() as { value?: string } | undefined)?.value;
  if (last === today) return;
  await createBackup();
  db.prepare("INSERT INTO settings(key, value) VALUES('last_backup_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(today);
}

// Comprueba al arrancar y cada 6 horas si ya hay copia de hoy; si no, la crea.
export function scheduleDailyBackups() {
  const state = globalThis as { __luminaBackupTimer?: NodeJS.Timeout };
  if (state.__luminaBackupTimer) return;
  const run = () => { void maybeCreateDailyBackup().catch((error) => console.warn("[LUMINA] No se pudo crear la copia diaria:", error instanceof Error ? error.message : error)); };
  setTimeout(run, 20_000).unref();
  state.__luminaBackupTimer = setInterval(run, 6 * 60 * 60_000);
  state.__luminaBackupTimer.unref();
}
