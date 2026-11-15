import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

function sqliteLoads() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    db.close();
    return true;
  } catch { return false; }
}

// El analizador de imágenes usa Apple Vision: se compila una vez con las herramientas de macOS.
const visionSource = "scripts/vision/analyze.swift";
if (process.platform === "darwin" && (!fs.existsSync("bin/lumina-vision") || fs.statSync(visionSource).mtimeMs > fs.statSync("bin/lumina-vision").mtimeMs)) {
  fs.mkdirSync("bin", { recursive: true });
  const compiled = spawnSync("swiftc", ["-O", visionSource, "-o", "bin/lumina-vision"], { stdio: "ignore" });
  if (compiled.status !== 0) console.warn("No se pudo compilar el analizador de imágenes; Lúmina seguirá sin reconocimiento local.");
}

// El cortador de audio (para transcribir videos sin subtítulos) usa AVFoundation, también incluido en macOS.
const splitSource = "scripts/audio/split.swift";
if (process.platform === "darwin" && (!fs.existsSync("bin/lumina-audio-split") || fs.statSync(splitSource).mtimeMs > fs.statSync("bin/lumina-audio-split").mtimeMs)) {
  fs.mkdirSync("bin", { recursive: true });
  const compiled = spawnSync("swiftc", ["-O", splitSource, "-o", "bin/lumina-audio-split"], { stdio: "ignore" });
  if (compiled.status !== 0) console.warn("No se pudo compilar el cortador de audio; los videos sin subtítulos necesitarán ffmpeg.");
}

if (!sqliteLoads()) {
  console.log("Ajustando SQLite para la versión actual de Node.js…");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["rebuild", "better-sqlite3", "sqlite-vec"], { stdio: "inherit" });
  if (result.status !== 0 || !sqliteLoads()) {
    console.error("No fue posible preparar SQLite. Ejecuta npm install dentro de la carpeta de Lúmina.");
    process.exit(1);
  }
}
