// ¿Cuándo vale más el titular de la IA que el título que trae la fuente?
// Tweets, capturas y comentarios no tienen título (es su primera frase); muchas webs traen títulos SEO
// («Producto - Lema | Sitio»). Videos, PDF, notas y publicaciones de Reddit sí tienen un título de verdad.
// Títulos en otro idioma (japonés, inglés…): LUMINA los muestra en español.
export function looksForeign(title: string) {
  if (/[\u0400-\u04ff\u0590-\u06ff\u0900-\u0dff\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(title)) return true;
  const words = ` ${title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  const hits = (list: string[]) => list.filter((word) => words.includes(` ${word} `)).length;
  const english = hits(["the", "and", "of", "to", "for", "with", "how", "what", "your", "you", "best", "new", "is", "are", "from", "why", "this", "my"]);
  const spanish = hits(["el", "la", "los", "las", "de", "del", "que", "por", "para", "con", "una", "un", "y", "en", "cómo", "qué", "mejores", "sobre"]) + (/[ñáéíóú¿¡]/i.test(title) ? 2 : 0);
  return english >= 1 && spanish === 0;
}

export function prefersAIHeadline(input: { sourceType: string; title: string; url: string; sourceId?: string }) {
  if (input.sourceType === "x" || input.sourceType === "image") return true;
  // Videos y PDF conservan su título, salvo que esté en otro idioma.
  if ((input.sourceType === "youtube" || input.sourceType === "pdf" || input.sourceType === "audio") && looksForeign(input.title)) return true;
  if (input.sourceType === "reddit") return /_c_/.test(input.sourceId || "") || looksForeign(input.title);
  if (input.sourceType !== "web") return false;
  const title = input.title.trim();
  let host = "";
  try { host = new URL(input.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
  return looksForeign(title)
    || title.length < 8
    || title.length > 100
    || /\s[|·–—-]\s/.test(title)
    || (host !== "" && title.toLocaleLowerCase().replace(/^www\./, "") === host.toLocaleLowerCase())
    || /^(inicio|home|página guardada|artículo guardado)$/i.test(title);
}
