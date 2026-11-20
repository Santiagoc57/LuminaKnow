import fs from "node:fs";
import { GoogleGenAI } from "@google/genai";
import OpenAI, { toFile } from "openai";
import { getDb } from "./db";
import { getGeminiKey, getOpenAIKey } from "./secrets";
import type { AvailableModel, KnowledgeEntity, KnowledgeRelation, SourceType, Summary, TranscriptCue } from "./types";
import { formatTimestamp, makeId } from "./utils";
import { LIBRARY_TAG_BY_ID, LIBRARY_TAG_CATALOG } from "./canonical-tags";
import { LOCAL_SUMMARY_NOTICE, RETRY_SUMMARY_NOTICE } from "./summary";
import { EARLY_SOURCE_SCHEMA, earlySourcePrompt } from "./source-suggestions";
import { existingFreeTagNames } from "./free-tags";

export const GEMINI_TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash-lite";
export const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001";
// OpenAI, elegidos por precio: GPT-6 Luna para resúmenes, imágenes, chat y etiquetas (0,10/0,50 USD por millón)
// y Nano para lo ligero (chatbot de cada fuente; 0,05/0,40 USD por millón).
export const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-6-luna";
// Las decisiones de etiquetado van con el modelo bueno: con Nano salían etiquetas por la plataforma o por palabras sueltas.
export const TAG_MODEL = process.env.OPENAI_TAG_MODEL || TEXT_MODEL;
export const LIGHT_MODEL = process.env.OPENAI_LIGHT_MODEL || "gpt-5-nano";
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
export const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";

export type AIProvider = "gemini" | "openai" | "none";

// Con clave de OpenAI se usa OpenAI; Gemini queda de respaldo. LUMINA_AI_PROVIDER=gemini fuerza lo contrario.
export function getAIProvider(): AIProvider {
  const preferGemini = process.env.LUMINA_AI_PROVIDER === "gemini";
  if (getOpenAIKey() && !(preferGemini && getGeminiKey())) return "openai";
  if (getGeminiKey()) return "gemini";
  return "none";
}

// Las huellas de búsqueda siguen en Gemini si hay clave (gratis y ya indexadas); si no, OpenAI.
function getEmbeddingProvider(): AIProvider {
  if (getGeminiKey()) return "gemini";
  if (getOpenAIKey()) return "openai";
  return "none";
}

// Precio aproximado en USD por millón de tokens (entrada, salida) para el control de presupuesto.
function openAICost(model: string, input: number, output: number) {
  const prices: Record<string, [number, number]> = { "gpt-6-luna": [0.1, 0.5], "gpt-5.6-luna": [0.2, 1.2], "gpt-5-nano": [0.05, 0.4], "gpt-5-mini": [0.25, 2], "gpt-5.4-nano": [0.2, 1.25], "gpt-5.4-mini": [0.75, 4.5] };
  const [inPrice, outPrice] = prices[model] ?? [1, 6];
  return (input * inPrice + output * outPrice) / 1_000_000;
}

export function hasAIKey() {
  return getAIProvider() !== "none";
}

export function listAvailableModels(): AvailableModel[] {
  const models: AvailableModel[] = [{ id: "auto", label: "Auto", provider: "auto", description: "Usa el proveedor disponible más económico." }];
  if (getGeminiKey()) models.push({ id: "gemini", label: GEMINI_TEXT_MODEL, provider: "gemini", description: "Gemini configurado en este Mac." });
  if (getOpenAIKey()) models.push({ id: "openai", label: TEXT_MODEL, provider: "openai", description: "OpenAI configurado en este Mac." });
  return models;
}

export function resolveModelProvider(modelId: string): AIProvider {
  if (modelId === "auto") return getAIProvider();
  if (modelId === "gemini" && getGeminiKey()) return "gemini";
  if (modelId === "openai" && getOpenAIKey()) return "openai";
  return "none";
}

export function currentEmbeddingModel() {
  const provider = getEmbeddingProvider();
  if (provider === "gemini") return `gemini:${GEMINI_EMBEDDING_MODEL}`;
  if (provider === "openai") return `openai:${EMBEDDING_MODEL}`;
  return "";
}

export function getGemini() {
  const apiKey = getGeminiKey();
  return apiKey ? new GoogleGenAI({ apiKey }) : null;
}

export function getOpenAI() {
  const apiKey = getOpenAIKey();
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export function getMonthlyUsage() {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(estimated_cost), 0) AS cost
    FROM usage_events
    WHERE created_at >= datetime('now', 'start of month')
  `).get() as { cost: number };
  const budget = Number((db.prepare("SELECT value FROM settings WHERE key = 'monthly_budget_usd'").get() as { value?: string } | undefined)?.value || 10);
  return { cost: Number(row.cost || 0), budget };
}

export function ensureBudget() {
  const usage = getMonthlyUsage();
  if (usage.cost >= usage.budget) throw new Error("Se alcanzó el límite mensual de IA.");
}

export function recordUsage(kind: string, model: string, inputUnits: number, outputUnits: number, estimatedCost: number) {
  getDb().prepare(`
    INSERT INTO usage_events(id, kind, model, input_units, output_units, estimated_cost, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("use"), kind, model, inputUnits, outputUnits, estimatedCost, new Date().toISOString());
}

export type BulkTagSuggestion = { videoId: string; tags: Array<{ tagId: string; level: "primary" | "secondary"; confidence: number }> };

export type EarlySourceSuggestion = { title: string; titles: string[]; tagIds: string[]; usedAI: boolean };

const compactTagCatalog = LIBRARY_TAG_CATALOG.map((tag) => ({ id: tag.id, name: tag.name, level: tag.level, parents: tag.parentNames }));

function fallbackCatalogTags(sourceType: SourceType, text: string) {
  const normalized = ` ${text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, " ")} `;
  const scored = LIBRARY_TAG_CATALOG.map((tag) => {
    const words = `${tag.name} ${tag.parentNames.join(" ")}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").split(/\s+/).filter((word) => word.length > 3);
    return { tag, score: words.reduce((score, word) => score + (normalized.includes(` ${word.replace(/[^a-z0-9]+/g, "")} `) ? 1 : 0), 0) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const primary = scored.filter((item) => item.tag.level === "primary").slice(0, 3).map((item) => item.tag.id);
  const secondary = scored.filter((item) => item.tag.level === "secondary").slice(0, 2).map((item) => item.tag.id);
  // Sin evidencia no se inventa nada: antes se ponía «Cultura» o «Redes sociales» por defecto.
  void sourceType;
  return [...primary, ...secondary];
}

function normalizeCatalogTagIds(ids: string[] | undefined, sourceType: SourceType, text: string) {
  const selected = [...new Set(ids || [])].map((id) => LIBRARY_TAG_BY_ID.get(id)).filter(Boolean);
  const primary = selected.filter((tag) => tag!.level === "primary").slice(0, 3).map((tag) => tag!.id);
  const secondary = selected.filter((tag) => tag!.level === "secondary").slice(0, 2).map((tag) => tag!.id);
  // La IA puede dejar sin secundaria lo que no encaja: no se rellena con adivinanzas por palabras.
  return primary.length ? [...primary, ...secondary] : fallbackCatalogTags(sourceType, text);
}

function localEarlySourceSuggestion(input: { title: string; content: string; sourceType: SourceType }) : EarlySourceSuggestion {
  // No presentar el título original (posiblemente en inglés) como una traducción.
  return { title: "", titles: [], tagIds: fallbackCatalogTags(input.sourceType, `${input.title} ${input.content}`), usedAI: false };
}

export async function suggestEarlySourceMetadata(input: { title: string; author: string; content: string; sourceType: SourceType; existingTags?: string[] }): Promise<EarlySourceSuggestion> {
  const fallback = localEarlySourceSuggestion(input);
  const provider = getAIProvider();
  if (provider === "none") return fallback;
  try {
    ensureBudget();
    const prompt = earlySourcePrompt(input);
    const schema = EARLY_SOURCE_SCHEMA;
    let parsed: { titles?: string[]; tagIds?: string[] } = {};
    if (provider === "gemini") {
      const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction: "Eres un bibliotecario digital. Responde únicamente JSON válido y siempre en español.", responseMimeType: "application/json", responseJsonSchema: schema } });
      parsed = JSON.parse(response.text || "{}");
      const usage = response.usageMetadata;
      if (usage) recordUsage("early_tagging", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    } else {
      const response = await getOpenAI()!.responses.create({ model: TAG_MODEL, input: [{ role: "system", content: "Eres un bibliotecario digital. Sugiere títulos y etiquetas útiles en español." }, { role: "user", content: prompt }], text: { format: { type: "json_schema", name: "early_source_metadata", strict: true, schema } } });
      parsed = JSON.parse(response.output_text || "{}");
      if (response.usage) recordUsage("early_tagging", TAG_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICost(TAG_MODEL, response.usage.input_tokens, response.usage.output_tokens));
    }
    const titles = [...new Set((parsed.titles || []).map((candidate) => {
      const rawTitle = candidate.replace(/\s+/g, " ").trim().replace(/^[«“\"']+|[»”\"'.]+$/g, "");
      const wordLimitedTitle = rawTitle.split(" ").slice(0, 12).join(" ");
      return wordLimitedTitle.length <= 90 ? wordLimitedTitle : wordLimitedTitle.slice(0, 90).replace(/\s+\S*$/, "").trim();
    }).filter(Boolean))].slice(0, 3);
    const resolvedTitles = titles.length ? titles : fallback.titles;
    const title = resolvedTitles[0] || "";
    const selected = [...new Set(parsed.tagIds || [])].map((id) => LIBRARY_TAG_BY_ID.get(id)).filter(Boolean);
    const primary = selected.filter((tag) => tag!.level === "primary").slice(0, 3).map((tag) => tag!.id);
    const secondary = selected.filter((tag) => tag!.level === "secondary").slice(0, 2).map((tag) => tag!.id);
    return { title, titles: resolvedTitles, tagIds: primary.length ? [...primary, ...secondary] : fallback.tagIds, usedAI: titles.length > 0 };
  } catch {
    return fallback;
  }
}

export async function suggestLibraryTags(sources: Array<{ id: string; title: string; author: string; content: string }>, interests: string, modelId = "auto"): Promise<BulkTagSuggestion[]> {
  const provider = resolveModelProvider(modelId);
  if (provider === "none") throw new Error("Configura Gemini u OpenAI para usar el etiquetado masivo.");
  ensureBudget();
  const compactSources = sources.map((source) => ({ ...source, content: source.content.slice(0, 6_000) }));
  const prompt = `Intereses del usuario:\n${interests || "Clasifica por los asuntos realmente presentes."}\n\nFUENTES:\n${JSON.stringify(compactSources)}\n\nCATÁLOGO CERRADO:\n${JSON.stringify(compactTagCatalog)}\n\nPara cada fuente devuelve exclusivamente entre 1 y 3 IDs primary y entre 1 y 2 IDs secondary. No inventes IDs. Conserva exactamente cada videoId.`;
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["sources"],
    properties: {
      sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["videoId", "tags"], properties: {
        videoId: { type: "string" },
        tags: { type: "array", items: { type: "object", additionalProperties: false, required: ["tagId", "level", "confidence"], properties: {
          tagId: { type: "string", enum: LIBRARY_TAG_CATALOG.map((tag) => tag.id) }, level: { type: "string", enum: ["primary", "secondary"] }, confidence: { type: "number" },
        } }, minItems: 1, maxItems: 5 },
      } } },
    },
  };
  let parsed: { sources?: BulkTagSuggestion[] } = {};
  if (provider === "gemini") {
    const response = await getGemini()!.models.generateContent({ model: GEMINI_TEXT_MODEL, contents: prompt, config: { systemInstruction: "Eres un bibliotecario digital. Devuelve clasificación consistente en español y únicamente JSON válido.", responseMimeType: "application/json", responseJsonSchema: schema } });
    parsed = JSON.parse(response.text || "{}") as { sources?: BulkTagSuggestion[] };
    const usage = response.usageMetadata;
    if (usage) recordUsage("bulk_tagging", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
  } else {
    const response = await getOpenAI()!.responses.create({ model: TAG_MODEL, input: [{ role: "system", content: "Eres un bibliotecario digital. Clasifica consistentemente en español." }, { role: "user", content: prompt }], text: { format: { type: "json_schema", name: "bulk_tagging", strict: true, schema } } });
    parsed = JSON.parse(response.output_text || "{}") as { sources?: BulkTagSuggestion[] };
    if (response.usage) recordUsage("bulk_tagging", TAG_MODEL, response.usage.input_tokens, response.usage.output_tokens, openAICost(TAG_MODEL, response.usage.input_tokens, response.usage.output_tokens));
  }
  const sourceIds = new Set(sources.map((source) => source.id));
  return (parsed.sources ?? []).filter((source) => sourceIds.has(source.videoId)).map((source) => {
    const unique = [...new Map(source.tags.map((tag) => [tag.tagId, tag])).values()].filter((tag) => LIBRARY_TAG_BY_ID.get(tag.tagId)?.level === tag.level);
    const primary = unique.filter((tag) => tag.level === "primary").slice(0, 3);
    const secondary = unique.filter((tag) => tag.level === "secondary").slice(0, 2);
    const fallbackIds = fallbackCatalogTags("web", `${sources.find((item) => item.id === source.videoId)?.title || ""} ${sources.find((item) => item.id === source.videoId)?.content || ""}`);
    const resolved = primary.length && secondary.length ? [...primary, ...secondary] : fallbackIds.map((tagId) => ({ tagId, level: LIBRARY_TAG_BY_ID.get(tagId)!.level, confidence: 0.55 }));
    return { videoId: source.videoId, tags: resolved.map((tag) => ({ ...tag, confidence: Math.max(0, Math.min(1, Number(tag.confidence) || 0.5)) })) };
  });
}

function fallbackSummary(title: string, description: string, chunks: TranscriptCue[], sourceType: SourceType = "youtube"): { summary: Summary; tags: string[]; topics: string[]; entities: KnowledgeEntity[]; relations: KnowledgeRelation[] } {
  const sample = chunks.slice(0, 5);
  const cardSummarySource = [description, ...sample.slice(0, 2).map((chunk) => chunk.text)].join(" ").replace(/\s+/g, " ").trim();
  const cardSummaryWords = cardSummarySource.split(/\s+/).filter(Boolean);
  const tags = fallbackCatalogTags(sourceType, `${title} ${description}`);
  return {
    summary: {
      gist: description.split("\n")[0]?.slice(0, 280) || `Una exploración de ${title}.`,
      cardSummary: cardSummaryWords.slice(0, 34).join(" ") || `Una exploración clara de ${title}, sus ideas principales y los elementos más útiles para consultarlos después.`,
      sourceTranslation: "",
      sections: sample.map((chunk, index) => ({ title: `Tema ${index + 1}`, points: [{ text: chunk.text.slice(0, 260), startSeconds: chunk.startSeconds }] })),
      keyPoints: sample.map((chunk) => ({ text: chunk.text.slice(0, 220), startSeconds: chunk.startSeconds })),
      chapters: sample.map((chunk, index) => ({ title: `Parte ${index + 1}`, startSeconds: chunk.startSeconds, summary: chunk.text.slice(0, 180) })),
      takeaways: [getAIProvider() === "none" ? LOCAL_SUMMARY_NOTICE : RETRY_SUMMARY_NOTICE],
    },
    tags,
    topics: [],
    entities: sample.slice(0, 5).map((chunk, index) => ({ name: `Idea ${index + 1}: ${title.slice(0, 50)}`, type: "idea" as const, description: chunk.text.slice(0, 180), evidenceTimestamp: chunk.startSeconds })),
    relations: [],
  };
}

function isRecoverableAIError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|quota|rate.?limit|fetch failed|ECONNRESET|ETIMEDOUT|5\d\d/i.test(message);
}

function isInvalidArgumentAIError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /400|INVALID_ARGUMENT|invalid argument/i.test(message);
}

async function summarizeVideoWithProvider(title: string, channel: string, description: string, chunks: TranscriptCue[], sourceType: SourceType = "youtube") {
  const provider = getAIProvider();
  if (provider === "none") return fallbackSummary(title, description, chunks, sourceType);
  ensureBudget();
  const transcript = chunks.map((chunk) => `[${formatTimestamp(chunk.startSeconds)}] ${chunk.text}`).join("\n").slice(0, 500_000);
  // OpenAI (modo estricto) exige additionalProperties: false en cada objeto, también en la raíz.
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["headline", "gist", "cardSummary", "sourceTranslation", "sections", "keyPoints", "chapters", "takeaways", "tags", "topics", "entities", "relations"],
    properties: {
      headline: { type: "string" },
      gist: { type: "string" },
      cardSummary: { type: "string" },
      sourceTranslation: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["title", "points"],
          properties: {
            title: { type: "string" },
            points: {
              type: "array",
              items: {
                type: "object", required: ["text", "startSeconds"],
                properties: { text: { type: "string" }, startSeconds: { type: "number" } }, additionalProperties: false,
              },
            },
          },
        },
      },
      keyPoints: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["text", "startSeconds"],
          properties: { text: { type: "string" }, startSeconds: { type: "number" } },
        },
      },
      chapters: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["title", "startSeconds", "summary"],
          properties: { title: { type: "string" }, startSeconds: { type: "number" }, summary: { type: "string" } },
        },
      },
      takeaways: { type: "array", items: { type: "string" } },
      tags: { type: "array", minItems: 1, maxItems: 5, items: { type: "string", enum: LIBRARY_TAG_CATALOG.map((tag) => tag.id) } },
      topics: { type: "array", maxItems: 8, items: { type: "string" } },
      entities: {
        type: "array",
        items: {
          type: "object", required: ["name", "type", "description", "evidenceTimestamp"],
          properties: {
            name: { type: "string" },
            type: { type: "string", enum: ["person", "organization", "tool", "place", "concept", "idea"] },
            description: { type: "string" },
            evidenceTimestamp: { type: "number" },
          }, additionalProperties: false,
        },
      },
      relations: {
        type: "array",
        items: {
          type: "object", required: ["sourceName", "targetName", "relationType", "explanation", "evidenceTimestamp"],
          properties: {
            sourceName: { type: "string" }, targetName: { type: "string" }, relationType: { type: "string" },
            explanation: { type: "string" }, evidenceTimestamp: { type: "number" },
          }, additionalProperties: false,
        },
      },
    },
  };
  const sourceLabel = sourceType === "x" ? "Publicación pública de X" : sourceType === "reddit" ? "Publicación e hilo público de Reddit" : sourceType === "web" ? "Artículo o página web pública" : "Video de YouTube";
  const prompt = `Tipo de fuente: ${sourceLabel}\nTítulo: ${title}\nAutor o canal: ${channel}\nDescripción: ${description.slice(0, 5000)}\n\nCONTENIDO:\n${transcript}\n\nCATÁLOGO CERRADO DE ETIQUETAS:\n${JSON.stringify(compactTagCatalog)}\n\nETIQUETAS LIBRES QUE YA EXISTEN (reutilízalas si encajan): ${JSON.stringify(existingFreeTagNames(150))}\n\nEn topics devuelve entre 3 y 8 etiquetas libres, cortas (1 a 3 palabras), concretas y en español salvo nombres propios: personas, lugares, marcas, herramientas, eventos o temas específicos que no estén ya en el catálogo. Usa mayúscula inicial solo en nombres propios. Si una existente encaja, escríbela exactamente igual.\n\nEn tags devuelve exclusivamente entre 1 y 3 IDs primary y entre 0 y 2 IDs secondary del catálogo (secondary solo si encaja con claridad). Etiqueta solo por el TEMA PRINCIPAL de la fuente, nunca por la plataforma ni el formato: que sea un tweet, un post de Reddit o un video no la convierte en «Redes sociales», «Comunicación» ni «Audiovisual»; una palabra mencionada de pasada (por ejemplo «estudié mercadeo») no justifica «Marketing». Pregúntate: ¿alguien que busque esta etiqueta esperaría encontrar esta fuente? Si dudas, no la pongas. Mejor una sola etiqueta certera que varias dudosas. Las etiquetas libres (topics) siguen la misma regla: nada de etiquetas por la plataforma.`;
  const cardSummaryInstruction = "En headline escribe un título en español de 4 a 12 palabras (máximo 80 caracteres) que diga de qué trata la fuente, como un buen titular: quién hace qué o cuál es el tema (por ejemplo «Milei responde con un comentario absurdo sobre sirenas en una entrevista»). No copies la primera frase, no pongas el nombre de la cuenta como título, sin comillas ni punto final. En cardSummary escribe un único párrafo en español de 26 a 34 palabras, concreto y fluido, pensado para ocupar aproximadamente tres líneas en una tarjeta. Explica la idea central y uno o dos aspectos útiles; no uses encabezados, listas, frases de relleno ni termines una idea a medias.";
  const systemInstruction = sourceType !== "youtube"
    ? `Analiza esta ${sourceType === "reddit" ? "publicación y sus comentarios públicos de Reddit" : sourceType === "web" ? "página o artículo web, respetando sus secciones" : "publicación de X"} con rigor. Todos los campos de salida deben estar siempre en español natural, aunque la fuente esté en otro idioma. No la alargues artificialmente ni inventes contexto. En sourceTranslation devuelve una traducción fiel al español del contenido cuando el original esté en otro idioma; conserva párrafos y encabezados, y si ya está en español devuelve una cadena vacía. ${sourceType === "web" ? "En gist escribe una sola frase breve, concreta y funcional —entre 7 y 18 palabras— que diga para qué sirve esa web o herramienta." : "Resume su afirmación central, argumentos, datos y matices presentes."} ${cardSummaryInstruction} Crea entre 1 y 6 secciones temáticas, entre 1 y 8 ideas clave y entre 1 y 5 conclusiones. En tags usa solamente IDs del catálogo aportado. Usa startSeconds para indicar el ordinal de la ${sourceType === "web" ? "sección del artículo" : "publicación o comentario"} que sustenta cada evidencia.`
    : `Analiza videos con rigor y escribe en español natural. Devuelve sourceTranslation como cadena vacía. ${cardSummaryInstruction} Crea un resumen detallado de 3 a 8 secciones temáticas con títulos específicos. Cada sección debe contener entre 2 y 5 puntos completos con timestamps exactos. Cubre proporcionalmente todo el video y no inventes información ausente. Genera además entre 3 y 8 ideas clave, entre 2 y 12 capítulos y entre 2 y 6 conclusiones. En tags usa solamente IDs del catálogo aportado.`;

  if (provider === "gemini") {
    const client = getGemini()!;
    let response;
    try {
      response = await client.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: prompt,
        config: { systemInstruction, responseMimeType: "application/json", responseJsonSchema: schema },
      });
    } catch (error) {
      if (!isInvalidArgumentAIError(error)) throw error;
      response = await client.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: `${prompt}\n\nDevuelve un objeto JSON con estas claves exactas: headline (string), gist (string), cardSummary (string), sourceTranslation (string), sections ({title,points:{text,startSeconds}[]}[]), keyPoints ({text,startSeconds}[]), chapters ({title,startSeconds,summary}[]), takeaways (string[]), tags (string[]), topics (string[]), entities ({name,type,description,evidenceTimestamp}[]) y relations ({sourceName,targetName,relationType,explanation,evidenceTimestamp}[]).`,
        config: { systemInstruction, responseMimeType: "application/json" },
      });
    }
    const parsed = JSON.parse(response.text || "{}") as Summary & { tags: string[]; topics?: string[]; entities: KnowledgeEntity[]; relations: KnowledgeRelation[] };
    const usage = response.usageMetadata;
    if (usage) recordUsage("summary", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    return {
      summary: { headline: typeof parsed.headline === "string" ? parsed.headline.trim().replace(/[.«»"]+$/g, "").slice(0, 90) : "", gist: parsed.gist, cardSummary: parsed.cardSummary, sourceTranslation: parsed.sourceTranslation, sections: parsed.sections, keyPoints: parsed.keyPoints, chapters: parsed.chapters, takeaways: parsed.takeaways },
      tags: normalizeCatalogTagIds(parsed.tags, sourceType, `${title} ${description}`),
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter((topic) => typeof topic === "string") : [],
      entities: parsed.entities,
      relations: parsed.relations,
    };
  }

  const client = getOpenAI()!;
  const response = await client.responses.create({
    model: TEXT_MODEL,
    input: [
      {
        role: "system",
        content: systemInstruction,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "video_summary",
        strict: true,
        schema,
      },
    },
  });
  const parsed = JSON.parse(response.output_text) as Summary & { tags: string[]; topics?: string[]; entities: KnowledgeEntity[]; relations: KnowledgeRelation[] };
  const usage = response.usage;
  if (usage) recordUsage("summary", TEXT_MODEL, usage.input_tokens, usage.output_tokens, openAICost(TEXT_MODEL, usage.input_tokens, usage.output_tokens));
  return {
    summary: { headline: typeof parsed.headline === "string" ? parsed.headline.trim().replace(/[.«»"]+$/g, "").slice(0, 90) : "", gist: parsed.gist, cardSummary: parsed.cardSummary, sourceTranslation: parsed.sourceTranslation, sections: parsed.sections, keyPoints: parsed.keyPoints, chapters: parsed.chapters, takeaways: parsed.takeaways },
    tags: normalizeCatalogTagIds(parsed.tags, sourceType, `${title} ${description}`),
    topics: Array.isArray(parsed.topics) ? parsed.topics.filter((topic) => typeof topic === "string") : [],
    entities: parsed.entities,
    relations: parsed.relations,
  };
}

export async function summarizeVideo(title: string, channel: string, description: string, chunks: TranscriptCue[], sourceType: SourceType = "youtube") {
  try {
    return await summarizeVideoWithProvider(title, channel, description, chunks, sourceType);
  } catch (firstError) {
    // Que un fallo de la IA no quede en silencio: el resumen de respaldo solo copia el texto.
    console.warn("[LUMINA] El resumen con IA falló:", firstError instanceof Error ? firstError.message.slice(0, 500) : firstError);
    (globalThis as { __luminaLastSummaryError?: unknown }).__luminaLastSummaryError = firstError;
    // El nivel gratuito de Gemini rechaza ráfagas: se espera un poco y se intenta otra vez antes de rendirse.
    if (!isRecoverableAIError(firstError)) {
      if (isInvalidArgumentAIError(firstError) || firstError instanceof SyntaxError) return fallbackSummary(title, description, chunks, sourceType);
      throw firstError;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.LUMINA_AI_RETRY_MS ?? 25_000)));
  try {
    return await summarizeVideoWithProvider(title, channel, description, chunks, sourceType);
  } catch (error) {
    if (isRecoverableAIError(error) || isInvalidArgumentAIError(error) || error instanceof SyntaxError) return fallbackSummary(title, description, chunks, sourceType);
    throw error;
  }
}

async function embedTextsWithProvider(texts: string[], purpose: "document" | "query" = "document") {
  const provider = getEmbeddingProvider();
  if (provider === "none" || !texts.length) return texts.map(() => null);
  ensureBudget();
  const output: Array<number[] | null> = [];
  for (let offset = 0; offset < texts.length; offset += 100) {
    const batch = texts.slice(offset, offset + 100);
    if (provider === "gemini") {
      const response = await getGemini()!.models.embedContent({
        model: GEMINI_EMBEDDING_MODEL,
        contents: batch,
        config: { taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT", outputDimensionality: 1536 },
      });
      output.push(...(response.embeddings ?? []).map((item) => item.values ?? null));
      recordUsage("embedding", GEMINI_EMBEDDING_MODEL, 0, 0, 0);
    } else {
      const response = await getOpenAI()!.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
      output.push(...response.data.map((item) => item.embedding));
      recordUsage("embedding", EMBEDDING_MODEL, response.usage.total_tokens, 0, response.usage.total_tokens * 0.02 / 1_000_000);
    }
  }
  return output;
}

export async function embedTexts(texts: string[], purpose: "document" | "query" = "document") {
  try {
    return await embedTextsWithProvider(texts, purpose);
  } catch (error) {
    if (isRecoverableAIError(error)) return texts.map(() => null);
    throw error;
  }
}

export function openAICostFor(model: string, input: number, output: number) { return openAICost(model, input, output); }

export async function transcribeFiles(files: string[], segmentSeconds = 300) {
  const provider = getAIProvider();
  if (provider === "none") throw new Error("Configura una clave de OpenAI o Gemini antes de transcribir audio.");
  ensureBudget();
  const segments: TranscriptCue[] = [];
  for (let index = 0; index < files.length; index += 1) {
    let text = "";
    if (provider === "gemini") {
      const response = await getGemini()!.models.generateContent({
        model: GEMINI_TEXT_MODEL,
        contents: [
          { text: "Transcribe fielmente todo el habla de este audio en su idioma original. Devuelve únicamente la transcripción, sin comentarios ni formato adicional." },
          { inlineData: { mimeType: files[index].endsWith(".m4a") ? "audio/mp4" : "audio/mp3", data: fs.readFileSync(files[index], { encoding: "base64" }) } },
        ],
      });
      text = response.text?.trim() || "";
      const usage = response.usageMetadata;
      if (usage) recordUsage("transcription", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    } else {
      const transcription = await getOpenAI()!.audio.transcriptions.create({
        model: TRANSCRIPTION_MODEL,
        file: fs.createReadStream(files[index]),
      });
      text = transcription.text.trim();
      recordUsage("transcription", TRANSCRIPTION_MODEL, segmentSeconds, 0, segmentSeconds / 60 * (TRANSCRIPTION_MODEL.includes("mini") ? 0.003 : 0.006));
    }
    const startSeconds = index * segmentSeconds;
    segments.push({ startSeconds, endSeconds: startSeconds + segmentSeconds, text });
  }
  return segments.filter((segment) => segment.text);
}

// Dictado corto (el micrófono del lector fantasma): un clip de voz grabado en el navegador, pasado a texto.
export async function transcribeDictation(audio: Buffer, mimeType: string) {
  const provider = getAIProvider();
  if (provider === "none") throw new Error("Configura una clave de OpenAI o Gemini para dictar.");
  ensureBudget();
  const seconds = Math.max(1, Math.round(audio.length / 16_000));
  if (provider === "gemini") {
    const response = await getGemini()!.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: [
        { text: "Transcribe fielmente lo que dice esta persona, en su idioma. Devuelve solo el texto, sin comillas ni comentarios." },
        { inlineData: { mimeType: mimeType.split(";")[0] || "audio/webm", data: audio.toString("base64") } },
      ],
    });
    const usage = response.usageMetadata;
    if (usage) recordUsage("transcription", GEMINI_TEXT_MODEL, usage.promptTokenCount || 0, usage.candidatesTokenCount || 0, 0);
    return response.text?.trim() || "";
  }
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  const transcription = await getOpenAI()!.audio.transcriptions.create({ model: TRANSCRIPTION_MODEL, file: await toFile(audio, `dictado.${extension}`, { type: mimeType.split(";")[0] }) });
  recordUsage("transcription", TRANSCRIPTION_MODEL, seconds, 0, seconds / 60 * (TRANSCRIPTION_MODEL.includes("mini") ? 0.003 : 0.006));
  return transcription.text.trim();
}
