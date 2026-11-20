import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const source = path.join(root, "extension", "src");
const output = path.join(root, "extension", "dist");
const downloads = path.join(root, "public", "downloads");
const sharedFiles = ["common.js", "page-readers.js", "content.js", "background.js", "popup.html", "popup.js", "popup.css", "options.html", "options.js", "options.css"];
const baseManifest = {
  manifest_version: 3,
  name: "Lúmina Companion",
  description: "Guarda páginas en Lúmina y recupera conocimiento relacionado mientras navegas.",
  version: "1.8.0",
  permissions: ["storage", "activeTab", "scripting", "contextMenus", "tabs"],
  host_permissions: ["<all_urls>"],
  // Sin popup fijo: el icono abre un diálogo centrado en la página (el panel clásico queda para páginas especiales).
  action: { default_title: "Guardar en Lúmina", default_icon: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" } },
  icons: { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" },
  options_ui: { page: "options.html", open_in_tab: true },
  commands: {
    "save-current": { suggested_key: { default: "Alt+S", mac: "MacCtrl+Shift+S" }, description: "Guardar la página actual en Lúmina" },
  },
  content_scripts: [{ matches: ["<all_urls>"], run_at: "document_idle", js: ["common.js", "page-readers.js", "content.js"] }],
};

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(downloads, { recursive: true });
for (const browser of ["chrome", "firefox"]) {
  const destination = path.join(output, browser);
  fs.mkdirSync(path.join(destination, "icons"), { recursive: true });
  sharedFiles.forEach((file) => fs.copyFileSync(path.join(source, file), path.join(destination, file)));
  for (const size of [16, 32, 48, 128]) fs.copyFileSync(path.join(source, "icons", `${size}.png`), path.join(destination, "icons", `${size}.png`));
  const manifest = browser === "chrome"
    ? { ...baseManifest, background: { service_worker: "background.js" } }
    : { ...baseManifest, background: { scripts: ["common.js", "page-readers.js", "background.js"] }, browser_specific_settings: { gecko: {
      id: "lumina-companion@lumina.local",
      strict_min_version: "142.0",
      // Envía el contenido y la dirección de las páginas solo al servidor de Lúmina que configura quien la usa.
      data_collection_permissions: { required: ["websiteContent", "browsingActivity"] },
    } } };
  fs.writeFileSync(path.join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const archive = path.join(downloads, `lumina-companion-${browser}.zip`);
  const xpi = path.join(downloads, `lumina-companion-${browser}.xpi`);
  fs.rmSync(archive, { force: true });
  fs.rmSync(xpi, { force: true });
  execFileSync("zip", ["-qr", archive, "."], { cwd: destination });
  fs.copyFileSync(archive, xpi);
}
