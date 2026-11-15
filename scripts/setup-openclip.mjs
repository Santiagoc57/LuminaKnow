// Conecta OpenClip con Lúmina: crea un código propio para OpenClip (no toca el de Firefox),
// lo guarda en ~/.lumina/openclip.env y copia la acción «Guardar en Lúmina» a ~/.openclip/extensions.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const dataDir = process.env.LUMINA_DATA_DIR || path.join(root, "data");
const serverUrl = (process.env.LUMINA_URL || `http://localhost:${process.env.LUMINA_PORT || 3000}`).replace(/\/$/, "");
const db = new Database(path.join(dataDir, "lumina.sqlite"));
const profiles = db.prepare("SELECT id, name FROM profiles ORDER BY created_at").all();
if (!profiles.length) throw new Error("Lúmina aún no tiene perfiles.");
const wanted = process.argv[2]?.toLocaleLowerCase("es");
const linked = db.prepare("SELECT key FROM settings WHERE key LIKE 'extension_token_hash:%'").all().map((row) => row.key.split(":")[1]);
const profile = profiles.find((item) => wanted && item.name.toLocaleLowerCase("es") === wanted) || profiles.find((item) => linked.includes(item.id)) || profiles[0];
const token = `lumina_ext_${Buffer.from(profile.id).toString("base64url")}.openclip.${crypto.randomBytes(32).toString("base64url")}`;
db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  .run(`extension_token_hash:${profile.id}:openclip`, crypto.createHash("sha256").update(token).digest("hex"));
db.close();

const configDir = path.join(os.homedir(), ".lumina");
fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
fs.writeFileSync(path.join(configDir, "openclip.env"), `LUMINA_URL='${serverUrl}'\nLUMINA_TOKEN='${token}'\n`, { mode: 0o600 });

const target = path.join(os.homedir(), ".openclip", "extensions", "Lumina.openclipext");
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(path.join(root, "integrations", "openclip", "Lumina.openclipext"), target, { recursive: true });
fs.chmodSync(path.join(target, "save.sh"), 0o755);
console.log(`OpenClip conectado con el perfil «${profile.name}».`);
console.log(`Acción instalada en ${target}. Abre OpenClip → Ajustes → Extensiones y actívala.`);
