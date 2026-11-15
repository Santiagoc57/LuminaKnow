// Aviso que acompaña a los resúmenes locales: no es una idea de la fuente.
export const LOCAL_SUMMARY_NOTICE = "Resumen preliminar generado localmente. Añade una clave de Gemini para obtener un análisis más profundo.";
export const RETRY_SUMMARY_NOTICE = "Resumen provisional: la IA no respondió esta vez (límite gratuito o error temporal). Pulsa Regenerar para el análisis completo.";

export function isProvisionalSummary(takeaways: unknown[] | undefined) {
  return (takeaways ?? []).some((text) => text === LOCAL_SUMMARY_NOTICE || text === RETRY_SUMMARY_NOTICE);
}

import type { KeyPoint, Summary, SummarySection } from "./types";

type EvidenceChunk = { startSeconds: number; text: string };
type RawSummary = {
  gist?: unknown;
  cardSummary?: unknown;
  sourceTranslation?: unknown;
  sections?: unknown;
  keyPoints?: unknown;
  chapters?: unknown;
  takeaways?: unknown;
};

const stopWords = new Set([
  "esta", "este", "esto", "para", "como", "desde", "hasta", "entre", "sobre", "tambien", "donde", "cuando", "porque", "hacia", "tiene", "puede", "video", "the", "with", "from", "that", "this",
]);

function terms(value: string) {
  return [...new Set((value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((term) => !stopWords.has(term)))];
}

function evidenceScore(query: string, text: string) {
  const queryTerms = terms(query);
  if (!queryTerms.length) return 0;
  const haystack = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  return queryTerms.filter((term) => haystack.includes(term)).length / queryTerms.length;
}

function locateLegacyPoint(text: string, chunks: EvidenceChunk[], chapters: Summary["chapters"]) {
  const chunkMatch = chunks.map((chunk) => ({ startSeconds: chunk.startSeconds, score: evidenceScore(text, chunk.text) })).sort((a, b) => b.score - a.score)[0];
  if (chunkMatch && chunkMatch.score >= 0.22) return chunkMatch.startSeconds;
  const chapterMatch = chapters.map((chapter) => ({ startSeconds: chapter.startSeconds, score: evidenceScore(text, `${chapter.title} ${chapter.summary}`) })).sort((a, b) => b.score - a.score)[0];
  if (!chapterMatch || chapterMatch.score < 0.3) return null;
  const nearestChunk = [...chunks].sort((a, b) => Math.abs(a.startSeconds - chapterMatch.startSeconds) - Math.abs(b.startSeconds - chapterMatch.startSeconds))[0];
  return nearestChunk?.startSeconds ?? chapterMatch.startSeconds;
}

function normalizePoint(point: unknown, chunks: EvidenceChunk[], chapters: Summary["chapters"]): KeyPoint | null {
  if (typeof point === "string") return { text: point, startSeconds: locateLegacyPoint(point, chunks, chapters) };
  if (!point || typeof point !== "object") return null;
  const candidate = point as Record<string, unknown>;
  if (typeof candidate.text !== "string") return null;
  return {
    text: candidate.text,
    startSeconds: typeof candidate.startSeconds === "number" && Number.isFinite(candidate.startSeconds)
      ? Math.max(0, candidate.startSeconds)
      : locateLegacyPoint(candidate.text, chunks, chapters),
  };
}

function buildLegacySections(chapters: Summary["chapters"], keyPoints: KeyPoint[]): SummarySection[] {
  if (!chapters.length) return keyPoints.length ? [{ title: "Ideas principales", points: keyPoints }] : [];
  return chapters.map((chapter, index) => {
    const nextStart = chapters[index + 1]?.startSeconds ?? Number.POSITIVE_INFINITY;
    const related = keyPoints.filter((point) => point.startSeconds !== null && point.startSeconds >= chapter.startSeconds && point.startSeconds < nextStart);
    const points: KeyPoint[] = [{ text: chapter.summary, startSeconds: chapter.startSeconds }, ...related];
    return {
      title: chapter.title,
      points: points.filter((point, pointIndex) => points.findIndex((candidate) => candidate.text.trim().toLocaleLowerCase("es") === point.text.trim().toLocaleLowerCase("es")) === pointIndex),
    };
  });
}

export function normalizeSummary(raw: unknown, chunks: EvidenceChunk[] = []): Summary | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as RawSummary;
  const chapters = Array.isArray(value.chapters) ? value.chapters.flatMap((chapter) => {
    if (!chapter || typeof chapter !== "object") return [];
    const candidate = chapter as Record<string, unknown>;
    if (typeof candidate.title !== "string" || typeof candidate.summary !== "string" || typeof candidate.startSeconds !== "number") return [];
    return [{ title: candidate.title, summary: candidate.summary, startSeconds: Math.max(0, candidate.startSeconds) }];
  }) : [];
  const keyPoints: KeyPoint[] = Array.isArray(value.keyPoints) ? value.keyPoints.flatMap((point) => {
    const normalized = normalizePoint(point, chunks, chapters);
    return normalized ? [normalized] : [];
  }) : [];
  const parsedSections: SummarySection[] = Array.isArray(value.sections) ? value.sections.flatMap((section) => {
    if (!section || typeof section !== "object") return [];
    const candidate = section as Record<string, unknown>;
    if (typeof candidate.title !== "string" || !Array.isArray(candidate.points)) return [];
    const points = candidate.points.flatMap((point) => {
      const normalized = normalizePoint(point, chunks, chapters);
      return normalized ? [normalized] : [];
    });
    return points.length ? [{ title: candidate.title, points }] : [];
  }) : [];
  return {
    gist: typeof value.gist === "string" ? value.gist : "",
    cardSummary: typeof value.cardSummary === "string" ? value.cardSummary : "",
    sourceTranslation: typeof value.sourceTranslation === "string" ? value.sourceTranslation : "",
    sections: parsedSections.length ? parsedSections : buildLegacySections(chapters, keyPoints),
    keyPoints,
    chapters,
    takeaways: Array.isArray(value.takeaways) ? value.takeaways.filter((item): item is string => typeof item === "string") : [],
  };
}

export function summaryNeedsTimestampNormalization(raw: unknown) {
  if (!raw || typeof raw !== "object") return false;
  const points = (raw as RawSummary).keyPoints;
  if (!Array.isArray(points)) return false;
  return !Array.isArray((raw as RawSummary).sections) || points.some((point) => typeof point === "string" || (point && typeof point === "object" && typeof (point as Record<string, unknown>).startSeconds !== "number"));
}
