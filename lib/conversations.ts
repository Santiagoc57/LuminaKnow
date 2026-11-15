import { getDb } from "./db";
import { generateChatAnswer } from "./scoped-chat";
import type { AvailableModel, ChatScopeType, ChatSourceSelection, Citation, ConversationMessage, ConversationSummary, ConversationTurn } from "./types";
import { makeId, safeJson } from "./utils";

const emptySelection = (): ChatSourceSelection => ({ collectionIds: [], tagIds: [], videoIds: [], excludedVideoIds: [] });

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
}

function placeholders(values: string[]) {
  return values.map(() => "?").join(",");
}

function normalizeSelection(selection: ChatSourceSelection): ChatSourceSelection {
  return {
    collectionIds: unique(selection.collectionIds),
    tagIds: unique(selection.tagIds),
    videoIds: unique(selection.videoIds),
    excludedVideoIds: unique(selection.excludedVideoIds),
  };
}

function requireKnownIds(table: "collections" | "tags" | "videos", ids: string[], label: string) {
  if (!ids.length) return;
  const count = (getDb().prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE id IN (${placeholders(ids)})`).get(...ids) as { count: number }).count;
  if (count !== ids.length) throw new Error(`Una o más ${label} ya no existen.`);
}

export function validateSourceSelection(input: ChatSourceSelection) {
  const selection = normalizeSelection(input);
  if (!selection.collectionIds.length && !selection.tagIds.length && !selection.videoIds.length) {
    throw new Error("Selecciona al menos una fuente antes de preguntar.");
  }
  requireKnownIds("collections", selection.collectionIds, "colecciones");
  requireKnownIds("tags", selection.tagIds, "etiquetas");
  requireKnownIds("videos", [...new Set([...selection.videoIds, ...selection.excludedVideoIds])], "fuentes");
  return selection;
}

export function getConversationSelection(conversationId: string): ChatSourceSelection {
  const rows = getDb().prepare(`SELECT context_type AS contextType, context_id AS contextId, mode
    FROM conversation_contexts WHERE conversation_id = ? ORDER BY created_at, context_type, context_id`).all(conversationId) as Array<{ contextType: "collection" | "tag" | "video"; contextId: string; mode: "include" | "exclude" }>;
  const result = emptySelection();
  rows.forEach((row) => {
    if (row.contextType === "collection") result.collectionIds.push(row.contextId);
    else if (row.contextType === "tag") result.tagIds.push(row.contextId);
    else if (row.mode === "exclude") result.excludedVideoIds.push(row.contextId);
    else result.videoIds.push(row.contextId);
  });
  return result;
}

export function resolveEffectiveSources(selectionInput: ChatSourceSelection) {
  const selection = validateSourceSelection(selectionInput);
  const db = getDb();
  const ids = new Set<string>();
  if (selection.collectionIds.length) {
    const rows = db.prepare(`WITH RECURSIVE selected_collections(id) AS (
        SELECT id FROM collections WHERE id IN (${placeholders(selection.collectionIds)})
        UNION ALL SELECT c.id FROM collections c JOIN selected_collections parent ON c.parent_id = parent.id
      ) SELECT DISTINCT vc.video_id AS id FROM video_collections vc JOIN videos v ON v.id = vc.video_id
      WHERE v.status = 'ready' AND vc.collection_id IN (SELECT id FROM selected_collections)`).all(...selection.collectionIds) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (selection.tagIds.length) {
    const rows = db.prepare(`SELECT vt.video_id AS id FROM video_tags vt JOIN videos v ON v.id = vt.video_id
      WHERE v.status = 'ready' AND vt.tag_id IN (${placeholders(selection.tagIds)})`).all(...selection.tagIds) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  if (selection.videoIds.length) {
    const rows = db.prepare(`SELECT id FROM videos WHERE status = 'ready' AND id IN (${placeholders(selection.videoIds)})`).all(...selection.videoIds) as Array<{ id: string }>;
    rows.forEach((row) => ids.add(row.id));
  }
  selection.excludedVideoIds.forEach((id) => ids.delete(id));
  const effective = [...ids].slice(0, 100);
  if (!effective.length) throw new Error("Las fuentes elegidas todavía no están listas para conversar.");
  return effective;
}

function scopeFor(selection: ChatSourceSelection, conversationId: string): { scopeType: ChatScopeType; scopeId: string; videoId: string | null } {
  const included = selection.collectionIds.length + selection.tagIds.length + selection.videoIds.length;
  if (included === 1 && selection.collectionIds.length === 1) return { scopeType: "collection", scopeId: selection.collectionIds[0], videoId: null };
  if (included === 1 && selection.tagIds.length === 1) return { scopeType: "tag", scopeId: selection.tagIds[0], videoId: null };
  if (!selection.excludedVideoIds.length && included === 1 && selection.videoIds.length === 1) return { scopeType: "video", scopeId: selection.videoIds[0], videoId: selection.videoIds[0] };
  return { scopeType: "selection", scopeId: conversationId, videoId: null };
}

function insertContexts(conversationId: string, selection: ChatSourceSelection, now: string) {
  const insert = getDb().prepare("INSERT INTO conversation_contexts(conversation_id, context_type, context_id, mode, created_at) VALUES(?, ?, ?, ?, ?)");
  selection.collectionIds.forEach((id) => insert.run(conversationId, "collection", id, "include", now));
  selection.tagIds.forEach((id) => insert.run(conversationId, "tag", id, "include", now));
  selection.videoIds.forEach((id) => insert.run(conversationId, "video", id, "include", now));
  selection.excludedVideoIds.forEach((id) => insert.run(conversationId, "video", id, "exclude", now));
}

function storeMessageSources(messageId: string, videoIds: string[]) {
  const insert = getDb().prepare("INSERT OR IGNORE INTO message_sources(message_id, video_id) VALUES(?, ?)");
  videoIds.forEach((videoId) => insert.run(messageId, videoId));
}

function titleFromQuestion(question: string) {
  const normalized = question.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}…` : normalized;
}

function createTurn(conversationId: string, question: string, modelId: AvailableModel["id"], videoIds: string[]) {
  const db = getDb();
  const now = new Date().toISOString();
  const messageId = makeId("msg");
  const turnId = makeId("turn");
  db.prepare("INSERT INTO messages(id, conversation_id, role, content, model_id, created_at) VALUES(?, ?, 'user', ?, ?, ?)").run(messageId, conversationId, question, modelId, now);
  storeMessageSources(messageId, videoIds);
  db.prepare(`INSERT INTO chat_turns(id, conversation_id, user_message_id, model_id, status, created_at, updated_at)
    VALUES(?, ?, ?, ?, 'queued', ?, ?)`).run(turnId, conversationId, messageId, modelId, now, now);
  db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  return { turnId, userMessageId: messageId };
}

export function createConversation(input: { profileId: string; question: string; title?: string; selection: ChatSourceSelection; modelId: AvailableModel["id"] }) {
  const db = getDb();
  const selection = validateSourceSelection(input.selection);
  const videoIds = resolveEffectiveSources(selection);
  const id = makeId("con");
  const now = new Date().toISOString();
  const scope = scopeFor(selection, id);
  let turn!: { turnId: string; userMessageId: string };
  db.transaction(() => {
    db.prepare(`INSERT INTO conversations(id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(id, scope.videoId, scope.scopeType, scope.scopeId, input.profileId, input.title?.trim() || titleFromQuestion(input.question), now, now);
    insertContexts(id, selection, now);
    turn = createTurn(id, input.question, input.modelId, videoIds);
  })();
  return { conversationId: id, ...turn };
}

function requireConversation(profileId: string, conversationId: string) {
  const conversation = getDb().prepare(`SELECT id, title, scope_type AS scopeType, scope_id AS scopeId, created_at AS createdAt, updated_at AS updatedAt
    FROM conversations WHERE id = ? AND profile_id = ?`).get(conversationId, profileId) as { id: string; title: string; scopeType: ChatScopeType; scopeId: string; createdAt: string; updatedAt: string } | undefined;
  if (!conversation) throw new Error("La conversación no existe para este perfil.");
  return conversation;
}

function scopeLabel(selection: ChatSourceSelection) {
  const db = getDb();
  if (selection.collectionIds.length === 1 && !selection.tagIds.length && !selection.videoIds.length) {
    return (db.prepare("SELECT name FROM collections WHERE id = ?").get(selection.collectionIds[0]) as { name: string } | undefined)?.name || "Colección";
  }
  if (selection.tagIds.length === 1 && !selection.collectionIds.length && !selection.videoIds.length) {
    return (db.prepare("SELECT name FROM tags WHERE id = ?").get(selection.tagIds[0]) as { name: string } | undefined)?.name || "Etiqueta";
  }
  if (selection.videoIds.length === 1 && !selection.collectionIds.length && !selection.tagIds.length) {
    return (db.prepare("SELECT title AS name FROM videos WHERE id = ?").get(selection.videoIds[0]) as { name: string } | undefined)?.name || "Video";
  }
  return "Selección de fuentes";
}

export function listConversations(profileId: string): ConversationSummary[] {
  const rows = getDb().prepare(`SELECT c.id, c.title, c.scope_type AS scopeType, c.updated_at AS updatedAt, c.pinned_at AS pinnedAt,
    COALESCE((SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1), '') AS preview
    FROM conversations c WHERE c.profile_id = ?
    ORDER BY c.pinned_at IS NULL, c.pinned_at DESC, c.updated_at DESC`).all(profileId) as Array<{ id: string; title: string; scopeType: ChatScopeType; updatedAt: string; pinnedAt: string | null; preview: string }>;
  return rows.map((row) => {
    const selection = getConversationSelection(row.id);
    let sourceCount = 0;
    try { sourceCount = resolveEffectiveSources(selection).length; } catch { sourceCount = 0; }
    return { ...row, preview: row.preview.slice(0, 120), sourceCount, scopeLabel: scopeLabel(selection) };
  });
}

export function getConversation(profileId: string, conversationId: string) {
  const conversation = requireConversation(profileId, conversationId);
  const db = getDb();
  db.prepare(`UPDATE chat_turns SET status = 'queued', updated_at = ?
    WHERE conversation_id = ? AND status = 'generating' AND updated_at < ?`)
    .run(new Date().toISOString(), conversationId, new Date(Date.now() - 120_000).toISOString());
  const selection = getConversationSelection(conversationId);
  let videoIds: string[] = [];
  try { videoIds = resolveEffectiveSources(selection); } catch { /* Se conserva el chat aunque sus fuentes hayan desaparecido. */ }
  const messages = db.prepare(`SELECT id, role, content, citations_json AS citationsJson, model_id AS modelId, created_at AS createdAt
    FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid`).all(conversationId).map((row) => {
      const item = row as { id: string; role: "user" | "assistant"; content: string; citationsJson: string; modelId: AvailableModel["id"]; createdAt: string };
      return { id: item.id, role: item.role, content: item.content, citations: safeJson<Citation[]>(item.citationsJson, []), modelId: item.modelId, createdAt: item.createdAt } satisfies ConversationMessage;
    });
  const turns = db.prepare(`SELECT id, user_message_id AS userMessageId, assistant_message_id AS assistantMessageId, status, error, model_id AS modelId
    FROM chat_turns WHERE conversation_id = ? ORDER BY created_at`).all(conversationId) as ConversationTurn[];
  const sources = videoIds.length ? db.prepare(`SELECT id, title, channel, thumbnail_url AS thumbnailUrl FROM videos WHERE id IN (${placeholders(videoIds)}) ORDER BY title`).all(...videoIds) : [];
  return { conversation, selection, messages, turns, sources };
}

export function addConversationMessage(input: { profileId: string; conversationId: string; question: string; modelId: AvailableModel["id"] }) {
  requireConversation(input.profileId, input.conversationId);
  const videoIds = resolveEffectiveSources(getConversationSelection(input.conversationId));
  return getDb().transaction(() => createTurn(input.conversationId, input.question, input.modelId, videoIds))();
}

export function updateConversationSources(profileId: string, conversationId: string, input: ChatSourceSelection) {
  const db = getDb();
  requireConversation(profileId, conversationId);
  const selection = validateSourceSelection(input);
  resolveEffectiveSources(selection);
  const scope = scopeFor(selection, conversationId);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare("DELETE FROM conversation_contexts WHERE conversation_id = ?").run(conversationId);
    insertContexts(conversationId, selection, now);
    db.prepare("UPDATE conversations SET video_id = ?, scope_type = ?, scope_id = ?, updated_at = ? WHERE id = ?")
      .run(scope.videoId, scope.scopeType, scope.scopeId, now, conversationId);
  })();
  return getConversation(profileId, conversationId);
}

export function renameConversation(profileId: string, conversationId: string, title: string) {
  requireConversation(profileId, conversationId);
  getDb().prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title.trim(), new Date().toISOString(), conversationId);
}

export function setConversationPinned(profileId: string, conversationId: string, pinned: boolean) {
  requireConversation(profileId, conversationId);
  getDb().prepare("UPDATE conversations SET pinned_at = ? WHERE id = ? AND profile_id = ?")
    .run(pinned ? new Date().toISOString() : null, conversationId, profileId);
}

export function deleteConversation(profileId: string, conversationId: string) {
  requireConversation(profileId, conversationId);
  getDb().prepare("DELETE FROM conversations WHERE id = ? AND profile_id = ?").run(conversationId, profileId);
}

export async function answerConversationTurn(input: { profileId: string; conversationId: string; turnId: string }) {
  requireConversation(input.profileId, input.conversationId);
  const db = getDb();
  const turn = db.prepare(`SELECT t.id, t.user_message_id AS userMessageId, t.assistant_message_id AS assistantMessageId,
      t.status, t.model_id AS modelId, m.content AS question, t.updated_at AS updatedAt
    FROM chat_turns t JOIN messages m ON m.id = t.user_message_id
    WHERE t.id = ? AND t.conversation_id = ?`).get(input.turnId, input.conversationId) as { id: string; userMessageId: string; assistantMessageId: string | null; status: string; modelId: AvailableModel["id"]; question: string; updatedAt: string } | undefined;
  if (!turn) throw new Error("La pregunta ya no existe.");
  if (turn.status === "complete" && turn.assistantMessageId) {
    const existing = db.prepare("SELECT content, citations_json AS citationsJson FROM messages WHERE id = ?").get(turn.assistantMessageId) as { content: string; citationsJson: string };
    return { content: existing.content, citations: safeJson<Citation[]>(existing.citationsJson, []) };
  }
  if (turn.status === "generating" && Date.now() - new Date(turn.updatedAt).getTime() < 120_000) throw new Error("Esta respuesta ya se está preparando.");
  db.prepare("UPDATE chat_turns SET status = 'generating', error = '', updated_at = ? WHERE id = ?").run(new Date().toISOString(), turn.id);
  try {
    const sources = db.prepare("SELECT video_id AS videoId FROM message_sources WHERE message_id = ? ORDER BY video_id").all(turn.userMessageId) as Array<{ videoId: string }>;
    const answer = await generateChatAnswer({ question: turn.question, videoIds: sources.map((source) => source.videoId), modelId: turn.modelId });
    const assistantMessageId = makeId("msg");
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("INSERT INTO messages(id, conversation_id, role, content, citations_json, model_id, created_at) VALUES(?, ?, 'assistant', ?, ?, ?, ?)")
        .run(assistantMessageId, input.conversationId, answer.content, JSON.stringify(answer.citations), turn.modelId, now);
      storeMessageSources(assistantMessageId, sources.map((source) => source.videoId));
      db.prepare("UPDATE chat_turns SET assistant_message_id = ?, status = 'complete', error = '', updated_at = ? WHERE id = ?").run(assistantMessageId, now, turn.id);
      db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, input.conversationId);
    })();
    return answer;
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo preparar la respuesta.";
    db.prepare("UPDATE chat_turns SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(message, new Date().toISOString(), turn.id);
    throw error;
  }
}
