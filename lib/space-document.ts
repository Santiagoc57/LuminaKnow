import { ensureBudget, getAIProvider, getGemini, getOpenAI, GEMINI_TEXT_MODEL, openAICostFor, recordUsage, TEXT_MODEL } from "./ai";
import { listVideos } from "./data";
import { spaceQueryMatches } from "./library-query";
import { listCatalogTags } from "./mobile-library";
import { listSmartSpaces } from "./spaces";
import type { AppVideo } from "./types";

// Convierte un espacio en un documento (informe, guion, post o resumen) con citas [n] a cada fuente.

export type DocumentFormat = "informe" | "guion" | "post" | "resumen";
const FORMAT_GUIDE: Record<DocumentFormat, string> = {
  informe: "un informe claro con título, introducción, secciones con subtítulos (##), y una conclusión",
  guion: "un guion para un video de 5 a 8 minutos: gancho inicial, bloques numerados con lo que se dice, y un cierre; en tono hablado",
  post: "un post largo para redes o blog, con un titular, párrafos cortos y una lista de ideas clave; tono cercano",
  resumen: "un resumen ejecutivo de una página: lo esencial en viñetas, agrupado por temas",
};

export function spaceSources(spaceId: string): { name: string; videos: AppVideo[] } {
  const space = listSmartSpaces().find((item) => item.id === spaceId);
  if (!space) throw new Error("Espacio no encontrado.");
  const catalog = listCatalogTags();
  const manual = new Set(space.itemIds);
  const videos = listVideos("").filter((video) => manual.has(video.id) || spaceQueryMatches(space.query, video, catalog));
  return { name: space.name, videos };
}

function sourceBlock(video: AppVideo, index: number) {
  const lines = [`[${index}] ${video.title}${video.channel ? ` — ${video.channel}` : ""} (guardado ${video.createdAt.slice(0, 10)})`];
  if (video.summary?.gist) lines.push(`Resumen: ${video.summary.gist}`);
  const points = (video.summary?.sections ?? []).flatMap((section) => section.points.map((point) => point.text)).slice(0, 6);
  if (points.length) lines.push(`Puntos: ${points.join(" · ")}`);
  if (video.summary?.takeaways?.length) lines.push(`Ideas: ${video.summary.takeaways.slice(0, 4).join(" · ")}`);
  const highlights = (video.highlights ?? []).slice(0, 4).map((item) => `«${item.quote}»${item.note ? ` (nota: ${item.note})` : ""}`);
  if (highlights.length) lines.push(`Subrayados: ${highlights.join(" ")}`);
  if (video.note?.content.trim()) lines.push(`Mi nota: ${video.note.content.trim().slice(0, 500)}`);
  if (!video.summary && video.description) lines.push(`Texto: ${video.description.slice(0, 600)}`);
  return lines.join("\n");
}

export async function spaceDocument(spaceId: string, format: DocumentFormat, focus = "") {
  if (getAIProvider() === "none") throw new Error("Configura la IA para crear documentos.");
  const { name, videos } = spaceSources(spaceId);
  const sources = videos.filter((video) => video.summary || video.note?.content || video.description).slice(0, 40);
  if (!sources.length) throw new Error("Este espacio todavía no tiene fuentes con contenido.");
  const context = sources.map((video, index) => sourceBlock(video, index + 1)).join("\n\n");
  const system = `Escribe en español ${FORMAT_GUIDE[format]}, en Markdown, usando solo las fuentes dadas del espacio «${name}». Cita con [n] cada afirmación que venga de una fuente (puedes juntar [1][3]). Conecta ideas entre fuentes, señala coincidencias y desacuerdos, y no inventes datos. No añadas una lista de fuentes al final: se añade aparte.`;
  const prompt = `${focus ? `Enfoque pedido: ${focus}\n\n` : ""}FUENTES:\n${context}`;
  ensureBudget();
  let markdown = "";
  if (getAIProvider() === "openai") {
    const response = await getOpenAI()!.responses.create({ model: TEXT_MODEL, input: [{ role: "system", content: system }, { role: "user", content: prompt }] });
    if (response.usage) recordUsage("space_document", TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICostFor(TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens));
    markdown = response.output_text.trim();
  } else {
    const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction: system } });
    markdown = (response.text || "").trim();
  }
  if (!markdown) throw new Error("La IA no devolvió el documento. Prueba otra vez.");
  const used = new Set([...markdown.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
  const list = sources.map((video, index) => ({ n: index + 1, id: video.id, title: video.title, url: video.url })).filter((item) => used.has(item.n));
  const references = list.map((item) => `[${item.n}] ${item.title}${item.url && !item.url.startsWith("local") ? ` — ${item.url}` : ""}`).join("\n");
  return { name, markdown: `${markdown}\n\n---\n\n**Fuentes**\n\n${references}`, sources: list };
}
