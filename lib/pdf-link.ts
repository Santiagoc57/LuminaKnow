// Reconoce enlaces a PDF sin tocar la red: arXiv por su identificador y cualquier otro por su extensión.
export type PdfLink = { url: string; arxivId: string | null };

const ARXIV_ID = /^(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)$/;

export function pdfLinkFrom(input: string): PdfLink | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "arxiv.org" || host === "export.arxiv.org") {
    const match = url.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/);
    if (match && ARXIV_ID.test(match[1])) return { url: `https://arxiv.org/pdf/${match[1]}`, arxivId: match[1] };
    return null;
  }
  return /\.pdf$/i.test(url.pathname) ? { url: url.toString(), arxivId: null } : null;
}

// Los metadatos de muchos PDF traen el nombre del programa o del archivo en vez de un título.
export function usablePdfTitle(value: string) {
  const title = value.trim();
  if (title.length < 4) return "";
  if (/^(untitled|sin título|document\d*|microsoft (word|powerpoint)\b)/i.test(title)) return "";
  if (/\.(pdf|docx?|pptx?|tex|indd|dvi)$/i.test(title)) return "";
  return title.slice(0, 200);
}

function xmlText(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

export function parseArxivEntry(xml: string) {
  const entry = xml.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return null;
  const title = xmlText(entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
  if (!title || /^error$/i.test(title)) return null;
  return {
    title,
    abstract: xmlText(entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? ""),
    authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((match) => xmlText(match[1])),
    publishedAt: xmlText(entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? ""),
  };
}
