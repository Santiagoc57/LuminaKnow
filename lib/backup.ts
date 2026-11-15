import fs from "node:fs/promises";
import path from "node:path";
import { databasePath, getDb } from "./db";

const backupDirectory = process.env.LUMINA_BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "backups");

export async function createBackup() {
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = path.join(backupDirectory, `lumina-${stamp}.sqlite`);
  await getDb().backup(destination);
  const backups = (await fs.readdir(backupDirectory))
    .filter((file) => file.endsWith(".sqlite"))
    .sort()
    .reverse();
  await Promise.all(backups.slice(7).map((file) => fs.rm(path.join(backupDirectory, file), { force: true })));
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
