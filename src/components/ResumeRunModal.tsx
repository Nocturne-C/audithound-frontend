import React, { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, ChevronRight, Clock3, RotateCcw, X } from "lucide-react";

import type { ResumeStage, RunDetail } from "../types";

type ResumeRunModalProps = {
  open: boolean;
  run: RunDetail;
  busy: boolean;
  executionActive: boolean;
  onClose: () => void;
  onResume: (stage: ResumeStage, round?: number) => void;
};

type StageDefinition = {
  id: ResumeStage;
  title: string;
  description: string;
  preserved: string;
  roundScoped: boolean;
};

const STAGES: StageDefinition[] = [
  {
    id: "scope",
    title: "Scope contract",
    description: "Re-read the repository snapshot, scope rules, and runtime contract.",
    preserved: "The previous run is archived; every execution artifact is rebuilt.",
    roundScoped: false,
  },
  {
    id: "map",
    title: "Source context",
    description: "Re-index in-scope files and declarations without ranking the audit work.",
    preserved: "The frozen scope is kept; source context and all later work are rebuilt.",
    roundScoped: false,
  },
  {
    id: "investigate",
    title: "Independent general audit",
    description: "Rerun every isolated general worker for one selected round.",
    preserved: "Earlier rounds remain canonical; this round and later rounds are rebuilt.",
    roundScoped: true,
  },
  {
    id: "focus",
    title: "Adaptive focus",
    description: "Keep general worker reports and rerun only inserted focus work.",
    preserved: "General reports for the selected round remain unchanged.",
    roundScoped: true,
  },
  {
    id: "normalize",
    title: "Canonical merge",
    description: "Rebuild deduplication, provenance, and canonical candidate records.",
    preserved: "All worker reports remain unchanged; merge output and later work are rebuilt.",
    roundScoped: true,
  },
  {
    id: "summary",
    title: "Round summary",
    description: "Rebuild round memory and the convergence decision from canonical findings.",
    preserved: "Canonical candidates remain unchanged; summary and later rounds are rebuilt.",
    roundScoped: true,
  },
  {
    id: "review",
    title: "Human review",
    description: "Reopen reviewer decisions without rerunning automated analysis.",
    preserved: "Canonical findings and current review decisions remain available for editing.",
    roundScoped: false,
  },
  {
    id: "regression",
    title: "Regression baseline",
    description: "Rebuild cross-run classifications after the reviewer gate.",
    preserved: "Findings and review decisions remain unchanged; baseline and delivery are rebuilt.",
    roundScoped: false,
  },
  {
    id: "report",
    title: "Delivery package",
    description: "Regenerate the formal report and signed delivery manifest only.",
    preserved: "The reviewed findings and existing regression baseline remain unchanged.",
    roundScoped: false,
  },
];

export const ResumeRunModal = React.memo(function ResumeRunModal({
  open,
  run,
  busy,
  executionActive,
  onClose,
  onResume,
}: ResumeRunModalProps) {
  const [stage, setStage] = useState<ResumeStage>("investigate");
  const [round, setRound] = useState(Math.max(1, run.lastCompletedRound));
  const dialogRef = useRef<HTMLDivElement>(null);
  const existingRounds = useMemo(
    () => [...new Set(run.rounds.length > 0 ? run.rounds : [Math.max(1, run.lastCompletedRound)])].sort((left, right) => right - left),
    [run.lastCompletedRound, run.rounds],
  );
  const latestRound = Math.max(run.lastCompletedRound, existingRounds[0] ?? 0);
  const nextRound = Math.min(12, latestRound + 1);
  const rounds = useMemo(
    () => stage === "investigate" && latestRound < 12
      ? [nextRound, ...existingRounds]
      : existingRounds,
    [existingRounds, latestRound, nextRound, stage],
  );
  const selected = STAGES.find((item) => item.id === stage) ?? STAGES[2];
  const continuing = selected.id === "investigate" && round > latestRound;

  const selectStage = (nextStage: ResumeStage) => {
    setStage(nextStage);
    setRound(nextStage === "investigate" && latestRound < 12 ? nextRound : Math.max(1, latestRound));
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const currentNodeId = run.workflowRun.nodes.find((node) => node.status === "failed" || node.status === "running")?.nodeId;
    const currentKind = run.workflow.nodes.find((node) => node.id === currentNodeId)?.kind;
    const inferred = STAGES.some((item) => item.id === currentKind)
      ? currentKind as ResumeStage
      : run.workflowRun.status === "awaiting_review"
        ? "review"
        : run.workflowRun.status === "completed"
          ? "report"
          : "investigate";
    setStage(inferred);
    setRound(Math.max(1, run.activeRound ?? run.lastCompletedRound ?? existingRounds[0] ?? 1));
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLButtonElement>("[data-selected='true']")?.focus();
    });
  }, [open, run.id]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="resume-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        aria-labelledby="resume-run-title"
        aria-modal="true"
        className="resume-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <header className="resume-dialog-header">
          <div>
            <div className="eyebrow">Checkpointed recovery</div>
            <h2 id="resume-run-title">Resume from an exact stage</h2>
            <p>Select what should be rebuilt. Upstream artifacts are preserved byte-for-byte.</p>
          </div>
          <button aria-label="Close resume dialog" className="icon-button" disabled={busy} onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>

        <div className="resume-dialog-body">
          <div aria-label="Resume stage" className="resume-stage-list" role="radiogroup">
            {STAGES.map((item, index) => {
              const active = item.id === stage;
              return (
                <button
                  aria-checked={active}
                  className={`resume-stage ${active ? "is-selected" : ""}`}
                  data-selected={active}
                  key={item.id}
                  onClick={() => selectStage(item.id)}
                  role="radio"
                  type="button"
                >
                  <span className="resume-stage-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="resume-stage-copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  {active ? <Check size={15} /> : <ChevronRight size={15} />}
                </button>
              );
            })}
          </div>

          <aside className="resume-impact-panel">
            <div className="resume-impact-heading">
              <span className="resume-impact-icon"><RotateCcw size={16} /></span>
              <div>
                <span>Resume point</span>
                <strong>{selected.title}</strong>
              </div>
            </div>

            {selected.roundScoped && (
              <label className="resume-round-field">
                <span><Clock3 size={14} /> Audit round</span>
                <select value={round} onChange={(event) => setRound(Number(event.target.value))}>
                  {rounds.map((value) => (
                    <option key={value} value={value}>
                      Round {value}{value > latestRound ? " · Continue" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="resume-impact-copy">
              <span>Preservation boundary</span>
              <p>
                {continuing
                  ? latestRound === 1
                    ? `Round 1 remains canonical; Round ${round} starts with its findings and summary as memory.`
                    : `Rounds 1–${latestRound} remain canonical; Round ${round} starts with their findings and summaries as memory.`
                  : selected.preserved}
              </p>
            </div>

            <div className="resume-backup-note">
              <Archive size={15} />
              <p>
                Replaced artifacts move into <code>resume_backups/</code> with a timestamped checkpoint. Nothing is deleted.
              </p>
            </div>

            {executionActive && (
              <div className="resume-active-note">
                Stop or wait for the active execution before rewinding this run.
              </div>
            )}
          </aside>
        </div>

        <footer className="resume-dialog-footer">
          <span>{run.id}</span>
          <div>
            <button className="button secondary" disabled={busy} onClick={onClose} type="button">Cancel</button>
            <button
              className="button primary"
              disabled={busy || executionActive}
              onClick={() => onResume(stage, selected.roundScoped ? round : undefined)}
              type="button"
            >
              <RotateCcw size={14} />
              {busy
                ? "Creating checkpoint…"
                : continuing
                  ? `Continue to Round ${round}`
                  : selected.id === "review"
                  ? "Reopen review"
                  : selected.id === "regression" || selected.id === "report"
                    ? "Rebuild stage"
                    : "Checkpoint & resume"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
});
