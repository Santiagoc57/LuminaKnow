import { parseXUrl } from "./utils";

type XEmbedResponse = {
  author_name?: string;
  author_url?: string;
  html?: string;
  url?: string;
};

export type ExtractedXPost = {
  postId: string;
  title: string;
  channel: string;
  description: string;
  publishedAt: string;
  url: string;
  authorHandle: string;
  avatarUrl: string;
  previewUrl: string;
};

async function previewFromPage(url: string) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return "";
    const html = await response.text();
    return decodeHtml(html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)?.[1] || "");
  } catch { return ""; }
}

async function mediaFromPublicEmbed(postId: string) {
  try {
    const endpoint = new URL("https://platform.twitter.com/embed/Tweet.html");
    endpoint.searchParams.set("id", postId);
    endpoint.searchParams.set("dnt", "true");
    const response = await fetch(endpoint, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return { previewUrl: "", avatarUrl: "" };
    const html = (await response.text()).replaceAll("\\/", "/").replaceAll("\\u0026", "&");
    const media = html.match(/https:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb|amplify_video_thumb)\/[^"'\\s<]+/i)?.[0] || "";
    const avatar = html.match(/https:\/\/pbs\.twimg\.com\/profile_images\/[^"'\\s<]+/i)?.[0] || "";
    return {
      previewUrl: decodeHtml(media.replace(/[),.;]+$/, "")),
      avatarUrl: decodeHtml(avatar.replace(/[),.;]+$/, "")),
    };
  } catch { return { previewUrl: "", avatarUrl: "" }; }
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity.startsWith("#")) {
      const hex = entity[1]?.toLowerCase() === "x";
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function textFromEmbed(html: string) {
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
  return decodeHtml(paragraph.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function publishedAtFromEmbed(html: string) {
  const links = [...html.matchAll(/<a\b[^>]*href=["'][^"']*\/status\/\d+[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const label = decodeHtml((links.at(-1)?.[1] ?? "").replace(/<[^>]+>/g, " ")).trim();
  const parsed = label ? new Date(label) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

export async function extractXPost(inputUrl: string): Promise<ExtractedXPost> {
  const parsed = parseXUrl(inputUrl);
  if (!parsed) throw new Error("Pega un enlace válido de una publicación pública de X.");
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", parsed.url);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");
  endpoint.searchParams.set("maxwidth", "550");
  const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error("No pudimos leer esta publicación. Puede haber sido eliminada, ser privada o no estar disponible públicamente.");
  const body = await response.json() as XEmbedResponse;
  const html = body.html ?? "";
  const text = textFromEmbed(html);
  if (!text) throw new Error("X no devolvió texto público para esta publicación.");
  const username = new URL(body.author_url || `https://x.com/${parsed.username}`).pathname.split("/").filter(Boolean)[0] || parsed.username;
  const author = body.author_name?.trim() || `@${username}`;
  const compact = text.replace(/\s+/g, " ");
  const [embedMedia, pagePreview] = await Promise.all([mediaFromPublicEmbed(parsed.postId), previewFromPage(parsed.url)]);
  const previewUrl = embedMedia.previewUrl || pagePreview;
  return {
    postId: parsed.postId,
    title: compact.length > 92 ? `${compact.slice(0, 89).trimEnd()}…` : compact,
    channel: author === `@${username}` ? author : `${author} · @${username}`,
    description: text,
    publishedAt: publishedAtFromEmbed(html),
    url: parsed.url,
    authorHandle: username,
    avatarUrl: embedMedia.avatarUrl,
    previewUrl,
  };
}
