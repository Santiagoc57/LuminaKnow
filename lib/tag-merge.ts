import { getDb, refreshVideoSearch } from "./db";

// Etiquetas que dicen lo mismo con otras palabras: «Terapia» y «terapia cognitivo-conductual», «Diseño web» y «diseño-web».
// Solo se proponen; nada se une sin que lo confirmes.

type TagRow = { id: string; name: string; level: string; uses: number };
export type SimilarTagPair = { keep: { id: string; name: string; uses: number; catalog: boolean }; merge: { id: string; name: string; uses: number; catalog: boolean }; reason: string };

const STOP = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "a", "para", "con", "por", "the", "of", "and"]);

function fold(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es").replace(/[-_/]+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}

function stem(word: string) {
  if (word.length > 5 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function words(name: string) {
  return fold(name).split(" ").filter((word) => word && !STOP.has(word)).map(stem);
}

const isCatalog = (tag: TagRow) => tag.level === "primary" || tag.level === "secondary";

export function similarTagPairs(limit = 40): SimilarTagPair[] {
  const tags = getDb().prepare(`
    SELECT t.id, t.name, t.level, COUNT(vt.video_id) AS uses
    FROM tags t LEFT JOIN video_tags vt ON vt.tag_id = t.id
    WHERE t.active = 1 AND t.archived_at IS NULL
    GROUP BY t.id
  `).all() as TagRow[];
  const pairs: Array<SimilarTagPair & { score: number }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < tags.length; i += 1) {
    for (let j = i + 1; j < tags.length; j += 1) {
      const a = tags[i];
      const b = tags[j];
      // Dos etiquetas del catálogo nunca se proponen: el catálogo ya está pensado.
      if (isCatalog(a) && isCatalog(b)) continue;
      if (!a.uses && !b.uses) continue;
      const wa = words(a.name);
      const wb = words(b.name);
      if (!wa.length || !wb.length) continue;
      let reason = "";
      let score = 0;
      if (wa.join(" ") === wb.join(" ")) { reason = "Se escriben casi igual"; score = 3; }
      else {
        const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
        const contained = short.every((word) => long.includes(word));
        // «Terapia» dentro de «terapia cognitiva»: solo entre etiquetas libres (unir una libre específica en un tema
        // del catálogo perdería justo el detalle que aporta) y con una sola palabra de diferencia.
        if (!isCatalog(a) && !isCatalog(b) && contained && short.join("").length >= 5 && long.length - short.length === 1) { reason = "Una está dentro de la otra"; score = 2; }
      }
      if (!reason) continue;
      // Se conserva la del catálogo; si no, la más usada; a igualdad, la más corta (más general).
      const keepA = isCatalog(a) !== isCatalog(b) ? isCatalog(a) : a.uses !== b.uses ? a.uses > b.uses : a.name.length <= b.name.length;
      const keep = keepA ? a : b;
      const merge = keepA ? b : a;
      const key = `${keep.id}|${merge.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ keep: { id: keep.id, name: keep.name, uses: keep.uses, catalog: isCatalog(keep) }, merge: { id: merge.id, name: merge.name, uses: merge.uses, catalog: isCatalog(merge) }, reason, score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score || (y.keep.uses + y.merge.uses) - (x.keep.uses + x.merge.uses)).slice(0, limit).map(({ score: _score, ...pair }) => pair);
}

// Pasa las fuentes de «merge» a «keep» y borra «merge». Una etiqueta del catálogo nunca se borra.
export function mergeTags(keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new Error("Elige dos etiquetas distintas.");
  const db = getDb();
  const keep = db.prepare("SELECT id, level FROM tags WHERE id = ?").get(keepId) as { id: string; level: string } | undefined;
  const merge = db.prepare("SELECT id, level FROM tags WHERE id = ?").get(mergeId) as { id: string; level: string } | undefined;
  if (!keep || !merge) throw new Error("Una de las etiquetas ya no existe.");
  if (merge.level === "primary" || merge.level === "secondary") throw new Error("Las etiquetas del catálogo no se pueden fundir en otra.");
  const videoIds = (db.prepare("SELECT video_id AS id FROM video_tags WHERE tag_id = ?").all(mergeId) as Array<{ id: string }>).map((row) => row.id);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence) SELECT video_id, ?, origin, confidence FROM video_tags WHERE tag_id = ?").run(keepId, mergeId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(mergeId);
  })();
  videoIds.forEach((id) => refreshVideoSearch(id));
  return { moved: videoIds.length };
}
