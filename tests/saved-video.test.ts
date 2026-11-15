import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("conserva un video como favorito sin crear trabajo de IA y respeta su título personalizado", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-saved-video-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const { getDb, refreshVideoSearch } = await import(`../lib/db?saved=${Date.now()}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  db.prepare(`INSERT INTO videos(id, youtube_id, url, title, custom_title, status, added_by, created_at, updated_at)
    VALUES('saved-1', 'abcdefghijk', 'https://youtube.com/watch?v=abcdefghijk', 'Título original', 'Mi favorito', 'saved', 'profile', ?, ?)`).run(now, now);
  refreshVideoSearch("saved-1");

  const row = db.prepare("SELECT status, custom_title AS customTitle FROM videos WHERE id = 'saved-1'").get() as { status: string; customTitle: string };
  const indexed = db.prepare("SELECT title FROM video_search WHERE video_id = 'saved-1'").get() as { title: string };
  const jobs = db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE video_id = 'saved-1'").get() as { count: number };
  assert.deepEqual(row, { status: "saved", customTitle: "Mi favorito" });
  assert.equal(indexed.title, "Mi favorito");
  assert.equal(jobs.count, 0);

  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
