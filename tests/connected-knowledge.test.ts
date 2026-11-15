import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Citation, ConversationSummary } from "../lib/types";

test("el chat de colección respeta exclusiones y conserva una copia de las fuentes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-scope-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const { getDb } = await import(`../lib/db?scope=${Date.now()}`);
  const { syncRetrievalUnit } = await import(`../lib/knowledge?scope=${Date.now()}`);
  const { answerScopedChat, validateScopeSources } = await import(`../lib/scoped-chat?scope=${Date.now()}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Santiago', 'x', '#000', ?)").run(now);
  const addVideo = db.prepare(`INSERT INTO videos(id, youtube_id, url, title, channel, status, added_by, created_at, updated_at)
    VALUES(?, ?, ?, ?, 'Canal', 'ready', 'profile', ?, ?)`);
  addVideo.run("v1", "aaaaaaaaaaa", "https://youtube.com/watch?v=aaaaaaaaaaa", "Energía solar", now, now);
  addVideo.run("v2", "bbbbbbbbbbb", "https://youtube.com/watch?v=bbbbbbbbbbb", "Baterías", now, now);
  addVideo.run("v3", "ccccccccccc", "https://youtube.com/watch?v=ccccccccccc", "Video excluido", now, now);
  db.prepare("INSERT INTO collections(id, name, color, created_at, updated_at) VALUES('c1', 'Tecnología', '#123', ?, ?)").run(now, now);
  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES(?, 'c1')").run("v1");
  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES(?, 'c1')").run("v2");
  syncRetrievalUnit({ id: "r1", videoId: "v1", sourceKind: "summary", sourceRef: "main", text: "La energía solar reduce costos y emisiones." });
  syncRetrievalUnit({ id: "r2", videoId: "v2", sourceKind: "summary", sourceRef: "main", text: "Las baterías almacenan energía para usarla durante la noche." });
  syncRetrievalUnit({ id: "r3", videoId: "v3", sourceKind: "summary", sourceRef: "main", text: "Este contenido nunca debe citarse." });

  assert.deepEqual(validateScopeSources("collection", "c1", ["v1"]), ["v1"]);
  assert.throws(() => validateScopeSources("collection", "c1", ["v3"]), /pertenecer/);
  const result = await answerScopedChat({ profileId: "profile", question: "¿Qué dice sobre la energía?", scopeType: "collection", scopeId: "c1", videoIds: ["v1"], modelId: "auto" });
  assert.ok(result.content.includes("energía solar"));
  assert.ok(result.citations.length > 0);
  assert.ok(result.citations.every((citation: Citation) => citation.videoId === "v1"));

  db.prepare("DELETE FROM video_collections WHERE video_id = 'v1' AND collection_id = 'c1'").run();
  const recorded = db.prepare(`SELECT ms.video_id AS videoId FROM message_sources ms
    JOIN messages m ON m.id = ms.message_id WHERE m.conversation_id = ? ORDER BY m.created_at`).all(result.conversationId) as Array<{ videoId: string }>;
  assert.equal(recorded.length, 2);
  assert.ok(recorded.every((source) => source.videoId === "v1"));
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("consolida entidades normalizadas y persiste el estado de una relación", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-graph-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const { getDb } = await import(`../lib/db?graph=${Date.now()}`);
  const { upsertKnowledgeEdge, upsertKnowledgeNode } = await import(`../lib/knowledge?graph=${Date.now()}`);
  const db = getDb();
  const first = upsertKnowledgeNode({ nodeType: "person", label: "José Álvarez" });
  const duplicate = upsertKnowledgeNode({ nodeType: "person", label: "Jose Alvarez" });
  assert.equal(first, duplicate);
  const video = upsertKnowledgeNode({ nodeType: "video", refId: "video-1", label: "Una fuente" });
  upsertKnowledgeEdge({ sourceNodeId: video, targetNodeId: first, relationType: "mentions", origin: "ai", status: "suggested" });
  const edge = db.prepare("SELECT id FROM knowledge_edges").get() as { id: string };
  db.prepare("UPDATE knowledge_edges SET status = 'confirmed' WHERE id = ?").run(edge.id);
  assert.equal((db.prepare("SELECT status FROM knowledge_edges WHERE id = ?").get(edge.id) as { status: string }).status, "confirmed");
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("gestiona membresías y elimina una colección sin borrar sus videos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-collections-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  const { getDb } = await import(`../lib/db?collections=${Date.now()}`);
  const { moveCollectionVideos, removeCollection, replaceCollectionVideos } = await import(`../lib/collections?collections=${Date.now()}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Catalina', 'x', '#000', ?)").run(now);
  const addVideo = db.prepare(`INSERT INTO videos(id, youtube_id, url, title, status, added_by, created_at, updated_at)
    VALUES(?, ?, ?, ?, 'ready', 'profile', ?, ?)`);
  addVideo.run("v1", "ddddddddddd", "https://youtube.com/watch?v=ddddddddddd", "Video uno", now, now);
  addVideo.run("v2", "eeeeeeeeeee", "https://youtube.com/watch?v=eeeeeeeeeee", "Video dos", now, now);
  const addCollection = db.prepare("INSERT INTO collections(id, name, color, created_at, updated_at) VALUES(?, ?, '#123', ?, ?)");
  addCollection.run("c1", "Origen", now, now);
  addCollection.run("c2", "Destino", now, now);
  addCollection.run("c3", "Tercera", now, now);
  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES('v1', 'c3')").run();

  replaceCollectionVideos("c1", ["v1", "v2"]);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM video_collections WHERE collection_id = 'c1'").get() as { count: number }).count, 2);
  moveCollectionVideos("c1", "c2", ["v1"]);
  const memberships = db.prepare("SELECT collection_id AS id FROM video_collections WHERE video_id = 'v1' ORDER BY collection_id").all() as Array<{ id: string }>;
  assert.deepEqual(memberships.map((item) => item.id), ["c2", "c3"]);

  db.prepare(`INSERT INTO conversations(id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at)
    VALUES('chat-c2', NULL, 'collection', 'c2', 'profile', '', ?, ?)` ).run(now, now);
  removeCollection("c2");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM videos").get() as { count: number }).count, 2);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM collections WHERE id = 'c2'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE id = 'chat-c2'").get() as { count: number }).count, 0);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM video_collections WHERE video_id = 'v1' AND collection_id = 'c3'").get() as { count: number }).count, 1);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("crea varios chats por colección, conserva fuentes históricas y aísla perfiles", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-unified-chat-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const { getDb } = await import(`../lib/db?unified=${Date.now()}`);
  const { addConversationMessage, createConversation, getConversation, listConversations, setConversationPinned, updateConversationSources } = await import(`../lib/conversations?unified=${Date.now()}`);
  const { removeCollection } = await import(`../lib/collections?unified=${Date.now()}`);
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('santiago', 'Santiago', 'x', '#000', ?), ('catalina', 'Catalina', 'x', '#111', ?)").run(now, now);
  const addVideo = db.prepare(`INSERT INTO videos(id, youtube_id, url, title, channel, status, added_by, created_at, updated_at)
    VALUES(?, ?, ?, ?, 'Canal', 'ready', 'santiago', ?, ?)`);
  addVideo.run("v1", "fffffffffff", "https://youtube.com/watch?v=fffffffffff", "Primer video", now, now);
  addVideo.run("v2", "ggggggggggg", "https://youtube.com/watch?v=ggggggggggg", "Segundo video", now, now);
  db.prepare("INSERT INTO collections(id, name, color, created_at, updated_at) VALUES('c1', 'Política', '#123', ?, ?)").run(now, now);
  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES('v1', 'c1')").run();

  const selection = { collectionIds: ["c1"], tagIds: [], videoIds: [], excludedVideoIds: [] };
  const first = createConversation({ profileId: "santiago", question: "¿Qué idea central tiene esta colección?", selection, modelId: "auto" });
  const second = createConversation({ profileId: "santiago", question: "Compara sus argumentos", selection, modelId: "auto" });
  assert.notEqual(first.conversationId, second.conversationId);
  assert.equal(listConversations("santiago").length, 2);
  assert.equal(listConversations("catalina").length, 0);
  assert.throws(() => getConversation("catalina", first.conversationId), /no existe/);

  setConversationPinned("santiago", first.conversationId, true);
  assert.equal(listConversations("santiago")[0].id, first.conversationId);
  assert.ok(listConversations("santiago")[0].pinnedAt);
  setConversationPinned("santiago", first.conversationId, false);
  assert.equal(listConversations("santiago").find((conversation: ConversationSummary) => conversation.id === first.conversationId)?.pinnedAt, null);

  db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES('v2', 'c1')").run();
  const followUp = addConversationMessage({ profileId: "santiago", conversationId: first.conversationId, question: "¿Qué añade la nueva fuente?", modelId: "auto" });
  const firstSources = db.prepare("SELECT video_id AS id FROM message_sources WHERE message_id = ? ORDER BY video_id").all(first.userMessageId) as Array<{ id: string }>;
  const followUpSources = db.prepare("SELECT video_id AS id FROM message_sources WHERE message_id = ? ORDER BY video_id").all(followUp.userMessageId) as Array<{ id: string }>;
  assert.deepEqual(firstSources.map((item) => item.id), ["v1"]);
  assert.deepEqual(followUpSources.map((item) => item.id), ["v1", "v2"]);

  updateConversationSources("santiago", first.conversationId, { ...selection, excludedVideoIds: ["v2"] });
  const excluded = addConversationMessage({ profileId: "santiago", conversationId: first.conversationId, question: "Usa solo la primera fuente", modelId: "auto" });
  const excludedSources = db.prepare("SELECT video_id AS id FROM message_sources WHERE message_id = ? ORDER BY video_id").all(excluded.userMessageId) as Array<{ id: string }>;
  assert.deepEqual(excludedSources.map((item) => item.id), ["v1"]);

  const mixed = createConversation({ profileId: "santiago", question: "Conserva este chat mixto", selection: { collectionIds: ["c1"], tagIds: [], videoIds: ["v2"], excludedVideoIds: [] }, modelId: "auto" });
  removeCollection("c1");
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE id = ?").get(mixed.conversationId) as { count: number }).count, 1);
  assert.deepEqual(getConversation("santiago", mixed.conversationId).selection, { collectionIds: [], tagIds: [], videoIds: ["v2"], excludedVideoIds: [] });
  assert.deepEqual(db.pragma("foreign_key_check"), []);
  db.close();
  global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
