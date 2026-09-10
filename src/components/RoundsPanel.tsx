import React from "react";
import type { RoundSummary } from "../types";
import { humanizeKey } from "../lib/format";
import { MetricInline, PanelHeader } from "./Common";

export function findRoundPrimaryArtifact(round: RoundSummary) {
  return (
    round.artifacts.find((artifact) => artifact.relativePath.endsWith("/round_summary.md")) ??
    round.artifacts.find((artifact) => artifact.relativePath.endsWith("/merge_view.md")) ??
    round.artifacts[0] ??
    null
  );
}

interface RoundsPanelProps {
  roundsDetail: RoundSummary[];
  activeArtifactPath: string | null;
  setActiveArtifactPath: (path: string | null) => void;
}

export const RoundsPanel = React.memo(function RoundsPanel({
  roundsDetail,
  activeArtifactPath,
  setActiveArtifactPath,
}: RoundsPanelProps) {
  return (
    <div className="panel rounds-panel">
      <PanelHeader title="Round intelligence" eyebrow="Iteration quality" />
      <div className="round-card-list">
        {roundsDetail.map((round) => (
          <div
            key={round.round}
            className="round-card"
          >
            <div className="round-card-top">
              <div>
                <div className="eyebrow">Round {round.round}</div>
                <h4 style={{ fontSize: "13px", fontWeight: 600 }}>
                  {round.summary.newFindings} new / {round.summary.totalFindings} total
                </h4>
              </div>
              <button
                className="ghost-button"
                onClick={() => setActiveArtifactPath(findRoundPrimaryArtifact(round)?.relativePath ?? activeArtifactPath)}
                type="button"
              >
                Open summary
              </button>
            </div>

            <div className="round-metrics">
              <MetricInline label="Updated" value={String(round.summary.updatedExistingFindings)} />
              <MetricInline label="Rejected" value={String(round.summary.rejectedCandidates)} />
              <MetricInline label="Agents" value={String(round.agentOutputs.length)} />
            </div>

            {Object.keys(round.summary.actionCounts).length > 0 && (
              <div className="mini-stack">
                {Object.entries(round.summary.actionCounts).map(([key, value]) => (
                  <div
                    key={key}
                    className="mini-stack-row"
                  >
                    <span>{humanizeKey(key)}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            )}

            {round.summaryMarkdown && (
              <p className="round-summary-snippet" style={{ fontSize: "11px", color: "var(--label-secondary)" }}>
                {round.summaryMarkdown.split("\n").find((line) => line.trim())}
              </p>
            )}

            <div className="round-agents">
              {round.agentOutputs.map((agent) => (
                <button
                  key={agent.id}
                  className="round-agent-pill"
                  onClick={() => setActiveArtifactPath(agent.artifacts[0]?.relativePath ?? activeArtifactPath)}
                  type="button"
                >
                  <span>{agent.label}</span>
                  <strong>{agent.findingCountReliable ? agent.findingCount : "Output"}</strong>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
