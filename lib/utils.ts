import type { Citation, TranscriptCue } from "./types";

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function titleCaseTag(value: string) {
  const smallWords = new Set(["a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "los", "o", "para", "por", "sin", "un", "una", "y"]);
  const acronyms: Record<string, string> = { ai: "AI", api: "API", ia: "IA", pdf: "PDF", seo: "SEO", ui: "UI", ux: "UX" };
  return value.replace(/^#+/, "").trim().split(/\s+/).filter(Boolean).map((word, index) => {
    const lower = word.toLocaleLowerCase("es");
    if (lower === "ui/ux") return "UI/UX";
    if (acronyms[lower]) return acronyms[lower];
    if (index > 0 && smallWords.has(lower)) return lower;
    const characters = Array.from(lower);
    return `${characters[0]?.toLocaleUpperCase("es") || ""}${characters.slice(1).join("")}`;
  }).join(" ");
}

export function friendlyJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Error inesperado");
  if (/Requested format is not available|nsig extraction failed/i.test(message)) {
    return "YouTube cambió la forma de entregar este video. Actualiza el extractor de Lúmina y pulsa «Intentar de nuevo».";
  }
  if (/Sign in to confirm|cookies-from-browser|not a bot/i.test(message)) {
    return "YouTube pidió verificar la sesión para acceder a este video. Inténtalo más tarde o usa otro video público.";
  }
  if (/Private video|Video unavailable|has been removed/i.test(message)) {
    return "Este video no está disponible públicamente; puede ser privado, haber sido eliminado o estar restringido.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message)) {
    return "La cuota gratuita del proveedor de IA está agotada por ahora. Lúmina puede seguir usando el resumen local y la búsqueda textual.";
  }
  if (/400|INVALID_ARGUMENT|invalid argument/i.test(message)) {
    return "El proveedor de IA rechazó el formato del análisis. Lúmina puede reintentarlo con un formato compatible o completar un resumen local.";
  }
  const concise = message.split("\n").map((line) => line.trim()).filter(Boolean).slice(-3).join(" ");
  return concise.slice(0, 700) || "Ocurrió un error inesperado durante el procesamiento.";
}

export function parseYouTubeUrl(input: string): { youtubeId: string; url: string } | null {
  try {
    const value = input.trim();
    const normalized = value.startsWith("http") ? value : `https://${value}`;
    const url = new URL(normalized);
    let youtubeId = "";

    if (url.hostname === "youtu.be") youtubeId = url.pathname.slice(1).split("/")[0];
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") youtubeId = url.searchParams.get("v") ?? "";
      if (url.pathname.startsWith("/shorts/")) youtubeId = url.pathname.split("/")[2] ?? "";
      if (url.pathname.startsWith("/embed/")) youtubeId = url.pathname.split("/")[2] ?? "";
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) return null;
    return { youtubeId, url: `https://www.youtube.com/watch?v=${youtubeId}` };
  } catch {
    return null;
  }
}

export function parseXUrl(input: string): { postId: string; username: string; url: string } | null {
  try {
    const value = input.trim();
    const normalized = value.startsWith("http") ? value : `https://${value}`;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const isX = hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com");
    if (!isX) return null;
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d{1,19})(?:\/|$)/i);
    if (!match) return null;
    const username = match[1];
    const postId = match[2];
    return { postId, username, url: `https://x.com/${username}/status/${postId}` };
  } catch {
    return null;
  }
}

export function parseRedditUrl(input: string): { postId: string; url: string } | null {
  try {
    const value = input.trim();
    const normalized = value.startsWith("http") ? value : `https://${value}`;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "redd.it") {
      const postId = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[a-z0-9]+$/i.test(postId) ? { postId, url: `https://www.reddit.com/comments/${postId}/` } : null;
    }
    if (hostname !== "reddit.com" && !hostname.endsWith(".reddit.com")) return null;
    const match = url.pathname.match(/\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i);
    if (!match) return null;
    return { postId: match[1], url: `https://www.reddit.com${url.pathname.replace(/\/+$/, "")}/` };
  } catch {
    return null;
  }
}

export function parseWebUrl(input: string): { pageId: string; url: string } | null {
  try {
    const value = input.trim();
    const normalized = value.startsWith("http") ? value : `https://${value}`;
    const url = new URL(normalized);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    const hostname = url.hostname.toLocaleLowerCase();
    if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return null;
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLocaleLowerCase())) url.searchParams.delete(key);
    });
    url.searchParams.sort();
    const canonical = url.toString();
    return { pageId: `web:${canonical}`, url: canonical };
  } catch {
    return null;
  }
}

export function parseSourceUrl(input: string) {
  const youtube = parseYouTubeUrl(input);
  if (youtube) return { sourceType: "youtube" as const, sourceId: youtube.youtubeId, url: youtube.url };
  const post = parseXUrl(input);
  if (post) return { sourceType: "x" as const, sourceId: post.postId, url: post.url };
  const reddit = parseRedditUrl(input);
  if (reddit) return { sourceType: "reddit" as const, sourceId: reddit.postId, url: reddit.url };
  const web = parseWebUrl(input);
  if (web) return { sourceType: "web" as const, sourceId: web.pageId, url: web.url };
  return null;
}

export function parseTimestamp(value: string) {
  const clean = value.trim().replace(",", ".");
  const parts = clean.split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

export function formatTimestamp(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function parseVtt(vtt: string): TranscriptCue[] {
  const lines = vtt.replaceAll("\r", "").split("\n");
  const parsed: TranscriptCue[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line.includes("-->")) {
      index += 1;
      continue;
    }
    const [startRaw, endRaw] = line.split("-->").map((part) => part.trim().split(" ")[0]);
    index += 1;
    const text: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      text.push(lines[index].replace(/<[^>]*>/g, "").trim());
      index += 1;
    }
    const normalized = text.join(" ")
      .replace(/&nbsp;/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&")
      // «>>» marca cambio de hablante en los subtítulos automáticos; no aporta al leer.
      .replace(/(^|\s)>>\s*/g, "$1").replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    parsed.push({
      startSeconds: parseTimestamp(startRaw),
      endSeconds: parseTimestamp(endRaw),
      text: normalized,
    });
  }

  // YouTube auto-captions alternate rolling two-line cues with ~10 ms cues
  // containing only the newly completed line. Keeping those short cues avoids
  // indexing every phrase two or three times.
  const completedLines = parsed.flatMap((cue, cueIndex) => {
    if (cue.endSeconds - cue.startSeconds > 0.08) return [];
    const preceding = parsed[cueIndex - 1];
    return [{ ...cue, startSeconds: preceding && preceding.endSeconds - preceding.startSeconds > 0.08 ? preceding.startSeconds : cue.startSeconds }];
  });
  const selected = completedLines.length >= 2 && completedLines.length >= parsed.length * 0.25 ? completedLines : parsed;
  const cues: TranscriptCue[] = [];
  for (const cue of selected) {
    const previous = cues.at(-1);
    if (previous?.text === cue.text) {
      previous.endSeconds = cue.endSeconds;
    } else {
      cues.push({ ...cue });
    }
  }
  return cues;
}

export function chunkCues(cues: TranscriptCue[], targetChars = 1800) {
  const chunks: TranscriptCue[] = [];
  let current: TranscriptCue | null = null;
  for (const cue of cues) {
    if (!current) {
      current = { ...cue };
      continue;
    }
    if (current.text.length + cue.text.length > targetChars || cue.startSeconds - current.startSeconds > 110) {
      chunks.push(current);
      current = { ...cue };
      continue;
    }
    current.text = `${current.text} ${cue.text}`;
    current.endSeconds = cue.endSeconds;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  return aNorm && bNorm ? dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm)) : 0;
}

export function keywordScore(query: string, text: string) {
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const haystack = text.toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) / Math.max(terms.length, 1);
}

export function citationsFromText(content: string, chunks: Array<{ id: number; startSeconds: number; endSeconds: number; text: string }>): Citation[] {
  const labels = [...content.matchAll(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g)].map((match) => match[1]);
  const seen = new Set<number>();
  return labels.flatMap((label) => {
    const seconds = parseTimestamp(label);
    const chunk = [...chunks].sort((a, b) => Math.abs(a.startSeconds - seconds) - Math.abs(b.startSeconds - seconds))[0];
    if (!chunk || seen.has(chunk.id)) return [];
    seen.add(chunk.id);
    return [{ startSeconds: chunk.startSeconds, endSeconds: chunk.endSeconds, label: formatTimestamp(chunk.startSeconds), text: chunk.text.slice(0, 240) }];
  });
}

export function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
