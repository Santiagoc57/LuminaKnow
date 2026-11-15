import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { suggestEarlySourceMetadata } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { previewPdfLink } from "@/lib/pdf";
import { pdfLinkFrom } from "@/lib/pdf-link";
import { extractRedditPost } from "@/lib/reddit-post";
import { parseSourceUrl } from "@/lib/utils";
import { extractXPost } from "@/lib/x-post";
import { extractWebArticle } from "@/lib/web-article";

export const runtime = "nodejs";

type SourcePreview = { title: string; author: string; content: string; thumbnailUrl: string };

async function youtubePreview(url: string): Promise<SourcePreview> {
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("format", "json");
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) throw new Error("No pudimos leer los datos públicos de este video.");
  const body = await response.json() as { title?: string; author_name?: string; thumbnail_url?: string };
  return { title: body.title?.trim() || "Video de YouTube", author: body.author_name?.trim() || "", content: body.title?.trim() || "", thumbnailUrl: body.thumbnail_url?.trim() || "" };
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { url } = z.object({ url: z.string().trim().min(1) }).parse(await request.json());
    const pdfLink = pdfLinkFrom(url);
    if (pdfLink) {
      const { title } = await previewPdfLink(pdfLink);
      return NextResponse.json({ title, titles: title ? [title] : [], usedAI: false, tags: [] });
    }
    const parsed = parseSourceUrl(url);
    if (!parsed) throw new Error("Pega un enlace público válido de YouTube, X, Reddit, Substack o cualquier artículo web.");
    let preview: SourcePreview;
    if (parsed.sourceType === "youtube") preview = await youtubePreview(parsed.url);
    else if (parsed.sourceType === "x") {
      const post = await extractXPost(parsed.url);
      preview = { title: post.title, author: post.channel, content: post.description, thumbnailUrl: post.previewUrl };
    } else if (parsed.sourceType === "reddit") {
      const post = await extractRedditPost(parsed.url, 1);
      preview = { title: post.title, author: post.channel, content: post.description, thumbnailUrl: post.previewUrl };
    } else {
      const article = await extractWebArticle(parsed.url);
      preview = { title: article.title, author: article.channel, content: [article.description, ...article.sections.slice(0, 4).map((section) => `${section.heading}\n${section.text}`)].filter(Boolean).join("\n\n"), thumbnailUrl: article.thumbnailUrl };
    }
    const suggestion = await suggestEarlySourceMetadata({ ...preview, sourceType: parsed.sourceType });
    const db = getDb();
    const tags = suggestion.tagIds.map((catalogKey) => db.prepare(`SELECT id, name, level FROM tags WHERE catalog_key = ? AND active = 1`).get(catalogKey)).filter(Boolean);
    return NextResponse.json({ sourceType: parsed.sourceType, metadataTitle: preview.title, thumbnailUrl: preview.thumbnailUrl, title: suggestion.title, titles: suggestion.titles, tags, usedAI: suggestion.usedAI });
  } catch (error) {
    return apiError(error);
  }
}
