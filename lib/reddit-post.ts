import { parseRedditUrl } from "./utils";

type RedditThing = { kind?: string; data?: Record<string, unknown> };

export type ExtractedRedditItem = {
  externalId: string;
  url: string;
  authorName: string;
  authorHandle: string;
  text: string;
  publishedAt: string;
  previewUrl: string;
};

export type ExtractedRedditPost = {
  postId: string;
  title: string;
  channel: string;
  description: string;
  publishedAt: string;
  url: string;
  authorHandle: string;
  previewUrl: string;
  items: ExtractedRedditItem[];
};

function decodeUrl(value: unknown) {
  return typeof value === "string" ? value.replaceAll("&amp;", "&") : "";
}

function isoFromUnix(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : "";
}

function imageFromPost(data: Record<string, unknown>) {
  const preview = data.preview as { images?: Array<{ source?: { url?: string } }> } | undefined;
  const previewUrl = decodeUrl(preview?.images?.[0]?.source?.url);
  if (previewUrl) return previewUrl;
  const thumbnail = decodeUrl(data.thumbnail);
  return /^https?:\/\//i.test(thumbnail) ? thumbnail : "";
}

function collectComments(children: RedditThing[], output: ExtractedRedditItem[], limit: number) {
  for (const child of children) {
    if (output.length >= limit) return;
    if (child.kind !== "t1" || !child.data) continue;
    const data = child.data;
    const body = typeof data.body === "string" ? data.body.trim() : "";
    if (body && body !== "[deleted]" && body !== "[removed]") {
      const permalink = typeof data.permalink === "string" ? data.permalink : "";
      const author = typeof data.author === "string" ? data.author : "usuario eliminado";
      output.push({
        externalId: typeof data.id === "string" ? data.id : `comment-${output.length}`,
        url: permalink ? `https://www.reddit.com${permalink}` : "",
        authorName: `u/${author}`,
        authorHandle: author,
        text: body,
        publishedAt: isoFromUnix(data.created_utc),
        previewUrl: "",
      });
    }
    const replies = data.replies;
    if (replies && typeof replies === "object") {
      const replyData = (replies as { data?: { children?: RedditThing[] } }).data;
      if (replyData?.children) collectComments(replyData.children, output, limit);
    }
  }
}

export async function extractRedditPost(inputUrl: string, limit = 100): Promise<ExtractedRedditPost> {
  const parsed = parseRedditUrl(inputUrl);
  if (!parsed) throw new Error("Pega un enlace válido de una publicación pública de Reddit.");
  const endpoint = new URL(parsed.url.replace(/\/$/, ".json"));
  endpoint.searchParams.set("raw_json", "1");
  endpoint.searchParams.set("limit", String(Math.min(100, Math.max(1, limit))));
  endpoint.searchParams.set("depth", "8");
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "LuminaKnowledge/1.0 (personal local library)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Reddit no permitió leer esta publicación. Puede ser privada, haber sido eliminada o requerir una sesión.");
  const listings = await response.json() as Array<{ data?: { children?: RedditThing[] } }>;
  const postData = listings[0]?.data?.children?.[0]?.data;
  if (!postData) throw new Error("Reddit no devolvió contenido público para esta publicación.");
  const title = typeof postData.title === "string" ? postData.title.trim() : "Publicación de Reddit";
  const body = typeof postData.selftext === "string" ? postData.selftext.trim() : "";
  const author = typeof postData.author === "string" ? postData.author : "usuario eliminado";
  const subreddit = typeof postData.subreddit === "string" ? postData.subreddit : "Reddit";
  const permalink = typeof postData.permalink === "string" ? postData.permalink : "";
  const canonicalUrl = permalink ? `https://www.reddit.com${permalink}` : parsed.url;
  const previewUrl = imageFromPost(postData);
  const rootText = [title, body].filter(Boolean).join("\n\n");
  const items: ExtractedRedditItem[] = [{
    externalId: parsed.postId,
    url: canonicalUrl,
    authorName: `u/${author}`,
    authorHandle: author,
    text: rootText,
    publishedAt: isoFromUnix(postData.created_utc),
    previewUrl,
  }];
  collectComments(listings[1]?.data?.children || [], items, Math.min(100, Math.max(1, limit)));
  return {
    postId: parsed.postId,
    title,
    channel: `r/${subreddit} · u/${author}`,
    description: rootText,
    publishedAt: items[0].publishedAt,
    url: canonicalUrl,
    authorHandle: author,
    previewUrl,
    items,
  };
}
