import { ensureBudget, GEMINI_TEXT_MODEL, getGemini, getOpenAI, LIGHT_MODEL, openAICostFor, recordUsage, resolveModelProvider } from "./ai";
import { getVideo, getVideoTranscript } from "./data";
import { buildGhostPrompt, GHOST_SYSTEM_INSTRUCTION, type GhostAction } from "./ghost-prompt";

export async function askGhostReader(input: { videoId: string; action: GhostAction; selection: string; question: string }) {
  const video = getVideo(input.videoId);
  if (!video) throw new Error("Fuente no encontrada.");
  const provider = resolveModelProvider("auto");
  if (provider === "none") throw new Error("Añade una clave de IA en Ajustes para usar el chatbot.");
  ensureBudget();
  const transcript = getVideoTranscript(video.id) as Array<{ text: string }>;
  const corpus = [
    ...video.sourceItems.map((item) => item.text),
    ...transcript.map((chunk) => chunk.text),
    video.description,
    video.sourceType === "note" ? video.note?.content : "",
    video.visual?.description,
    video.visual?.text,
  ].filter(Boolean).join("\n\n");
  // El resumen ya está en español y cubre todo: es la base más fiable aunque la transcripción venga en otro idioma.
  const summary = video.summary;
  const outline = summary ? [
    ...(summary.chapters ?? []).map((chapter) => `- ${chapter.title}: ${chapter.summary}`),
    ...(summary.sections ?? []).map((section) => `- ${section.title}: ${section.points.map((point) => point.text).join(" ")}`),
    ...(summary.keyPoints ?? []).map((point) => `- ${point.text}`),
    ...(summary.takeaways ?? []).map((takeaway) => `- Conclusión: ${takeaway}`),
  ].join("\n").slice(0, 6_000) : "";
  const prompt = buildGhostPrompt({ action: input.action, title: video.title, author: video.channel, gist: summary?.gist || "", corpus, selection: input.selection, question: input.question, outline });
  let answer = "";
  try {
    if (provider === "gemini") {
      const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction: GHOST_SYSTEM_INSTRUCTION } });
      answer = response.text?.trim() || "";
      const usage = response.usageMetadata;
      if (usage) recordUsage("ghost_reader", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    } else {
      const response = await getOpenAI()!.responses.create({ model: LIGHT_MODEL, input: [{ role: "system", content: GHOST_SYSTEM_INSTRUCTION }, { role: "user", content: prompt }] });
      answer = response.output_text.trim();
      if (response.usage) recordUsage("ghost_reader", LIGHT_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICostFor(LIGHT_MODEL, response.usage.input_tokens, response.usage.output_tokens));
    }
  } catch {
    throw new Error("El proveedor de IA no respondió. Intenta de nuevo en un momento.");
  }
  if (!answer) throw new Error("La IA no devolvió una respuesta. Intenta de nuevo.");
  return answer;
}
