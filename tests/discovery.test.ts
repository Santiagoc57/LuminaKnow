import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("archivar saca la fuente de la biblioteca, los espacios persisten y la extensión guarda recortes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-discovery-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?discovery=${stamp}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Prueba', 'x', '#000', ?)").run(new Date().toISOString());
  const { createExtensionToken } = await import(`../lib/extension-auth?discovery=${stamp}`);
  const { POST } = await import(`../app/api/extension/capture/route?discovery=${stamp}`);
  const token = createExtensionToken("profile");
  const capture = (body: Record<string, unknown>) => POST(new Request("http://localhost:3000/api/extension/capture", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));

  const created = await capture({ url: "https://example.com/ensayo", title: "T".repeat(400), description: "D".repeat(5_000), imageUrl: "/portada-relativa.jpg", clip: "Primera línea\nSegunda línea" });
  assert.equal(created.status, 201, "metadatos largos o incompletos no deben impedir el guardado");
  const { id } = await created.json();
  const stored = db.prepare("SELECT title, thumbnail_url AS image FROM videos WHERE id = ?").get(id) as { title: string; image: string };
  assert.equal(stored.title.length, 240);
  assert.equal(stored.image, "");
  const quotes = () => (db.prepare("SELECT quote, origin FROM highlights WHERE video_id = ? ORDER BY created_at, quote").all(id) as Array<{ quote: string; origin: string }>);
  assert.deepEqual(quotes().map((item) => [item.quote, item.origin]), [["Primera línea\nSegunda línea", "clip"]]);

  const duplicate = await capture({ url: "https://example.com/ensayo", clip: "Otro recorte" });
  assert.equal(duplicate.status, 200);
  assert.equal(quotes().length, 2);

  const { createHighlight, deleteHighlight, updateHighlightNote } = await import(`../lib/highlights?discovery=${stamp}`);
  const manual = createHighlight({ videoId: id, quote: "Idea subrayada", origin: "reader", profileId: "profile" });
  assert.equal(createHighlight({ videoId: id, quote: "Idea subrayada", origin: "reader", profileId: "profile" }).id, manual.id, "subrayar lo mismo no duplica");
  assert.equal(updateHighlightNote(id, manual.id, "Mi comentario"), true);
  assert.ok(db.prepare("SELECT 1 FROM library_search WHERE video_id = ? AND notes LIKE '%Mi comentario%'").get(id), "la nota del subrayado se puede buscar");
  assert.equal(deleteHighlight("otra-fuente", manual.id), false);
  assert.equal(deleteHighlight(id, manual.id), true);

  const { listVideos } = await import(`../lib/data?discovery=${stamp}`);
  assert.equal(listVideos().length, 1);
  db.prepare("UPDATE videos SET archived_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  assert.equal(listVideos().length, 0);
  assert.equal(listVideos({ archived: true }).length, 1);

  const { createSmartSpace, deleteSmartSpace, listSmartSpaces } = await import(`../lib/spaces?discovery=${stamp}`);
  const space = createSmartSpace({ name: "Ideas", color: "#123456", query: "#ideas" });
  assert.deepEqual(listSmartSpaces().map((item: { name: string }) => item.name), ["Ideas"]);
  assert.throws(() => createSmartSpace({ name: "ideas", color: "#123456", query: "x" }), /Ya tienes una carpeta/);
  assert.equal(deleteSmartSpace(space.id), true);

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("los subrayados se ubican por texto, incluso cruzando párrafos", async () => {
  const { findHighlightRanges } = await import("../lib/highlight-ranges");
  const text = "La libertad  es\nuna práctica (diaria). La libertad cansa.";
  assert.deepEqual(findHighlightRanges(text, [{ id: "a", quote: "es una práctica (diaria)" }]).map((r) => text.slice(r.start, r.end)), ["es\nuna práctica (diaria)"]);
  assert.equal(findHighlightRanges(text, [{ id: "b", quote: "La libertad" }]).length, 2);
  assert.deepEqual(findHighlightRanges(text, [{ id: "c", quote: "Otro párrafo\nLa libertad cansa." }]).map((r) => r.id), ["c"]);
  assert.equal(findHighlightRanges(text, [{ id: "d", quote: "no aparece" }]).length, 0);
  const overlapped = findHighlightRanges("abcdefgh", [{ id: "x", quote: "abcd" }, { id: "y", quote: "cdef" }]);
  assert.deepEqual(overlapped.map((r) => [r.start, r.end]), [[0, 6]]);
});

test("el lector fantasma envía solo el entorno de la selección y la trata como contenido", async () => {
  const { buildGhostPrompt, GHOST_SYSTEM_INSTRUCTION, surroundingPassage } = await import("../lib/ghost-prompt");
  const corpus = `${"a".repeat(5_000)}FRASE CLAVE${"b".repeat(5_000)}`;
  const passage = surroundingPassage(corpus, "FRASE CLAVE", 100);
  assert.ok(passage.includes("FRASE CLAVE"));
  assert.ok(passage.length < 300);
  assert.ok(surroundingPassage(corpus, "no está", 100).length <= 200);
  const prompt = buildGhostPrompt({ action: "define", title: "T", author: "", gist: "", corpus, selection: "FRASE CLAVE", question: "" });
  assert.match(prompt, /<seleccion>\nFRASE CLAVE\n<\/seleccion>/);
  assert.ok(prompt.length < 4_000);
  assert.match(GHOST_SYSTEM_INSTRUCTION, /nunca instrucciones/);
});

test("borrar una fuente también borra su texto de los índices de búsqueda", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-purge-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { deleteSourceEverywhere, getDb, refreshVideoSearch } = await import(`../lib/db?purge=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'Prueba', 'x', '#000', ?)").run(now);
  const add = (id: string, text: string) => {
    db.prepare("INSERT INTO videos(id, youtube_id, source_type, url, title, description, status, added_by, created_at, updated_at) VALUES(?, ?, 'web', 'https://example.com', ?, ?, 'saved', 'p', ?, ?)").run(id, id, id, text, now, now);
    refreshVideoSearch(id);
    db.prepare("INSERT INTO retrieval_search(unit_id, video_id, text) VALUES(?, ?, ?)").run(`u-${id}`, id, text);
  };
  add("privada", "secretoprivado");
  add("otra", "textopublico");
  const insertNode = db.prepare("INSERT INTO knowledge_nodes(id, node_type, label, normalized_label, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)");
  insertNode.run("n-persona", "person", "Ana", "ana", now, now);
  const found = (table: string, term: string) => (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE ${table} MATCH ?`).get(term) as { c: number }).c;
  assert.equal(found("library_search", "secretoprivado"), 1);
  deleteSourceEverywhere("privada");
  for (const table of ["library_search", "retrieval_search", "video_search"]) assert.equal(found(table, "secretoprivado"), 0, table);
  assert.equal(found("library_search", "textopublico"), 1, "lo demás no se toca");
  assert.equal(db.prepare("SELECT 1 FROM knowledge_nodes WHERE id = 'n-persona'").get(), undefined, "las entidades que quedan sueltas se van");
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("Decisions: umbral por etiqueta y la subetiqueta arrastra su tema", async () => {
  const { pickDecidedTags } = await import("../lib/tag-decisions");
  const picked = pickDecidedTags([
    { tagId: "tag_primary_productividad_y_carrera", probability: 0.4 },
    { tagId: "tag_primary_comunicacion_y_medios", probability: 0.2 },
    { tagId: "tag_secondary_carrera", probability: 0.9 },
    { tagId: "tag_secondary_redes_sociales", probability: 0.3 },
  ]);
  assert.ok(picked.includes("tag_secondary_carrera"));
  assert.ok(picked.includes("tag_primary_productividad_y_carrera"), "el tema de la subetiqueta entra aunque no pase el umbral");
  assert.ok(!picked.includes("tag_secondary_redes_sociales"), "por debajo del umbral no entra");
  assert.ok(!picked.includes("tag_primary_comunicacion_y_medios"));
});

test("el PIN se bloquea tras 5 fallos y la espera crece", async () => {
  const { loginWaitSeconds, recordLoginFailure, recordLoginSuccess } = await import("../lib/login-throttle");
  const now = 1_000_000;
  for (let i = 0; i < 4; i += 1) assert.equal(recordLoginFailure("p-test", now), 0);
  assert.equal(recordLoginFailure("p-test", now), 30);
  assert.equal(recordLoginFailure("p-test", now), 60);
  assert.equal(loginWaitSeconds("p-test", now + 61_000), 0);
  recordLoginSuccess("p-test");
  assert.equal(recordLoginFailure("p-test", now), 0, "un acierto reinicia el contador");
});
