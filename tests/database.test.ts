import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("crea el esquema local y aplica índices", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-db-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const { getDb } = await import(`../lib/db?test=${Date.now()}`);
  const db = getDb();
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table', 'index')").all() as Array<{ name: string }>;
  assert.ok(tables.some((item) => item.name === "videos"));
  assert.ok(tables.some((item) => item.name === "transcript_chunks"));
  assert.ok(tables.some((item) => item.name === "idx_chunks_video_ordinal"));
  assert.ok(tables.some((item) => item.name === "retrieval_units"));
  assert.ok(tables.some((item) => item.name === "message_sources"));
  assert.ok(tables.some((item) => item.name === "knowledge_nodes"));
  assert.ok(tables.some((item) => item.name === "knowledge_edges"));
  assert.ok(tables.some((item) => item.name === "conversation_contexts"));
  assert.ok(tables.some((item) => item.name === "chat_turns"));
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
