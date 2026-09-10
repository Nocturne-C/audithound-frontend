import React, { useMemo } from "react";
import { ArrowUpRight, Boxes, FolderKanban, GitCommitHorizontal, PackageCheck, ShieldAlert } from "lucide-react";

import { formatRelativeDate } from "../lib/format";
import type { RunSummary } from "../types";
import { EmptyBlock, MetricCard, StatusPill } from "./Common";

interface ProjectsViewProps {
  runs: RunSummary[];
  onOpenRun: (runId: string) => void;
  onNewScan: () => void;
}

type ProjectGroup = {
  id: string;
  runs: RunSummary[];
  latest: RunSummary;
  findingCount: number;
  highRiskCount: number;
};

export const ProjectsView = React.memo(function ProjectsView({ runs, onOpenRun, onNewScan }: ProjectsViewProps) {
  const projects = useMemo(() => groupProjects(runs), [runs]);
  const reviewReady = runs.filter((run) => run.workflowStatus === "awaiting_review").length;
  const delivered = runs.filter((run) => run.workflowStatus === "completed").length;
  const highRisk = runs.reduce(
    (total, run) => total + run.severityCounts.Critical + run.severityCounts.High,
    0,
  );

  return (
    <div className="projects-view">
      <section className="panel hero hero-split">
        <div className="hero-copy">
          <div className="eyebrow">Project portfolio</div>
          <div className="hero-title-row">
            <h2>Keep every review, fix cycle, and release decision attached to the product it belongs to.</h2>
          </div>
          <p>
            Projects provide stable lineage across engagements. Each scan remains independently reviewable while regressions
            and recurring root causes stay connected.
          </p>
          <div className="hero-meta-row">
            <span className="hero-meta-pill">{projects.length} projects</span>
            <span className="hero-meta-pill">{runs.length} engagements</span>
            <span className="hero-meta-pill">{reviewReady} reviewer gates open</span>
          </div>
        </div>
        <div className="hero-sidecard">
          <div className="hero-sidecard-section">
            <div className="eyebrow">Portfolio posture</div>
            <strong>{reviewReady > 0 ? "Decisions are waiting" : "No review backlog"}</strong>
            <span>
              {reviewReady > 0
                ? "Open the latest engagement and complete the evidence gate."
                : "New work can enter the queue without adding reviewer debt."}
            </span>
          </div>
          <div className="hero-sidecard-actions">
            <button className="button primary" onClick={onNewScan} type="button">
              Start engagement
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      </section>

      <section className="metric-strip" style={{ borderBottom: "none", paddingBottom: 0 }}>
        <MetricCard label="Projects" value={String(projects.length)} hint="Stable lineage namespaces" tone="neutral" />
        <MetricCard label="Review Gates" value={String(reviewReady)} hint="Require human disposition" tone={reviewReady > 0 ? "medium" : "safe"} />
        <MetricCard label="Delivered" value={String(delivered)} hint="Formal packages sealed" tone="safe" />
        <MetricCard label="Critical / High" value={String(highRisk)} hint="Across all engagements" tone={highRisk > 0 ? "critical" : "safe"} />
      </section>

      <section className="projects-grid">
        {projects.length === 0 && (
          <div className="panel projects-empty">
            <EmptyBlock
              icon={<FolderKanban size={18} />}
              title="No projects yet"
              body="Create the first engagement to establish a project lineage."
            />
          </div>
        )}
        {projects.map((project) => (
          <article className="panel project-card" key={project.id}>
            <header className="project-card-header">
              <div className="project-card-icon"><Boxes size={16} /></div>
              <div>
                <div className="eyebrow">Project</div>
                <h3>{project.id}</h3>
              </div>
              <StatusPill
                label={workflowLabel(project.latest.workflowStatus)}
                tone={workflowTone(project.latest.workflowStatus)}
              />
            </header>

            <div className="project-card-metrics">
              <div>
                <span>Engagements</span>
                <strong>{project.runs.length}</strong>
              </div>
              <div>
                <span>Findings</span>
                <strong>{project.findingCount}</strong>
              </div>
              <div>
                <span>Critical / High</span>
                <strong>{project.highRiskCount}</strong>
              </div>
            </div>

            <div className="project-engagements">
              {project.runs.slice(0, 4).map((run) => (
                <button className="project-engagement-row" key={run.id} onClick={() => onOpenRun(run.id)} type="button">
                  <span className="project-engagement-state" data-status={run.workflowStatus} />
                  <span className="project-engagement-copy">
                    <strong>{run.engagementId}</strong>
                    <small>
                      {run.scanProfile} · {run.totalFindings} findings · {formatRelativeDate(run.updatedAt)}
                    </small>
                  </span>
                  <span className="project-engagement-commit">
                    {run.commit ? (
                      <>
                        <GitCommitHorizontal size={12} />
                        {run.commit.slice(0, 7)}
                      </>
                    ) : (
                      workflowLabel(run.workflowStatus)
                    )}
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>

            <footer className="project-card-footer">
              <span>
                {project.latest.repository
                  ? project.latest.repository.replace(/\.git$/, "")
                  : project.latest.targetPath ?? "Local source snapshot"}
              </span>
              <span>
                {project.latest.workflowStatus === "completed" ? <PackageCheck size={13} /> : <ShieldAlert size={13} />}
                Updated {formatRelativeDate(project.latest.updatedAt)}
              </span>
            </footer>
          </article>
        ))}
      </section>
    </div>
  );
});

function groupProjects(runs: RunSummary[]): ProjectGroup[] {
  const groups = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const projectId = run.projectId || run.title;
    groups.set(projectId, [...(groups.get(projectId) ?? []), run]);
  }
  return [...groups.entries()]
    .map(([id, projectRuns]) => {
      const sorted = [...projectRuns].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return {
        id,
        runs: sorted,
        latest: sorted[0],
        findingCount: sorted.reduce((total, run) => total + run.totalFindings, 0),
        highRiskCount: sorted.reduce(
          (total, run) => total + run.severityCounts.Critical + run.severityCounts.High,
          0,
        ),
      };
    })
    .sort((left, right) => right.latest.updatedAt.localeCompare(left.latest.updatedAt));
}

function workflowLabel(status: RunSummary["workflowStatus"]) {
  if (status === "awaiting_review") {
    return "Review ready";
  }
  if (status === "completed") {
    return "Delivered";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "paused") {
    return "Paused";
  }
  return status === "cancelled" ? "Cancelled" : "Pending";
}

function workflowTone(status: RunSummary["workflowStatus"]) {
  if (status === "completed") {
    return "safe";
  }
  if (status === "running") {
    return "info";
  }
  if (status === "awaiting_review" || status === "paused") {
    return "medium";
  }
  if (status === "failed") {
    return "critical";
  }
  return "neutral";
}
