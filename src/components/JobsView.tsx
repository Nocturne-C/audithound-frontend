import React from "react";
import { ArrowUpRight, Ban, Clock3, FileTerminal, LoaderCircle, Pause, Play, RefreshCcw } from "lucide-react";

import { formatAbsoluteDate, formatRelativeDate } from "../lib/format";
import type { JobDetail, JobRecord } from "../types";
import { EmptyBlock, MetricCard, StatusPill } from "./Common";

interface JobsViewProps {
  jobs: JobRecord[];
  jobsLoading: boolean;
  selectedJobId: string | null;
  selectedJob: JobDetail | null;
  selectedJobLoading: boolean;
  onSelectJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onPauseJob: (jobId: string) => void;
  onResumeJob: (jobId: string) => void;
  onRefresh: () => void;
  onOpenRun: (runId: string) => void;
}

export const JobsView = React.memo(function JobsView({
  jobs,
  jobsLoading,
  selectedJobId,
  selectedJob,
  selectedJobLoading,
  onSelectJob,
  onCancelJob,
  onPauseJob,
  onResumeJob,
  onRefresh,
  onOpenRun,
}: JobsViewProps) {
  const activeCount = jobs.filter((job) => job.status === "queued" || job.status === "preparing" || job.status === "running" || job.status === "paused").length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const reviewReadyCount = jobs.filter((job) => job.status === "review_ready").length;
  const completedCount = jobs.filter((job) => job.status === "succeeded").length;

  return (
    <div className="jobs-view">
      <section className="panel hero hero-split">
        <div className="hero-copy">
          <div className="eyebrow">Execution queue</div>
          <div className="hero-title-row">
            <h2>Know exactly what is queued, running, or failing without leaving the product.</h2>
          </div>
          <p>
            Follow every submitted job from intake to output, inspect the live tail, and jump straight into the resulting
            review run when it lands.
          </p>
          <div className="hero-meta-row">
            <span className="hero-meta-pill">Local + worker pools</span>
            <span className="hero-meta-pill">{activeCount} active or queued</span>
            <span className="hero-meta-pill">{reviewReadyCount} awaiting review</span>
            <span className="hero-meta-pill">{completedCount} completed</span>
          </div>
        </div>
        <div className="hero-sidecard">
          <div className="hero-sidecard-section">
            <div className="eyebrow">Queue health</div>
            <strong>{activeCount > 0 ? "Work in flight" : "Queue is clear"}</strong>
            <span>{failedCount > 0 ? `${failedCount} failed jobs need review` : "No failing jobs at the moment"}</span>
          </div>
          <div className="hero-sidecard-actions">
            <button className="action-button" onClick={onRefresh} type="button">
              <RefreshCcw size={15} />
              <span>Refresh jobs</span>
            </button>
          </div>
        </div>
      </section>

      <section className="metric-strip" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <MetricCard label="Queued / Active" value={String(activeCount)} hint="Jobs waiting or currently running" tone={activeCount > 0 ? "medium" : "safe"} />
        <MetricCard label="Review Ready" value={String(reviewReadyCount)} hint="Automation complete; reviewer gate open" tone={reviewReadyCount > 0 ? "medium" : "neutral"} />
        <MetricCard label="Completed" value={String(completedCount)} hint="Successful jobs with a generated run" tone="safe" />
        <MetricCard label="Failed" value={String(failedCount)} hint="Investigate these logs before retrying" tone={failedCount > 0 ? "critical" : "neutral"} />
      </section>

      <section className="jobs-layout">
        <div className="panel jobs-list-panel">
          <div className="panel-header is-compact">
            <div className="eyebrow">Jobs</div>
            <h3>Recent submissions</h3>
          </div>
          <div className="jobs-list">
            {jobsLoading && (
              <EmptyBlock
                icon={<LoaderCircle size={18} />}
                title="Loading jobs"
                body="Reading the persisted queue state."
                compact
              />
            )}
            {!jobsLoading && jobs.length === 0 && (
              <EmptyBlock
                icon={<Clock3 size={18} />}
                title="No jobs yet"
                body="Submit a GitHub URL or archive to create the first queued audit."
                compact
              />
            )}
            {jobs.map((job) => (
              <button
                key={job.id}
                className={`job-row ${job.id === selectedJobId ? "is-active" : ""}`}
                onClick={() => onSelectJob(job.id)}
                type="button"
              >
                <div className="job-row-header">
                  <strong>{job.name}</strong>
                  <StatusPill label={humanizeJobStatus(job.status)} tone={jobTone(job.status)} />
                </div>
                <div className="job-row-meta">
                  <span>{job.source.type === "github" ? "GitHub" : job.source.type === "upload" ? "Upload" : "Local snapshot"}</span>
                  <span>{job.settings.executionMode === "worker" ? `Pool ${job.settings.workerPool}` : "Studio host"}</span>
                  <span>{formatRelativeDate(job.updatedAt)}</span>
                </div>
                <div className="job-row-stage">{job.stage}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel jobs-detail-panel">
          {!selectedJob && (
            <EmptyBlock
              icon={<FileTerminal size={18} />}
              title="Select a job"
              body="Choose a queued or completed job to inspect status, logs, and linked run output."
            />
          )}

          {selectedJobLoading && selectedJob && (
            <div className="jobs-loading-overlay">
              <LoaderCircle className="spin" size={18} />
            </div>
          )}

          {selectedJob && (
            <>
              <div className="panel-header">
                <div className="eyebrow">Job detail</div>
                <h3>{selectedJob.name}</h3>
              </div>

              <div className="jobs-detail-grid">
                <div className="metric-inline">
                  <span>Status</span>
                  <strong>{humanizeJobStatus(selectedJob.status)}</strong>
                </div>
                <div className="metric-inline">
                  <span>Stage</span>
                  <strong>{selectedJob.stage}</strong>
                </div>
                <div className="metric-inline">
                  <span>Created</span>
                  <strong>{formatAbsoluteDate(selectedJob.createdAt)}</strong>
                </div>
                <div className="metric-inline">
                  <span>Updated</span>
                  <strong>{formatAbsoluteDate(selectedJob.updatedAt)}</strong>
                </div>
                <div className="metric-inline">
                  <span>Workflow</span>
                  <strong>{selectedJob.settings.workflowId}</strong>
                </div>
                <div className="metric-inline">
                  <span>Project</span>
                  <strong>{selectedJob.projectId}</strong>
                </div>
                <div className="metric-inline">
                  <span>Engagement</span>
                  <strong>{selectedJob.engagementId}</strong>
                </div>
                <div className="metric-inline">
                  <span>Execution</span>
                  <strong>{selectedJob.settings.workers}× · {selectedJob.settings.maxRounds} rounds</strong>
                </div>
                <div className="metric-inline">
                  <span>Execution target</span>
                  <strong>
                    {selectedJob.settings.executionMode === "worker"
                      ? `${selectedJob.settings.workerPool} · attempt ${selectedJob.attempt}`
                      : "Studio host"}
                  </strong>
                </div>
                <div className="metric-inline">
                  <span>Assigned worker</span>
                  <strong>{selectedJob.assignedWorkerId ?? "Not leased"}</strong>
                </div>
                <div className="metric-inline">
                  <span>Adaptive focus</span>
                  <strong>
                    {selectedJob.settings.focusPolicy === "off"
                      ? "General only"
                      : `${selectedJob.settings.focusPolicy} · ${selectedJob.settings.focusWorkers}×`}
                  </strong>
                </div>
              </div>

              <div className="jobs-source-card">
                <div className="eyebrow">Source</div>
                <code>{jobSourceDescription(selectedJob)}</code>
              </div>

              <div className="jobs-action-row">
                {selectedJob.status === "running" && selectedJob.settings.executionMode === "local" && (
                  <button className="button secondary" onClick={() => onPauseJob(selectedJob.id)} type="button">
                    <Pause size={15} />
                    <span>Pause safely</span>
                  </button>
                )}
                {selectedJob.status === "paused" && (
                  <button className="button secondary" onClick={() => onResumeJob(selectedJob.id)} type="button">
                    <Play size={15} />
                    <span>Resume</span>
                  </button>
                )}
                {canCancel(selectedJob.status) && (
                  <button className="button secondary" onClick={() => onCancelJob(selectedJob.id)} type="button">
                    <Ban size={15} />
                    <span>Cancel</span>
                  </button>
                )}
                {selectedJob.runId && (selectedJob.status === "review_ready" || selectedJob.status === "succeeded") && (
                  <button className="button primary" onClick={() => onOpenRun(selectedJob.runId!)} type="button">
                    <ArrowUpRight size={15} />
                    <span>{selectedJob.status === "review_ready" ? "Open review gate" : "Open delivery"}</span>
                  </button>
                )}
              </div>

              {selectedJob.error && <div className="banner error">{selectedJob.error}</div>}

              <div className="jobs-log-panel">
                <div className="eyebrow">Execution log tail</div>
                <pre>{selectedJob.logTail || "No log output yet."}</pre>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
});

function humanizeJobStatus(status: JobRecord["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "preparing":
      return "Preparing";
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "rate_limited":
      return "Rate limited";
    case "review_ready":
      return "Review ready";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function jobTone(status: JobRecord["status"]) {
  switch (status) {
    case "queued":
      return "neutral";
    case "preparing":
      return "medium";
    case "running":
      return "info";
    case "paused":
    case "rate_limited":
      return "medium";
    case "review_ready":
      return "medium";
    case "succeeded":
      return "safe";
    case "failed":
      return "critical";
    case "cancelled":
      return "neutral";
    default:
      return "neutral";
  }
}

function canCancel(status: JobRecord["status"]) {
  return status === "queued" || status === "preparing" || status === "running" || status === "paused" || status === "rate_limited";
}

function jobSourceDescription(job: JobRecord) {
  if (job.source.type === "github") {
    return `${job.source.repoUrl}${job.source.ref ? ` @ ${job.source.ref}` : ""}`;
  }
  if (job.source.type === "upload") {
    return `${job.source.originalName} (${Math.round(job.source.sizeBytes / 1024)} KB)`;
  }
  return job.source.path;
}
