import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listCollections, listVideos } from "@/lib/data";
import { formatTimestamp } from "@/lib/utils";
import { apiError } from "@/lib/http";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

function csvCell(value: unknown) {
  const text = String(value ?? "").replaceAll('"', '""');
  return `"${text}"`;
}

function wrapText(text: string, max = 92) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > max && line) { lines.push(line); line = word; }
    else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

export async function GET(request: Request) {
  try {
    await requireProfile();
    const params = new URL(request.url).searchParams;
    const format = params.get("format") || "json";
    const requestedIds = params.getAll("videoIds").flatMap((value) => value.split(",")).filter(Boolean);
    const selected = new Set(requestedIds);
    const videos = listVideos().filter((video) => !selected.size || selected.has(video.id));
    const folders = listCollections();
    const folderById = new Map(folders.map((folder) => [folder.id, folder]));
    const folderPath = (id: string) => {
      const parts: string[] = [];
      const visited = new Set<string>();
      let current = folderById.get(id);
      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        parts.unshift(current.name);
        current = current.parentId ? folderById.get(current.parentId) : undefined;
      }
      return parts.join(" > ");
    };
    if (format === "markdown") {
      const markdown = videos.map((video) => {
        const summary = video.summary;
        const timestamp = (seconds: number | null) => video.sourceType === "youtube" && seconds != null ? `**${formatTimestamp(seconds)} —** ` : "";
        return [
          `# ${video.title}`,
          `- Tipo: ${video.sourceType === "x" ? "Publicación de X" : video.sourceType === "reddit" ? "Publicación de Reddit" : video.sourceType === "web" ? "Artículo web" : "Video de YouTube"}`,
          `- Autor o canal: ${video.channel}`,
          `- Fuente: ${video.url}`,
          ...(video.sourcePublishedAt ? [`- Publicado: ${video.sourcePublishedAt}`] : []),
          `- Carpetas: ${video.collections.map((folder) => folderPath(folder.id)).join(", ") || "—"}`,
          `- Etiquetas: ${video.tags.map((tag) => tag.name).join(", ") || "—"}`,
          "",
          summary?.gist || "Sin resumen.",
          "",
          "## Resumen detallado",
          ...(summary?.sections?.flatMap((section) => [`### ${section.title}`, ...section.points.map((point) => `- ${timestamp(point.startSeconds)}${point.text}`), ""]) || []),
          "",
          "## Puntos clave",
          ...(summary?.keyPoints.map((point) => `- ${timestamp(point.startSeconds)}${point.text}`) || []),
          "",
          video.sourceType !== "youtube" ? "## Estructura" : "## Capítulos",
          ...(summary?.chapters.map((chapter) => `- **${video.sourceType === "youtube" ? `${formatTimestamp(chapter.startSeconds)} — ` : ""}${chapter.title}:** ${chapter.summary}`) || []),
          "",
          "## Notas",
          video.note?.content || "",
        ].join("\n");
      }).join("\n\n---\n\n");
      return new Response(markdown, { headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="lumina-${new Date().toISOString().slice(0, 10)}.md"`,
      } });
    }
    if (format === "csv") {
      const header = ["ID", "Tipo", "Título", "Autor o canal", "URL", "Publicado", "Guardado", "Estado", "Carpetas", "Etiquetas", "Nota", "Resumen", "Cantidad del hilo"];
      const rows = videos.map((video) => [video.id, video.sourceType === "x" ? "X" : video.sourceType === "reddit" ? "Reddit" : video.sourceType === "web" ? "Web" : "YouTube", video.title, video.channel, video.url, video.sourcePublishedAt, video.createdAt, video.status, video.collections.map((item) => folderPath(item.id)).join("; "), video.tags.map((tag) => tag.name).join("; "), video.note?.content || "", video.summary?.gist || "", video.sourceItems.length || 1]);
      const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lumina-${new Date().toISOString().slice(0, 10)}.csv"` } });
    }
    if (format === "pdf") {
      const pdf = await PDFDocument.create();
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const pageSize: [number, number] = [595.28, 841.89];
      let page = pdf.addPage(pageSize);
      let y = 800;
      const drawLine = (text: string, options: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
        const size = options.size ?? 10;
        const gap = options.gap ?? size * 1.45;
        for (const line of wrapText(text, Math.max(45, Math.floor(92 * 10 / size)))) {
          if (y < 48) { page = pdf.addPage(pageSize); y = 800; }
          page.drawText(line, { x: 46, y, size, font: options.font ?? regular, color: options.color ?? rgb(0.18, 0.17, 0.15) });
          y -= gap;
        }
      };
      drawLine("Lúmina — Biblioteca exportada", { size: 20, font: bold, gap: 30 });
      drawLine(`${videos.length} fuentes · ${new Date().toLocaleDateString("es-CO")}`, { size: 9, color: rgb(0.48, 0.45, 0.4), gap: 24 });
      for (const video of videos) {
        if (y < 180) { page = pdf.addPage(pageSize); y = 800; }
        drawLine(video.title, { size: 15, font: bold, gap: 21 });
        drawLine(`${video.sourceType === "x" ? "X" : video.sourceType === "reddit" ? "Reddit" : video.sourceType === "web" ? "Web" : "YouTube"} · ${video.channel || "Autor desconocido"} · ${video.status}`, { size: 9, color: rgb(0.43, 0.41, 0.37) });
        drawLine(video.url, { size: 8, color: rgb(0.78, 0.26, 0.15), gap: 17 });
        if (video.collections.length) drawLine(`Carpetas: ${video.collections.map((item) => folderPath(item.id)).join(" · ")}`, { size: 9 });
        if (video.tags.length) drawLine(`Etiquetas: ${video.tags.map((item) => item.name).join(" · ")}`, { size: 9, gap: 17 });
        if (video.summary?.gist) drawLine(video.summary.gist, { size: 10, gap: 15 });
        if (video.sourceItems.length > 1) {
          drawLine(`Hilo de ${video.sourceItems.length} publicaciones`, { size: 10, font: bold });
          video.sourceItems.forEach((item, index) => { drawLine(`${index + 1}. ${item.text}`, { size: 9 }); drawLine(item.url, { size: 7, color: rgb(0.78, 0.26, 0.15), gap: 13 }); });
        }
        if (video.note?.content) { drawLine("Notas", { size: 10, font: bold }); drawLine(video.note.content, { size: 9 }); }
        y -= 16;
      }
      const bytes = await pdf.save();
      return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="lumina-${new Date().toISOString().slice(0, 10)}.pdf"` } });
    }
    const transcripts = getDb().prepare("SELECT video_id AS videoId, ordinal, start_seconds AS startSeconds, end_seconds AS endSeconds, text FROM transcript_chunks ORDER BY video_id, ordinal").all();
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), videos, transcripts }, null, 2), { headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="lumina-${new Date().toISOString().slice(0, 10)}.json"`,
    } });
  } catch (error) {
    return apiError(error);
  }
}
