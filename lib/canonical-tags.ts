import { catalogTagColor } from "./tag-colors";

export type LibraryTagLevel = "primary" | "secondary";

type PrimaryTagDefinition = { catalogKey: string; name: string; color: string; children: readonly string[] };

const PRIMARY_TAG_DEFINITIONS: readonly PrimaryTagDefinition[] = [
  { catalogKey: "tag_primary_inteligencia_artificial", name: "Inteligencia artificial", color: "#e65c3b", children: ["Modelos generativos", "Agentes", "Skills", "Automatización", "Prompts", "Imagen con IA", "Video con IA", "Texto a video", "Avatares digitales", "Voz y clonación", "Datos y entrenamiento"] },
  { catalogKey: "tag_primary_tecnologia_y_desarrollo", name: "Tecnología", color: "#59758d", children: ["Desarrollo web", "Apps y software", "Programación", "Datos y bases", "Ciberseguridad", "Hardware", "Infraestructura y nube", "Código abierto", "Automatización"] },
  { catalogKey: "tag_primary_diseno_grafico", name: "Diseño gráfico", color: "#a56378", children: ["Marca y logo", "Tipografía", "Diseño editorial", "Ilustración y 3D", "UI/UX", "Pósteres y visuales", "Storyboard y personajes", "Herramientas de diseño", "Imagen con IA", "Motion graphics", "Avatares digitales", "Creatividad"] },
  { catalogKey: "tag_primary_audiovisual", name: "Audiovisual", color: "#aa724d", children: ["Producción de video", "Edición y montaje", "Motion graphics", "Cinematografía", "Fotografía", "Sonido y música", "Guion y narrativa", "Animación", "Video con IA", "Texto a video", "Avatares digitales", "Voz y clonación", "Storyboard y personajes"] },
  { catalogKey: "tag_primary_politica", name: "Política", color: "#c45f43", children: ["Ideologías", "Elecciones", "Instituciones", "Políticas públicas", "Geopolítica", "Comunicación política", "Batalla cultural", "Derechos y libertades", "Libertad", "Medios y opinión pública"] },
  { catalogKey: "tag_primary_filosofia", name: "Filosofía", color: "#706485", children: ["Ética", "Epistemología", "Metafísica", "Filosofía política", "Libertad", "Pensamiento crítico", "Filosofía de la ciencia", "Batalla cultural", "Historia de las ideas"] },
  { catalogKey: "tag_primary_historia", name: "Historia", color: "#9b7857", children: ["Historia antigua", "Historia medieval", "Historia moderna", "Historia contemporánea", "América Latina", "Colombia", "Guerras y conflictos", "Historia de las ideas"] },
  { catalogKey: "tag_primary_economia_y_negocios", name: "Economía", color: "#7f7653", children: ["Macroeconomía", "Finanzas e inversión", "Impuestos", "Comercio", "Emprendimiento", "Estrategia empresarial", "Marketing y ventas", "Producto y modelos de negocio"] },
  { catalogKey: "tag_primary_cultura_y_sociedad", name: "Cultura", color: "#8a6f68", children: ["Identidad y género", "Religión", "Medios y opinión pública", "Movimientos sociales", "Demografía", "Tendencias y comunidades", "Batalla cultural", "Vida cotidiana"] },
  { catalogKey: "tag_primary_ciencia", name: "Ciencia", color: "#50817d", children: ["Física", "Biología", "Química", "Psicología", "Medio ambiente", "Espacio", "Método científico", "Investigación"] },
  { catalogKey: "tag_primary_salud_y_bienestar", name: "Salud", color: "#6f8a7f", children: ["Nutrición", "Ejercicio", "Salud mental", "Sueño", "Medicina", "Prevención", "Hábitos", "Relaciones"] },
  { catalogKey: "tag_primary_educacion", name: "Educación", color: "#63826b", children: ["Aprendizaje", "Pedagogía", "Cursos y formación", "Lectura", "Escritura", "Investigación", "Habilidades", "Idiomas"] },
  { catalogKey: "tag_primary_productividad_y_carrera", name: "Productividad", color: "#6f7f55", children: ["Organización", "Gestión del tiempo", "Notas y conocimiento personal", "Flujos de trabajo", "Hábitos", "Creatividad", "Carrera", "Liderazgo", "Automatización"] },
  { catalogKey: "tag_primary_comunicacion_y_medios", name: "Comunicación", color: "#7e6857", children: ["Periodismo", "Redes sociales", "Publicidad", "Copywriting", "Storytelling", "Oratoria", "Podcasting", "Medios y opinión pública", "Marketing y ventas"] },
  { catalogKey: "tag_primary_entretenimiento_y_deportes", name: "Entretenimiento", color: "#8b6c88", children: ["Cine y series", "Literatura", "Música", "Videojuegos", "Fútbol", "Otros deportes", "Cultura popular", "Reseñas y recomendaciones"] },
] as const;

export const LIBRARY_TAG_TAXONOMY = PRIMARY_TAG_DEFINITIONS.map((tag) => ({ ...tag, color: catalogTagColor(tag.catalogKey) }));

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export const CANONICAL_LIBRARY_TAGS = LIBRARY_TAG_TAXONOMY.map((item) => item.name);
export const CANONICAL_TAG_COLORS = LIBRARY_TAG_TAXONOMY.map((item) => item.color);

const secondaryParents = new Map<string, string[]>();
LIBRARY_TAG_TAXONOMY.forEach((parent) => parent.children.forEach((child) => {
  const parents = secondaryParents.get(child) || [];
  if (!parents.includes(parent.name)) parents.push(parent.name);
  secondaryParents.set(child, parents);
}));

export type LibraryTagCatalogEntry = {
  id: string;
  name: string;
  color: string;
  level: LibraryTagLevel;
  sortOrder: number;
  parentNames: string[];
};

export const LIBRARY_TAG_CATALOG: LibraryTagCatalogEntry[] = [
  ...LIBRARY_TAG_TAXONOMY.map((item, index) => ({ id: item.catalogKey, name: item.name, color: item.color, level: "primary" as const, sortOrder: index, parentNames: [] })),
  ...[...secondaryParents.entries()].map(([name, parentNames], index) => {
    const id = `tag_secondary_${slug(name)}`;
    return { id, name, color: catalogTagColor(id), level: "secondary" as const, sortOrder: index, parentNames };
  }),
];

export const LIBRARY_TAG_BY_ID = new Map(LIBRARY_TAG_CATALOG.map((tag) => [tag.id, tag]));
export const LIBRARY_TAG_BY_NAME = new Map(LIBRARY_TAG_CATALOG.map((tag) => [tag.name.toLocaleLowerCase("es"), tag]));

export function isCanonicalLibraryTag(name: string) {
  return LIBRARY_TAG_TAXONOMY.some((tag) => tag.name.localeCompare(name, "es", { sensitivity: "accent" }) === 0);
}

export function catalogTagByName(name: string) {
  return LIBRARY_TAG_BY_NAME.get(name.trim().toLocaleLowerCase("es"));
}

export function validateCatalogAssignment(tagIds: string[]) {
  const uniqueIds = [...new Set(tagIds)];
  const tags = uniqueIds.map((id) => LIBRARY_TAG_BY_ID.get(id)).filter((tag): tag is LibraryTagCatalogEntry => Boolean(tag));
  if (tags.length !== uniqueIds.length) throw new Error("Una de las etiquetas no pertenece al catálogo de Lúmina.");
  if (tags.filter((tag) => tag.level === "primary").length > 3) throw new Error("Puedes asignar como máximo 3 etiquetas principales.");
  if (tags.filter((tag) => tag.level === "secondary").length > 2) throw new Error("Puedes asignar como máximo 2 subetiquetas.");
  return tags;
}
