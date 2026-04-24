"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Edge,
  type Node,
} from "@xyflow/react";
import type { SessionView } from "@/lib/use-trace-stream";

const NODE_WIDTH = 160;
const NODE_SPACING = 200;

const nodeStyle = (state: "idle" | "active" | "halted"): React.CSSProperties => ({
  padding: "12px 16px",
  borderRadius: 10,
  fontWeight: 500,
  color: "#e6eaf0",
  minWidth: NODE_WIDTH,
  textAlign: "center",
  border:
    state === "active"
      ? "1px solid #7cffb0"
      : state === "halted"
        ? "1px solid #ff6b6b"
        : "1px solid rgba(255,255,255,0.12)",
  background:
    state === "active"
      ? "rgba(124, 255, 176, 0.18)"
      : state === "halted"
        ? "rgba(255, 107, 107, 0.18)"
        : "rgba(255,255,255,0.04)",
  boxShadow:
    state === "active"
      ? "0 0 24px rgba(124, 255, 176, 0.5)"
      : state === "halted"
        ? "0 0 24px rgba(255, 107, 107, 0.5)"
        : "none",
  transition: "all 150ms ease-out",
});

interface Props {
  session: SessionView;
  focusedNode?: string;
  onNodeClick?: (node: string) => void;
}

export const LiveGraph = ({ session, focusedNode, onNodeClick }: Props) => {
  const { nodes, edges } = useMemo(() => {
    const flowNodes: Node[] = session.nodes.map((name, i) => {
      const isHalted = session.haltedNode === name && !!session.outcome;
      const isActive =
        !isHalted &&
        session.activeNode === name &&
        !session.outcome;
      const isFocused = focusedNode === name;
      return {
        id: name,
        position: { x: i * NODE_SPACING, y: 0 },
        data: { label: name },
        style: {
          ...nodeStyle(isHalted ? "halted" : isActive ? "active" : "idle"),
          cursor: onNodeClick ? "pointer" : "default",
          outline: isFocused ? "2px solid #7cc9ff" : "none",
          outlineOffset: isFocused ? 2 : 0,
        },
      };
    });

    const flowEdges: Edge[] = session.transitions.map(([a, b], i) => ({
      id: `${a}->${b}-${i}`,
      source: a,
      target: b,
      animated: true,
      style: { stroke: "rgba(255,255,255,0.3)", strokeWidth: 1.5 },
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [session, focusedNode, onNodeClick]);

  return (
    <div className="h-[60vh] rounded-lg border border-white/10 bg-panel overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={!!onNodeClick}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
      >
        <Background color="#1a1f27" gap={24} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};
