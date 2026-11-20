import type { AppVideo } from "./types";

// Repaso diario: 3 a 5 ideas tuyas (subrayados primero; si faltan, ideas clave de tus resúmenes), distintas cada día
// pero estables durante el día. Y lo que lleva más de un mes sin leer, para leerlo o archivarlo.

export type DailyIdea = { videoId: string; title: string; quote: string; note: string; kind: "highlight" | "takeaway" };

function seeded(seed: number) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

export function dayKey(date = new Date()) {
  return Number(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`);
}

export function dailyIdeas(videos: AppVideo[], date = new Date(), count = 5): DailyIdea[] {
  const random = seeded(dayKey(date));
  const shuffle = <T,>(items: T[]) => items.map((item) => ({ item, order: random() })).sort((a, b) => a.order - b.order).map((entry) => entry.item);
  const highlights: DailyIdea[] = videos.flatMap((video) => (video.highlights ?? []).filter((highlight) => highlight.quote.trim().length > 20).map((highlight) => ({ videoId: video.id, title: video.title, quote: highlight.quote.trim(), note: highlight.note, kind: "highlight" as const })));
  const takeaways: DailyIdea[] = videos.filter((video) => !video.archivedAt).flatMap((video) => (video.summary?.takeaways ?? []).slice(0, 3).map((text) => ({ videoId: video.id, title: video.title, quote: text, note: "", kind: "takeaway" as const })));
  const picked: DailyIdea[] = [];
  const usedSources = new Set<string>();
  // Una idea por fuente, para variar; primero tus subrayados.
  for (const idea of [...shuffle(highlights), ...shuffle(takeaways)]) {
    if (picked.length >= count) break;
    if (usedSources.has(idea.videoId)) continue;
    usedSources.add(idea.videoId);
    picked.push(idea);
  }
  return picked;
}

const MONTH = 30 * 86_400_000;
export function oldUnread(videos: AppVideo[], now = Date.now()) {
  return videos
    .filter((video) => !video.consumedAt && !video.archivedAt && !["note", "image", "palette"].includes(video.sourceType) && now - new Date(video.createdAt).getTime() > MONTH)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
