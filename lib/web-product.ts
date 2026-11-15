// Detecta fichas de producto (tiendas) a partir de los datos estructurados que las propias tiendas publican:
// JSON-LD «Product» (schema.org) o las etiquetas Open Graph de precio.
export type ProductInfo = { name: string; brand: string; price: string; currency: string; image: string };

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function findProduct(node: unknown): Json | null {
  for (const item of asArray(node)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Json;
    const types = asArray(record["@type"]).map(String);
    if (types.some((type) => /product/i.test(type))) return record;
    const nested = findProduct(record["@graph"]) ?? findProduct(record.mainEntity) ?? findProduct(record.itemListElement);
    if (nested) return nested;
  }
  return null;
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object") return text((value as Json).name ?? (value as Json)["@value"] ?? (value as Json).url);
  return "";
}

function firstImage(value: unknown): string {
  for (const item of asArray(value)) { const url = text(item); if (url) return url; }
  return "";
}

export function detectProduct(document: Document, pageUrl: string): ProductInfo | null {
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || "";
  let product: Json | null = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { product = findProduct(JSON.parse(script.textContent || "null")); } catch { /* JSON-LD inválido */ }
    if (product) break;
  }
  const offers = product ? asArray(product.offers).map((offer) => offer as Json) : [];
  const offer = offers.find((item) => item && (item.price !== undefined || item.lowPrice !== undefined)) ?? offers[0];
  const price = text(offer?.price ?? offer?.lowPrice ?? asArray(offer?.priceSpecification).map((item) => (item as Json).price)[0]) || meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]');
  const currency = text(offer?.priceCurrency) || meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]');
  const isProductPage = Boolean(product) || /product/i.test(meta('meta[property="og:type"]')) || Boolean(meta('meta[property="product:price:amount"]'));
  if (!isProductPage || (!price && !product)) return null;
  const resolve = (value: string) => { try { return value ? new URL(value, pageUrl).toString() : ""; } catch { return ""; } };
  return {
    name: text(product?.name) || meta('meta[property="og:title"]'),
    brand: text(product?.brand) || meta('meta[property="product:brand"]') || meta('meta[property="og:site_name"]'),
    price,
    currency,
    image: resolve(firstImage(product?.image) || meta('meta[property="og:image"]')),
  };
}

export function formatPrice(price: string, currency: string) {
  const amount = Number(String(price).replace(",", "."));
  if (!price || Number.isNaN(amount)) return price;
  try { return new Intl.NumberFormat("es", { style: "currency", currency: currency || "USD", maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount); }
  catch { return `${amount} ${currency}`.trim(); }
}

// Películas y series (IMDb, Letterboxd, TMDB…): también publican JSON-LD «Movie» / «TVSeries».
export type MovieInfo = { kind: "movie" | "series"; name: string; year: string; duration: string; director: string; rating: string; poster: string; synopsis: string };

function findTyped(node: unknown, pattern: RegExp): Json | null {
  for (const item of asArray(node)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Json;
    if (asArray(record["@type"]).map(String).some((type) => pattern.test(type))) return record;
    const nested = findTyped(record["@graph"], pattern) ?? findTyped(record.mainEntity, pattern);
    if (nested) return nested;
  }
  return null;
}

// «PT2H22M» → «2 h 22 min».
function readableDuration(value: string) {
  const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return value;
  return [match[1] && `${match[1]} h`, match[2] && `${match[2]} min`].filter(Boolean).join(" ");
}

export function detectMovie(document: Document, pageUrl: string): MovieInfo | null {
  let movie: Json | null = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try { movie = findTyped(JSON.parse(script.textContent || "null"), /^(Movie|TVSeries|TVSeason|TVEpisode)$/i); } catch { /* JSON-LD inválido */ }
    if (movie) break;
  }
  const ogType = document.querySelector<HTMLMetaElement>('meta[property="og:type"]')?.content || "";
  if (!movie && !/video\.(movie|tv_show|episode)/i.test(ogType)) return null;
  const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || "";
  const types = asArray(movie?.["@type"]).map(String).join(" ");
  const resolve = (value: string) => { try { return value ? new URL(value, pageUrl).toString() : ""; } catch { return ""; } };
  const rating = movie?.aggregateRating as Json | undefined;
  return {
    kind: /TV|tv_show|episode/i.test(types || ogType) ? "series" : "movie",
    name: text(movie?.name) || meta('meta[property="og:title"]'),
    year: (text(movie?.datePublished) || text(movie?.startDate)).slice(0, 4),
    duration: readableDuration(text(movie?.duration)),
    director: asArray(movie?.director).map(text).filter(Boolean).slice(0, 2).join(", "),
    rating: rating ? text(rating.ratingValue) : "",
    poster: resolve(firstImage(movie?.image) || meta('meta[property="og:image"]')),
    synopsis: text(movie?.description) || meta('meta[property="og:description"]'),
  };
}
