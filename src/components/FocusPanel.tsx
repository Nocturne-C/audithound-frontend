import React, { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleDot,
  GitBranch,
  LoaderCircle,
  Play,
  Plus,
  RefreshCcw,
  Sparkles,
  Target,
  X,
} from "lucide-react";

import {
  configureFocus,
  continueWithFocus,
  dismissFocusSuggestion,
  evaluateFocus,
  queueFocusSuggestion,
  requestFocus,
  unqueueFocusSuggestion,
} from "../lib/api";
import type { Finding, FocusPolicy, FocusState, FocusSuggestion, JobRecord, WorkflowRunSnapshot } from "../types";
import { StatusPill } from "./Common";

type FocusPanelProps = {
  runId: string;
  focus: FocusState;
  findings: Finding[];
  lastCompletedRound: number;
  managedJob: JobRecord | null;
  workflowStatus: WorkflowRunSnapshot["status"];
  onChange: (focus: FocusState) => void;
  onContinuationQueued: (job: JobRecord) => void;
  onNotify: (message: string, type?: "success" | "error" | "info") => void;
};

export const FocusPanel = React.memo(function FocusPanel({
  runId,
  focus,
  findings,
  lastCompletedRound,
  managedJob,
  workflowStatus,
  onChange,
  onContinuationQueued,
  onNotify,
}: FocusPanelProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState("");
  const [objective, setObjective] = useState("");
  const [priority, setPriority] = useState<FocusSuggestion["priority"]>("medium");
  const visibleSuggestions = useMemo(
    () => [...focus.suggestions]
      .filter((suggestion) => suggestion.status !== "dismissed")
      .sort((left, right) => focusSort(left) - focusSort(right) || right.score - left.score),
    [focus.suggestions],
  );
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? null;
  const activeExecution = workflowStatus === "running"
    ? [...focus.executions].reverse().find((execution) => execution.status === "running") ?? null
    : null;
  const queuedCount = focus.counts.queued + focus.counts.scheduled + focus.counts.running;
  const canQueue = focus.policy !== "off" && !focus.budgetExhausted;
  const continuationAvailable = managedJob?.status === "review_ready" || managedJob?.status === "failed";
  const hasRecoverableFocus = managedJob?.status === "failed"
    && (focus.counts.scheduled > 0 || focus.counts.running > 0);
  const canContinue = queuedCount > 0
    && workflowStatus !== "running"
    && continuationAvailable
    && focus.policy !== "off"
    && (!focus.budgetExhausted || hasRecoverableFocus);

  const runAction = async (key: string, action: () => Promise<FocusState>, message: string) => {
    setBusyAction(key);
    try {
      const next = await action();
      onChange(next);
      onNotify(message, "success");
      return true;
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Unable to update adaptive focus.", "error");
      return false;
    } finally {
      setBusyAction(null);
    }
  };

  const handlePolicy = (policyValue: FocusPolicy) => {
    if (policyValue === focus.policy) {
      return;
    }
    void runAction(
      `policy-${policyValue}`,
      () => configureFocus(runId, { policy: policyValue }),
      policyValue === "auto"
        ? "Automatic focus insertion enabled."
        : policyValue === "off"
          ? "General loop will continue without automatic focus."
          : "Focus suggestions now wait for reviewer approval.",
    );
  };

  const handleManualRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedObjective = objective.trim();
    if (!trimmedObjective) {
      onNotify("Describe the question the focus worker must resolve.", "error");
      return;
    }
    const targetPaths = selectedFinding ? findingSourcePaths(selectedFinding) : [];
    void runAction(
      "manual-request",
      () => requestFocus(runId, {
        title: selectedFinding ? `Reviewer focus on ${selectedFinding.id}` : "Reviewer-requested focus",
        objective: trimmedObjective,
        rationale: selectedFinding
          ? `A reviewer selected ${selectedFinding.id} after inspecting the merged record.`
          : "A reviewer inserted this branch from the execution workspace.",
        findingId: selectedFinding?.id,
        targetPaths,
        priority,
        requestedBy: "reviewer",
        afterRound: lastCompletedRound,
      }),
      "Focus work queued for the next available round.",
    ).then((succeeded) => {
      if (succeeded) {
        setObjective("");
        setSelectedFindingId("");
      }
    });
  };

  const handleContinue = async () => {
    setBusyAction("continue");
    try {
      const job = await continueWithFocus(runId);
      onContinuationQueued(job);
      onNotify("Queued focus continuation with the preserved source workspace.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Unable to continue this run.", "error");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="focus-panel">
      <div className="focus-panel-header">
        <div>
          <div className="eyebrow">Optional workflow branch</div>
          <h3>Adaptive focus</h3>
          <p>General review stays intact. Focus workers join only when merged evidence or a reviewer names a concrete question.</p>
        </div>
        <button
          className="button secondary"
          disabled={busyAction !== null || lastCompletedRound < 1}
          onClick={() => void runAction(
            "evaluate",
            () => evaluateFocus(runId, lastCompletedRound),
            "Re-evaluated the latest merge and summary.",
          )}
          type="button"
        >
          {busyAction === "evaluate" ? <LoaderCircle className="spin" size={14} /> : <RefreshCcw size={14} />}
          Re-evaluate
        </button>
      </div>

      <div className="focus-routing-map" aria-label="Adaptive focus routing">
        <div className="focus-routing-node">
          <span>01</span>
          <strong>General loop</strong>
          <small>Unchanged full scope</small>
        </div>
        <ArrowRight size={15} />
        <div className="focus-routing-node is-decision">
          <span>02</span>
          <strong>Merge + summary</strong>
          <small>Evidence decides</small>
        </div>
        <GitBranch className="focus-routing-branch-icon" size={18} />
        <div className={`focus-routing-node is-focus ${activeExecution ? "is-live" : ""}`}>
          <span>03 · optional</span>
          <strong>Focused fan-out</strong>
          <small>{activeExecution ? `${activeExecution.suggestionIds.length} workers running` : "Only when inserted"}</small>
        </div>
        <ArrowRight size={15} />
        <div className="focus-routing-node">
          <span>04</span>
          <strong>Canonical merge</strong>
          <small>One evidence record</small>
        </div>
      </div>

      <div className="focus-control-strip">
        <div className="focus-policy-control">
          <span>Routing policy</span>
          <div className="focus-policy-options" role="group" aria-label="Adaptive focus policy">
            {([
              ["suggest", "Ask first"],
              ["auto", "Automatic"],
              ["off", "General only"],
            ] as const).map(([value, label]) => (
              <button
                aria-pressed={focus.policy === value}
                className={focus.policy === value ? "is-active" : ""}
                disabled={busyAction !== null}
                key={value}
                onClick={() => handlePolicy(value)}
                type="button"
              >
                {focus.policy === value && <Check size={12} />}
                {label}
              </button>
            ))}
          </div>
        </div>
        <FocusMetric label="Suggested" value={focus.counts.suggested} />
        <FocusMetric label="Queued" value={queuedCount} tone={queuedCount > 0 ? "active" : undefined} />
        <FocusMetric label="Completed" value={focus.counts.completed} />
        <FocusMetric label="Round budget" value={`${focus.focusRoundsUsed}/${focus.maxFocusRounds}`} tone={focus.budgetExhausted ? "warning" : undefined} />
      </div>

      <div className="focus-panel-grid">
        <div className="focus-suggestions">
          <div className="focus-section-heading">
            <div>
              <span>Focus queue</span>
              <strong>{visibleSuggestions.length > 0 ? "Evidence-driven questions" : "No focus work proposed"}</strong>
            </div>
            <small>
              {focus.policy === "auto"
                ? "Eligible suggestions queue automatically."
                : focus.policy === "off"
                  ? "Suggestions are preserved while insertion is paused."
                  : "Nothing runs without an explicit queue decision."}
            </small>
          </div>

          {visibleSuggestions.length === 0 && (
            <div className="focus-empty-state">
              <Sparkles size={17} />
              <div>
                <strong>The general loop remains the only active path.</strong>
                <p>Re-evaluate after a completed round, or insert a reviewer question when a specific mechanism needs deeper work.</p>
              </div>
            </div>
          )}

          <div className="focus-suggestion-list">
            {visibleSuggestions.map((suggestion) => (
              <article className={`focus-suggestion-card is-${suggestion.status}`} key={suggestion.id}>
                <div className="focus-suggestion-topline">
                  <div>
                    <StatusPill label={suggestion.priority} tone={priorityTone(suggestion.priority)} />
                    <span className="focus-source-label">
                      {suggestion.source === "manual" ? <Target size={12} /> : <Sparkles size={12} />}
                      {suggestion.source === "manual" ? "Reviewer" : "System suggestion"}
                    </span>
                  </div>
                  <span className={`focus-status is-${suggestion.status}`}>
                    <CircleDot size={11} />
                    {humanizeStatus(suggestion.status)}
                  </span>
                </div>
                <h4>{suggestion.title}</h4>
                <p>{suggestion.objective}</p>
                <div className="focus-rationale">{suggestion.rationale}</div>
                {(suggestion.targetPaths.length > 0 || suggestion.findingIds.length > 0) && (
                  <div className="focus-chip-row">
                    {suggestion.findingIds.map((findingId) => <span key={findingId}>{findingId}</span>)}
                    {suggestion.targetPaths.slice(0, 3).map((targetPath) => <code key={targetPath}>{targetPath}</code>)}
                    {suggestion.targetPaths.length > 3 && <span>+{suggestion.targetPaths.length - 3}</span>}
                  </div>
                )}
                {(suggestion.status === "suggested" || suggestion.status === "failed") && (
                  <div className="focus-card-actions">
                    <button
                      className="button secondary"
                      disabled={busyAction !== null}
                      onClick={() => void runAction(
                        `dismiss-${suggestion.id}`,
                        () => dismissFocusSuggestion(runId, suggestion.id),
                        "Focus suggestion dismissed.",
                      )}
                      type="button"
                    >
                      <X size={13} />
                      Dismiss
                    </button>
                    <button
                      className="button primary"
                      disabled={busyAction !== null || !canQueue}
                      onClick={() => void runAction(
                        `queue-${suggestion.id}`,
                        () => queueFocusSuggestion(runId, suggestion.id),
                        suggestion.status === "failed"
                          ? "Focus retry queued for insertion."
                          : "Focus suggestion queued for insertion.",
                      )}
                      type="button"
                    >
                      {busyAction === `queue-${suggestion.id}` ? <LoaderCircle className="spin" size={13} /> : <Plus size={13} />}
                      {suggestion.status === "failed" ? "Retry next round" : "Insert next round"}
                    </button>
                  </div>
                )}
                {suggestion.status === "queued" && (
                  <div className="focus-card-actions">
                    <button
                      className="button secondary"
                      disabled={busyAction !== null}
                      onClick={() => void runAction(
                        `unqueue-${suggestion.id}`,
                        () => unqueueFocusSuggestion(runId, suggestion.id),
                        focus.policy === "auto"
                          ? "Removed and suppressed this automatic focus item."
                          : "Removed focus item from the next round.",
                      )}
                      type="button"
                    >
                      {busyAction === `unqueue-${suggestion.id}` ? <LoaderCircle className="spin" size={13} /> : <X size={13} />}
                      Remove from queue
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>

        <form className="focus-request-card" onSubmit={handleManualRequest}>
          <div className="focus-section-heading">
            <div>
              <span>Reviewer insertion</span>
              <strong>Name the unresolved question</strong>
            </div>
          </div>
          <label className="field">
            <span className="field-label">Linked finding</span>
            <div className="field-input field-select">
              <select value={selectedFindingId} onChange={(event) => setSelectedFindingId(event.target.value)}>
                <option value="">No finding · open source question</option>
                {findings.map((finding) => (
                  <option key={finding.id} value={finding.id}>{finding.id} · {finding.title ?? "Untitled finding"}</option>
                ))}
              </select>
            </div>
          </label>
          <label className="field">
            <span className="field-label">Focus objective</span>
            <div className="field-textarea">
              <textarea
                onChange={(event) => setObjective(event.target.value)}
                placeholder={selectedFinding
                  ? "What exact premise, path, prerequisite, or impact must the worker prove or falsify?"
                  : "Describe a concrete mechanism or source direction that deserves a bounded investigation."}
                rows={6}
                value={objective}
              />
            </div>
          </label>
          <label className="field">
            <span className="field-label">Priority</span>
            <div className="field-input field-select">
              <select
                onChange={(event) => setPriority(event.target.value as FocusSuggestion["priority"])}
                value={priority}
              >
                <option value="critical">Critical path</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="normal">Normal</option>
              </select>
            </div>
          </label>
          <button className="button primary focus-request-submit" disabled={busyAction !== null || !canQueue} type="submit">
            {busyAction === "manual-request" ? <LoaderCircle className="spin" size={14} /> : <GitBranch size={14} />}
            Queue focus branch
          </button>
          {focus.policy === "off" && (
            <div className="focus-budget-note">
              <span>Focus insertion is paused by the General only policy.</span>
              <button
                disabled={busyAction !== null}
                onClick={() => handlePolicy("suggest")}
                type="button"
              >
                Switch to Ask first
              </button>
            </div>
          )}
          {focus.budgetExhausted && (
            <div className="focus-budget-note">
              <span>The focus round budget is exhausted.</span>
              <button
                disabled={busyAction !== null || focus.maxFocusRounds >= 12}
                onClick={() => void runAction(
                  "extend-budget",
                  () => configureFocus(runId, { maxFocusRounds: Math.min(12, focus.maxFocusRounds + 1) }),
                  "Extended the focus budget by one round.",
                )}
                type="button"
              >
                Extend by one round
              </button>
            </div>
          )}
        </form>
      </div>

      {queuedCount > 0 && (
        <div className="focus-continuation-bar">
          <div>
            <Play size={14} />
            <span>
              {focus.policy === "off"
                ? "Queued focus is paused. Switch routing policy before continuing."
                : focus.budgetExhausted && !hasRecoverableFocus
                  ? "Queued focus is waiting for an extended round budget."
                  : workflowStatus === "running"
                    ? "Queued focus will be consumed by the next available round."
                    : hasRecoverableFocus
                      ? "The previous focus attempt was interrupted. Continue to re-queue its unfinished work."
                    : continuationAvailable
                      ? "The automated pass has stopped. Continue the preserved run to execute queued focus work."
                      : managedJob
                        ? "The managed continuation is already queued or unavailable from its current state."
                        : "Focus work is queued. Use the Resume command in the run header to continue this CLI-created run."}
            </span>
          </div>
          {canContinue && (
            <button className="button primary" disabled={busyAction !== null} onClick={() => void handleContinue()} type="button">
              {busyAction === "continue" ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />}
              Continue with focus
            </button>
          )}
        </div>
      )}
    </section>
  );
});

function FocusMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "active" | "warning";
}) {
  return (
    <div className={`focus-metric ${tone ? `is-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function focusSort(suggestion: FocusSuggestion) {
  const order: Record<FocusSuggestion["status"], number> = {
    running: 0,
    scheduled: 1,
    queued: 2,
    suggested: 3,
    failed: 4,
    completed: 5,
    dismissed: 6,
  };
  return order[suggestion.status];
}

function priorityTone(priority: FocusSuggestion["priority"]) {
  if (priority === "critical") {
    return "critical" as const;
  }
  if (priority === "high") {
    return "high" as const;
  }
  if (priority === "medium") {
    return "medium" as const;
  }
  return "neutral" as const;
}

function humanizeStatus(status: FocusSuggestion["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function findingSourcePaths(finding: Finding) {
  const paths = finding.locations
    .map((location) => location.replace(/(?::\d+(?::\d+)?)$/, ""))
    .filter(Boolean);
  return [...new Set(paths)];
}
