"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ForceGraphMethods, GraphData, LinkObject, NodeObject } from "react-force-graph-2d";
import type { GraphEdgeData, GraphNodeData } from "@/lib/types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const colors: Record<GraphNodeData["nodeType"], string> = {
  video: "#e75e3a",
  collection: "#6f82a5",
  tag: "#b88774",
  person: "#8d7ba8",
  organization: "#748d7e",
  tool: "#b38b45",
  place: "#7594a0",
  concept: "#9a7d6b",
  idea: "#a07c99",
};

export function KnowledgeGraphCanvas({ nodes, edges, selectedId, search, onSelect, nodeSpacing = 58, linkDistance = 68, paused = false, fitRequest = 0, showLabels = false, calm = false }: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  selectedId: string | null;
  search: string;
  onSelect: (node: GraphNodeData) => void;
  nodeSpacing?: number;
  linkDistance?: number;
  paused?: boolean;
  fitRequest?: number;
  showLabels?: boolean;
  calm?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.max(320, entry.contentRect.width), height: Math.max(420, entry.contentRect.height) }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const charge = graph.d3Force("charge") as { strength?: (value: number) => unknown } | undefined;
    const link = graph.d3Force("link") as { distance?: (value: number) => unknown } | undefined;
    charge?.strength?.(-Math.max(50, nodeSpacing * 2.2));
    link?.distance?.(linkDistance);
    graph.d3ReheatSimulation();
  }, [linkDistance, nodeSpacing]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (paused) graph.pauseAnimation();
    else { graph.resumeAnimation(); graph.d3ReheatSimulation(); }
  }, [paused]);

  useEffect(() => {
    if (!fitRequest) return;
    graphRef.current?.zoomToFit(450, 55);
  }, [fitRequest]);

  const neighborIds = useMemo(() => {
    if (!selectedId) return new Set<string>();
    const ids = new Set([selectedId]);
    edges.forEach((edge) => {
      const source = typeof edge.source === "string" ? edge.source : (edge.source as GraphNodeData).id;
      const target = typeof edge.target === "string" ? edge.target : (edge.target as GraphNodeData).id;
      if (source === selectedId) ids.add(target);
      if (target === selectedId) ids.add(source);
    });
    return ids;
  }, [edges, selectedId]);
  const query = search.trim().toLocaleLowerCase("es");
  const graphData = useMemo(() => ({ nodes: nodes.map((node) => ({ ...node })), links: edges.map((edge) => ({ ...edge })) }) as GraphData<GraphNodeData, GraphEdgeData>, [nodes, edges]);

  function nodeColor(node: NodeObject<GraphNodeData>) {
    const isMatch = query && node.label.toLocaleLowerCase("es").includes(query);
    if (selectedId && !neighborIds.has(node.id)) return "rgba(175,171,162,.26)";
    if (isMatch) return "#2563eb";
    if (calm) return selectedId === node.id ? "#e75e3a" : "#aeb1b2";
    return colors[node.nodeType];
  }

  return (
    <div className="force-graph-wrap" ref={wrapRef}>
      <ForceGraph2D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={graphData}
        backgroundColor="#f8f7f3"
        cooldownTicks={90}
        d3AlphaDecay={0.035}
        d3VelocityDecay={0.34}
        nodeRelSize={5}
        linkDirectionalArrowLength={(rawLink: LinkObject) => (rawLink as GraphEdgeData).origin === "manual" ? 3 : 0}
        linkColor={(rawLink: LinkObject) => (rawLink as GraphEdgeData).status === "suggested" ? "rgba(150,145,136,.38)" : "rgba(105,99,89,.58)"}
        linkWidth={(rawLink: LinkObject) => (rawLink as GraphEdgeData).status === "confirmed" ? 1.4 : .8}
        nodePointerAreaPaint={(rawNode: NodeObject, color: string, context: CanvasRenderingContext2D) => {
          const node = rawNode as NodeObject<GraphNodeData>;
          context.fillStyle = color;
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, 10, 0, 2 * Math.PI);
          context.fill();
        }}
        nodeCanvasObject={(rawNode: NodeObject, context: CanvasRenderingContext2D, globalScale: number) => {
          const node = rawNode as NodeObject<GraphNodeData>;
          const radius = 5 + Math.min(8, Math.sqrt(node.degree || 0) * 1.8);
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, radius + (selectedId === node.id ? 3 : 0), 0, 2 * Math.PI);
          context.fillStyle = selectedId === node.id ? "rgba(231,94,58,.18)" : "rgba(255,255,255,.9)";
          context.fill();
          context.beginPath();
          context.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
          context.fillStyle = nodeColor(node);
          context.fill();
          const shouldShowLabel = showLabels || globalScale > 1.05 || selectedId === node.id || Boolean(query && node.label.toLocaleLowerCase("es").includes(query));
          if (shouldShowLabel) {
            const fontSize = Math.max(3.2, 11 / globalScale);
            context.font = `600 ${fontSize}px DM Sans`;
            context.textAlign = "center";
            context.textBaseline = "top";
            context.fillStyle = selectedId && !neighborIds.has(node.id) ? "rgba(80,76,70,.3)" : "#38352f";
            context.fillText(node.label.slice(0, 42), node.x ?? 0, (node.y ?? 0) + radius + 3);
          }
        }}
        onNodeClick={(rawNode: NodeObject) => {
          const node = rawNode as NodeObject<GraphNodeData>;
          onSelect(node);
          graphRef.current?.centerAt(node.x, node.y, 500);
          graphRef.current?.zoom(2.6, 500);
        }}
        onEngineStop={() => graphRef.current?.zoomToFit(450, 45)}
      />
    </div>
  );
}
