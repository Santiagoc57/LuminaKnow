import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("siembra la taxonomía cerrada y resuelve filtros AND con descendientes compartidos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-taxonomy-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?taxonomy=${stamp}`);
  const { listVideos } = await import(`../lib/data?taxonomy=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();

  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tags WHERE level = 'primary' AND active = 1").get() as { count: number }).count, 15);
  const primaryNames = (db.prepare("SELECT name FROM tags WHERE level = 'primary' AND active = 1 ORDER BY sort_order").all() as Array<{ name: string }>).map((tag) => tag.name);
  assert.ok(["Tecnología", "Economía", "Cultura", "Salud", "Productividad", "Comunicación", "Entretenimiento"].every((name) => primaryNames.includes(name)));
  assert.ok(primaryNames.every((name) => !name.includes(" y ")));
  const skills = db.prepare("SELECT id, level, active FROM tags WHERE catalog_key = 'tag_secondary_skills'").get() as { id: string; level: string; active: number };
  assert.equal(skills.level, "secondary");
  assert.equal(skills.active, 1);
  assert.deepEqual(db.prepare("SELECT t.name FROM tag_relations r JOIN tags t ON t.id = r.parent_tag_id WHERE r.child_tag_id = ?").all(skills.id), [{ name: "Inteligencia artificial" }]);
  getDb();
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tags WHERE catalog_key = 'tag_secondary_skills'").get() as { count: number }).count, 1);
  const battle = db.prepare("SELECT id FROM tags WHERE name = 'Batalla cultural'").get() as { id: string };
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tag_relations WHERE child_tag_id = ?").get(battle.id) as { count: number }).count, 3);

  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  db.prepare("INSERT INTO videos(id, youtube_id, url, title, status, added_by, created_at, updated_at) VALUES('v1', 'abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk', 'Debate cultural', 'ready', 'profile', ?, ?)").run(now, now);
  db.prepare("INSERT INTO video_tags(video_id, tag_id, origin, confidence) VALUES('v1', ?, 'manual', 1)").run(battle.id);
  const politics = db.prepare("SELECT id FROM tags WHERE name = 'Política'").get() as { id: string };
  const philosophy = db.prepare("SELECT id FROM tags WHERE name = 'Filosofía'").get() as { id: string };
  assert.deepEqual(listVideos({ tagIds: [politics.id, philosophy.id] }).map((video: { id: string }) => video.id), ["v1"]);

  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("deshacer una migración restaura exactamente etiquetas y metadatos anteriores", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-taxonomy-undo-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?taxonomyundo=${stamp}`);
  const { undoTaggingJob } = await import(`../lib/tagging?taxonomyundo=${stamp}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  db.prepare("INSERT INTO videos(id, youtube_id, url, title, status, added_by, created_at, updated_at) VALUES('v1', 'abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk', 'Fuente', 'ready', 'profile', ?, ?)").run(now, now);
  db.prepare("INSERT INTO tags(id, name, color, kind, level, active, created_at) VALUES('legacy', 'Etiqueta anterior', '#111', 'manual', 'legacy', 0, ?)").run(now);
  const replacement = db.prepare("SELECT id FROM tags WHERE level = 'primary' LIMIT 1").get() as { id: string };
  const snapshot = { v1: [{ tagId: "legacy", origin: "manual", confidence: 0.73, bulkJobId: null }] };
  db.prepare("INSERT INTO bulk_tag_jobs(id, profile_id, status, model_id, source_ids_json, sample_ids_json, mode, snapshot_json, created_at, updated_at) VALUES('job', 'profile', 'complete', 'gemini', '[\"v1\"]', '[\"v1\"]', 'replace', ?, ?, ?)").run(JSON.stringify(snapshot), now, now);
  db.prepare("INSERT INTO video_tags(video_id, tag_id, origin, confidence, bulk_job_id) VALUES('v1', ?, 'ai', .9, 'job')").run(replacement.id);
  db.prepare("INSERT INTO bulk_tag_changes(job_id, video_id, tag_id, created_at) VALUES('job', 'v1', ?, ?)").run(replacement.id, now);

  undoTaggingJob("job", "profile");
  assert.deepEqual(db.prepare("SELECT tag_id AS tagId, origin, confidence, bulk_job_id AS bulkJobId FROM video_tags WHERE video_id = 'v1'").all(), snapshot.v1);
  assert.deepEqual(db.prepare("SELECT active, archived_at AS archivedAt FROM tags WHERE id = 'legacy'").get(), { active: 1, archivedAt: null });

  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
