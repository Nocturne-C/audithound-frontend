import React from "react";
import { Activity } from "lucide-react";
import type { ArtifactMeta } from "../types";
import { formatRelativeDate } from "../lib/format";
import { EmptyBlock, MetricInline, StatusPill } from "./Common";

interface LiveRoundPanelProps {
  activeRound: number | null;
  artifacts: ArtifactMeta[];
  activeArtifactPath: string | null;
  lastCompletedRound: number;
  onOpenArtifact: (path: string | null) => void;
  rounds: number[];
}

export const LiveRoundPanel = React.memo(function LiveRoundPanel({
  activeRound,
  artifacts,
  activeArtifactPath,
  lastCompletedRound,
  onOpenArtifact,
  rounds,
}: LiveRoundPanelProps) {
  const totalRounds = rounds.length;
  const progress = totalRounds > 0 ? Math.round((lastCompletedRound / totalRounds) * 100) : 0;
  const traceCount = artifacts.filter((a) => a.kind === "log" || a.group === "traces").length;

  if (!activeRound) {
    return (
      <div className="live-panel">
        <div className="progress-strip">
          <MetricInline label="Completed" value={String(lastCompletedRound)} />
          <MetricInline label="Rounds" value={String(rounds.length)} />
          <MetricInline label="Trace logs" value="0" />
        </div>
        <EmptyBlock
          icon={<Activity size={18} />}
          title="No active round"
          body="This run does not currently expose an in-flight round directory."
          compact
        />
      </div>
    );
  }

  return (
    <div className="live-panel">
      <div className="live-banner">
        <div>
          <div className="eyebrow">Round {activeRound}</div>
          <h4>Auto-refreshing log tail</h4>
        </div>
        <StatusPill tone="safe" label="Live" />
      </div>
      <div className="progress-strip">
        <MetricInline label="Completed" value={`${lastCompletedRound}/${totalRounds}`} />
        <MetricInline label="Progress" value={`${progress}%`} />
        <MetricInline label="Trace logs" value={String(traceCount)} />
      </div>

      {artifacts.length === 0 ? (
        <p className="muted" style={{ padding: "12px 14px", margin: 0 }}>
          The active round exists, but no live logs were detected yet.
        </p>
      ) : (
        <div className="live-artifact-list">
          {artifacts.map((artifact) => (
            <button
              key={artifact.relativePath}
              className={`live-artifact-button ${activeArtifactPath === artifact.relativePath ? "is-active" : ""}`}
              onClick={() => onOpenArtifact(artifact.relativePath)}
              type="button"
            >
              <div>
                <strong>{artifact.label}</strong>
                <small style={{ display: "block", marginTop: "2px" }}>
                  {artifact.updatedAt ? formatRelativeDate(artifact.updatedAt) : `Round ${artifact.round}`}
                </small>
              </div>
              <span className="live-tail-badge">tail</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
