import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("las etiquetas libres se unifican y no duplican las del catálogo", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-free-tags-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const { getDb } = await import(`../lib/db?free=${Date.now()}`);
  const { freeTagKey, ensureFreeTag, syncAiFreeTags } = await import(`../lib/free-tags?free=${Date.now()}`);
  const db = getDb();
  assert.equal(freeTagKey("Deportes"), freeTagKey("deporte"));
  assert.equal(freeTagKey("#Política"), freeTagKey("politica"));
  const first = ensureFreeTag("James Gunn", "ai");
  assert.equal(ensureFreeTag("james gunn").id, first.id);
  // «Fútbol» ya es subetiqueta del catálogo: se reutiliza en vez de crear una libre.
  assert.equal(ensureFreeTag("futbol").level, "secondary");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'S', 'x', '#000', ?)").run(now);
  db.prepare("INSERT INTO videos(id, youtube_id, url, title, status, added_by, created_at, updated_at) VALUES('v', 'v', 'https://x.com/a/status/1', 't', 'ready', 'p', ?, ?)").run(now, now);
  syncAiFreeTags("v", ["Superman", "superman", "DC Studios", "Warner Bros"]);
  const names = (db.prepare("SELECT t.name FROM video_tags vt JOIN tags t ON t.id = vt.tag_id WHERE vt.video_id = 'v' ORDER BY t.name").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names, ["DC Studios", "Superman", "Warner Bros"]);
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
