import type { Citation, Summary } from "./types";
import { citationsFromText, formatTimestamp } from "./utils";

type EvidenceChunk = {
  id: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  score: number;
};

function cleanExcerpt(text: string, limit = 330) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  const shortened = normalized.slice(0, limit);
  const lastStop = Math.max(shortened.lastIndexOf(". "), shortened.lastIndexOf("? "), shortened.lastIndexOf("! "));
  return `${(lastStop > 110 ? shortened.slice(0, lastStop + 1) : shortened).trim()}…`;
}

function citedSummary(summary: Summary, chunks: EvidenceChunk[]) {
  const firstTime = summary.chapters[0]?.startSeconds ?? chunks[0]?.startSeconds ?? 0;
  const points = summary.keyPoints.slice(0, 3).map((point, index) => {
    const time = point.startSeconds ?? summary.chapters[index]?.startSeconds ?? firstTime;
    return `• ${point.text} [${formatTimestamp(time)}]`;
  });
  return `${summary.gist} [${formatTimestamp(firstTime)}]${points.length ? `\n\nEn concreto:\n${points.join("\n")}` : ""}`;
}

function citedTakeaways(summary: Summary, chunks: EvidenceChunk[]) {
  const firstTime = summary.chapters[0]?.startSeconds ?? chunks[0]?.startSeconds ?? 0;
  const items = summary.takeaways.slice(0, 4).map((item, index) => {
    const time = summary.chapters[index]?.startSeconds ?? firstTime;
    return `• ${item} [${formatTimestamp(time)}]`;
  });
  return `Estas son las conclusiones prácticas que quedan respaldadas por el análisis del video:\n\n${items.join("\n")}`;
}

export function localChatAnswer(question: string, chunks: EvidenceChunk[], summary: Summary | null): { content: string; citations: Citation[] } {
  const normalizedQuestion = question.toLocaleLowerCase("es");
  let content = "";

  if (summary && /idea central|tema principal|resumen|resumir|de qu[eé] trata|qu[eé] dice el video/.test(normalizedQuestion)) {
    content = citedSummary(summary, chunks);
  } else if (summary && /conclusi|aplicar|pr[aá]ctic|aprendizaje|para recordar/.test(normalizedQuestion)) {
    content = citedTakeaways(summary, chunks);
  } else {
    const evidence = chunks.filter((chunk, index) => chunk.score > 0 || index < 2).slice(0, 3);
    const hasDirectMatch = chunks.some((chunk) => chunk.score > 0);
    if (!hasDirectMatch) {
      content = "No encuentro evidencia suficiente en la transcripción para responder eso con seguridad. Prueba mencionando una persona, concepto o frase concreta del video.";
    } else {
      content = evidence.map((chunk, index) => `${index ? "Además, " : "Según la transcripción, "}${cleanExcerpt(chunk.text)} [${formatTimestamp(chunk.startSeconds)}]`).join("\n\n");
    }
  }

  return { content, citations: citationsFromText(content, chunks) };
}
