(function (root) {
  const primaries = [
    ["tag_primary_inteligencia_artificial", "Inteligencia artificial", ["inteligencia artificial", "artificial intelligence", "machine learning", "modelo generativo", "llm", "chatgpt", "gemini", "claude", "openai", "prompt"]],
    ["tag_primary_tecnologia_y_desarrollo", "Tecnología", ["tecnologia", "technology", "software", "programacion", "programming", "developer", "desarrollo web", "codigo", "code", "database", "api", "cloud", "hardware"]],
    ["tag_primary_diseno_grafico", "Diseño gráfico", ["diseno", "design", "branding", "logo", "tipografia", "typography", "ilustracion", "illustration", "ui", "ux", "figma", "poster"]],
    ["tag_primary_audiovisual", "Audiovisual", ["video", "cinema", "cine", "fotografia", "photography", "animacion", "animation", "audio", "sonido", "edicion", "filmmaking"]],
    ["tag_primary_politica", "Política", ["politica", "politics", "elecciones", "election", "gobierno", "government", "geopolitica", "derechos", "ideologia"]],
    ["tag_primary_filosofia", "Filosofía", ["filosofia", "philosophy", "etica", "ethics", "epistemologia", "libertad", "pensamiento critico", "metafisica"]],
    ["tag_primary_historia", "Historia", ["historia", "history", "historico", "guerra", "war", "medieval", "antigua", "contemporanea", "colombia"]],
    ["tag_primary_economia_y_negocios", "Economía", ["economia", "economics", "finanzas", "finance", "inversion", "investment", "negocio", "business", "marketing", "impuestos", "startup"]],
    ["tag_primary_cultura_y_sociedad", "Cultura", ["cultura", "culture", "sociedad", "social", "identidad", "genero", "religion", "comunidad", "batalla cultural"]],
    ["tag_primary_ciencia", "Ciencia", ["ciencia", "science", "fisica", "physics", "biologia", "biology", "quimica", "psychology", "psicologia", "investigacion cientifica"]],
    ["tag_primary_salud_y_bienestar", "Salud", ["salud", "health", "medicina", "medicine", "nutricion", "nutrition", "ejercicio", "fitness", "sueno", "mental health"]],
    ["tag_primary_educacion", "Educación", ["educacion", "education", "aprender", "learning", "curso", "course", "pedagogia", "lectura", "escritura", "tutorial"]],
    ["tag_primary_productividad_y_carrera", "Productividad", ["productividad", "productivity", "workflow", "organizacion", "gestion del tiempo", "career", "carrera", "liderazgo", "habitos"]],
    ["tag_primary_comunicacion_y_medios", "Comunicación", ["comunicacion", "communication", "periodismo", "journalism", "redes sociales", "social media", "publicidad", "copywriting", "podcast"]],
    ["tag_primary_entretenimiento_y_deportes", "Entretenimiento", ["entretenimiento", "entertainment", "pelicula", "movie", "serie", "music", "musica", "videojuego", "gaming", "futbol", "sport", "literatura"]],
  ];
  const secondaries = [
    ["tag_secondary_modelos_generativos", "Modelos generativos", ["modelo generativo", "generative model", "llm", "chatgpt", "gemini", "claude"]],
    ["tag_secondary_agentes", "Agentes", ["ai agent", "agente ia", "agentic"]],
    ["tag_secondary_automatizacion", "Automatización", ["automatizacion", "automation", "zapier", "make.com", "n8n"]],
    ["tag_secondary_prompts", "Prompts", ["prompt", "prompting"]],
    ["tag_secondary_imagen_con_ia", "Imagen con IA", ["midjourney", "stable diffusion", "imagen con ia", "image generation"]],
    ["tag_secondary_video_con_ia", "Video con IA", ["video con ia", "ai video", "runway", "sora"]],
    ["tag_secondary_voz_y_clonacion", "Voz y clonación", ["voice cloning", "clonacion de voz", "elevenlabs"]],
    ["tag_secondary_desarrollo_web", "Desarrollo web", ["web development", "desarrollo web", "frontend", "backend", "javascript", "typescript", "react", "next.js"]],
    ["tag_secondary_apps_y_software", "Apps y software", ["app", "software", "aplicacion"]],
    ["tag_secondary_programacion", "Programación", ["programacion", "programming", "codigo", "coding", "python", "javascript", "typescript"]],
    ["tag_secondary_codigo_abierto", "Código abierto", ["open source", "codigo abierto", "github"]],
    ["tag_secondary_marca_y_logo", "Marca y logo", ["branding", "brand identity", "marca", "logo"]],
    ["tag_secondary_ui_ux", "UI/UX", ["ui", "ux", "user experience", "interfaz", "figma"]],
    ["tag_secondary_herramientas_de_diseno", "Herramientas de diseño", ["figma", "canva", "photoshop", "illustrator"]],
    ["tag_secondary_produccion_de_video", "Producción de video", ["video production", "produccion de video", "filmmaking"]],
    ["tag_secondary_edicion_y_montaje", "Edición y montaje", ["video editing", "edicion", "montaje", "premiere", "davinci resolve"]],
    ["tag_secondary_fotografia", "Fotografía", ["fotografia", "photography", "camera"]],
    ["tag_secondary_batalla_cultural", "Batalla cultural", ["batalla cultural", "culture war"]],
    ["tag_secondary_libertad", "Libertad", ["libertad", "freedom", "liberalismo"]],
    ["tag_secondary_geopolitica", "Geopolítica", ["geopolitica", "geopolitics"]],
    ["tag_secondary_historia_de_las_ideas", "Historia de las ideas", ["historia de las ideas", "intellectual history"]],
    ["tag_secondary_finanzas_e_inversion", "Finanzas e inversión", ["finanzas", "finance", "inversion", "investing", "stocks"]],
    ["tag_secondary_emprendimiento", "Emprendimiento", ["emprendimiento", "entrepreneurship", "startup"]],
    ["tag_secondary_marketing_y_ventas", "Marketing y ventas", ["marketing", "ventas", "sales"]],
    ["tag_secondary_identidad_y_genero", "Identidad y género", ["identidad", "identity", "genero", "gender"]],
    ["tag_secondary_medios_y_opinion_publica", "Medios y opinión pública", ["opinion publica", "public opinion", "media", "medios"]],
    ["tag_secondary_investigacion", "Investigación", ["investigacion", "research", "paper", "study"]],
    ["tag_secondary_salud_mental", "Salud mental", ["salud mental", "mental health", "ansiedad", "depresion"]],
    ["tag_secondary_aprendizaje", "Aprendizaje", ["aprendizaje", "learning", "learn", "tutorial"]],
    ["tag_secondary_cursos_y_formacion", "Cursos y formación", ["curso", "course", "formacion", "training"]],
    ["tag_secondary_flujos_de_trabajo", "Flujos de trabajo", ["workflow", "flujo de trabajo"]],
    ["tag_secondary_gestion_del_tiempo", "Gestión del tiempo", ["gestion del tiempo", "time management"]],
    ["tag_secondary_periodismo", "Periodismo", ["periodismo", "journalism", "news"]],
    ["tag_secondary_redes_sociales", "Redes sociales", ["redes sociales", "social media", "twitter", "reddit"]],
    ["tag_secondary_cine_y_series", "Cine y series", ["cine", "cinema", "movie", "film", "serie", "netflix"]],
    ["tag_secondary_futbol", "Fútbol", ["futbol", "football", "soccer"]],
  ];

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function scoreEntries(entries, haystack) {
    // Palabras completas: «ui» no debe encontrarse dentro de «quien» ni «app» dentro de «happy».
    const words = ` ${haystack.replace(/[^a-z0-9.]+/g, " ")} `;
    const hit = (keyword) => words.includes(` ${normalize(keyword).replace(/[^a-z0-9.]+/g, " ").trim()} `);
    return entries.map(([key, name, keywords]) => ({ key, name, score: keywords.reduce((score, keyword) => score + (hit(keyword) ? 1 : 0), 0) }))
      .filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es"));
  }

  function domainDefaults(url) {
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch {}
    if (/github\.com|stackoverflow\.com|npmjs\.com/.test(domain)) return [["tag_primary_tecnologia_y_desarrollo", "Tecnología"], ["tag_secondary_programacion", "Programación"], ["tag_secondary_codigo_abierto", "Código abierto"]];
    if (/figma\.com|behance\.net|dribbble\.com|canva\.com/.test(domain)) return [["tag_primary_diseno_grafico", "Diseño gráfico"], ["tag_secondary_herramientas_de_diseno", "Herramientas de diseño"], ["tag_secondary_ui_ux", "UI/UX"]];
    if (/openai\.com|anthropic\.com|huggingface\.co|aistudio\.google\.com/.test(domain)) return [["tag_primary_inteligencia_artificial", "Inteligencia artificial"], ["tag_secondary_modelos_generativos", "Modelos generativos"]];
    if (/reddit\.com|x\.com|twitter\.com/.test(domain)) return [["tag_primary_comunicacion_y_medios", "Comunicación"], ["tag_secondary_redes_sociales", "Redes sociales"]];
    return [];
  }

  function proposeTags(metadata) {
    const haystack = normalize(`${metadata.title || ""} ${metadata.description || ""} ${metadata.keywords || ""} ${metadata.url || ""}`);
    const defaults = domainDefaults(metadata.url || "");
    const primaryScores = scoreEntries(primaries, haystack);
    const secondaryScores = scoreEntries(secondaries, haystack);
    const primary = [];
    const secondary = [];
    for (const [key, name] of defaults) {
      const target = key.startsWith("tag_primary_") ? primary : secondary;
      if (!target.some((item) => item.key === key)) target.push({ key, name });
    }
    for (const item of primaryScores) if (primary.length < 3 && !primary.some((tag) => tag.key === item.key)) primary.push({ key: item.key, name: item.name });
    for (const item of secondaryScores) if (secondary.length < 2 && !secondary.some((tag) => tag.key === item.key)) secondary.push({ key: item.key, name: item.name });
    if (!primary.length) primary.push({ key: "tag_primary_cultura_y_sociedad", name: "Cultura" });
    if (!secondary.length) secondary.push({ key: "tag_secondary_tendencias_y_comunidades", name: "Tendencias y comunidades" });
    return [...primary.slice(0, 3).map((tag) => ({ ...tag, level: "primary" })), ...secondary.slice(0, 2).map((tag) => ({ ...tag, level: "secondary" }))];
  }

  function pageMetadata(documentRef, locationRef) {
    const meta = (selector) => documentRef.querySelector(selector)?.content?.trim() || "";
    return {
      url: locationRef.href,
      title: meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || documentRef.title || locationRef.hostname,
      description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || meta('meta[name="twitter:description"]') || "",
      imageUrl: meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]') || "",
      author: meta('meta[name="author"]') || meta('meta[property="article:author"]') || "",
      siteName: meta('meta[property="og:site_name"]') || locationRef.hostname.replace(/^www\./, ""),
      publishedAt: meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || "",
      keywords: meta('meta[name="keywords"]') || "",
    };
  }

  root.LuminaShared = { proposeTags, pageMetadata };
})(globalThis);
