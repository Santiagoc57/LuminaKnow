// Genera app/dark.generated.css a partir de globals.css: cada color claro de fondo, texto o borde
// recibe su equivalente oscuro. Así el modo oscuro cubre toda la app sin mantener dos hojas a mano.
import fs from "node:fs";

const source = fs.readFileSync("app/globals.css", "utf8");
const out = [];

function hexToHsl(hex) {
  let value = hex.replace("#", "");
  if (value.length === 3) value = [...value].map((char) => char + char).join("");
  const r = parseInt(value.slice(0, 2), 16) / 255, g = parseInt(value.slice(2, 4), 16) / 255, b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hsl([h, s, l]) {
  return `hsl(${Math.round(h)} ${Math.round(Math.min(1, s) * 100)}% ${Math.round(Math.max(0, Math.min(1, l)) * 100)}%)`;
}

function darkColor(hex, property) {
  const [h, s, l] = hexToHsl(hex);
  const isBackground = /background/.test(property);
  const isBorder = /border|outline/.test(property);
  if (isBackground) {
    if (l >= 0.85) return hsl([h, s * 0.18, 0.115 + (l - 0.85) * 0.55]);
    if (l <= 0.25) return hsl([h, s * 0.3, 0.3 + l * 0.2]);
    return null;
  }
  if (isBorder) {
    if (l >= 0.8) return hsl([h, s * 0.2, 0.22 + (l - 0.8) * 0.2]);
    return null;
  }
  // Texto: lo oscuro se aclara; los grises medios suben un poco para seguir leyéndose.
  if (l <= 0.3) return hsl([h, s * 0.3, 0.9 - l * 0.3]);
  if (l <= 0.62 && s < 0.25) return hsl([h, s, Math.min(0.78, l + 0.18)]);
  if (l >= 0.95) return null;
  return null;
}

const rule = /([^{}]+)\{([^{}]*)\}/g;
let match;
const strip = source.replace(/\/\*[\s\S]*?\*\//g, "");
// Las reglas dentro de @media se procesan como reglas sueltas: suficiente para los colores.
while ((match = rule.exec(strip))) {
  const selector = match[1].trim();
  if (!selector || selector.startsWith("@") || selector.startsWith(":root") || /^(from|to|\d+%)/.test(selector)) continue;
  const declarations = [];
  for (const declaration of match[2].split(";")) {
    const [rawProperty, ...rest] = declaration.split(":");
    const property = rawProperty?.trim();
    const value = rest.join(":").trim();
    if (!property || !value || !/^(background|background-color|color|border|border-(top|bottom|left|right)|border-color|border-(top|bottom|left|right)-color|outline-color)$/.test(property)) continue;
    let changed = false;
    const replaced = value
      .replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, (hex) => { const next = darkColor(hex, property); if (next) changed = true; return next || hex; })
      .replace(/rgba\(255,\s*255,\s*255,\s*([\d.]+)\)/g, (_all, alpha) => { changed = true; return /background/.test(property) ? `rgba(32, 31, 29, ${alpha})` : `rgba(255, 255, 255, ${Math.min(0.2, Number(alpha))})`; })
      .replace(/^white$|\bwhite\b(?=\s|$|;)/g, () => { changed = true; return /background/.test(property) ? "hsl(30 6% 15%)" : "white"; });
    if (changed && !/gradient/.test(value)) declarations.push(`${property}: ${replaced}`);
  }
  if (declarations.length) {
    const scoped = selector.split(",").map((part) => `html[data-theme="dark"] ${part.trim().replace(/^(html|body)\b/, "")}`.replace(/\s+$/, "")).join(", ");
    out.push(`${scoped} { ${declarations.join("; ")}; }`);
  }
}

const header = `/* Generado por scripts/build-dark-css.mjs: no editar a mano. */
html[data-theme="dark"] {
  color-scheme: dark;
  --canvas: #161513; --paper: #1d1c1a; --panel: #1b1a18; --ink: #ecebe7; --muted: #9c978e;
  --line: #34322e; --soft-line: #2b2a27; --accent: #ef6a46; --accent-dark: #ff8d6b; --accent-soft: #3a231b;
  --shadow: 0 24px 80px rgba(0, 0, 0, .45);
}
html[data-theme="dark"] body { background: #161513; color: #ecebe7; }
html[data-theme="dark"] img, html[data-theme="dark"] video, html[data-theme="dark"] iframe { color-scheme: normal; }
`;
// Ajustes a mano que deben ganar a lo generado.
const footer = `
/* «ESC para cerrar» va sobre el fondo oscuro del modal: blanco también en modo oscuro. */
html[data-theme="dark"] .lv-modal-esc { color: rgba(255,255,255,.82); }
html[data-theme="dark"] .lv-modal-esc:hover { color: #fff; background: rgba(255,255,255,.1); }

html[data-theme="dark"] .home-toolbar-main input, html[data-theme="dark"] .home-toolbar-main .library-query { background: transparent; }
html[data-theme="dark"] .home-toolbar-main input { color: #ecebe7; }
html[data-theme="dark"] .home-toolbar-main input::placeholder { color: #6f6a62; }
html[data-theme="dark"] .lv-quick-note textarea, html[data-theme="dark"] .lv-quick-note [contenteditable] { background: transparent; color: #ecebe7; }
html[data-theme="dark"] .lv-tile-title, html[data-theme="dark"] .lv-tile-quote-card, html[data-theme="dark"] .lv-quick-note { background: #22211e; }
html[data-theme="dark"] .lv-image-stage { background-color: inherit; }
`;
fs.writeFileSync("app/dark.generated.css", header + out.join("\n") + "\n" + footer);
console.log(`Modo oscuro: ${out.length} reglas generadas.`);
