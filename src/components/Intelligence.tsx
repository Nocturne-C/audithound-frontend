import React from "react";
import { FolderSearch2 } from "lucide-react";
import type { CountMap } from "../types";
import { confidenceTone, severityTone, sumCounts, toPercent } from "../lib/format";
import { EmptyBlock, StatusPill } from "./Common";

// DistributionList
interface DistributionListProps {
  counts: CountMap;
  order: string[];
  mode: "severity" | "confidence";
}

export const DistributionList = React.memo(function DistributionList({
  counts,
  order,
  mode,
}: DistributionListProps) {
  const total = sumCounts(counts);

  return (
    <div className="distribution-list">
      {order.map((key) => {
        const value = counts[key] ?? 0;
        return (
          <div
            key={key}
            className="distribution-row"
          >
            <div className="distribution-meta">
              <StatusPill tone={mode === "severity" ? severityTone(key) : confidenceTone(key)} label={key} />
              <span>{value}</span>
            </div>
            <div className="distribution-track">
              <div
                className={`distribution-fill tone-${mode === "severity" ? severityTone(key) : confidenceTone(key)}`}
                style={{ width: `${toPercent(value, total)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
});

// HotspotList
interface HotspotListProps {
  hotspots: Array<{ file: string; count: number }>;
}

export const HotspotList = React.memo(function HotspotList({ hotspots }: HotspotListProps) {
  const max = Math.max(1, ...hotspots.map((item) => item.count));

  if (hotspots.length === 0) {
    return (
      <EmptyBlock
        icon={<FolderSearch2 size={18} />}
        title="No hotspots yet"
        body="Findings with source locations will surface file pressure here."
        compact
      />
    );
  }

  return (
    <div className="hotspot-list">
      {hotspots.map((hotspot) => (
        <div
          key={hotspot.file}
          className="hotspot-row"
        >
          <div className="hotspot-head">
            <code>{hotspot.file}</code>
            <strong>{hotspot.count}</strong>
          </div>
          <div className="distribution-track">
            <div
              className="distribution-fill tone-high"
              style={{ width: `${Math.round((hotspot.count / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
});

// AgentMix
interface AgentMixProps {
  counts: CountMap;
}

export const AgentMix = React.memo(function AgentMix({ counts }: AgentMixProps) {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  if (entries.length === 0) {
    return <p className="muted">No source agent attribution available.</p>;
  }

  return (
    <div className="tag-row">
      {entries.map(([agent, count]) => (
        <span
          key={agent}
          className="tag"
        >
          {agent} · {count}
        </span>
      ))}
    </div>
  );
});
