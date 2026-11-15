import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const sourceArgument = process.argv[2];
if (!sourceArgument) {
  throw new Error("Uso: npm run restore -- /ruta/a/lumina-fecha.sqlite");
}

const source = path.resolve(sourceArgument);
const dataDirectory = process.env.LUMINA_DATA_DIR || path.join(process.cwd(), "data");
const backupDirectory = process.env.LUMINA_BACKUP_DIR || path.join(process.cwd(), "backups");
const destination = path.join(dataDirectory, "lumina.sqlite");
const sourceInfo = await fs.stat(source);
if (!sourceInfo.isFile()) throw new Error("La copia indicada no es un archivo.");

const candidate = new Database(source, { readonly: true, fileMustExist: true });
const integrity = candidate.pragma("integrity_check") as Array<{ integrity_check: string }>;
candidate.close();
if (integrity[0]?.integrity_check !== "ok") throw new Error("La copia no superó la verificación de integridad de SQLite.");

await fs.mkdir(dataDirectory, { recursive: true });
await fs.mkdir(backupDirectory, { recursive: true });
try {
  await fs.access(destination);
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  await fs.copyFile(destination, path.join(backupDirectory, `pre-restore-${stamp}.sqlite`));
} catch {
  // A fresh installation has no current database to preserve.
}

const temporary = `${destination}.restoring`;
await fs.copyFile(source, temporary);
await fs.rename(temporary, destination);
await Promise.all([
  fs.rm(`${destination}-wal`, { force: true }),
  fs.rm(`${destination}-shm`, { force: true }),
]);
console.log(`Restauración completada desde: ${source}`);
