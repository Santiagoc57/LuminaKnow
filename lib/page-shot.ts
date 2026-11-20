import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Captura de pantalla de una web desde este Mac, con Chrome (o Brave/Edge) sin ventana. Sirve para
// regenerar la portada de una tarjeta web cuando la extensión no la tomó o salió en blanco.
const BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

export async function screenshotPage(url: string): Promise<Uint8Array | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const browser = BROWSERS.find((candidate) => fs.existsSync(candidate));
  if (!browser) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lumina-shot-"));
  const file = path.join(dir, "shot.png");
  try {
    await run(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(dir, "profile")}`, "--window-size=1280,800", "--virtual-time-budget=6000", `--screenshot=${file}`, url], { timeout: 40_000 });
    if (!fs.existsSync(file)) return null;
    const bytes = new Uint8Array(fs.readFileSync(file));
    return bytes.length > 5000 ? bytes : null;
  } catch { return null; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Plan B: la imagen que la propia web declara para compartir (og:image).
export async function shareImage(url: string): Promise<Uint8Array | null> {
  try {
    const html = await (await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) LUMINA" }, signal: AbortSignal.timeout(12_000) })).text();
    const match = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)/i);
    if (!match) return null;
    const image = await fetch(new URL(match[1], url), { signal: AbortSignal.timeout(12_000) });
    return image.ok ? new Uint8Array(await image.arrayBuffer()) : null;
  } catch { return null; }
}
