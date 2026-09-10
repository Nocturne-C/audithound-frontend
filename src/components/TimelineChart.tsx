import React from "react";
import type { RoundSummary } from "../types";

interface TimelineChartProps {
  rounds: RoundSummary[];
}

export const TimelineChart = React.memo(function TimelineChart({ rounds }: TimelineChartProps) {
  if (rounds.length === 0) {
    return <p className="muted">No round data available.</p>;
  }

  const maxNew = Math.max(1, ...rounds.map((round) => round.summary.newFindings));
  const maxTotal = Math.max(1, ...rounds.map((round) => round.summary.totalFindings));

  const width = 500;
  const height = 200;
  const paddingX = 40;
  const paddingY = 30;

  const N = rounds.length;
  const stepX = N > 1 ? (width - 2 * paddingX) / (N - 1) : 0;

  // Draw trend lines and area pathways
  const points = rounds.map((round, idx) => {
    const x = N > 1 ? paddingX + idx * stepX : width / 2;
    const yNew = height - paddingY - (round.summary.newFindings / maxNew) * (height - 2 * paddingY);
    const yTotal = height - paddingY - (round.summary.totalFindings / maxTotal) * (height - 2 * paddingY);
    return { x, yNew, yTotal, round };
  });

  const linePath = N > 1 
    ? points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.yNew}`).join(" ")
    : "";

  const areaPath = N > 1
    ? `${linePath} L ${points[N - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`
    : "";

  return (
    <div className="timeline-chart" style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="200" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="chart-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        <line x1={paddingX} y1="40" x2={width - paddingX} y2="40" stroke="var(--line-soft)" strokeDasharray="3 3" />
        <line x1={paddingX} y1="100" x2={width - paddingX} y2="100" stroke="var(--line-soft)" strokeDasharray="3 3" />
        <line x1={paddingX} y1="160" x2={width - paddingX} y2="160" stroke="var(--line-soft)" />

        {/* Total findings columns (glass style) */}
        {points.map((p) => (
          <g key={`col-${p.round.round}`}>
            <rect
              x={p.x - 8}
              y={p.yTotal}
              width="16"
              height={height - paddingY - p.yTotal}
              rx="4"
              fill="rgba(255, 255, 255, 0.02)"
              stroke="var(--line-strong)"
              strokeWidth="1"
            />
            {/* Round indicator text */}
            <text x={p.x} y="190" textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--muted-soft)">
              R{p.round.round}
            </text>
          </g>
        ))}

        {/* Trend Area under new findings */}
        {N > 1 && <path d={areaPath} fill="url(#chart-glow)" />}

        {/* Trend Line for new findings */}
        {N > 1 && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Dynamic dots and value tags */}
        {points.map((p) => (
          <g key={`dot-${p.round.round}`}>
            <circle
              cx={p.x}
              cy={p.yNew}
              r="5"
              fill="var(--accent-strong)"
              stroke="var(--bg-deep)"
              strokeWidth="2"
              style={{ filter: "drop-shadow(0 0 4px var(--accent))" }}
            />
            <text x={p.x} y={p.yNew - 12} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)">
              {p.round.summary.newFindings}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
});
