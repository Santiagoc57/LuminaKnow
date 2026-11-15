import { getDb } from "./db";
import type { KnowledgeEntity, KnowledgeRelation, Summary } from "./types";
import { cosineSimilarity, makeId } from "./utils";

type NodeType = "video" | "collection" | "tag" | "person" | "organization" | "tool" | "place" | "concept" | "idea";

export function normalizeKnowledgeLabel(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function embeddingBuffer(embedding: number[] | null | undefined) {
  return embedding?.length ? Buffer.from(new Float32Array(embedding).buffer) : null;
}

export function averageEmbeddings(embeddings: Array<number[] | null>) {
  const available = embeddings.filter((item): item is number[] => Boolean(item?.length));
  if (!available.length) return null;
  const length = available[0].length;
  const average = Array.from({ length }, () => 0);
  for (const embedding of available) for (let index = 0; index < length; index += 1) average[index] += embedding[index] / available.length;
  return average;
}

// La IA a veces propone tipos fuera del catálogo; sin esto, el CHECK de SQLite tumba todo el análisis.
const ENTITY_NODE_TYPES = new Set<NodeType>(["person", "organization", "tool", "place", "concept", "idea"]);

export function upsertKnowledgeNode(input: { nodeType: NodeType; refId?: string | null; label: string; description?: string; metadata?: Record<string, unknown>; embedding?: number[] | null; embeddingModel?: string }) {
  const db = getDb();
  const normalized = normalizeKnowledgeLabel(input.label);
  const existing = input.refId
    ? db.prepare("SELECT id FROM knowledge_nodes WHERE node_type = ? AND ref_id = ?").get(input.nodeType, input.refId) as { id: string } | undefined
    : db.prepare("SELECT id FROM knowledge_nodes WHERE node_type = ? AND normalized_label = ? ORDER BY created_at LIMIT 1").get(input.nodeType, normalized) as { id: string } | undefined;
  const id = existing?.id ?? makeId("node");
  const now = new Date().toISOString();
  const binary = embeddingBuffer(input.embedding);
  if (existing) {
    db.prepare(`
      UPDATE knowledge_nodes SET label = ?, normalized_label = ?, description = CASE WHEN ? IS NULL THEN description ELSE ? END, metadata_json = ?,
        embedding = COALESCE(?, embedding), embedding_model = CASE WHEN ? != '' THEN ? ELSE embedding_model END, updated_at = ?
      WHERE id = ?
    `).run(input.label, normalized, input.description ?? null, input.description ?? "", JSON.stringify(input.metadata ?? {}), binary, input.embeddingModel ?? "", input.embeddingModel ?? "", now, id);
  } else {
    db.prepare(`
      INSERT INTO knowledge_nodes(id, node_type, ref_id, label, normalized_label, description, embedding, embedding_model, metadata_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.nodeType, input.refId ?? null, input.label, normalized, input.description ?? "", binary, input.embeddingModel ?? "", JSON.stringify(input.metadata ?? {}), now, now);
  }
  return id;
}

export function upsertKnowledgeEdge(input: { sourceNodeId: string; targetNodeId: string; relationType: string; origin: "manual" | "membership" | "tag" | "ai" | "semantic"; confidence?: number; status?: "suggested" | "confirmed" | "hidden"; explanation?: string; evidence?: unknown[] }) {
  if (input.sourceNodeId === input.targetNodeId) return;
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO knowledge_edges(id, source_node_id, target_node_id, relation_type, origin, confidence, status, explanation, evidence_json, created_at, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_node_id, target_node_id, relation_type, origin) DO UPDATE SET
      confidence = excluded.confidence, explanation = excluded.explanation, evidence_json = excluded.evidence_json, updated_at = excluded.updated_at
  `).run(makeId("edge"), input.sourceNodeId, input.targetNodeId, input.relationType, input.origin, input.confidence ?? 1, input.status ?? "suggested", input.explanation ?? "", JSON.stringify(input.evidence ?? []), now, now);
}

export function syncRetrievalUnit(input: { id: string; videoId: string; sourceKind: "transcript" | "summary" | "note"; sourceRef: string; startSeconds?: number | null; endSeconds?: number | null; text: string; embedding?: number[] | null; embeddingModel?: string }) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO retrieval_units(id, video_id, source_kind, source_ref, start_seconds, end_seconds, text, embedding, embedding_model, updated_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id, source_kind, source_ref) DO UPDATE SET
      text = excluded.text, start_seconds = excluded.start_seconds, end_seconds = excluded.end_seconds,
      embedding = excluded.embedding, embedding_model = excluded.embedding_model, updated_at = excluded.updated_at
  `).run(input.id, input.videoId, input.sourceKind, input.sourceRef, input.startSeconds ?? null, input.endSeconds ?? null, input.text, embeddingBuffer(input.embedding), input.embeddingModel ?? "", now);
  db.prepare("DELETE FROM retrieval_search WHERE unit_id = ?").run(input.id);
  if (input.text.trim()) db.prepare("INSERT INTO retrieval_search(unit_id, video_id, text) VALUES(?, ?, ?)").run(input.id, input.videoId, input.text);
}

function nearestChunk(videoId: string, timestamp: number) {
  return getDb().prepare(`
    SELECT id, start_seconds AS startSeconds, end_seconds AS endSeconds, text
    FROM transcript_chunks WHERE video_id = ? ORDER BY ABS(start_seconds - ?) LIMIT 1
  `).get(videoId, timestamp) as { id: number; startSeconds: number; endSeconds: number; text: string } | undefined;
}

export function syncVideoMemberships(videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT id, title, thumbnail_url AS thumbnailUrl, channel FROM videos WHERE id = ?").get(videoId) as { id: string; title: string; thumbnailUrl: string; channel: string } | undefined;
  if (!video) return;
  const videoNode = upsertKnowledgeNode({ nodeType: "video", refId: video.id, label: video.title, metadata: { thumbnailUrl: video.thumbnailUrl, channel: video.channel } });
  db.prepare("DELETE FROM knowledge_edges WHERE source_node_id = ? AND origin IN ('membership', 'tag')").run(videoNode);
  const tags = db.prepare("SELECT t.id, t.name FROM tags t JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ?").all(videoId) as Array<{ id: string; name: string }>;
  const collections = db.prepare("SELECT c.id, c.name, c.description FROM collections c JOIN video_collections vc ON vc.collection_id = c.id WHERE vc.video_id = ?").all(videoId) as Array<{ id: string; name: string; description: string }>;
  tags.forEach((tag) => upsertKnowledgeEdge({ sourceNodeId: videoNode, targetNodeId: upsertKnowledgeNode({ nodeType: "tag", refId: tag.id, label: tag.name }), relationType: "tagged_with", origin: "tag", status: "confirmed" }));
  collections.forEach((collection) => upsertKnowledgeEdge({ sourceNodeId: videoNode, targetNodeId: upsertKnowledgeNode({ nodeType: "collection", refId: collection.id, label: collection.name, description: collection.description }), relationType: "belongs_to", origin: "membership", status: "confirmed" }));
}

function syncSemanticEdges(videoNode: string, embedding: number[] | null, embeddingModel: string) {
  if (!embedding?.length || !embeddingModel) return;
  const db = getDb();
  const current = new Float32Array(embedding);
  const candidates = db.prepare(`
    SELECT id, label, embedding FROM knowledge_nodes
    WHERE node_type = 'video' AND id != ? AND embedding IS NOT NULL AND embedding_model = ?
  `).all(videoNode, embeddingModel) as Array<{ id: string; label: string; embedding: Buffer }>;
  candidates.map((candidate) => ({ ...candidate, score: cosineSimilarity(current, new Float32Array(candidate.embedding.buffer, candidate.embedding.byteOffset, candidate.embedding.byteLength / 4)) }))
    .filter((candidate) => candidate.score >= 0.72).sort((a, b) => b.score - a.score).slice(0, 8)
    .forEach((candidate) => upsertKnowledgeEdge({ sourceNodeId: videoNode, targetNodeId: candidate.id, relationType: "semantically_related", origin: "semantic", confidence: candidate.score, status: "suggested", explanation: `Las transcripciones tienen una similitud semántica de ${Math.round(candidate.score * 100)}%.` }));
}

export function syncVideoKnowledge(input: { videoId: string; summary: Summary; tags: string[]; entities: KnowledgeEntity[]; relations: KnowledgeRelation[]; videoEmbedding: number[] | null; embeddingModel: string }) {
  const db = getDb();
  const video = db.prepare("SELECT title, channel, thumbnail_url AS thumbnailUrl FROM videos WHERE id = ?").get(input.videoId) as { title: string; channel: string; thumbnailUrl: string } | undefined;
  if (!video) return;
  const videoNode = upsertKnowledgeNode({ nodeType: "video", refId: input.videoId, label: video.title, description: input.summary.gist, metadata: { channel: video.channel, thumbnailUrl: video.thumbnailUrl }, embedding: input.videoEmbedding, embeddingModel: input.embeddingModel });
  syncVideoMemberships(input.videoId);
  db.prepare("DELETE FROM entity_mentions WHERE video_id = ?").run(input.videoId);
  db.prepare("DELETE FROM knowledge_edges WHERE source_node_id = ? AND origin = 'ai' AND status = 'suggested'").run(videoNode);

  const entityIds = new Map<string, string>();
  const entities = [...input.entities, ...input.summary.chapters.map((chapter) => ({ name: chapter.title, type: "idea" as const, description: chapter.summary, evidenceTimestamp: chapter.startSeconds }))];
  for (const entity of entities) {
    const nodeId = upsertKnowledgeNode({ nodeType: ENTITY_NODE_TYPES.has(entity.type) ? entity.type : "concept", label: entity.name, description: entity.description });
    entityIds.set(normalizeKnowledgeLabel(entity.name), nodeId);
    const chunk = nearestChunk(input.videoId, entity.evidenceTimestamp);
    const evidence = chunk?.text.slice(0, 360) || entity.description;
    upsertKnowledgeEdge({ sourceNodeId: videoNode, targetNodeId: nodeId, relationType: "mentions", origin: "ai", confidence: 0.82, status: "suggested", explanation: entity.description, evidence: [{ timestamp: entity.evidenceTimestamp, text: evidence }] });
    db.prepare(`
      INSERT INTO entity_mentions(id, node_id, video_id, chunk_id, start_seconds, end_seconds, evidence, confidence, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(makeId("mention"), nodeId, input.videoId, chunk?.id ?? null, chunk?.startSeconds ?? entity.evidenceTimestamp, chunk?.endSeconds ?? entity.evidenceTimestamp, evidence, 0.82, new Date().toISOString());
  }
  for (const relation of input.relations) {
    const source = entityIds.get(normalizeKnowledgeLabel(relation.sourceName));
    const target = entityIds.get(normalizeKnowledgeLabel(relation.targetName));
    if (source && target) upsertKnowledgeEdge({ sourceNodeId: source, targetNodeId: target, relationType: relation.relationType, origin: "ai", confidence: 0.76, status: "suggested", explanation: relation.explanation, evidence: [{ timestamp: relation.evidenceTimestamp }] });
  }
  syncSemanticEdges(videoNode, input.videoEmbedding, input.embeddingModel);
}

export function ensureBaseKnowledgeGraph() {
  const db = getDb();
  const videos = db.prepare("SELECT id, title, summary_json AS summaryJson FROM videos WHERE status = 'ready'").all() as Array<{ id: string; title: string; summaryJson: string | null }>;
  videos.forEach((video) => {
    syncVideoMemberships(video.id);
    if (!video.summaryJson) return;
    try {
      const summary = JSON.parse(video.summaryJson) as Summary;
      const videoNode = upsertKnowledgeNode({ nodeType: "video", refId: video.id, label: video.title, description: summary.gist });
      summary.chapters.slice(0, 12).forEach((chapter) => {
        const ideaNode = upsertKnowledgeNode({ nodeType: "idea", label: chapter.title, description: chapter.summary });
        upsertKnowledgeEdge({ sourceNodeId: videoNode, targetNodeId: ideaNode, relationType: "explains", origin: "ai", confidence: 0.8, status: "suggested", explanation: chapter.summary, evidence: [{ timestamp: chapter.startSeconds }] });
      });
    } catch { /* El video sigue disponible aunque su resumen anterior no sea válido. */ }
  });
}
