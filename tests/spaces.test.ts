import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spaceQueryMatches } from "../lib/library-query";
import type { AppVideo } from "../lib/types";

test("un espacio sin búsqueda no coincide con todo", () => {
  const video = { id: "v", sourceType: "web", url: "https://example.com", title: "Ensayo", channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: new Date().toISOString() } as unknown as AppVideo;
  assert.equal(spaceQueryMatches("", video), false);
  assert.equal(spaceQueryMatches("   ", video), false);
  assert.equal(spaceQueryMatches("ensayo", video), true);
  assert.equal(spaceQueryMatches("poema", video), false);
});

test("las carpetas guardan a mano, tienen regla opcional y absorben los espacios antiguos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-spaces-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?spaces=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'Prueba', 'x', '#000', ?)").run(now);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO videos(id, youtube_id, source_type, url, title, status, added_by, created_at, updated_at) VALUES(?, ?, 'web', 'https://example.com', ?, 'saved', 'p', ?, ?)").run(id, id, id, now, now);
  // Un espacio de la versión anterior, con una tarjeta añadida a mano.
  db.prepare("INSERT INTO smart_spaces(id, name, color, query, sort_order, created_at) VALUES('spc_old', 'bt', '#e0912f', '#logo', 0, ?)").run(now);
  db.prepare("INSERT INTO space_items(space_id, video_id, added_at) VALUES('spc_old', 'a', ?)").run(now);
  const { addSpaceItem, createSmartSpace, deleteSmartSpace, listSmartSpaces, removeSpaceItem, reorderSmartSpaces, updateSmartSpace } = await import(`../lib/spaces?spaces=${stamp}`);

  const migrated = listSmartSpaces();
  assert.deepEqual(migrated.map((folder: { name: string; query: string; itemIds: string[] }) => [folder.name, folder.query, folder.itemIds]), [["bt", "#logo", ["a"]]], "el espacio pasa a ser carpeta con su regla y sus tarjetas");
  listSmartSpaces();
  assert.equal(listSmartSpaces().length, 1, "la migración ocurre una sola vez");

  const viaje = createSmartSpace({ name: "Viaje", videoId: "a" });
  assert.match(viaje.color, /^#[0-9a-f]{6}$/, "sin color elegido asigna uno al azar");
  assert.equal(viaje.query, "");
  assert.ok(createSmartSpace({ name: "Vacía" }), "una carpeta normal puede empezar vacía");
  assert.throws(() => createSmartSpace({ name: "viaje", videoId: "b" }), /Ya tienes/);

  addSpaceItem(viaje.id, "b");
  addSpaceItem(viaje.id, "b");
  const find = (id: string) => listSmartSpaces().find((folder: { id: string }) => folder.id === id);
  assert.equal(find(viaje.id).itemIds.length, 2, "añadir dos veces no duplica");
  assert.throws(() => addSpaceItem(viaje.id, "no-existe"), /Fuente no encontrada/);
  assert.throws(() => addSpaceItem("no-existe", "a"), /Carpeta no encontrada/);
  removeSpaceItem(viaje.id, "a");
  assert.deepEqual(find(viaje.id).itemIds, ["b"]);

  updateSmartSpace(viaje.id, { query: "#viajes", name: "Viajes" });
  assert.equal(find(viaje.id).query, "#viajes");
  assert.equal(find(viaje.id).name, "Viajes");
  reorderSmartSpaces([viaje.id, ...listSmartSpaces().map((folder: { id: string }) => folder.id).filter((id: string) => id !== viaje.id)]);
  assert.equal(listSmartSpaces()[0].id, viaje.id);

  db.prepare("DELETE FROM videos WHERE id = 'b'").run();
  assert.deepEqual(find(viaje.id).itemIds, [], "borrar la fuente la saca de la carpeta");
  addSpaceItem(viaje.id, "a");
  assert.equal(deleteSmartSpace(viaje.id), true);
  assert.equal(deleteSmartSpace(viaje.id), false);
  assert.ok(db.prepare("SELECT 1 FROM videos WHERE id = 'a'").get(), "borrar la carpeta no borra fuentes");

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
