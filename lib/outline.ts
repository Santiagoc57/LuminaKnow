import type { AppVideo } from "./types";
import { formatTimestamp } from "./utils";

type OutlineChunk = { id: number; startSeconds: number; endSeconds: number; text: string };

export type OutlineSection = {
  title: string;
  startSeconds: number;
  endSeconds: number;
  points: Array<{ text: string; startSeconds: number }>;
};

function concisePoint(text: string) {
  const clean = text.replace(/\[(?:música|aplausos?)\]/gi, "").replace(/\s+/g, " ").trim();
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 35);
  const candidate = sentences.find((sentence) => sentence.length <= 280) ?? sentences[0] ?? clean;
  if (candidate.length <= 280) return candidate;
  const clipped = candidate.slice(0, 277);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > 180 ? boundary : 277).trim()}…`;
}

function evenlySpaced<T>(items: T[], count: number) {
  if (items.length <= count) return items;
  const indexes = Array.from({ length: count }, (_, index) => Math.round(index * (items.length - 1) / Math.max(1, count - 1)));
  return [...new Set(indexes)].map((index) => items[index]);
}

export function buildVideoOutline(video: AppVideo, chunks: OutlineChunk[]): OutlineSection[] {
  if (!chunks.length) return [];
  const duration = Math.max(video.durationSeconds, chunks.at(-1)?.endSeconds ?? 0);
  const chapters = video.summary?.chapters ?? [];
  const chaptersCoverVideo = chapters.length >= 3 && (chapters.at(-1)?.startSeconds ?? 0) >= duration * 0.5;
  const sectionCount = Math.min(12, Math.max(4, Math.ceil(duration / 600)));
  const boundaries = chaptersCoverVideo
    ? chapters.map((chapter) => chapter.startSeconds)
    : Array.from({ length: sectionCount }, (_, index) => duration * index / sectionCount);

  return boundaries.map((startSeconds, index) => {
    const endSeconds = boundaries[index + 1] ?? duration;
    const sectionChunks = chunks.filter((chunk) => chunk.startSeconds >= startSeconds && chunk.startSeconds < endSeconds);
    const selected = evenlySpaced(sectionChunks, 3);
    const matchingChapter = chapters.find((chapter) => chapter.startSeconds >= startSeconds && chapter.startSeconds < endSeconds);
    const generatedTitle = `Tramo ${String(index + 1).padStart(2, "0")} · ${formatTimestamp(startSeconds)}–${formatTimestamp(endSeconds)}`;
    const title = matchingChapter && !/^Parte \d+$/i.test(matchingChapter.title) ? matchingChapter.title : generatedTitle;
    return {
      title,
      startSeconds,
      endSeconds,
      points: selected.map((chunk) => ({ text: concisePoint(chunk.text), startSeconds: chunk.startSeconds })).filter((point) => point.text),
    };
  }).filter((section) => section.points.length);
}
