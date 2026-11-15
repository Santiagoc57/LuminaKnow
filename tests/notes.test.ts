import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractNoteLinks, linkQueryAtCaret, notePreview, parseInline, parseNoteBlocks, renameNoteLinks, titleFromContent, toggleTaskLine } from "../lib/note-text";

test("el título sale del encabezado o de la primera línea", () => {
  assert.equal(titleFromContent("# Mi idea\ntexto"), "Mi idea");
  assert.equal(titleFromContent("intro\n\n# Mi idea"), "Mi idea");
  assert.equal(titleFromContent("Solo **una** línea"), "Solo una línea");
  assert.equal(titleFromContent("- [ ] comprar pan"), "comprar pan");
  assert.equal(titleFromContent("[[Otra nota]] me gustó"), "Otra nota me gustó");
  assert.equal(titleFromContent("   \n "), "Nota sin título");
  assert.equal(titleFromContent("x".repeat(300)).length, 120);
});

test("entiende el formato básico y no ejecuta nada raro", () => {
  assert.deepEqual(parseInline("hola **fuerte** y *suave* con ==marca== y `code`").map((node) => node.kind), ["text", "bold", "text", "em", "text", "mark", "text", "code"]);
  assert.deepEqual(parseInline("ver [[Mi nota]] ya"), [{ kind: "text", text: "ver " }, { kind: "link", title: "Mi nota" }, { kind: "text", text: " ya" }]);
  assert.deepEqual(parseInline("[sitio](https://a.com)"), [{ kind: "url", text: "sitio", href: "https://a.com" }]);
  assert.deepEqual(parseInline("[malo](javascript:alert(1))").map((node) => node.kind), ["text"], "solo se enlaza http y https");
  assert.deepEqual(parseInline("2 * 3 * 4").map((node) => node.kind), ["text"]);
  assert.deepEqual(parseNoteBlocks("# T\n## S\n- a\n- [x] b\n- [ ] c\n> q\n\ntexto\n```\n# no es título\n```").map((block) => block.kind), ["h1", "h2", "item", "task", "task", "quote", "p", "code"]);
});

test("las tareas se marcan en su línea exacta", () => {
  const text = "- [ ] uno\n- [x] dos";
  assert.equal(toggleTaskLine(text, 0), "- [x] uno\n- [x] dos");
  assert.equal(toggleTaskLine(text, 1), "- [ ] uno\n- [ ] dos");
  assert.equal(toggleTaskLine(text, 9), text);
});

test("los enlaces se detectan, renombran y autocompletan", () => {
  assert.deepEqual(extractNoteLinks("[[A]] y [[a]] y [[ B ]]"), ["A", "B"]);
  assert.equal(renameNoteLinks("ver [[Viejo]] y [[viejo]] y [[Otro]]", "viejo", "Nuevo"), "ver [[Nuevo]] y [[Nuevo]] y [[Otro]]");
  assert.deepEqual(linkQueryAtCaret("hola [[Mi n", 11), { start: 5, query: "Mi n" });
  assert.equal(linkQueryAtCaret("hola [[Mi]] x", 13), null);
  assert.equal(linkQueryAtCaret("[[a\nb", 5), null);
  assert.equal(linkQueryAtCaret("sin nada", 8), null);
  assert.equal(notePreview("# Título\nuno **dos**\n- [ ] tarea", "Título"), "uno dos\n☐ tarea");
});

test("guardar crea versiones, mantiene el título y conecta notas", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-notes-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?notes=${stamp}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'Prueba', 'x', '#000', ?)").run(new Date().toISOString());
  const notes = await import(`../lib/notes?notes=${stamp}`);
  const title = (id: string) => (db.prepare("SELECT COALESCE(NULLIF(custom_title, ''), title) AS t FROM videos WHERE id = ?").get(id) as { t: string }).t;
  const content = (id: string) => (db.prepare("SELECT content FROM notes WHERE video_id = ?").get(id) as { content: string }).content;

  assert.throws(() => notes.createNote({ content: "   ", profileId: "p" }), /vacía/);
  const a = notes.createNote({ content: "# Idea A\nprimera", profileId: "p" }).id;
  const b = notes.createNote({ content: "Hablo de [[idea a]] y de [[No existe]]", profileId: "p" }).id;
  assert.equal(title(a), "Idea A");

  const connections = notes.noteConnections(a);
  assert.deepEqual(connections.backlinks.map((item: { id: string }) => item.id), [b], "los enlaces no distinguen mayúsculas");
  const outgoing = notes.noteConnections(b).outgoing;
  assert.deepEqual(outgoing.map((item: { id: string | null; title: string }) => [item.id, item.title]), [[a, "Idea A"], [null, "No existe"]]);

  notes.saveNoteContent({ videoId: a, profileId: "p", content: "# Idea renombrada\nprimera" });
  assert.equal(title(a), "Idea renombrada");
  assert.match(content(b), /\[\[Idea renombrada\]\]/, "cambiar el título no rompe los enlaces");
  assert.deepEqual(notes.noteConnections(a).backlinks.map((item: { id: string }) => item.id), [b]);

  db.prepare("UPDATE videos SET custom_title = 'Fijo' WHERE id = ?").run(a);
  notes.saveNoteContent({ videoId: a, profileId: "p", content: "# Otro encabezado\nprimera" });
  assert.equal(title(a), "Fijo", "un título puesto a mano no se pisa");

  const first = notes.listNoteVersions(a).length;
  assert.equal(first, 1, "guardar seguido no llena el historial");
  notes.saveNoteContent({ videoId: a, profileId: "p", content: "# Otro encabezado\nprimera" });
  assert.equal(notes.listNoteVersions(a).length, first, "sin cambios no hay versión");
  db.prepare("UPDATE note_versions SET created_at = '2020-01-01T00:00:00.000Z' WHERE video_id = ?").run(a);
  notes.saveNoteContent({ videoId: a, profileId: "p", content: "tercera" });
  const versions = notes.listNoteVersions(a);
  assert.equal(versions.length, 2, "pasado el intervalo guarda lo anterior");
  assert.equal(versions[0].content, "# Otro encabezado\nprimera");

  notes.restoreNoteVersion(a, versions[0].id, "p");
  assert.equal(content(a), "# Otro encabezado\nprimera");
  assert.equal(notes.listNoteVersions(a)[0].content, "tercera", "restaurar conserva lo que había");
  assert.throws(() => notes.restoreNoteVersion(b, versions[0].id, "p"), /ya no existe/, "una versión no se aplica a otra nota");

  assert.ok(db.prepare("SELECT 1 FROM library_search WHERE video_id = ? AND notes LIKE '%tercera%'").get(a) === undefined);
  assert.equal((db.prepare("SELECT embedding FROM retrieval_units WHERE id = ?").get(`ret_note_${a}`) as { embedding: unknown }).embedding, null, "las notas no se envían a un proveedor");
  assert.ok(!notes.searchLinkTargets("fijo", a).some((item: { id: string }) => item.id === a), "no se ofrece enlazar una nota consigo misma");
  assert.equal(notes.searchLinkTargets("hablo")[0].id, b);
  assert.equal(notes.resolveLinkTarget("FIJO").id, a);

  db.prepare("DELETE FROM videos WHERE id = ?").run(a);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM note_versions").get() as { c: number }).c, 0);

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
