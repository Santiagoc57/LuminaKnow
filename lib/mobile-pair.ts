import crypto from "node:crypto";
import { getDb } from "./db";
import { createExtensionToken } from "./extension-auth";

// Vincular el celular: la Mac muestra un código de 6 cifras que vale 10 minutos y cinco intentos.
// El celular lo cambia por su propio código de acceso, que se puede revocar sin tocar la extensión.
const KEY = "mobile_pair_code";
const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Pending = { profileId: string; hash: string; expires: number; attempts: number };

const hash = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

function save(value: Pending | null) {
  const db = getDb();
  if (!value) { db.prepare("DELETE FROM settings WHERE key = ?").run(KEY); return; }
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(KEY, JSON.stringify(value));
}

export function createPairCode(profileId: string) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expires = Date.now() + TTL_MS;
  save({ profileId, hash: hash(code), expires, attempts: 0 });
  return { code, expiresAt: new Date(expires).toISOString() };
}

export function redeemPairCode(code: string) {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(KEY) as { value: string } | undefined;
  const pending = row ? JSON.parse(row.value) as Pending : null;
  if (!pending || pending.expires < Date.now()) { save(null); throw new Error("El código venció. Genera uno nuevo en Ajustes de LUMINA en tu Mac."); }
  const actual = hash(code.replace(/\D/g, ""));
  if (actual.length !== pending.hash.length || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(pending.hash))) {
    pending.attempts += 1;
    save(pending.attempts >= MAX_ATTEMPTS ? null : pending);
    throw new Error(pending.attempts >= MAX_ATTEMPTS ? "Demasiados intentos. Genera un código nuevo en tu Mac." : "Ese código no coincide.");
  }
  save(null);
  return createExtensionToken(pending.profileId, "mobile");
}
