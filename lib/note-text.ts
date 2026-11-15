// Interpreta el texto de una nota sin tocar la base de datos: sirve tanto en el servidor como en el navegador.

export type NoteInline =
  | { kind: "text"; text: string }
  | { kind: "bold" | "em" | "code" | "mark"; text: string }
  | { kind: "url"; text: string; href: string }
  | { kind: "link"; title: string };

export type NoteBlock =
  | { kind: "h1" | "h2" | "h3" | "p" | "quote" | "item"; text: string; line: number }
  | { kind: "task"; text: string; line: number; checked: boolean }
  | { kind: "code"; text: string; line: number };

const LINK = /\[\[([^[\]\n]{1,200})\]\]/g;
const INLINE = /\*\*[^*\n]+\*\*|==[^=\n]+==|`[^`\n]+`|\[\[[^[\]\n]{1,200}\]\]|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\*[^*\s][^*\n]*\*|https?:\/\/[^\s<>)]+/g;
const FALLBACK_TITLE = "Nota sin título";

export function parseInline(text: string): NoteInline[] {
  const nodes: NoteInline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    if (match.index > cursor) nodes.push({ kind: "text", text: text.slice(cursor, match.index) });
    cursor = match.index + token.length;
    if (token.startsWith("**")) nodes.push({ kind: "bold", text: token.slice(2, -2) });
    else if (token.startsWith("==")) nodes.push({ kind: "mark", text: token.slice(2, -2) });
    else if (token.startsWith("`")) nodes.push({ kind: "code", text: token.slice(1, -1) });
    else if (token.startsWith("[[")) nodes.push({ kind: "link", title: token.slice(2, -2).trim() });
    else if (token.startsWith("[")) {
      const separator = token.indexOf("](");
      nodes.push({ kind: "url", text: token.slice(1, separator), href: token.slice(separator + 2, -1) });
    } else if (token.startsWith("*")) nodes.push({ kind: "em", text: token.slice(1, -1) });
    else nodes.push({ kind: "url", text: token, href: token });
  }
  if (cursor < text.length) nodes.push({ kind: "text", text: text.slice(cursor) });
  return nodes;
}

export function parseNoteBlocks(content: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  const lines = content.split("\n");
  for (let line = 0; line < lines.length; line += 1) {
    const value = lines[line];
    if (value.trimStart().startsWith("```")) {
      const code: string[] = [];
      const start = line;
      for (line += 1; line < lines.length && !lines[line].trimStart().startsWith("```"); line += 1) code.push(lines[line]);
      blocks.push({ kind: "code", text: code.join("\n"), line: start });
      continue;
    }
    if (!value.trim()) continue;
    const heading = value.match(/^(#{1,3})\s+(.+)$/);
    const task = value.match(/^\s*[-*]\s+\[( |x|X)\]\s*(.*)$/);
    const item = value.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
    const quote = value.match(/^>\s?(.*)$/);
    if (heading) blocks.push({ kind: `h${heading[1].length}` as "h1" | "h2" | "h3", text: heading[2], line });
    else if (task) blocks.push({ kind: "task", text: task[2], line, checked: task[1] !== " " });
    else if (item) blocks.push({ kind: "item", text: item[1], line });
    else if (quote) blocks.push({ kind: "quote", text: quote[1], line });
    else blocks.push({ kind: "p", text: value, line });
  }
  return blocks;
}

export function toggleTaskLine(content: string, line: number) {
  const lines = content.split("\n");
  if (line < 0 || line >= lines.length) return content;
  lines[line] = lines[line].replace(/\[( |x|X)\]/, (mark) => mark === "[ ]" ? "[x]" : "[ ]");
  return lines.join("\n");
}

function stripInline(text: string) {
  return parseInline(text).map((node) => node.kind === "link" ? node.title : node.text).join("");
}

export function titleFromContent(content: string) {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#\s+\S/.test(line));
  const first = heading ?? lines[0];
  if (!first) return FALLBACK_TITLE;
  const clean = stripInline(first.replace(/^#{1,6}\s+/, "").replace(/^(?:[-*]\s+(?:\[[ xX]\]\s*)?|>\s?|\d+\.\s+)/, "")).trim();
  return clean.slice(0, 120) || FALLBACK_TITLE;
}

// Texto corto para tarjetas: sin el título y sin marcas de Markdown.
export function notePreview(content: string, title = "") {
  const blocks = parseNoteBlocks(content).map((block) => {
    const text = block.kind === "code" ? block.text : stripInline(block.text);
    return block.kind === "task" ? `${block.checked ? "☑" : "☐"} ${text}` : text;
  });
  if (blocks[0]?.trim() === title.trim()) blocks.shift();
  return blocks.join("\n");
}

export function extractNoteLinks(content: string) {
  const seen = new Map<string, string>();
  for (const match of content.matchAll(LINK)) {
    const title = match[1].trim();
    if (title && !seen.has(title.toLocaleLowerCase("es"))) seen.set(title.toLocaleLowerCase("es"), title);
  }
  return [...seen.values()];
}

export function renameNoteLinks(content: string, from: string, to: string) {
  const target = from.trim().toLocaleLowerCase("es");
  return content.replace(LINK, (whole, title: string) => title.trim().toLocaleLowerCase("es") === target ? `[[${to}]]` : whole);
}

// Si el cursor está dentro de un [[ sin cerrar, devuelve qué se está buscando.
export function linkQueryAtCaret(text: string, caret: number) {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[[");
  if (start < 0) return null;
  const query = before.slice(start + 2);
  if (query.includes("]") || query.includes("\n") || query.length > 200) return null;
  return { start, query };
}

// Una cita es una nota que solo contiene texto citado («> …») y, opcionalmente, su autor («— Autor»).
export type QuoteParts = { text: string; author: string };

export function quoteFromNote(content: string): QuoteParts | null {
  const lines = content.trim().split(/\r?\n/);
  const quoted: string[] = [];
  let author = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (quoted.length) quoted.push(""); continue; }
    if (line.startsWith(">")) { quoted.push(line.replace(/^>\s?/, "")); continue; }
    const credit = line.match(/^[—–-]\s*(.+)$/);
    if (credit && quoted.length && !author) { author = credit[1].replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim(); continue; }
    return null;
  }
  const text = quoted.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text ? { text, author } : null;
}

// Texto pegado o recortado entre comillas («…», "…", “…”) se guarda como cita.
export function quotedText(value: string): string | null {
  const text = value.trim();
  const match = text.match(/^["“«„']([\s\S]{3,})["”»“']\s*(?:[—–-]\s*(.+))?$/);
  if (!match) return null;
  return [match[1].trim().split(/\r?\n/).map((line) => `> ${line}`).join("\n"), match[2] ? `— ${match[2].trim()}` : ""].filter(Boolean).join("\n\n");
}
