import { getDb, refreshVideoSearch } from "./db";
import { syncVideoMemberships } from "./knowledge";

function uniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function placeholders(values: string[]) {
  return values.map(() => "?").join(",");
}

function requireCollection(collectionId: string) {
  const collection = getDb().prepare("SELECT id FROM collections WHERE id = ?").get(collectionId);
  if (!collection) throw new Error("La colección no existe.");
}

export function assertCollectionParent(collectionId: string, parentId: string | null) {
  if (!parentId) return;
  if (collectionId === parentId) throw new Error("Una carpeta no puede contenerse a sí misma.");
  requireCollection(parentId);
  const descendants = getDb().prepare(`
    WITH RECURSIVE descendants(id) AS (
      SELECT id FROM collections WHERE parent_id = ?
      UNION ALL SELECT c.id FROM collections c JOIN descendants d ON c.parent_id = d.id
    ) SELECT id FROM descendants
  `).all(collectionId) as Array<{ id: string }>;
  if (descendants.some((item) => item.id === parentId)) throw new Error("Ese movimiento crearía un ciclo entre carpetas.");
}

export function reorderCollection(collectionId: string, parentId: string | null, sortOrder: number) {
  const db = getDb();
  requireCollection(collectionId);
  assertCollectionParent(collectionId, parentId);
  db.transaction(() => {
    db.prepare("UPDATE collections SET parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?")
      .run(parentId, Math.max(0, sortOrder), new Date().toISOString(), collectionId);
  })();
  refreshCollectionBranchSearch(collectionId);
}

export function refreshCollectionBranchSearch(collectionId: string) {
  const rows = getDb().prepare(`WITH RECURSIVE branch(id) AS (
      SELECT id FROM collections WHERE id = ?
      UNION ALL SELECT c.id FROM collections c JOIN branch parent ON c.parent_id = parent.id
    ) SELECT DISTINCT vc.video_id AS videoId FROM video_collections vc WHERE vc.collection_id IN (SELECT id FROM branch)`)
    .all(collectionId) as Array<{ videoId: string }>;
  rows.forEach(({ videoId }) => refreshVideoSearch(videoId));
}

function requireVideos(videoIds: string[]) {
  if (!videoIds.length) return;
  const count = (getDb().prepare(`SELECT COUNT(*) AS count FROM videos WHERE id IN (${placeholders(videoIds)})`).get(...videoIds) as { count: number }).count;
  if (count !== videoIds.length) throw new Error("Uno o más videos ya no existen en la biblioteca.");
}

export function replaceCollectionVideos(collectionId: string, requestedVideoIds: string[]) {
  const db = getDb();
  requireCollection(collectionId);
  const videoIds = uniqueIds(requestedVideoIds);
  requireVideos(videoIds);
  const previous = db.prepare("SELECT video_id AS videoId FROM video_collections WHERE collection_id = ?").all(collectionId) as Array<{ videoId: string }>;
  db.transaction(() => {
    db.prepare("DELETE FROM video_collections WHERE collection_id = ?").run(collectionId);
    const insert = db.prepare("INSERT INTO video_collections(video_id, collection_id) VALUES(?, ?)");
    videoIds.forEach((videoId) => insert.run(videoId, collectionId));
    db.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), collectionId);
  })();
  [...new Set([...previous.map((item) => item.videoId), ...videoIds])].forEach((videoId) => { syncVideoMemberships(videoId); refreshVideoSearch(videoId); });
  return videoIds;
}

export function moveCollectionVideos(collectionId: string, destinationCollectionId: string, requestedVideoIds: string[]) {
  if (collectionId === destinationCollectionId) throw new Error("Elige una colección de destino diferente.");
  const db = getDb();
  requireCollection(collectionId);
  requireCollection(destinationCollectionId);
  const videoIds = uniqueIds(requestedVideoIds);
  if (!videoIds.length) throw new Error("Selecciona al menos un video para mover.");
  requireVideos(videoIds);
  const membership = (db.prepare(`SELECT COUNT(*) AS count FROM video_collections WHERE collection_id = ? AND video_id IN (${placeholders(videoIds)})`).get(collectionId, ...videoIds) as { count: number }).count;
  if (membership !== videoIds.length) throw new Error("Solo puedes mover videos que pertenezcan a esta colección.");
  db.transaction(() => {
    const add = db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)");
    const remove = db.prepare("DELETE FROM video_collections WHERE video_id = ? AND collection_id = ?");
    videoIds.forEach((videoId) => { add.run(videoId, destinationCollectionId); remove.run(videoId, collectionId); });
    const now = new Date().toISOString();
    db.prepare("UPDATE collections SET updated_at = ? WHERE id IN (?, ?)").run(now, collectionId, destinationCollectionId);
  })();
  videoIds.forEach((videoId) => { syncVideoMemberships(videoId); refreshVideoSearch(videoId); });
  return videoIds;
}

export function removeCollection(collectionId: string) {
  const db = getDb();
  requireCollection(collectionId);
  const videos = db.prepare(`WITH RECURSIVE branch(id) AS (
      SELECT id FROM collections WHERE id = ?
      UNION ALL SELECT c.id FROM collections c JOIN branch parent ON c.parent_id = parent.id
    ) SELECT DISTINCT vc.video_id AS videoId FROM video_collections vc WHERE vc.collection_id IN (SELECT id FROM branch)`)
    .all(collectionId) as Array<{ videoId: string }>;
  db.transaction(() => {
    const parent = db.prepare("SELECT parent_id AS parentId FROM collections WHERE id = ?").get(collectionId) as { parentId: string | null };
    db.prepare("UPDATE collections SET parent_id = ?, updated_at = ? WHERE parent_id = ?").run(parent.parentId, new Date().toISOString(), collectionId);
    const affected = db.prepare("SELECT DISTINCT conversation_id AS conversationId FROM conversation_contexts WHERE context_type = 'collection' AND context_id = ? AND mode = 'include'").all(collectionId) as Array<{ conversationId: string }>;
    affected.forEach(({ conversationId }) => {
      const includeCount = (db.prepare("SELECT COUNT(*) AS count FROM conversation_contexts WHERE conversation_id = ? AND mode = 'include'").get(conversationId) as { count: number }).count;
      if (includeCount <= 1) db.prepare("DELETE FROM conversations WHERE id = ?").run(conversationId);
      else db.prepare("DELETE FROM conversation_contexts WHERE conversation_id = ? AND context_type = 'collection' AND context_id = ?").run(conversationId, collectionId);
    });
    db.prepare("DELETE FROM conversations WHERE scope_type = 'collection' AND scope_id = ? AND NOT EXISTS (SELECT 1 FROM conversation_contexts cc WHERE cc.conversation_id = conversations.id)").run(collectionId);
    db.prepare("DELETE FROM knowledge_nodes WHERE node_type = 'collection' AND ref_id = ?").run(collectionId);
    db.prepare("DELETE FROM collections WHERE id = ?").run(collectionId);
  })();
  videos.forEach((video) => { syncVideoMemberships(video.videoId); refreshVideoSearch(video.videoId); });
}
