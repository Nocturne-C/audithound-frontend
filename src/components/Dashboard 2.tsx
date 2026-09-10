import React, { useMemo } from "react";
import { Clock } from "lucide-react";
import type { RunSummary, Severity } from "../types";
import { MetricCard } from "./Common";
import { formatRelativeDate } from "../lib/format";

interface DashboardProps {
  runs: RunSummary[];
  onSelectRun: (id: string) => void;
}

export const Dashboard = React.memo(function Dashboard({
  runs,
  onSelectRun,
}: DashboardProps) {
  // Aggregate Metrics
  const totalRuns = runs.length;
  const totalFindings = useMemo(() => runs.reduce((sum, r) => sum + r.totalFindings, 0), [runs]);
  const convergedRuns = useMemo(() => runs.filter((r) => r.converged).length, [runs]);

  const dominantSeverity = useMemo(() => {
    const totals: Record<string, number> = {
      Critical: 0,
      High: 0,
      Medium: 0,
      Low: 0,
      Informational: 0,
    };
    for (const r of runs) {
      for (const key of Object.keys(totals)) {
        totals[key] += r.severityCounts[key as Severity] || 0;
      }
    }
    let maxSev = "None";
    let maxCount = 0;
    for (const key of Object.keys(totals)) {
      if (totals[key] > maxCount) {
        maxCount = totals[key];
        maxSev = key;
      }
    }
    return maxCount > 0 ? maxSev : "None";
  }, [runs]);

  // Sparkline Trend Data
  const trendData = useMemo(() => {
    return [...runs]
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .map((r) => ({
        title: r.title,
        findings: r.totalFindings,
      }));
  }, [runs]);

  const latestRun = useMemo(
    () => [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
    [runs],
  );

  const svgChart = useMemo(() => {
    if (trendData.length < 2) return null;
    const maxVal = Math.max(...trendData.map((d) => d.findings), 5);
    const minVal = 0;
    const range = maxVal - minVal;
    const width = 800;
    const height = 120;
    const padding = 15;
    const usableHeight = height - padding * 2;
    const usableWidth = width - padding * 2;

    const points = trendData
      .map((d, index) => {
        const x = padding + (index / (trendData.length - 1)) * usableWidth;
        const y = height - padding - ((d.findings - minVal) / range) * usableHeight;
        return `${x},${y}`;
      })
      .join(" ");

    // For the filled area under the line
    const areaPoints = `${padding},${height - padding} ${points} ${
      padding + usableWidth
    },${height - padding}`;

    return { points, areaPoints, width, height };
  }, [trendData]);

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="eyebrow">Overview</div>
        <h2>Dashboard</h2>
        <div className="dashboard-card-subtitle">
          Studio-wide analysis, queue context, and fast access to the freshest review work
        </div>
      </div>

      {latestRun && (
        <section className="panel dashboard-feature">
          <div className="dashboard-feature-copy">
            <div className="eyebrow">Latest run</div>
            <h3>{latestRun.title}</h3>
            <p>
              {latestRun.totalFindings} findings across {latestRun.rounds.length} rounds. Updated{" "}
              {formatRelativeDate(latestRun.updatedAt)}.
            </p>
          </div>
          <button className="button secondary dashboard-feature-action" onClick={() => onSelectRun(latestRun.id)} type="button">
            Open latest run
          </button>
        </section>
      )}

      <section className="metric-strip" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <MetricCard
          label="Total runs"
          value={String(totalRuns)}
          hint="Indexed workspace runs"
          tone="neutral"
        />
        <MetricCard
          label="Total findings"
          value={String(totalFindings)}
          hint="Across all loaded scopes"
          tone={totalFindings > 0 ? "medium" : "safe"}
        />
        <MetricCard
          label="Converged runs"
          value={`${convergedRuns} / ${totalRuns}`}
          hint="Audit targets stabilized"
          tone="safe"
        />
        <MetricCard
          label="Dominant risk"
          value={dominantSeverity}
          hint="Highest aggregate severity"
          tone={
            dominantSeverity === "Critical" || dominantSeverity === "High"
              ? "critical"
              : dominantSeverity === "Medium"
              ? "medium"
              : "safe"
          }
        />
      </section>

      {/* Sparkline Trend */}
      {svgChart && (
        <div className="dashboard-trend">
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            Findings Accumulation Trend
          </div>
          <div style={{ position: "relative" }}>
            <svg
              viewBox={`0 0 ${svgChart.width} ${svgChart.height}`}
              width="100%"
              height={svgChart.height}
              style={{ overflow: "visible" }}
            >
              <defs>
                <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Grid lines */}
              <line
                x1="15"
                y1="15"
                x2={svgChart.width - 15}
                y2="15"
                stroke="var(--separator)"
                strokeDasharray="4 4"
              />
              <line
                x1="15"
                y1="60"
                x2={svgChart.width - 15}
                y2="60"
                stroke="var(--separator)"
                strokeDasharray="4 4"
              />
              <line
                x1="15"
                y1="105"
                x2={svgChart.width - 15}
                y2="105"
                stroke="var(--separator)"
                strokeDasharray="4 4"
              />

              {/* Area */}
              <polygon points={svgChart.areaPoints} fill="url(#chartGrad)" />

              {/* Line */}
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={svgChart.points}
              />

              {/* Dot markers */}
              {trendData.map((d, index) => {
                const maxVal = Math.max(...trendData.map((x) => x.findings), 5);
                const minVal = 0;
                const range = maxVal - minVal;
                const padding = 15;
                const usableHeight = svgChart.height - padding * 2;
                const usableWidth = svgChart.width - padding * 2;
                const x = padding + (index / (trendData.length - 1)) * usableWidth;
                const y = svgChart.height - padding - ((d.findings - minVal) / range) * usableHeight;

                return (
                  <g key={index}>
                    <circle cx={x} cy={y} r="5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
                    <title>{`${d.title}: ${d.findings} findings`}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Runs Grid */}
      <div className="dashboard-grid">
        {runs.map((run) => {
          const total = run.totalFindings || 1;
          const crit = run.severityCounts.Critical || 0;
          const high = run.severityCounts.High || 0;
          const med = run.severityCounts.Medium || 0;
          const low = run.severityCounts.Low || 0;
          const info = run.severityCounts.Informational || 0;

          return (
            <div
              key={run.id}
              className="dashboard-card"
              onClick={() => onSelectRun(run.id)}
            >
              <div className="dashboard-card-header">
                <div>
                  <div className="dashboard-card-title">{run.title}</div>
                  <div className="dashboard-card-subtitle">{run.id}</div>
                </div>
                <div
                  className="status-pill"
                  style={{
                    backgroundColor: run.converged ? "rgba(52, 199, 89, 0.1)" : "rgba(0, 113, 227, 0.1)",
                    color: run.converged ? "var(--safe)" : "var(--accent)",
                    padding: "3px 8px",
                    borderRadius: "10px",
                    fontSize: "9px",
                    fontWeight: 600,
                  }}
                >
                  {run.converged ? "Converged" : "Active"}
                </div>
              </div>

              <div className="dashboard-card-metrics">
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "10px", color: "var(--label-secondary)" }}>Findings</span>
                  <strong style={{ fontSize: "16px", color: "var(--label)" }}>{run.totalFindings}</strong>
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "10px", color: "var(--label-secondary)" }}>Last Delta</span>
                  <strong style={{ fontSize: "16px", color: run.latestDelta > 0 ? "var(--critical)" : "var(--safe)" }}>
                    {run.latestDelta >= 0 ? "+" : ""}
                    {run.latestDelta}
                  </strong>
                </div>
              </div>

              {/* Progress bar stack representing distribution */}
              <div>
                <div className="dashboard-card-subtitle" style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span>Severity Distribution</span>
                  <span>{`${crit}C / ${high}H / ${med}M / ${low}L`}</span>
                </div>
                <div className="dashboard-card-bar">
                  <div
                    className="dashboard-card-bar-segment"
                    style={{ width: `${(crit / total) * 100}%`, backgroundColor: "var(--critical)" }}
                  />
                  <div
                    className="dashboard-card-bar-segment"
                    style={{ width: `${(high / total) * 100}%`, backgroundColor: "var(--high)" }}
                  />
                  <div
                    className="dashboard-card-bar-segment"
                    style={{ width: `${(med / total) * 100}%`, backgroundColor: "var(--medium)" }}
                  />
                  <div
                    className="dashboard-card-bar-segment"
                    style={{ width: `${(low / total) * 100}%`, backgroundColor: "var(--low)" }}
                  />
                  <div
                    className="dashboard-card-bar-segment"
                    style={{ width: `${(info / total) * 100}%`, backgroundColor: "var(--safe)" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4, fontSize: "10px", color: "var(--label-tertiary)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Clock size={11} />
                  {formatRelativeDate(run.updatedAt)}
                </span>
                <span>Rounds: {run.rounds.length}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
