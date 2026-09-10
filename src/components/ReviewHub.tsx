import React, { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Clock3,
  FileWarning,
  RefreshCcw,
  Search,
  ShieldCheck,
} from "lucide-react";

import { formatRelativeDate } from "../lib/format";
import type { JobRecord, RunSummary } from "../types";
import { EmptyBlock, MetricCard, StatusPill } from "./Common";

interface ReviewHubProps {
  runs: RunSummary[];
  jobs: JobRecord[];
  loading: boolean;
  onOpenRun: (runId: string) => void;
  onOpenJob: (jobId: string) => void;
  onRefresh: () => void;
}

type ReviewState = "live" | "ready" | "partial" | "delivered" | "draft";
type ReviewFilter = "all" | Exclude<ReviewState, "draft">;

type ReviewItem = {
  key: string;
  state: ReviewState;
  run: RunSummary | null;
  job: JobRecord | null;
  title: string;
  subtitle: string;
  projectId: string;
  engagementId: string;
  updatedAt: string;
};

const activeJobStatuses = new Set<JobRecord["status"]>([
  "queued",
  "preparing",
  "running",
  "paused",
  "rate_limited",
]);

const filterOptions: Array<{ id: ReviewFilter; label: string }> = [
  { id: "all", label: "All reviews" },
  { id: "live", label: "Live" },
  { id: "ready", label: "Needs review" },
  { id: "partial", label: "Partial" },
  { id: "delivered", label: "Delivered" },
];

export const ReviewHub = React.memo(function ReviewHub({
  runs,
  jobs,
  loading,
  onOpenRun,
  onOpenJob,
  onRefresh,
}: ReviewHubProps) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [search, setSearch] = useState("");
  const items = useMemo(() => buildReviewItems(runs, jobs), [jobs, runs]);
  const counts = useMemo(
    () => ({
      live: items.filter((item) => item.state === "live").length,
      ready: items.filter((item) => item.state === "ready").length,
      partial: items.filter((item) => item.state === "partial").length,
      delivered: items.filter((item) => item.state === "delivered").length,
    }),
    [items],
  );
  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.state !== filter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return [
        item.title,
        item.subtitle,
        item.projectId,
        item.engagementId,
        item.run?.id,
        item.job?.id,
        item.job?.stage,
        item.job?.settings.model,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }, [filter, items, search]);

  return (
    <div className="review-hub">
      <section className="panel hero hero-split review-hub-hero">
        <div className="hero-copy">
          <div className="eyebrow">Review workspace</div>
          <div className="hero-title-row">
            <h2>Choose the review you want to enter.</h2>
          </div>
          <p>
            Live scans, decision-ready evidence, interrupted partial results, and delivered engagements stay in one queue.
            Nothing opens until you choose it.
          </p>
          <div className="hero-meta-row">
            <span className="hero-meta-pill">{items.length} review records</span>
            <span className="hero-meta-pill">{counts.live} live</span>
            <span className="hero-meta-pill">{counts.ready} awaiting judgment</span>
          </div>
        </div>
        <div className="hero-sidecard review-hub-principle">
          <div className="hero-sidecard-section">
            <div className="eyebrow">Clear separation</div>
            <strong>Scans execute. Review decides.</strong>
            <span>
              Scans remains the operational log. Review is the human workbench where you deliberately select and inspect
              any available result.
            </span>
          </div>
          <div className="hero-sidecard-actions">
            <button className="action-button" onClick={onRefresh} type="button">
              <RefreshCcw size={15} />
              <span>Refresh review queue</span>
            </button>
          </div>
        </div>
      </section>

      <section className="metric-strip review-hub-metrics">
        <MetricCard
          label="Live"
          value={String(counts.live)}
          hint="Queued, preparing, running, paused, or rate limited"
          tone={counts.live > 0 ? "info" : "neutral"}
        />
        <MetricCard
          label="Needs Review"
          value={String(counts.ready)}
          hint="Evidence is available for human disposition"
          tone={counts.ready > 0 ? "medium" : "neutral"}
        />
        <MetricCard
          label="Partial"
          value={String(counts.partial)}
          hint="Interrupted work with inspectable output"
          tone={counts.partial > 0 ? "critical" : "neutral"}
        />
        <MetricCard
          label="Delivered"
          value={String(counts.delivered)}
          hint="Completed review packages"
          tone="safe"
        />
      </section>

      <section className="review-browser" aria-label="Review selection">
        <div className="review-toolbar">
          <label className="review-search">
            <Search size={15} />
            <input
              aria-label="Search reviews"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search project, engagement, model, or run…"
              value={search}
            />
          </label>
          <div className="review-filters" aria-label="Filter reviews">
            {filterOptions.map((option) => {
              const count = option.id === "all" ? items.length : counts[option.id];
              return (
                <button
                  aria-pressed={filter === option.id}
                  className={filter === option.id ? "is-active" : ""}
                  key={option.id}
                  onClick={() => setFilter(option.id)}
                  type="button"
                >
                  <span>{option.label}</span>
                  <small>{count}</small>
                </button>
              );
            })}
          </div>
        </div>

        <div className="review-results-heading">
          <div>
            <div className="eyebrow">Available work</div>
            <h3>{filter === "all" ? "All review records" : filterOptions.find((option) => option.id === filter)?.label}</h3>
          </div>
          <span>{visibleItems.length} shown</span>
        </div>

        {loading && items.length === 0 && (
          <div className="panel review-hub-empty">
            <EmptyBlock
              icon={<Activity className="spin" size={18} />}
              title="Loading review queue"
              body="Joining persisted runs with live execution state."
            />
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="panel review-hub-empty">
            <EmptyBlock
              icon={<ShieldCheck size={18} />}
              title="No reviews yet"
              body="Start a scan to create the first review record."
            />
          </div>
        )}

        {items.length > 0 && visibleItems.length === 0 && (
          <div className="panel review-hub-empty">
            <EmptyBlock
              icon={<Search size={18} />}
              title="No matching reviews"
              body="Adjust the state filter or search terms."
            />
          </div>
        )}

        <div className="review-card-grid">
          {visibleItems.map((item) => (
            <ReviewCard
              item={item}
              key={item.key}
              onOpenJob={onOpenJob}
              onOpenRun={onOpenRun}
            />
          ))}
        </div>
      </section>
    </div>
  );
});

function ReviewCard({
  item,
  onOpenRun,
  onOpenJob,
}: {
  item: ReviewItem;
  onOpenRun: (runId: string) => void;
  onOpenJob: (jobId: string) => void;
}) {
  const presentation = statePresentation(item);
  const executionStatus = item.job ? humanize(item.job.status) : "Historical run";
  const workflowStatus = workflowStatusLabel(item);
  const stage = currentStage(item);
  const stageDetail = currentStageDetail(item);
  const source = reviewSource(item);

  return (
    <article className="review-card" data-state={item.state}>
      <header className="review-card-header">
        <div className="review-card-state-icon" aria-hidden="true">
          {presentation.icon}
        </div>
        <div className="review-card-identity">
          <div className="review-card-kicker">
            <span>{item.projectId}</span>
            <span>/</span>
            <code>{item.engagementId}</code>
          </div>
          <h3>{item.title}</h3>
          <p title={item.subtitle}>{item.subtitle}</p>
        </div>
        <StatusPill label={presentation.label} tone={presentation.tone} />
      </header>

      <div className="review-card-stage">
        <div className="review-card-stage-copy">
          <span>Current stage</span>
          <strong>{stage}</strong>
          <p>{stageDetail}</p>
        </div>
        {item.state === "live" && <span className="review-live-beacon">Live</span>}
      </div>

      <div className="review-card-facts">
        <div>
          <span>Execution</span>
          <strong>{executionStatus}</strong>
        </div>
        <div>
          <span>Workflow</span>
          <strong>{workflowStatus}</strong>
        </div>
        <div>
          <span>Findings</span>
          <strong>{item.run ? item.run.totalFindings : "—"}</strong>
        </div>
        <div>
          <span>Rounds</span>
          <strong>{roundLabel(item)}</strong>
        </div>
      </div>

      <footer className="review-card-footer">
        <div className="review-card-source">
          <span title={source}>{source}</span>
          <small>Updated {formatRelativeDate(item.updatedAt)}</small>
        </div>
        <div className="review-card-actions">
          {item.job && item.run && (
            <button className="button secondary" onClick={() => onOpenJob(item.job!.id)} type="button">
              Execution
            </button>
          )}
          {item.run ? (
            <button className="button primary" onClick={() => onOpenRun(item.run!.id)} type="button">
              <span>{primaryActionLabel(item.state)}</span>
              <ArrowUpRight size={14} />
            </button>
          ) : item.job ? (
            <button className="button primary" onClick={() => onOpenJob(item.job!.id)} type="button">
              <span>Open execution</span>
              <ArrowUpRight size={14} />
            </button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function buildReviewItems(runs: RunSummary[], jobs: JobRecord[]) {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const itemsByIdentity = new Map<string, ReviewItem>();
  const sortedJobs = [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  for (const job of sortedJobs) {
    const linkedRunId = job.runId && runsById.has(job.runId)
      ? job.runId
      : runsById.has(job.id)
        ? job.id
        : null;
    const run = linkedRunId ? runsById.get(linkedRunId) ?? null : null;
    const identity = linkedRunId ? `run:${linkedRunId}` : `job:${job.id}`;
    if (itemsByIdentity.has(identity)) {
      continue;
    }
    itemsByIdentity.set(identity, {
      key: identity,
      state: deriveReviewState(run, job),
      run,
      job,
      title: job.name || run?.title || job.id,
      subtitle: run?.subtitle || sourceLabel(job),
      projectId: run?.projectId || job.projectId,
      engagementId: run?.engagementId || job.engagementId,
      updatedAt: laterTimestamp(run?.updatedAt, job.updatedAt),
    });
  }

  for (const run of runs) {
    const identity = `run:${run.id}`;
    if (itemsByIdentity.has(identity)) {
      continue;
    }
    itemsByIdentity.set(identity, {
      key: identity,
      state: deriveReviewState(run, null),
      run,
      job: null,
      title: run.title,
      subtitle: run.subtitle,
      projectId: run.projectId,
      engagementId: run.engagementId,
      updatedAt: run.updatedAt,
    });
  }

  const stateOrder: Record<ReviewState, number> = {
    live: 0,
    ready: 1,
    partial: 2,
    draft: 3,
    delivered: 4,
  };
  return [...itemsByIdentity.values()].sort(
    (left, right) =>
      stateOrder[left.state] - stateOrder[right.state] ||
      right.updatedAt.localeCompare(left.updatedAt),
  );
}

function deriveReviewState(run: RunSummary | null, job: JobRecord | null): ReviewState {
  if (job && activeJobStatuses.has(job.status)) {
    return "live";
  }
  if (job?.status === "review_ready" || run?.workflowStatus === "awaiting_review") {
    return "ready";
  }
  if (
    job?.status === "failed" ||
    job?.status === "cancelled" ||
    run?.workflowStatus === "failed" ||
    run?.workflowStatus === "cancelled"
  ) {
    return "partial";
  }
  if (job?.status === "succeeded" || run?.workflowStatus === "completed") {
    return "delivered";
  }
  if (run && run.totalFindings > 0) {
    return "ready";
  }
  return "draft";
}

function statePresentation(item: ReviewItem) {
  if (item.state === "live") {
    if (item.job?.status === "rate_limited") {
      return { label: "Rate limited", tone: "medium", icon: <Clock3 size={16} /> };
    }
    if (item.job?.status === "paused" || item.run?.workflowStatus === "paused") {
      return { label: "Paused", tone: "medium", icon: <Clock3 size={16} /> };
    }
    return { label: "Live", tone: "info", icon: <Activity size={16} /> };
  }
  if (item.state === "ready") {
    return { label: "Needs review", tone: "medium", icon: <ShieldCheck size={16} /> };
  }
  if (item.state === "partial") {
    return { label: "Partial result", tone: "critical", icon: <FileWarning size={16} /> };
  }
  if (item.state === "delivered") {
    return { label: "Delivered", tone: "safe", icon: <BadgeCheck size={16} /> };
  }
  return { label: "Draft", tone: "neutral", icon: <Clock3 size={16} /> };
}

function currentStage(item: ReviewItem) {
  if (item.job?.stage) {
    return humanizeStage(item.job.stage);
  }
  if (item.run?.workflowStatus === "awaiting_review") {
    return "Human evidence gate";
  }
  if (item.run?.workflowStatus === "completed") {
    return "Delivery package";
  }
  if (item.run?.workflowStatus === "failed") {
    return "Execution interrupted";
  }
  if (item.run && item.run.totalFindings > 0) {
    return "Legacy review";
  }
  return "Awaiting execution";
}

function currentStageDetail(item: ReviewItem) {
  if (item.job?.error) {
    return item.job.error;
  }
  if (item.job && activeJobStatuses.has(item.job.status)) {
    return `${item.job.settings.workers} worker${item.job.settings.workers === 1 ? "" : "s"} · ${item.job.settings.model} · up to ${item.job.settings.maxRounds} rounds`;
  }
  if (item.state === "ready") {
    return `${item.run?.totalFindings ?? 0} findings are available for human disposition.`;
  }
  if (item.state === "partial") {
    return "Preserved evidence remains inspectable even though execution did not finish.";
  }
  if (item.state === "delivered") {
    return "The review lifecycle is complete and its retained evidence remains available.";
  }
  return "No inspectable evidence has been produced yet.";
}

function reviewSource(item: ReviewItem) {
  if (item.run?.repository) {
    return item.run.repository.replace(/\.git$/, "");
  }
  if (item.run?.targetPath) {
    return item.run.targetPath;
  }
  if (item.job) {
    return sourceLabel(item.job);
  }
  return item.run?.relativePath ?? "Local source snapshot";
}

function sourceLabel(job: JobRecord) {
  if (job.source.type === "github") {
    return job.source.repoUrl;
  }
  return job.source.type === "upload" ? job.source.originalName : job.source.path;
}

function roundLabel(item: ReviewItem) {
  const completedRounds = item.run?.rounds.length ?? 0;
  if (item.job && activeJobStatuses.has(item.job.status)) {
    return `${completedRounds} / ${item.job.settings.maxRounds}`;
  }
  return String(completedRounds);
}

function primaryActionLabel(state: ReviewState) {
  if (state === "live") {
    return "Open live review";
  }
  if (state === "ready") {
    return "Start review";
  }
  if (state === "partial") {
    return "Inspect partial";
  }
  if (state === "delivered") {
    return "Open review";
  }
  return "Open draft";
}

function humanizeStage(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    queued: "Waiting in queue",
    preparing: "Preparing source",
    "preparing-source": "Preparing source",
    "running-audit": "Independent audit in progress",
    "review-ready": "Human evidence gate",
    completed: "Delivery complete",
    failed: "Execution interrupted",
    cancelled: "Execution cancelled",
  };
  return labels[normalized] ?? humanize(value);
}

function humanizeWorkflowStatus(value: RunSummary["workflowStatus"]) {
  if (value === "awaiting_review") {
    return "Awaiting review";
  }
  return humanize(value);
}

function workflowStatusLabel(item: ReviewItem) {
  if (!item.run) {
    return "Output pending";
  }
  if (
    item.run.workflowStatus === "pending" &&
    (item.run.totalFindings > 0 || item.job?.status === "succeeded")
  ) {
    return "Legacy";
  }
  return humanizeWorkflowStatus(item.run.workflowStatus);
}

function humanize(value: string) {
  const label = value.replaceAll("_", " ").replaceAll("-", " ").trim();
  return label ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : "Unknown";
}

function laterTimestamp(left: string | undefined, right: string) {
  if (!left) {
    return right;
  }
  return new Date(left).getTime() > new Date(right).getTime() ? left : right;
}
