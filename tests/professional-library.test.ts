import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("las carpetas anidadas incluyen descendientes, rechazan ciclos y promueven hijos al eliminar", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-folders-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const stamp = Date.now();
  const { getDb, refreshVideoSearch } = await import(`../lib/db?folders=${stamp}`);
  const { assertCollectionParent, removeCollection, reorderCollection } = await import(`../lib/collections?folders=${stamp}`);
  const { resolveEffectiveSources } = await import(`../lib/conversations?folders=${stamp}`);
  const { listVideos } = await import(`../lib/data?folders=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  db.prepare("INSERT INTO collections(id, name, color, parent_id, sort_order, created_at, updated_at) VALUES('root', 'Diseño', '#123', NULL, 0, ?, ?), ('child', 'Motion', '#456', 'root', 0, ?, ?), ('leaf', 'Referencias', '#789', 'child', 0, ?, ?)").run(now, now, now, now, now, now);
  db.prepare(`INSERT INTO videos(id, youtube_id, source_type, url, title, channel, description, status, added_by, created_at, updated_at)
    VALUES('v1', 'abcdefghijk', 'youtube', 'https://youtube.com/watch?v=abcdefghijk', 'Animación editorial', 'Canal creativo', 'Una referencia sobre kinetic typography', 'ready', 'profile', ?, ?)`).run(now, now);
  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES('v1', 'leaf')").run();
  db.prepare("INSERT INTO source_items(id, video_id, external_id, ordinal, url, author_name, author_handle, text, published_at, preview_url, metadata_json, created_at) VALUES('item', 'v1', 'post', 0, 'https://x.com/a/status/1', 'Autora', 'autora', 'Método especial de storyboard modular', '', '', '{}', ?)").run(now);
  refreshVideoSearch("v1");

  assert.deepEqual(resolveEffectiveSources({ collectionIds: ["root"], tagIds: [], videoIds: [], excludedVideoIds: [] }), ["v1"]);
  assert.throws(() => assertCollectionParent("root", "leaf"), /ciclo/);
  assert.throws(() => reorderCollection("root", "root", 0), /sí misma/);
  assert.equal(listVideos({ query: "storyboard modular" }).length, 1);
  assert.equal(listVideos({ collectionId: "root", includeDescendants: true }).length, 1);

  removeCollection("child");
  assert.equal((db.prepare("SELECT parent_id AS parentId FROM collections WHERE id = 'leaf'").get() as { parentId: string | null }).parentId, "root");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM videos WHERE id = 'v1'").get() as { count: number }).count, 1);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("deshacer un lote solo retira las etiquetas añadidas por ese trabajo", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-tag-undo-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?tagundo=${stamp}`);
  const { undoTaggingJob } = await import(`../lib/tagging?tagundo=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Catalina', 'x', '#000', ?)").run(now);
  db.prepare("INSERT INTO videos(id, youtube_id, url, title, status, added_by, created_at, updated_at) VALUES('v1', 'abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk', 'Fuente', 'ready', 'profile', ?, ?)").run(now, now);
  db.prepare("INSERT INTO tags(id, name, color, kind, created_at) VALUES('manual', 'Manual', '#111', 'manual', ?), ('ai', 'IA', '#222', 'descriptive', ?)").run(now, now);
  db.prepare("INSERT INTO bulk_tag_jobs(id, profile_id, status, model_id, interests, source_ids_json, sample_ids_json, created_at, updated_at) VALUES('job', 'profile', 'complete', 'gemini', '', '[\"v1\"]', '[\"v1\"]', ?, ?)").run(now, now);
  db.prepare("INSERT INTO video_tags(video_id, tag_id, origin, confidence, bulk_job_id) VALUES('v1', 'manual', 'manual', 1, NULL), ('v1', 'ai', 'ai', .9, 'job')").run();
  db.prepare("INSERT INTO bulk_tag_changes(job_id, video_id, tag_id, created_at) VALUES('job', 'v1', 'ai', ?)").run(now);

  undoTaggingJob("job", "profile");
  const tags = db.prepare("SELECT tag_id AS id FROM video_tags WHERE video_id = 'v1' ORDER BY tag_id").all() as Array<{ id: string }>;
  assert.deepEqual(tags.map((item) => item.id), ["manual"]);
  assert.equal((db.prepare("SELECT status FROM bulk_tag_jobs WHERE id = 'job'").get() as { status: string }).status, "undone");
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
