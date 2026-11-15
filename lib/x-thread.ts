import { extractXPost, type ExtractedXPost } from "./x-post";
import { parseXUrl } from "./utils";

export type XThreadPreview = {
  rootUrl: string;
  status: "single" | "complete" | "partial";
  items: ExtractedXPost[];
  warnings: string[];
};

function canonicalCandidates(html: string, username: string) {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...html.matchAll(new RegExp(`https?://(?:www\\.)?(?:x\\.com|twitter\\.com)/${escaped}/status/(\\d+)`, "gi"))];
  return [...new Set(matches.map((match) => `https://x.com/${username}/status/${match[1]}`))];
}

async function publicPageCandidates(url: string, username: string) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36", Accept: "text/html" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];
    return canonicalCandidates(await response.text(), username);
  } catch {
    return [];
  }
}

export async function previewXThread(rootInput: string, extraInputs: string[] = []): Promise<XThreadPreview> {
  const root = parseXUrl(rootInput);
  if (!root) throw new Error("Pega una publicación pública válida de X.");
  const rootPost = await extractXPost(root.url);
  const discovered = await publicPageCandidates(root.url, rootPost.authorHandle);
  const explicit = extraInputs.flatMap((value) => {
    const parsed = parseXUrl(value);
    return parsed ? [parsed.url] : [];
  });
  const urls = [...new Set([root.url, ...discovered, ...explicit])].slice(0, 100);
  const settled = await Promise.allSettled(urls.map((url) => extractXPost(url)));
  const warnings: string[] = [];
  const items = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const sameAuthor = items.filter((item) => item.authorHandle.toLocaleLowerCase() === rootPost.authorHandle.toLocaleLowerCase());
  if (sameAuthor.length !== items.length) warnings.push("Se omitieron respuestas de otros autores.");
  if (settled.some((result) => result.status === "rejected")) warnings.push("X no permitió leer una o más publicaciones detectadas.");
  const ordered = [...new Map(sameAuthor.map((item) => [item.postId, item])).values()].sort((a, b) => {
    if (a.postId === root.postId) return -1;
    if (b.postId === root.postId) return 1;
    if (a.publishedAt && b.publishedAt) return new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
    return BigInt(a.postId) < BigInt(b.postId) ? -1 : 1;
  });
  const automaticCount = discovered.length;
  const status: XThreadPreview["status"] = ordered.length <= 1 ? "single" : settled.some((result) => result.status === "rejected") || automaticCount <= 1 ? "partial" : "complete";
  if (status === "single") warnings.push("No encontramos respuestas consecutivas públicas. Puedes pegar enlaces adicionales antes de guardar.");
  if (status === "partial") warnings.push("La detección puede estar incompleta; revisa la lista antes de guardar.");
  return { rootUrl: root.url, status, items: ordered.length ? ordered : [rootPost], warnings: [...new Set(warnings)] };
}
