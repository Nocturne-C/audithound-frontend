import React from "react";
import { GitCompareArrows } from "lucide-react";
import type { Finding, RunDetail, RunSummary } from "../types";
import { severityTone } from "../lib/format";
import { MetricInline, StatusPill } from "./Common";

type DiffFinding = RunDetail["findings"][number];
type RunDiff = {
  sharedCount: number;
  currentOnly: DiffFinding[];
  compareOnly: DiffFinding[];
  changed: Array<{
    current: DiffFinding;
    compare: DiffFinding;
    changes: string[];
  }>;
};

interface RunDiffPanelProps {
  currentRun: RunDetail;
  compareRunId: string;
  compareRunDetail: RunDetail | null;
  compareCandidates: RunSummary[];
  compareLoading: boolean;
  diff: RunDiff | null;
  onSelectCompareRun: (runId: string) => void;
}

export const RunDiffPanel = React.memo(function RunDiffPanel({
  currentRun,
  compareRunId,
  compareRunDetail,
  compareCandidates,
  compareLoading,
  diff,
  onSelectCompareRun,
}: RunDiffPanelProps) {
  return (
    <div className="run-diff-panel">
      <label className="field">
        <span className="field-label">Compare against</span>
        <div className="select-shell">
          <GitCompareArrows size={15} />
          <select
            value={compareRunId}
            onChange={(event) => onSelectCompareRun(event.target.value)}
          >
            <option value="">Select another run…</option>
            {compareCandidates.map((candidate) => (
              <option
                key={candidate.id}
                value={candidate.id}
              >
                {candidate.title} · {candidate.id}
              </option>
            ))}
          </select>
        </div>
      </label>

      {!compareRunId && <p className="muted" style={{ marginTop: "8px" }}>Choose another run to compare merged findings and severity mix.</p>}
      {compareLoading && <p className="muted" style={{ marginTop: "8px" }}>Loading compare run…</p>}

      {compareRunDetail && diff && (
        <>
          <div className="diff-summary-grid">
            <MetricInline label="Shared" value={String(diff.sharedCount)} />
            <MetricInline label="Changed" value={String(diff.changed.length)} />
            <MetricInline label="Current only" value={String(diff.currentOnly.length)} />
            <MetricInline label="Compare only" value={String(diff.compareOnly.length)} />
          </div>

          <div className="diff-identity">
            <div>
              <div className="eyebrow">Current</div>
              <strong>{currentRun.title}</strong>
            </div>
            <div>
              <div className="eyebrow">Compare</div>
              <strong>{compareRunDetail.title}</strong>
            </div>
          </div>

          <div className="diff-columns">
            <DiffFindingList
              title="Only in current"
              items={diff.currentOnly}
              emptyBody="No current-only merged findings."
            />
            <DiffChangeList items={diff.changed} />
            <DiffFindingList
              title="Only in compare"
              items={diff.compareOnly}
              emptyBody="No compare-only merged findings."
            />
          </div>
        </>
      )}
    </div>
  );
});

// DiffChangeList Component
const DiffChangeList = React.memo(function DiffChangeList({ items }: { items: RunDiff["changed"] }) {
  return (
    <section className="detail-block" style={{ padding: "12px 0" }}>
      <div className="detail-block-title">Changed shared</div>
      {items.length === 0 ? (
        <p>No severity or confidence changes.</p>
      ) : (
        <div className="diff-finding-list">
          {items.slice(0, 5).map((item) => (
            <div key={item.current.id} className="diff-finding-card">
              <div className="finding-card-top">
                <div className="finding-id">{item.current.id}</div>
                <StatusPill tone={severityTone(item.current.severity)} label={item.current.severity ?? "Unknown"} />
              </div>
              <div className="diff-finding-title">{item.current.title ?? "Untitled finding"}</div>
              <div className="finding-card-meta">
                {item.changes.map((change) => (
                  <span key={change}>{change}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

// DiffFindingList Component
interface DiffFindingListProps {
  title: string;
  items: Finding[];
  emptyBody: string;
}

const DiffFindingList = React.memo(function DiffFindingList({
  title,
  items,
  emptyBody,
}: DiffFindingListProps) {
  return (
    <section className="detail-block" style={{ padding: "12px 0" }}>
      <div className="detail-block-title">{title}</div>
      {items.length === 0 ? (
        <p>{emptyBody}</p>
      ) : (
        <div className="diff-finding-list">
          {items.slice(0, 5).map((item) => (
            <div
              key={item.id}
              className="diff-finding-card"
            >
              <div className="finding-card-top">
                <div className="finding-id">{item.id}</div>
                <StatusPill tone={severityTone(item.severity)} label={item.severity ?? "Unknown"} />
              </div>
              <div className="diff-finding-title">{item.title ?? "Untitled finding"}</div>
              <div className="finding-card-meta">
                <span>{item.locations[0] ?? "No location"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
