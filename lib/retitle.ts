import { getAIProvider, getGemini, getOpenAI, GEMINI_TEXT_MODEL, openAICostFor, recordUsage, TEXT_MODEL, ensureBudget } from "./ai";
import { getDb, refreshVideoSearch } from "./db";
import { prefersAIHeadline } from "./headline";

// Mejora los títulos de lo ya guardado (tweets, capturas, webs con título de relleno): la IA escribe un titular
// a partir del resumen. Se guarda el título anterior en el resumen, por si se quiere volver atrás.

const INSTRUCTION = "Escribe un título en español de 4 a 12 palabras (máximo 80 caracteres) que diga de qué trata esta fuente, como un buen titular: quién hace qué o cuál es el tema. No copies la primera frase, no pongas el nombre de la cuenta como título, sin comillas ni punto final. Responde solo con el título.";

async function headlineFor(input: { title: string; author: string; text: string }) {
  const prompt = `Autor o sitio: ${input.author || "desconocido"}\nTítulo actual: ${input.title}\n\nContenido y resumen:\n${input.text.slice(0, 4_000)}`;
  ensureBudget();
  if (getAIProvider() === "openai") {
    const response = await getOpenAI()!.responses.create({ model: TEXT_MODEL, input: [{ role: "system", content: INSTRUCTION }, { role: "user", content: prompt }] });
    if (response.usage) recordUsage("retitle", TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICostFor(TEXT_MODEL, response.usage.input_tokens, response.usage.output_tokens));
    return response.output_text;
  }
  const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction: INSTRUCTION } });
  return response.text || "";
}

// Un título nuevo para una sola fuente (botón «Otro título» del panel), aunque ya tuviera uno de la IA.
export async function retitleOne(id: string) {
  if (getAIProvider() === "none") throw new Error("Configura la IA para escribir títulos.");
  const db = getDb();
  const row = db.prepare("SELECT title, channel, description, summary_json AS summaryJson FROM videos WHERE id = ?").get(id) as { title: string; channel: string; description: string; summaryJson: string } | undefined;
  if (!row) throw new Error("Fuente no encontrada.");
  const summary = JSON.parse(row.summaryJson || "{}");
  const items = (db.prepare("SELECT text FROM source_items WHERE video_id = ? ORDER BY ordinal LIMIT 6").all(id) as Array<{ text: string }>).map((item) => item.text).join("\n\n");
  const text = [summary.gist, summary.cardSummary, items || row.description].filter(Boolean).join("\n\n");
  const headline = (await headlineFor({ title: row.title, author: row.channel, text: `${text}\n\n(Propón un título distinto a: «${row.title}»)` })).trim().split("\n")[0].replace(/^["«“]|["»”.]+$/g, "").trim().slice(0, 90);
  if (!headline || headline.length < 8) throw new Error("La IA no propuso un título útil. Prueba otra vez.");
  if (!summary.originalTitle) summary.originalTitle = row.title;
  summary.headline = headline;
  db.prepare("UPDATE videos SET title = ?, custom_title = '', summary_json = ?, updated_at = ? WHERE id = ?").run(headline, JSON.stringify(summary), new Date().toISOString(), id);
  refreshVideoSearch(id);
  return headline;
}

export function retitleCandidates() {
  const rows = getDb().prepare("SELECT id, source_type AS sourceType, title, url, youtube_id AS sourceId, channel, description, summary_json AS summaryJson FROM videos WHERE status = 'ready' AND custom_title = '' AND archived_at IS NULL").all() as Array<{ id: string; sourceType: string; title: string; url: string; sourceId: string; channel: string; description: string; summaryJson: string }>;
  return rows.filter((row) => prefersAIHeadline(row) && !JSON.parse(row.summaryJson || "{}").headline);
}

export async function retitleLibrary(options: { dryRun?: boolean; limit?: number } = {}) {
  if (getAIProvider() === "none") throw new Error("Configura la IA para mejorar los títulos.");
  const db = getDb();
  const results: Array<{ id: string; before: string; after: string }> = [];
  for (const row of retitleCandidates().slice(0, options.limit ?? 200)) {
    const summary = JSON.parse(row.summaryJson || "{}");
    const items = (db.prepare("SELECT text FROM source_items WHERE video_id = ? ORDER BY ordinal LIMIT 6").all(row.id) as Array<{ text: string }>).map((item) => item.text).join("\n\n");
    const text = [summary.gist, summary.cardSummary, items || row.description].filter(Boolean).join("\n\n");
    let headline = "";
    try { headline = (await headlineFor({ title: row.title, author: row.channel, text })).trim().split("\n")[0].replace(/^["«“]|["»”.]+$/g, "").trim().slice(0, 90); } catch { headline = ""; }
    if (!headline || headline.length < 8) continue;
    results.push({ id: row.id, before: row.title, after: headline });
    if (options.dryRun) continue;
    summary.headline = headline;
    summary.originalTitle = row.title;
    db.prepare("UPDATE videos SET title = ?, summary_json = ?, updated_at = ? WHERE id = ?").run(headline, JSON.stringify(summary), new Date().toISOString(), row.id);
    refreshVideoSearch(row.id);
  }
  return results;
}
