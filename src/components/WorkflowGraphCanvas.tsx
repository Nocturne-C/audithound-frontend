import React, { useMemo } from "react";
import { Link2, Plus } from "lucide-react";

import type {
  WorkflowDefinition,
  WorkflowNodeKind,
  WorkflowNodePosition,
} from "../types";

const NODE_WIDTH = 196;
const NODE_HEIGHT = 142;
const COLUMN_STEP = 286;
const ROW_STEP = 194;
const CANVAS_PADDING_X = 48;
const CANVAS_PADDING_Y = 46;

export const WORKFLOW_KIND_COPY: Record<WorkflowNodeKind, { label: string; detail: string }> = {
  scope: { label: "Scope", detail: "Record target identity and boundaries." },
  map: { label: "Context map", detail: "Extract source objects and trust edges." },
  investigate: { label: "General audit", detail: "Run independent evidence discovery." },
  focus: { label: "Adaptive focus", detail: "Insert evidence-driven narrow workers." },
  normalize: { label: "Canonicalize", detail: "Normalize distinct root causes." },
  review: { label: "Human gate", detail: "Require reviewer evidence decisions." },
  regression: { label: "Regression", detail: "Compare approved root-cause lineage." },
  report: { label: "Delivery", detail: "Generate the gated delivery package." },
};

type WorkflowGraphCanvasProps = {
  workflow: WorkflowDefinition;
  selectedNodeId: string | null;
  connectingFrom: string | null;
  onAddNode: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
  onConnect: (sourceNodeId: string, targetNodeId: string) => void;
  onConnectingChange: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, position: WorkflowNodePosition) => void;
  onSelectNode: (nodeId: string) => void;
};

export const WorkflowGraphCanvas = React.memo(function WorkflowGraphCanvas({
  workflow,
  selectedNodeId,
  connectingFrom,
  onAddNode,
  onConnect,
  onConnectingChange,
  onMoveNode,
  onSelectNode,
}: WorkflowGraphCanvasProps) {
  const readOnly = workflow.builtIn;
  const geometry = useMemo(() => {
    const positioned = workflow.nodes.map((node) => ({
      node,
      x: CANVAS_PADDING_X + node.position.column * COLUMN_STEP,
      y: CANVAS_PADDING_Y + node.position.row * ROW_STEP,
    }));
    const maxColumn = Math.max(2, ...workflow.nodes.map((node) => node.position.column));
    const maxRow = Math.max(1, ...workflow.nodes.map((node) => node.position.row));
    return {
      positioned,
      byId: new Map(positioned.map((item) => [item.node.id, item])),
      width: Math.max(920, CANVAS_PADDING_X * 2 + maxColumn * COLUMN_STEP + NODE_WIDTH),
      height: Math.max(520, CANVAS_PADDING_Y * 2 + maxRow * ROW_STEP + NODE_HEIGHT),
    };
  }, [workflow.nodes]);

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (readOnly) {
      return;
    }
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = {
      column: Math.max(0, Math.round((event.clientX - bounds.left - CANVAS_PADDING_X) / COLUMN_STEP)),
      row: Math.max(0, Math.round((event.clientY - bounds.top - CANVAS_PADDING_Y) / ROW_STEP)),
    };
    const nodeId = event.dataTransfer.getData("application/x-audithound-workflow-node");
    if (nodeId) {
      onMoveNode(nodeId, position);
      return;
    }
    const kind = event.dataTransfer.getData("application/x-audithound-workflow-kind") as WorkflowNodeKind;
    if (kind && kind in WORKFLOW_KIND_COPY) {
      onAddNode(kind, position);
    }
  };

  return (
    <div className="workflow-graph-scroll">
      <div
        className={`workflow-graph-canvas ${readOnly ? "is-read-only" : ""}`}
        onDragOver={(event) => {
          if (!readOnly) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={handleDrop}
        style={{ width: geometry.width, height: geometry.height }}
      >
        <svg
          aria-hidden="true"
          className="workflow-edge-layer"
          height={geometry.height}
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          width={geometry.width}
        >
          <defs>
            <marker id="workflow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M0 0L8 4L0 8Z" />
            </marker>
          </defs>
          {geometry.positioned.flatMap(({ node: target, x: targetX, y: targetY }) => (
            target.dependsOn.map((dependencyId) => {
              const source = geometry.byId.get(dependencyId);
              if (!source) {
                return null;
              }
              const startX = source.x + NODE_WIDTH;
              const startY = source.y + NODE_HEIGHT / 2;
              const endX = targetX;
              const endY = targetY + NODE_HEIGHT / 2;
              const bend = Math.max(52, Math.abs(endX - startX) * 0.42);
              return (
                <path
                  className={`workflow-edge ${selectedNodeId === target.id || selectedNodeId === source.node.id ? "is-related" : ""}`}
                  d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`}
                  key={`${source.node.id}-${target.id}`}
                  markerEnd="url(#workflow-arrow)"
                />
              );
            })
          ))}
          {connectingFrom && geometry.byId.get(connectingFrom) && (
            <circle
              className="workflow-connection-beacon"
              cx={(geometry.byId.get(connectingFrom)?.x ?? 0) + NODE_WIDTH}
              cy={(geometry.byId.get(connectingFrom)?.y ?? 0) + NODE_HEIGHT / 2}
              r="7"
            />
          )}
        </svg>

        {geometry.positioned.map(({ node, x, y }, index) => {
          const isConnectionTarget = Boolean(connectingFrom && connectingFrom !== node.id);
          return (
            <div
              className={`workflow-graph-node ${connectingFrom === node.id ? "is-connecting" : ""}`}
              draggable={!readOnly}
              key={node.id}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("application/x-audithound-workflow-node", node.id);
              }}
              style={{ left: x, top: y, width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
            >
              {!readOnly && (
                <button
                  aria-label={isConnectionTarget ? `Connect to ${node.title}` : `Input for ${node.title}`}
                  className={`workflow-port is-input ${isConnectionTarget ? "is-ready" : ""}`}
                  disabled={!isConnectionTarget}
                  onClick={() => {
                    if (connectingFrom) {
                      onConnect(connectingFrom, node.id);
                      onConnectingChange(null);
                    }
                  }}
                  type="button"
                >
                  <Plus size={10} />
                </button>
              )}
              <button
                className={`workflow-node-card is-${node.kind} ${node.id === selectedNodeId ? "is-selected" : ""}`}
                onClick={() => onSelectNode(node.id)}
                type="button"
              >
                <div className="workflow-node-topline">
                  <span className="workflow-node-kind">{WORKFLOW_KIND_COPY[node.kind].label}</span>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </div>
                <strong>{node.title}</strong>
                <p>{node.description}</p>
                <div className="workflow-node-meta">
                  <span>{node.inputMode === "each" ? "Fan out" : node.inputMode === "all" ? "Fan in" : "Full scope"}</span>
                  <span>{node.concurrency}× parallel</span>
                  {node.requiresHumanGate && <span>Human gate</span>}
                </div>
              </button>
              {!readOnly && (
                <button
                  aria-label={`Connect from ${node.title}`}
                  className={`workflow-port is-output ${connectingFrom === node.id ? "is-active" : ""}`}
                  onClick={() => onConnectingChange(connectingFrom === node.id ? null : node.id)}
                  type="button"
                >
                  <Link2 size={11} />
                </button>
              )}
            </div>
          );
        })}

        {!readOnly && workflow.nodes.length === 0 && (
          <div className="workflow-graph-empty">
            <Plus size={18} />
            <strong>Drop the first stage here.</strong>
            <span>Start with Scope, then connect only the evidence transitions you need.</span>
          </div>
        )}
      </div>
    </div>
  );
});
