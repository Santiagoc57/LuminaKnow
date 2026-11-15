import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("la repisa limita, ordena y olvida lo que se quita", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-shelf-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?shelf=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'Prueba', 'x', '#000', ?)").run(now);
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  for (const id of ids) db.prepare("INSERT INTO videos(id, youtube_id, source_type, url, title, status, added_by, created_at, updated_at) VALUES(?, ?, 'web', 'https://example.com', ?, 'saved', 'p', ?, ?)").run(id, id, id, now, now);
  const { addToShelf, removeFromShelf, reorderShelf, SHELF_LIMIT } = await import(`../lib/shelf?shelf=${stamp}`);
  const shelf = () => (db.prepare("SELECT id FROM videos WHERE top_position IS NOT NULL ORDER BY top_position").all() as Array<{ id: string }>).map((row) => row.id);

  ids.slice(0, SHELF_LIMIT).forEach((id) => addToShelf(id));
  assert.deepEqual(shelf(), ids.slice(0, SHELF_LIMIT));
  addToShelf("a");
  assert.equal(shelf().length, SHELF_LIMIT, "añadir lo mismo no duplica ni cambia el orden");
  assert.throws(() => addToShelf("g"), /admite 6/);
  assert.throws(() => addToShelf("no-existe"), /no encontrada/);

  reorderShelf(["f", "e", "d", "c", "b", "a"]);
  assert.deepEqual(shelf(), ["f", "e", "d", "c", "b", "a"]);
  assert.throws(() => reorderShelf(["a", "b"]), /cambió/);
  assert.throws(() => reorderShelf(["a", "a", "b", "c", "d", "e"]), /cambió/);
  assert.throws(() => reorderShelf(["g", "e", "d", "c", "b", "a"]), /cambió/);
  assert.deepEqual(shelf(), ["f", "e", "d", "c", "b", "a"], "un orden inválido no cambia nada");

  removeFromShelf("e");
  addToShelf("g");
  assert.deepEqual(shelf(), ["f", "d", "c", "b", "a", "g"], "lo nuevo entra al final");

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
