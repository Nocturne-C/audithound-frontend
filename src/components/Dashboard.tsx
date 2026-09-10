import React, { useMemo } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  Plus,
  ShieldAlert,
} from "lucide-react";

import type { RunSummary, Severity } from "../types";
import { formatRelativeDate } from "../lib/format";
import { EmptyBlock, MetricCard } from "./Common";

type DashboardProps = {
  runs: RunSummary[];
  onSelectRun: (id: string) => void;
  onNewScan: () => void;
};

export const Dashboard = React.memo(function Dashboard({ runs, onSelectRun, onNewScan }: DashboardProps) {
  const portfolio = useMemo(() => {
    const findings = runs.reduce((sum, run) => sum + run.totalFindings, 0);
    const critical = runs.reduce((sum, run) => sum + (run.severityCounts.Critical ?? 0), 0);
    const high = runs.reduce((sum, run) => sum + (run.severityCounts.High ?? 0), 0);
    const converged = runs.filter((run) => run.converged).length;
    const open = runs.filter((run) => !run.converged || run.latestDelta > 0);
    return { findings, critical, high, converged, open };
  }, [runs]);

  const recentRuns = useMemo(
    () => [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 8),
    [runs],
  );

  const attentionRuns = useMemo(
    () =>
      [...runs]
        .filter((run) => run.severityCounts.Critical > 0 || run.severityCounts.High > 0 || !run.converged)
        .sort((left, right) => {
          const leftScore = left.severityCounts.Critical * 100 + left.severityCounts.High * 10 + Number(!left.converged);
          const rightScore = right.severityCounts.Critical * 100 + right.severityCounts.High * 10 + Number(!right.converged);
          return rightScore - leftScore || right.updatedAt.localeCompare(left.updatedAt);
        })
        .slice(0, 4),
    [runs],
  );

  return (
    <div className="dashboard product-view">
      <header className="product-header dashboard-product-header">
        <div>
          <div className="eyebrow">Portfolio</div>
          <h2>Turn audit output into decisions.</h2>
          <p>Prioritize unresolved risk, continue active reviews, and track whether repeat scans are becoming more trustworthy.</p>
        </div>
        <button className="button primary" onClick={onNewScan} type="button">
          <Plus size={14} />
          New scan
        </button>
      </header>

      <section className="metric-strip portfolio-metrics">
        <MetricCard label="Indexed reviews" value={String(runs.length)} hint={`${portfolio.converged} converged`} tone="neutral" />
        <MetricCard label="Open attention" value={String(portfolio.open.length)} hint="Active or changed runs" tone={portfolio.open.length > 0 ? "medium" : "safe"} />
        <MetricCard label="Critical / High" value={`${portfolio.critical} / ${portfolio.high}`} hint="Across indexed outputs" tone={portfolio.critical > 0 ? "critical" : portfolio.high > 0 ? "medium" : "safe"} />
        <MetricCard label="Findings retained" value={String(portfolio.findings)} hint="Before reviewer disposition" tone="neutral" />
      </section>

      <section className="portfolio-layout">
        <div className="portfolio-primary">
          <div className="portfolio-section-head">
            <div>
              <div className="eyebrow">Attention</div>
              <h3>Review the work with the highest decision pressure.</h3>
            </div>
            <span>{attentionRuns.length} surfaced</span>
          </div>

          <div className="attention-list">
            {attentionRuns.map((run) => (
              <button className="attention-card" key={run.id} onClick={() => onSelectRun(run.id)} type="button">
                <div className="attention-card-state">
                  {run.converged ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                </div>
                <div className="attention-card-main">
                  <div>
                    <strong>{run.title}</strong>
                    <span>{run.id}</span>
                  </div>
                  <p>
                    {run.severityCounts.Critical > 0
                      ? `${run.severityCounts.Critical} critical finding${run.severityCounts.Critical === 1 ? "" : "s"} require immediate review.`
                      : run.severityCounts.High > 0
                        ? `${run.severityCounts.High} high-severity finding${run.severityCounts.High === 1 ? "" : "s"} remain in the evidence set.`
                        : "Execution has not reached a stable convergence baseline."}
                  </p>
                </div>
                <div className="attention-card-metrics">
                  <span><strong>{run.totalFindings}</strong> findings</span>
                  <span><strong>{run.latestDelta >= 0 ? `+${run.latestDelta}` : run.latestDelta}</strong> latest delta</span>
                </div>
                <ArrowUpRight size={15} />
              </button>
            ))}
            {attentionRuns.length === 0 && (
              <EmptyBlock
                icon={<CheckCircle2 size={18} />}
                title="No urgent review pressure"
                body="Every indexed run is converged and has no new latest-round delta."
              />
            )}
          </div>
        </div>

        <aside className="portfolio-rail">
          <div className="portfolio-rail-card">
            <div className="portfolio-rail-icon"><ShieldAlert size={16} /></div>
            <div>
              <div className="eyebrow">Operating principle</div>
              <h3>Evidence before severity.</h3>
              <p>A severe claim without a trigger path, source anchor, and actor model should not reach delivery.</p>
            </div>
          </div>
          <div className="portfolio-rail-card">
            <div className="portfolio-rail-icon"><GitCompareArrows size={16} /></div>
            <div>
              <div className="eyebrow">Regression posture</div>
              <h3>{repeatTargetCount(runs)} repeated target{repeatTargetCount(runs) === 1 ? "" : "s"}.</h3>
              <p>Repeat scans can be compared by stable root-cause fingerprints instead of title similarity alone.</p>
            </div>
          </div>
        </aside>
      </section>

      <section className="recent-runs-panel">
        <div className="portfolio-section-head">
          <div>
            <div className="eyebrow">Recent work</div>
            <h3>Latest review runs</h3>
          </div>
          <span>{runs.length} total</span>
        </div>
        <div className="recent-runs-table">
          <div className="recent-run-row is-header">
            <span>Target</span>
            <span>State</span>
            <span>Findings</span>
            <span>Risk</span>
            <span>Rounds</span>
            <span>Updated</span>
            <span />
          </div>
          {recentRuns.map((run) => (
            <button className="recent-run-row" key={run.id} onClick={() => onSelectRun(run.id)} type="button">
              <span className="recent-run-target"><strong>{run.title}</strong><small>{run.id}</small></span>
              <span className={`recent-run-state ${run.converged ? "is-converged" : ""}`}>
                <span />
                {run.converged ? "Converged" : "Review open"}
              </span>
              <span>{run.totalFindings}</span>
              <span className={`risk-label is-${run.dominantSeverity.toLowerCase()}`}>{shortSeverity(run.dominantSeverity)}</span>
              <span>{run.rounds.length}</span>
              <span>{formatRelativeDate(run.updatedAt)}</span>
              <span><ArrowUpRight size={14} /></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
});

function repeatTargetCount(runs: RunSummary[]) {
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.title, (counts.get(run.title) ?? 0) + 1);
  }
  return [...counts.values()].filter((count) => count > 1).length;
}

function shortSeverity(severity: Severity) {
  return severity === "Informational" ? "Info" : severity;
}
