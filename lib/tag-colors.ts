// Colors belong to catalog identities, never to their position in a card.
const TAG_COLORS: Record<string, string> = {
  tag_primary_inteligencia_artificial: "#df4519",
  tag_primary_tecnologia_y_desarrollo: "#1769e0",
  tag_primary_diseno_grafico: "#d62976",
  tag_primary_audiovisual: "#c05212",
  tag_primary_politica: "#d72e42",
  tag_primary_filosofia: "#7c3aed",
  tag_primary_historia: "#ad6508",
  tag_primary_economia_y_negocios: "#60820a",
  tag_primary_cultura_y_sociedad: "#ba2bad",
  tag_primary_ciencia: "#008575",
  tag_primary_salud_y_bienestar: "#008651",
  tag_primary_educacion: "#13832a",
  tag_primary_productividad_y_carrera: "#727c08",
  tag_primary_comunicacion_y_medios: "#c33b63",
  tag_primary_entretenimiento_y_deportes: "#9539d5",
  tag_secondary_agentes: "#7c3aed",
  tag_secondary_skills: "#b52acb",
  tag_secondary_prompts: "#b76a00",
  tag_secondary_ui_ux: "#008775",
};

const SECONDARY_COLORS = ["#1769e0", "#d62976", "#7c3aed", "#008575", "#d72e42", "#ad6508", "#13832a", "#ba2bad", "#c05212", "#067ea4", "#5146d9", "#c33b63"];

export function catalogTagColor(catalogKey: string): string {
  if (TAG_COLORS[catalogKey]) return TAG_COLORS[catalogKey];
  let hash = 0;
  for (const character of catalogKey) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return SECONDARY_COLORS[hash % SECONDARY_COLORS.length];
}
