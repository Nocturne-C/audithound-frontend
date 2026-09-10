import React, { useMemo, useState } from "react";
import {
  Check,
  Circle,
  CircleDashed,
  Clock3,
  GitBranch,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import type { WorkflowDefinition, WorkflowNodeExecution, WorkflowRunSnapshot } from "../types";

type ExecutionGraphProps = {
  workflow: WorkflowDefinition;
  snapshot: WorkflowRunSnapshot;
};

export const ExecutionGraph = React.memo(function ExecutionGraph({ workflow, snapshot }: ExecutionGraphProps) {
  const orderedNodes = useMemo(
    () => [...workflow.nodes].sort((left, right) => left.position.column - right.position.column || left.position.row - right.position.row),
    [workflow.nodes],
  );
  const executionByNode = useMemo(
    () => new Map(snapshot.nodes.map((node) => [node.nodeId, node])),
    [snapshot.nodes],
  );
  const initialNode = snapshot.currentNodeId ?? orderedNodes.find((node) => executionByNode.get(node.id)?.status === "running")?.id ?? orderedNodes[0]?.id ?? null;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialNode);
  const selectedDefinition = orderedNodes.find((node) => node.id === selectedNodeId) ?? orderedNodes[0] ?? null;
  const selectedExecution = selectedDefinition ? executionByNode.get(selectedDefinition.id) ?? emptyExecution(selectedDefinition.id) : null;
  const completedCount = snapshot.nodes.filter((node) => node.status === "completed").length;
  const activeCount = snapshot.nodes.filter((node) => node.status === "running").length;

  return (
    <div className="execution-graph">
      <div className="execution-summary">
        <div>
          <span className={`execution-status-dot is-${snapshot.status}`} />
          <strong>{workflow.name}</strong>
          <small>v{snapshot.workflowVersion} · {snapshot.status}</small>
        </div>
        <div className="execution-summary-metrics">
          <span><strong>{completedCount}</strong> completed</span>
          <span><strong>{activeCount}</strong> active</span>
          <span><strong>{snapshot.nodes.length - completedCount - activeCount}</strong> remaining</span>
        </div>
      </div>

      <div className="execution-lane" role="list">
        {orderedNodes.map((node, index) => {
          const execution = executionByNode.get(node.id) ?? emptyExecution(node.id);
          return (
            <React.Fragment key={node.id}>
              {index > 0 && <div className={`execution-edge is-${execution.status}`} />}
              <button
                className={`execution-stage is-${execution.status} is-kind-${node.kind} ${selectedDefinition?.id === node.id ? "is-selected" : ""}`}
                onClick={() => setSelectedNodeId(node.id)}
                role="listitem"
                type="button"
              >
                <span className="execution-stage-icon">{statusIcon(execution.status)}</span>
                <span className="execution-stage-copy">
                  <small>{node.kind}</small>
                  <strong>{node.title}</strong>
                </span>
                {execution.status === "running" && (
                  <span className="execution-stage-progress">
                    <span style={{ width: `${execution.progress}%` }} />
                  </span>
                )}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {selectedDefinition && selectedExecution && (
        <div className="execution-detail">
          <div className="execution-detail-copy">
            <div className="eyebrow">{selectedDefinition.kind} stage</div>
            <h3>{selectedDefinition.title}</h3>
            <p>{selectedExecution.message || selectedDefinition.description}</p>
          </div>
          <div className="execution-detail-grid">
            <div>
              <span>Status</span>
              <strong>{selectedExecution.status}</strong>
            </div>
            <div>
              <span>Attempt</span>
              <strong>{selectedExecution.attempt || "—"}</strong>
            </div>
            <div>
              <span>Inputs</span>
              <strong>{selectedExecution.inputCount}</strong>
            </div>
            <div>
              <span>Outputs</span>
              <strong>{selectedExecution.outputCount}</strong>
            </div>
            <div>
              <span>Execution</span>
              <strong>{selectedDefinition.inputMode === "each" ? `${selectedDefinition.concurrency}× fan-out` : selectedDefinition.inputMode}</strong>
            </div>
            <div>
              <span>Contract</span>
              <strong>{selectedDefinition.outputContract}</strong>
            </div>
          </div>
          <div className="execution-detail-footer">
            <span><GitBranch size={13} /> {selectedDefinition.dependsOn.length ? selectedDefinition.dependsOn.join(", ") : "Root stage"}</span>
            {selectedDefinition.requiresHumanGate && <span><ShieldCheck size={13} /> Human decision required</span>}
            {selectedExecution.artifactPaths.length > 0 && <span>{selectedExecution.artifactPaths.length} artifact{selectedExecution.artifactPaths.length === 1 ? "" : "s"}</span>}
          </div>
        </div>
      )}
    </div>
  );
});

function emptyExecution(nodeId: string): WorkflowNodeExecution {
  return {
    nodeId,
    status: "pending",
    attempt: 0,
    startedAt: null,
    finishedAt: null,
    progress: 0,
    inputCount: 0,
    outputCount: 0,
    message: "",
    artifactPaths: [],
  };
}

function statusIcon(status: WorkflowNodeExecution["status"]) {
  if (status === "completed") {
    return <Check size={13} />;
  }
  if (status === "running") {
    return <Clock3 size={13} />;
  }
  if (status === "waiting") {
    return <ShieldCheck size={13} />;
  }
  if (status === "failed") {
    return <TriangleAlert size={13} />;
  }
  if (status === "blocked") {
    return <CircleDashed size={13} />;
  }
  return <Circle size={11} />;
}
