import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("la extensión guarda hilos, comentarios y tweets leídos desde la página", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-structured-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const { getDb } = await import(`../lib/db?structured=${Date.now()}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(new Date().toISOString());
  const { createExtensionToken } = await import(`../lib/extension-auth?structured=${Date.now()}`);
  const token = createExtensionToken("profile");
  const { POST } = await import(`../app/api/extension/structured/route?structured=${Date.now()}`);
  const send = (body: unknown) => POST(new Request("http://localhost:3000/api/extension/structured", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  }));
  const thread = "https://www.reddit.com/r/macmini/comments/abc123/mac_mini_ia/";
  const comment = { externalId: "c1", url: `${thread}c1/`, authorName: "u/ana", authorHandle: "ana", text: "Uso LM Studio con 64 GB.", publishedAt: "", depth: 0 };

  const saved = await send({ kind: "reddit-comment", url: comment.url, title: "Uso LM Studio", parentTitle: "Mac mini como caja de IA", parentUrl: thread, items: [comment, { ...comment, externalId: "c2", text: "Respuesta", depth: 1 }], analyze: false });
  assert.equal(saved.status, 201);
  const commentRow = db.prepare("SELECT youtube_id AS sourceId, status FROM videos").get() as { sourceId: string; status: string };
  assert.equal(commentRow.sourceId, "abc123_c_c1");
  assert.equal(commentRow.status, "saved");

  const threadBody = { kind: "reddit-thread", url: thread, title: "Mac mini como caja de IA", channel: "u/op · r/macmini", items: [{ externalId: "abc123", text: "Mac mini como caja de IA", depth: 0 }, comment], analyze: false };
  assert.equal((await send(threadBody)).status, 201);
  const threadId = (db.prepare("SELECT id FROM videos WHERE youtube_id = 'abc123'").get() as { id: string }).id;
  // Con menos comentarios cargados no se pierde lo ya guardado; con más, se actualiza.
  assert.equal((await send({ ...threadBody, items: threadBody.items.slice(0, 1) })).status, 200);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM source_items WHERE video_id = ?").get(threadId) as { count: number }).count, 2);
  assert.equal((await send({ ...threadBody, items: [...threadBody.items, { ...comment, externalId: "c3", text: "Otro" }] })).status, 200);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM source_items WHERE video_id = ?").get(threadId) as { count: number }).count, 3);

  const tweet = await send({ kind: "tweet", url: "https://x.com/davidsantos/status/123456", title: "Recorte", channel: "David (@davidsantos)", items: [{ externalId: "123456", authorName: "David", authorHandle: "davidsantos", avatarUrl: "https://pbs.twimg.com/a.jpg", text: "Recortaron 40 minutos." }], analyze: false });
  assert.equal(tweet.status, 201);
  const meta = db.prepare("SELECT si.metadata_json AS meta FROM source_items si JOIN videos v ON v.id = si.video_id WHERE v.youtube_id = '123456'").get() as { meta: string };
  assert.equal(JSON.parse(meta.meta).avatarUrl, "https://pbs.twimg.com/a.jpg");
  assert.equal((await send({ kind: "tweet", url: "https://x.com/a/status/9", items: [] })).status, 400);
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
