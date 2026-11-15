import { lookup } from "node:dns/promises";
import { detectMovie, detectProduct, type MovieInfo, type ProductInfo } from "./web-product";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ARTICLE_CHARS = 120_000;

export type ExtractedWebSection = {
  externalId: string;
  heading: string;
  text: string;
  url: string;
};

export type ExtractedWebArticle = {
  url: string;
  title: string;
  channel: string;
  author: string;
  description: string;
  thumbnailUrl: string;
  faviconUrl: string;
  publishedAt: string;
  sourceLanguage: string;
  siteName: string;
  sourceKind: "substack" | "web" | "product" | "movie";
  sections: ExtractedWebSection[];
  product: ProductInfo | null;
  movie: MovieInfo | null;
  readableHtml: string;
};

function isPrivateIp(address: string) {
  const normalized = address.toLocaleLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const ipv4 = mapped || (isIP(normalized) === 4 ? normalized : "");
  if (!ipv4) return false;
  const [a, b] = ipv4.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("La página debe usar un enlace público http o https.");
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) throw new Error("El enlace utiliza un puerto que Lúmina no puede consultar.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLocaleLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) throw new Error("Lúmina solo puede guardar páginas públicas de Internet.");
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error("Lúmina no puede acceder a direcciones privadas o de la red doméstica.");
  return url;
}

async function readLimitedHtml(response: Response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_HTML_BYTES) throw new Error("La página es demasiado grande para guardarla como artículo.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("La página es demasiado grande para guardarla como artículo.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  return new TextDecoder().decode(bytes);
}

async function fetchPublicHtml(inputUrl: string) {
  let current = await assertPublicUrl(inputUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "es,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_7) AppleWebKit/537.36 Chrome/124 Safari/537.36 LuminaReader/1.0",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("La página respondió con una redirección incompleta.");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "La página no permite leer su contenido público." : `La página respondió con el estado ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("Este enlace no parece ser un artículo o una página HTML.");
    return { html: await readLimitedHtml(response), url: current.toString() };
  }
  throw new Error("La página redirigió demasiadas veces.");
}

function metadata(document: Document, ...selectors: string[]) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const value = node?.getAttribute("content") || node?.getAttribute("href") || "";
    if (value.trim()) return value.trim();
  }
  return "";
}

function absoluteUrl(value: string, base: string) {
  if (!value) return "";
  try { return new URL(value, base).toString(); } catch { return ""; }
}

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function fallbackContent(document: Document) {
  const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
  clone?.querySelectorAll("script,style,noscript,nav,footer,form,button,svg,canvas").forEach((node) => node.remove());
  return cleanText(clone?.textContent || "").slice(0, MAX_ARTICLE_CHARS);
}

function articleSections(content: string, pageUrl: string, fallbackTitle: string) {
  const contentDocument = new JSDOM(`<main>${content}</main>`, { url: pageUrl }).window.document;
  const nodes = [...contentDocument.querySelectorAll("h1,h2,h3,p,li,blockquote,pre")];
  const sections: Array<{ heading: string; anchor: string; paragraphs: string[] }> = [];
  let current = { heading: fallbackTitle, anchor: "", paragraphs: [] as string[] };
  for (const node of nodes) {
    const text = cleanText(node.textContent || "");
    if (!text) continue;
    if (/^H[1-3]$/.test(node.tagName)) {
      if (current.paragraphs.length) sections.push(current);
      current = { heading: text.slice(0, 180), anchor: node.id || "", paragraphs: [] };
    } else if (!current.paragraphs.includes(text)) current.paragraphs.push(text);
  }
  if (current.paragraphs.length) sections.push(current);
  const expanded = sections.flatMap((section) => {
    const chunks: string[][] = [[]];
    section.paragraphs.forEach((paragraph) => {
      const active = chunks.at(-1)!;
      if (active.join("\n\n").length + paragraph.length > 4_500 && active.length) chunks.push([]);
      chunks.at(-1)!.push(paragraph);
    });
    return chunks.filter((chunk) => chunk.length).map((chunk, index) => ({ ...section, heading: index ? `${section.heading} · ${index + 1}` : section.heading, paragraphs: chunk }));
  }).slice(0, 80);
  return expanded.map((section, index) => ({
    externalId: `section-${index + 1}`,
    heading: section.heading || `Sección ${index + 1}`,
    text: cleanText(section.paragraphs.join("\n\n")),
    url: section.anchor ? `${pageUrl.split("#")[0]}#${encodeURIComponent(section.anchor)}` : pageUrl,
  }));
}

export async function extractWebArticle(inputUrl: string): Promise<ExtractedWebArticle> {
  const { html, url } = await fetchPublicHtml(inputUrl);
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 120 }).parse();
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const isSubstack = hostname === "substack.com" || hostname.endsWith(".substack.com") || /substack/i.test(metadata(document, 'meta[name="generator"]'));
  const title = cleanText(article?.title || metadata(document, 'meta[property="og:title"]', 'meta[name="twitter:title"]') || document.title || hostname).slice(0, 240);
  const author = cleanText(article?.byline || metadata(document, 'meta[name="author"]', 'meta[property="article:author"]')).slice(0, 160);
  const siteName = cleanText(article?.siteName || metadata(document, 'meta[property="og:site_name"]') || hostname).slice(0, 160);
  const description = cleanText(article?.excerpt || metadata(document, 'meta[property="og:description"]', 'meta[name="description"]') || "").slice(0, 1_200);
  const publishedAt = article?.publishedTime || metadata(document, 'meta[property="article:published_time"]', 'meta[name="date"]', 'time[datetime]');
  const sourceLanguage = (article?.lang || document.documentElement.lang || "").split("-")[0].toLocaleLowerCase();
  const thumbnailUrl = absoluteUrl(metadata(document, 'meta[property="og:image"]', 'meta[name="twitter:image"]', 'link[rel="image_src"]'), url);
  const faviconUrl = absoluteUrl(metadata(document, 'link[rel="icon"]', 'link[rel="shortcut icon"]', 'link[rel="apple-touch-icon"]'), url) || new URL("/favicon.ico", url).toString();
  const movie = detectMovie(document, url);
  const product = movie ? null : detectProduct(document, url);
  let readableContent = article?.content || "";
  let sections = readableContent ? articleSections(readableContent, url, title) : [];
  // Una ficha de producto puede tener poco texto: basta con su descripción.
  if (!sections.length && product) sections = [{ externalId: "product", heading: title, text: description || product.name || title, url }];
  if (movie && (!sections.length || sections.reduce((total, section) => total + section.text.length, 0) < 200)) sections = [{ externalId: "movie", heading: movie.name || title, text: movie.synopsis || description || title, url }];
  if (!sections.length) {
    const fallback = fallbackContent(document);
    if (fallback.length < 120) throw new Error("No encontramos suficiente texto público para convertir esta página en artículo.");
    readableContent = `<p>${fallback.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`;
    sections = articleSections(readableContent, url, title);
  }
  return {
    url,
    title,
    channel: author ? `${author} · ${siteName}` : siteName,
    author,
    description: description || sections[0]?.text.slice(0, 600) || title,
    thumbnailUrl: movie?.poster || product?.image || thumbnailUrl,
    faviconUrl,
    publishedAt: publishedAt || "",
    sourceLanguage,
    siteName,
    sourceKind: movie ? "movie" : product ? "product" : isSubstack ? "substack" : "web",
    sections,
    product,
    movie,
    // HTML limpio (sin scripts) para la copia permanente.
    readableHtml: readableContent.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, ""),
  };
}
