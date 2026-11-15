import { LIBRARY_TAG_CATALOG } from "./canonical-tags";
import { ensureBudget, getAIProvider, getOpenAI, recordUsage } from "./ai";

// Etiquetado con la API Decisions de OpenAI (gpt-6-luna): por cada etiqueta del catálogo devuelve la
// probabilidad de que sea el tema de la fuente. Así el criterio es un umbral claro y no una lista que el
// modelo rellena para cumplir. Solo cobra la entrada (0,10 USD por millón de tokens).
export const DECISIONS_MODEL = process.env.OPENAI_DECISIONS_MODEL || "gpt-6-luna";
const PRIMARY_THRESHOLD = 0.6;
const SECONDARY_THRESHOLD = 0.65;

type PredicateAnswer = { type: string; name: string; probability?: number };
type DecisionsResponse = { answers?: PredicateAnswer[]; usage?: { input_tokens?: number } };

export type TagDecision = { tagId: string; probability: number };

export function pickDecidedTags(answers: TagDecision[]) {
  const byId = new Map(LIBRARY_TAG_CATALOG.map((tag) => [tag.id, tag]));
  const ranked = [...answers].sort((a, b) => b.probability - a.probability);
  const primary = ranked.filter((answer) => byId.get(answer.tagId)?.level === "primary");
  const secondary = ranked.filter((answer) => byId.get(answer.tagId)?.level === "secondary");
  const chosenPrimary = primary.filter((answer) => answer.probability >= PRIMARY_THRESHOLD).slice(0, 3);
  // Siempre al menos el tema más probable, si tiene un mínimo de evidencia.
  if (!chosenPrimary.length && primary[0] && primary[0].probability >= 0.35) chosenPrimary.push(primary[0]);
  const chosenSecondary = secondary.filter((answer) => answer.probability >= SECONDARY_THRESHOLD).slice(0, 2);
  // Una subetiqueta arrastra su tema: «Carrera» sin «Productividad y carrera» quedaría huérfana.
  const ids = chosenPrimary.map((answer) => answer.tagId);
  for (const answer of chosenSecondary) {
    const parents = byId.get(answer.tagId)?.parentNames ?? [];
    if (parents.some((name) => ids.some((id) => byId.get(id)?.name === name))) continue;
    const parent = primary.find((candidate) => parents.includes(byId.get(candidate.tagId)?.name || ""));
    if (parent && ids.length < 3) ids.push(parent.tagId);
  }
  return [...ids, ...chosenSecondary.map((answer) => answer.tagId)];
}

export async function decideCatalogTags(input: { title: string; author: string; summary: string; content: string }): Promise<string[] | null> {
  if (getAIProvider() !== "openai") return null;
  ensureBudget();
  // La regla va una sola vez en la entrada; cada pregunta queda corta (son 133 y se cobran como entrada).
  const evidence = `Criterio: una etiqueta corresponde solo si es el asunto del que realmente trata la fuente; no cuenta la plataforma ni el formato (ser un tweet no la hace «Redes sociales») ni las palabras mencionadas de pasada.\n\nTítulo: ${input.title}\nAutor: ${input.author || "desconocido"}\nResumen: ${input.summary}\n\nContenido (extracto):\n${input.content.slice(0, 4_000)}`;
  const ask = async (tags: typeof LIBRARY_TAG_CATALOG) => {
    if (!tags.length) return [] as TagDecision[];
    const questions = tags.map((tag) => ({ type: "predicate", name: tag.id, instructions: `¿Trata de «${tag.name}»${tag.parentNames.length ? ` (${tag.parentNames.join(" / ")})` : ""}?` }));
    const response = await getOpenAI()!.post<DecisionsResponse>("/decisions", { body: { model: DECISIONS_MODEL, input: evidence, questions } });
    const tokens = response.usage?.input_tokens ?? 0;
    recordUsage("tag_decisions", DECISIONS_MODEL, tokens, 0, tokens * 0.1 / 1_000_000);
    return (response.answers ?? []).filter((answer) => answer.type === "predicate" && typeof answer.probability === "number").map((answer) => ({ tagId: answer.name, probability: answer.probability! }));
  };
  try {
    // Dos pasos (se cobra la fuente con cada pregunta): primero los 15 temas, luego solo las subetiquetas de los temas probables.
    const primaries = await ask(LIBRARY_TAG_CATALOG.filter((tag) => tag.level === "primary"));
    if (!primaries.length) return null;
    const likely = new Set(primaries.filter((answer) => answer.probability >= 0.05).sort((a, b) => b.probability - a.probability).slice(0, 4).map((answer) => LIBRARY_TAG_CATALOG.find((tag) => tag.id === answer.tagId)?.name));
    const secondaries = await ask(LIBRARY_TAG_CATALOG.filter((tag) => tag.level === "secondary" && tag.parentNames.some((name) => likely.has(name))));
    return pickDecidedTags([...primaries, ...secondaries]);
  } catch (error) {
    console.warn("[LUMINA] Decisions no respondió; se usan las etiquetas del resumen:", error instanceof Error ? error.message.slice(0, 300) : error);
    return null;
  }
}
