import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { ensureBaseKnowledgeGraph } from "@/lib/knowledge";
import { safeJson } from "@/lib/utils";
import type { GraphEdgeData, GraphNodeData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireProfile();
    ensureBaseKnowledgeGraph();
    const db = getDb();
    const url = new URL(request.url);
    const focusType = url.searchParams.get("focusType");
    const focusId = url.searchParams.get("focusId");
    const depth = Math.min(3, Math.max(0, Number(url.searchParams.get("depth") ?? 1)));
    const allowedTypes = new Set((url.searchParams.get("types") || "video,collection,tag,person,organization,tool,place,concept,idea").split(","));
    const statuses = new Set((url.searchParams.get("statuses") || "confirmed,suggested").split(","));
    const minConfidence = Math.min(1, Math.max(0, Number(url.searchParams.get("minConfidence") ?? 0)));
    const allNodes = db.prepare("SELECT id, node_type AS nodeType, ref_id AS refId, label, description, metadata_json AS metadataJson FROM knowledge_nodes").all() as Array<{ id: string; nodeType: GraphNodeData["nodeType"]; refId: string | null; label: string; description: string; metadataJson: string }>;
    const allEdges = db.prepare("SELECT id, source_node_id AS source, target_node_id AS target, relation_type AS relationType, origin, confidence, status, explanation FROM knowledge_edges WHERE status != 'hidden'").all() as GraphEdgeData[];
    let visibleIds = new Set(allNodes.map((node) => node.id));
    if (focusType && focusId) {
      const roots = allNodes.filter((node) => (focusType === "node" && node.id === focusId) || (node.nodeType === focusType && node.refId === focusId)).map((node) => node.id);
      visibleIds = new Set(roots);
      let frontier = new Set(roots);
      for (let level = 0; level < depth; level += 1) {
        const next = new Set<string>();
        allEdges.forEach((edge) => {
          if (frontier.has(edge.source)) next.add(edge.target);
          if (frontier.has(edge.target)) next.add(edge.source);
        });
        next.forEach((id) => visibleIds.add(id));
        frontier = next;
      }
    }
    const collectionId = url.searchParams.get("collectionId");
    const tagId = url.searchParams.get("tagId");
    if (collectionId || tagId) {
      const videoNodeIds = new Set(allNodes.filter((node) => node.nodeType === "video").map((node) => node.id));
      const membersFor = (nodeType: "collection" | "tag", refId: string | null) => {
        if (!refId) return null;
        const filterNode = allNodes.find((node) => node.nodeType === nodeType && node.refId === refId);
        if (!filterNode) return new Set<string>();
        return new Set(allEdges.flatMap((edge) => {
          if (edge.source === filterNode.id && videoNodeIds.has(edge.target)) return [edge.target];
          if (edge.target === filterNode.id && videoNodeIds.has(edge.source)) return [edge.source];
          return [];
        }));
      };
      const collectionMembers = membersFor("collection", collectionId);
      const tagMembers = membersFor("tag", tagId);
      const matched = new Set([...videoNodeIds].filter((id) => (!collectionMembers || collectionMembers.has(id)) && (!tagMembers || tagMembers.has(id))));
      const expanded = new Set(matched);
      allEdges.forEach((edge) => {
        if (matched.has(edge.source)) expanded.add(edge.target);
        if (matched.has(edge.target)) expanded.add(edge.source);
      });
      visibleIds = new Set([...visibleIds].filter((id) => expanded.has(id)));
    }
    const edges = allEdges.filter((edge) => statuses.has(edge.status) && edge.confidence >= minConfidence && visibleIds.has(edge.source) && visibleIds.has(edge.target));
    const degree = new Map<string, number>();
    edges.forEach((edge) => { degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1); degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1); });
    let nodes: GraphNodeData[] = allNodes.filter((node) => visibleIds.has(node.id) && allowedTypes.has(node.nodeType)).map((node) => ({ id: node.id, nodeType: node.nodeType, refId: node.refId, label: node.label, description: node.description, metadata: safeJson(node.metadataJson, {}), degree: degree.get(node.id) ?? 0 }));
    if (!focusType && nodes.length > 400) {
      nodes = nodes.sort((a, b) => {
        const aPriority = a.nodeType === "video" || a.nodeType === "collection" ? 1000 : 0;
        const bPriority = b.nodeType === "video" || b.nodeType === "collection" ? 1000 : 0;
        return bPriority + b.degree - (aPriority + a.degree);
      }).slice(0, 400);
    }
    const nodeIds = new Set(nodes.map((node) => node.id));
    const filteredEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const shortestPath: string[] = [];
    if (from && to && nodeIds.has(from) && nodeIds.has(to)) {
      const neighbors = new Map<string, string[]>();
      filteredEdges.forEach((edge) => {
        neighbors.set(edge.source, [...(neighbors.get(edge.source) ?? []), edge.target]);
        neighbors.set(edge.target, [...(neighbors.get(edge.target) ?? []), edge.source]);
      });
      const queue = [from];
      const previous = new Map<string, string | null>([[from, null]]);
      while (queue.length && !previous.has(to)) {
        const current = queue.shift()!;
        for (const neighbor of neighbors.get(current) ?? []) if (!previous.has(neighbor)) { previous.set(neighbor, current); queue.push(neighbor); }
      }
      if (previous.has(to)) {
        let current: string | null = to;
        while (current) { shortestPath.unshift(current); current = previous.get(current) ?? null; }
      }
    }
    return NextResponse.json({ nodes, edges: filteredEdges, shortestPath, totalNodes: allNodes.length, totalEdges: allEdges.length, truncated: nodes.length < allNodes.length && !focusType });
  } catch (error) {
    return apiError(error);
  }
}
