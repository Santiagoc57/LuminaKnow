import type { AppVideo } from "./types";

// Versión ligera de una fuente para la carga inicial (tarjetas, búsqueda, filtros). La ficha pide la completa al abrirse.
// Se recortan los textos largos (artículos, hilos, secciones del resumen) y se guarda cuántas palabras tenían.
export function slimVideo(video: AppVideo): AppVideo {
  const summary = video.summary ? {
    ...(video.summary.headline ? { headline: video.summary.headline } : {}),
    gist: video.summary.gist,
    cardSummary: video.summary.cardSummary,
    sourceTranslation: (video.summary.sourceTranslation || "").slice(0, 1500),
    sections: (video.summary.sections ?? []).slice(0, 2).map((section) => ({ title: section.title, points: section.points.slice(0, 2) })),
    keyPoints: [],
    chapters: [],
    takeaways: (video.summary.takeaways ?? []).slice(0, 4),
  } : null;
  const sourceItems = video.sourceItems.slice(0, 40).map((item, index) => {
    const words = item.text.trim().split(/\s+/).filter(Boolean).length;
    return { ...item, text: item.text.slice(0, index < 3 ? 1200 : index < 8 ? 240 : 0), metadata: { ...(item.metadata ?? {}), wordCount: words } };
  });
  return { ...video, summary, sourceItems, description: video.description.slice(0, 1500) };
}
