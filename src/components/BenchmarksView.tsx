import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CheckCircle2, FlaskConical, Gauge, LoaderCircle, RefreshCw, Scale, ShieldCheck } from "lucide-react";

import { fetchBenchmarks } from "../lib/api";
import type { BenchmarkPayload } from "../types";
import { EmptyBlock, MetricCard } from "./Common";

type BenchmarksViewProps = {
  onOpenRun: (runId: string) => void;
};

export const BenchmarksView = React.memo(function BenchmarksView({ onOpenRun }: BenchmarksViewProps) {
  const [benchmark, setBenchmark] = useState<BenchmarkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setBenchmark(await fetchBenchmarks());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to build benchmark overview.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const reviewRate = useMemo(
    () => benchmark && benchmark.totalFindings > 0 ? Math.round((benchmark.reviewedFindings / benchmark.totalFindings) * 100) : 0,
    [benchmark],
  );

  if (loading && !benchmark) {
    return (
      <div className="product-view">
        <EmptyBlock icon={<LoaderCircle size={18} />} title="Building benchmark view" body="Aggregating reviewer outcomes, reproduction decisions, and repeat-run deltas." />
      </div>
    );
  }

  if (!benchmark) {
    return (
      <div className="product-view">
        <EmptyBlock icon={<FlaskConical size={18} />} title="Benchmark unavailable" body={error ?? "No run data is available."} />
      </div>
    );
  }

  return (
    <div className="benchmarks-view product-view">
      <header className="product-header">
        <div>
          <div className="eyebrow">Benchmarks</div>
          <h2>Measure trust, not just finding volume.</h2>
          <p>Operational quality combines review completion, reproduction decisions, calibration, and stable behavior across reruns.</p>
        </div>
        <button className="button secondary" disabled={loading} onClick={() => void load()} type="button">
          <RefreshCw className={loading ? "spin" : ""} size={14} />
          Refresh
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <section className="metric-strip benchmark-metrics">
        <MetricCard label="Runs observed" value={String(benchmark.totalRuns)} hint={`${benchmark.convergedRuns} converged`} tone="neutral" />
        <MetricCard label="Reviewed" value={`${reviewRate}%`} hint={`${benchmark.reviewedFindings} of ${benchmark.totalFindings} findings`} tone={reviewRate >= 70 ? "safe" : "medium"} />
        <MetricCard label="Confirmed" value={String(benchmark.confirmedFindings)} hint="Reviewer-confirmed findings" tone="safe" />
        <MetricCard label="Reproduced" value={String(benchmark.reproducibleFindings)} hint="Explicit reproduction decision" tone={benchmark.reproducibleFindings > 0 ? "safe" : "medium"} />
        <MetricCard label="Average rounds" value={String(benchmark.averageRounds)} hint="Until stop or convergence" tone="neutral" />
      </section>

      {benchmark.evaluatedCases && benchmark.evaluatedCases > 0 ? (
        <section className="benchmark-calibration is-ready">
          <div>
            <Scale size={18} />
            <span>
              <small>Ground-truth calibration</small>
              <strong>{benchmark.evaluatedCases} reviewed cases</strong>
            </span>
          </div>
          <div className="benchmark-calibration-metrics">
            <span>Precision <strong>{formatRate(benchmark.precision)}</strong></span>
            <span>Recall <strong>{formatRate(benchmark.recall)}</strong></span>
            <span>False-negative rate <strong>{formatRate(benchmark.falseNegativeRate)}</strong></span>
          </div>
        </section>
      ) : (
        <section className="benchmark-calibration">
          <div>
            <Scale size={18} />
            <span>
              <small>Ground-truth calibration</small>
              <strong>Not evaluated yet</strong>
            </span>
          </div>
          <p>
            Review completion measures process progress, not accuracy. Add a reviewer-approved `benchmark_result.json` before
            precision or recall is displayed.
          </p>
        </section>
      )}

      <section className="benchmark-quality-ladder">
        <div className="benchmark-quality-copy">
          <Gauge size={18} />
          <div>
            <div className="eyebrow">Quality ladder</div>
            <h3>Volume is only the first rung.</h3>
            <p>A reliable audit advances from candidate generation to reviewer disposition, confirmation, reproduction, and regression stability.</p>
          </div>
        </div>
        <div className="quality-ladder">
          <QualityStep label="Candidates" value={benchmark.totalFindings} tone="neutral" />
          <QualityStep label="Reviewed" value={benchmark.reviewedFindings} tone="blue" />
          <QualityStep label="Confirmed" value={benchmark.confirmedFindings} tone="green" />
          <QualityStep label="Reproduced" value={benchmark.reproducibleFindings} tone="violet" />
        </div>
      </section>

      <section className="benchmark-table-panel">
        <div className="benchmark-table-header">
          <div>
            <div className="eyebrow">Target history</div>
            <h3>Repeat-run stability</h3>
          </div>
          <span>{benchmark.targets.length} target{benchmark.targets.length === 1 ? "" : "s"}</span>
        </div>
        <div className="benchmark-table">
          <div className="benchmark-row is-header">
            <span>Target</span>
            <span>Runs</span>
            <span>Latest</span>
            <span>Delta</span>
            <span>Review</span>
            <span>State</span>
            <span />
          </div>
          {benchmark.targets.map((target) => (
            <div className="benchmark-row" key={target.id}>
              <span className="benchmark-target">
                <strong>{target.title}</strong>
                <small>{target.latestRunId}</small>
              </span>
              <span>{target.runCount}</span>
              <span>{target.latestFindings}</span>
              <span className={target.findingDelta && target.findingDelta > 0 ? "delta-up" : target.findingDelta && target.findingDelta < 0 ? "delta-down" : ""}>
                {target.findingDelta === null ? "—" : `${target.findingDelta > 0 ? "+" : ""}${target.findingDelta}`}
              </span>
              <span>
                <span className="benchmark-rate"><span style={{ width: `${target.reviewRate}%` }} /></span>
                <small>{target.reviewRate}%</small>
              </span>
              <span className={`benchmark-state ${target.converged ? "is-converged" : ""}`}>
                {target.converged ? <CheckCircle2 size={13} /> : <ShieldCheck size={13} />}
                {target.converged ? "Converged" : "Open"}
              </span>
              <button className="icon-button" onClick={() => onOpenRun(target.latestRunId)} title="Open latest run" type="button">
                <ArrowUpRight size={14} />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
});

function QualityStep({ label, value, tone }: { label: string; value: number; tone: "neutral" | "blue" | "green" | "violet" }) {
  return (
    <div className={`quality-step is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}
