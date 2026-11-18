import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Inicio automático: un servicio de tu usuario (LaunchAgent) que arranca LUMINA al iniciar sesión, sin Terminal.
// Solo toca ~/Library/LaunchAgents; se quita igual de fácil.
const run = promisify(execFile);
const LABEL = "com.lumina.server";
const plistPath = () => path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const domain = () => `gui/${process.getuid?.() ?? 501}`;

export function autostartEnabled() {
  return fs.existsSync(plistPath());
}

export function appInstalled() {
  return fs.existsSync("/Applications/LUMINA.app") || fs.existsSync(path.join(os.homedir(), "Applications", "LUMINA.app"));
}

export async function setAutostart(enabled: boolean) {
  if (process.platform !== "darwin") throw new Error("El inicio automático solo está disponible en macOS.");
  const file = plistPath();
  if (!enabled) {
    if (fs.existsSync(file)) {
      // bootout detendría también el servidor que estás usando ahora; solo se quita el registro.
      await run("launchctl", ["disable", `${domain()}/${LABEL}`]).catch(() => undefined);
      fs.rmSync(file, { force: true });
    }
    return autostartEnabled();
  }
  const script = path.join(/* turbopackIgnore: true */ process.cwd(), "scripts", "app", "run-server.sh");
  if (!fs.existsSync(script)) throw new Error("No se encontró el script de arranque de LUMINA.");
  const logs = path.join(os.homedir(), "Library", "Logs", "LUMINA");
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  fs.writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>${escape(script)}</string></array>
  <key>RunAtLoad</key><true/>
  <!-- Se reinicia si se cae, pero no si salió porque ya había un LUMINA abierto. -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>${escape(path.join(logs, "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${escape(path.join(logs, "launchd.log"))}</string>
</dict></plist>
`);
  await run("launchctl", ["enable", `${domain()}/${LABEL}`]).catch(() => undefined);
  // Si ya está registrado (por ejemplo, de antes), no pasa nada; si no, se registra para el próximo inicio de sesión.
  await run("launchctl", ["bootstrap", domain(), file]).catch(() => undefined);
  return autostartEnabled();
}
