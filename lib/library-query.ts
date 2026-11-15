import type { AppVideo, LibraryTag } from "./types";
import { quoteFromNote } from "./note-text";
import { extractDateRange, type QueryDateRange } from "./query-dates";
import { colorName } from "./visual-colors";

export type ParsedLibraryQuery = {
  text: string;
  tagTerms: string[];
  site: string;
  sourceType: string;
  collection: string;
  author: string;
  before: string;
  after: string;
  object: string;
  color: string;
  state: string;
  dateRange: QueryDateRange | null;
  anyOf: ParsedLibraryQuery[][];
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}

function cleanOperatorValue(value: string) {
  return value.replace(/^"|"$/g, "").replaceAll("-", " ").trim();
}

const QUERY_TOKENS = /"[^"]+"|[^\s:]+:"[^"]+"|#[^\s]+|\S+/g;

// Agrupa los términos: los unidos con || son alternativas entre sí; el resto debe cumplirse a la vez.
function queryGroups(input: string) {
  const tokens = (input.match(QUERY_TOKENS) ?? []).flatMap((token) => token.includes('"') || !token.includes("||") ? [token] : token.split(/(\|\|)/).filter(Boolean));
  const groups: string[][] = [];
  let joining = false;
  for (const token of tokens) {
    if (token === "||") { joining = groups.length > 0; continue; }
    if (joining) groups[groups.length - 1].push(token);
    else groups.push([token]);
    joining = false;
  }
  return groups;
}

export function libraryQueryTerms(input: string): string[] {
  const { rest, range } = extractDateRange(input, new Date());
  return [...(range ? [range.phrase] : []), ...queryGroups(rest).map((group) => group.join(" || "))];
}

// Formas alternativas para que "nubes" encuentre "nube" y "zapato" encuentre "zapatos".
function wordForms(term: string) {
  const forms = [term];
  if (term.endsWith("es") && term.length >= 6) forms.push(term.slice(0, -2));
  if (term.endsWith("s") && term.length >= 5) forms.push(term.slice(0, -1));
  return forms;
}

function includesTerm(haystack: string, term: string) {
  return wordForms(term).some((form) => haystack.includes(form));
}

function emptyQuery(): ParsedLibraryQuery {
  return { text: "", tagTerms: [], site: "", sourceType: "", collection: "", author: "", before: "", after: "", object: "", color: "", state: "", dateRange: null, anyOf: [] };
}

function applyToken(parsed: ParsedLibraryQuery, text: string[], token: string) {
  if (token.startsWith("#") && token.length > 1) { parsed.tagTerms.push(cleanOperatorValue(token.slice(1))); return; }
  const separator = token.startsWith('"') ? -1 : token.indexOf(":");
  if (separator > 0) {
    const key = normalize(token.slice(0, separator));
    const value = cleanOperatorValue(token.slice(separator + 1));
    if (key === "site" || key === "sitio") { parsed.site = value; return; }
    if (key === "tipo" || key === "type") { parsed.sourceType = value; return; }
    if (key === "en" || key === "carpeta") { parsed.collection = value; return; }
    if (key === "autor" || key === "author") { parsed.author = value; return; }
    if (key === "objeto" || key === "object") { parsed.object = value; return; }
    if (key === "color") { parsed.color = value; return; }
    if (key === "estado" || key === "state") { parsed.state = value; return; }
    if (key === "antes" || key === "before") { parsed.before = value; return; }
    if (key === "despues" || key === "after") { parsed.after = value; return; }
  }
  text.push(cleanOperatorValue(token));
}

function parseTokens(tokens: string[], parsed = emptyQuery()) {
  const text: string[] = [];
  tokens.forEach((token) => applyToken(parsed, text, token));
  parsed.text = text.join(" ").trim();
  return parsed;
}

export function parseLibraryQuery(input: string, now = new Date()): ParsedLibraryQuery {
  const { rest, range } = extractDateRange(input, now);
  const groups = queryGroups(rest);
  const parsed = parseTokens(groups.filter((group) => group.length === 1).map((group) => group[0]));
  parsed.dateRange = range;
  parsed.anyOf = groups.filter((group) => group.length > 1).map((group) => group.map((token) => parseTokens([token])));
  return parsed;
}

function queryDate(value: string, endOfPeriod: boolean) {
  if (!value) return null;
  const year = value.match(/^\d{4}$/)?.[0];
  const date = new Date(year ? `${year}-${endOfPeriod ? "12-31T23:59:59" : "01-01T00:00:00"}` : value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function sourceMatches(video: AppVideo, requested: string) {
  const type = normalize(requested);
  if (!type) return true;
  if (["video", "videos", "youtube"].includes(type)) return video.sourceType === "youtube";
  if (["x", "twitter", "tweet"].includes(type)) return video.sourceType === "x";
  if (["reddit", "post"].includes(type)) return video.sourceType === "reddit";
  if (["social", "publicacion", "publicaciones"].includes(type)) return video.sourceType === "x" || video.sourceType === "reddit";
  if (["articulo", "articulos", "substack"].includes(type)) return video.sourceType === "web" && video.sourceItems.some((item) => item.metadata?.sourceKind === "substack");
  if (["github", "repositorio"].includes(type)) { try { return new URL(video.url).hostname.includes("github.com"); } catch { return false; } }
  if (["pdf", "pdfs"].includes(type)) return video.sourceType === "pdf";
  if (["paper", "papers", "arxiv"].includes(type)) return video.sourceType === "pdf" && video.url.includes("arxiv.org");
  if (["pelicula", "peliculas", "movie", "movies", "serie", "series", "cine"].includes(type)) return video.sourceType === "web" && Boolean(video.sourceItems[0]?.metadata?.movie);
  if (["producto", "productos", "product", "products", "compras"].includes(type)) return video.sourceType === "web" && Boolean(video.sourceItems[0]?.metadata?.product);
  if (["cita", "citas", "quote", "quotes"].includes(type)) return video.sourceType === "note" && Boolean(quoteFromNote(video.note?.content || ""));
  if (["nota", "notas", "note", "notes"].includes(type)) return video.sourceType === "note";
  if (["imagen", "imagenes", "image", "images", "foto", "fotos"].includes(type)) return video.sourceType === "image";
  // Las portadas de páginas web suelen parecer capturas para Vision, pero no lo son.
  if (["captura", "capturas", "screenshot", "screenshots", "pantallazo", "pantallazos"].includes(type)) return video.sourceType !== "web" && video.sourceType !== "pdf" && (video.visual?.labels ?? []).some((label) => label.id === "screenshot" && label.confidence >= 0.6);
  if (["web", "pagina", "paginas"].includes(type)) return video.sourceType === "web";
  if (["paleta", "paletas", "palette", "palettes"].includes(type)) return video.sourceType === "palette";
  return normalize(video.sourceType).includes(type);
}

export function matchesLibraryQuery(video: AppVideo, parsed: ParsedLibraryQuery, catalog: LibraryTag[] = []): boolean {
  if (parsed.dateRange) {
    const saved = new Date(video.createdAt).getTime();
    if (saved < parsed.dateRange.from || saved >= parsed.dateRange.to) return false;
  }
  if (!parsed.anyOf.every((alternatives) => alternatives.some((alternative) => matchesLibraryQuery(video, alternative, catalog)))) return false;
  const searchable = normalize([video.title, video.channel, video.description, video.summary?.gist, video.note?.content, video.tags.map((tag) => tag.name).join(" "), video.collections.map((item) => item.name).join(" "), video.sourceItems.map((item) => item.text).join(" "), video.highlights?.flatMap((item) => [item.quote, item.note]).join(" "), video.visual?.text, video.visual?.description, video.visual?.objects.join(" "), video.visual?.labels.flatMap((label) => [label.name, label.id]).join(" ")].filter(Boolean).join(" "));
  if (parsed.text && !normalize(parsed.text).split(/\s+/).every((term) => includesTerm(searchable, term))) return false;
  if (parsed.site) {
    try { if (!normalize(new URL(video.url).hostname).includes(normalize(parsed.site))) return false; } catch { return false; }
  }
  if (!sourceMatches(video, parsed.sourceType)) return false;
  if (parsed.collection && !video.collections.some((item) => normalize(item.name).includes(normalize(parsed.collection)))) return false;
  if (parsed.author && !normalize(video.channel).includes(normalize(parsed.author))) return false;
  if (parsed.tagTerms.length) {
    const videoTagIds = new Set(video.tags.map((tag) => tag.id));
    const matchesEveryTag = parsed.tagTerms.every((term) => {
      const normalizedTerm = normalize(term);
      const matchingCatalog = catalog.filter((tag) => normalize(tag.name).includes(normalizedTerm));
      const acceptedIds = new Set(matchingCatalog.flatMap((tag) => [tag.id, ...catalog.filter((child) => child.parentIds.includes(tag.id)).map((child) => child.id)]));
      return acceptedIds.size ? [...acceptedIds].some((id) => videoTagIds.has(id)) : video.tags.some((tag) => normalize(tag.name).includes(normalizedTerm));
    });
    if (!matchesEveryTag) return false;
  }
  if (parsed.object) {
    const term = normalize(parsed.object);
    const names = [...(video.visual?.objects ?? []), ...(video.visual?.labels ?? []).filter((label) => label.confidence >= 0.3).flatMap((label) => [label.name, label.id.replaceAll("_", " ")])];
    if (!names.some((name) => includesTerm(normalize(name), term))) return false;
  }
  if (parsed.state) {
    const state = normalize(parsed.state);
    if (["leido", "leidos", "leida", "leidas", "visto", "vistos", "vista", "vistas", "read", "watched"].includes(state) && !video.consumedAt) return false;
    if (["pendiente", "pendientes", "sinleer", "later"].includes(state) && video.consumedAt) return false;
    if (state === "en mente" && (video.topPosition === null || video.topPosition === undefined)) return false;
  }
  if (parsed.color) {
    const term = normalize(parsed.color);
    if (!(video.visual?.colors ?? []).some((swatch) => swatch.share >= 0.08 && normalize(colorName(swatch.hex)) === term)) return false;
  }
  const createdAt = new Date(video.createdAt).getTime();
  const before = queryDate(parsed.before, false);
  const after = queryDate(parsed.after, false);
  if (before !== null && createdAt > before) return false;
  if (after !== null && createdAt < after) return false;
  return true;
}

// Coincide por su búsqueda; una búsqueda vacía no significa "todo", sino que el espacio es solo manual.
export function spaceQueryMatches(query: string, video: AppVideo, catalog: LibraryTag[] = []) {
  return Boolean(query.trim()) && matchesLibraryQuery(video, parseLibraryQuery(query), catalog);
}
