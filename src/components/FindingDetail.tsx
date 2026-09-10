import React, { useState } from "react";
import { CalendarDays, Check, Circle, FileCode2, Fingerprint, GitPullRequest, MessageSquareText, PackageCheck, ShieldAlert, UserRound } from "lucide-react";
import type { Finding, FindingDecision, SourcePayload, TriageStatus } from "../types";
import { confidenceTone, severityTone, statusTone } from "../lib/format";
import { EmptyBlock, StatusPill } from "./Common";
import { CodePreviewSkeleton } from "./Skeleton";

export type EvidenceProfile = {
  score: number;
  signals: Array<{
    label: string;
    value: string;
    ok: boolean;
  }>;
};

const triageStatusOptions: TriageStatus[] = [
  "New",
  "Reviewing",
  "Confirmed",
  "False Positive",
  "Duplicate",
  "Needs Evidence",
  "Accepted Risk",
  "Fixed",
  "Retest Passed",
];

interface FindingDetailProps {
  selectedFinding: Finding | null;
  selectedDecision: FindingDecision | null;
  selectedEvidence: EvidenceProfile | null;
  updateSelectedDecision: (patch: Partial<FindingDecision>) => void;
  selectedSourceLocation: string | null;
  setSelectedSourceLocation: (val: string | null) => void;
  sourcePreview: SourcePayload | null;
  sourceLoading: boolean;
  sourceError: string | null;
  onBackToList?: () => void;
}

export const FindingDetail = React.memo(function FindingDetail({
  selectedFinding,
  selectedDecision,
  selectedEvidence,
  updateSelectedDecision,
  selectedSourceLocation,
  setSelectedSourceLocation,
  sourcePreview,
  sourceLoading,
  sourceError,
  onBackToList,
}: FindingDetailProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "evidence" | "source" | "history" | "delivery">("overview");

  if (!selectedFinding) {
    return (
      <div className="finding-detail">
        <EmptyBlock
          icon={<ShieldAlert size={18} />}
          title="No finding selected"
          body="Pick a finding to inspect its reasoning and evidence surface."
        />
      </div>
    );
  }

  const canonicalEvidence = selectedEvidence;

  return (
    <div className="finding-detail">
      <div className="finding-detail-header">
        <div className="finding-detail-heading">
          {onBackToList && (
            <button className="back-list-button" onClick={onBackToList} type="button">
              ← Back
            </button>
          )}
          <div>
            <div className="eyebrow">{selectedFinding.id}</div>
            <h3>{selectedFinding.title}</h3>
            {selectedFinding.fingerprint && <code className="finding-fingerprint"><Fingerprint size={11} /> {selectedFinding.fingerprint}</code>}
          </div>
        </div>
        <div className="finding-detail-badges">
          <StatusPill tone={severityTone(selectedFinding.severity)} label={selectedFinding.severity ?? "Unknown"} />
          <StatusPill tone={confidenceTone(selectedFinding.confidence)} label={selectedFinding.confidence ?? "unknown"} />
          {selectedDecision && <StatusPill tone={statusTone(selectedDecision.status)} label={selectedDecision.status} />}
        </div>
      </div>

      <nav aria-label="Finding sections" className="finding-tabs">
        {[
          ["overview", "Overview"],
          ["evidence", "Evidence"],
          ["source", "Source"],
          ["history", "History"],
          ["delivery", "Delivery"],
        ].map(([id, label]) => (
          <button className={activeTab === id ? "is-active" : ""} key={id} onClick={() => setActiveTab(id as typeof activeTab)} type="button">
            {label}
          </button>
        ))}
      </nav>

      <div className="finding-tab-content">
        {activeTab === "overview" && (
          <>
            {canonicalEvidence && <EvidenceProfileCard profile={canonicalEvidence} />}
            <DetailBlock title="Claim" body={selectedFinding.claim} />
            <div className="finding-context-grid">
              <DetailBlock title="Attacker" body={selectedFinding.actor} />
              <DetailBlock title="Entrypoint" body={selectedFinding.entrypoint} />
            </div>
            <DetailBlock title="Reachability" body={selectedFinding.reachability} />
            <DetailBlock title="Attacker controllability" body={selectedFinding.controllability} />
            <InfoList title="Prerequisites" items={selectedFinding.prerequisites ?? []} />
            <DetailBlock title="Impact" body={selectedFinding.impact} />
            <InfoList title="Trigger path" items={selectedFinding.paths} />
            <div className="tag-row">
              {(selectedFinding.source_agents ?? []).map((agent) => <span key={agent} className="tag">{agent}</span>)}
            </div>
          </>
        )}

        {activeTab === "evidence" && (
          <>
            {canonicalEvidence ? <EvidenceProfileCard profile={canonicalEvidence} /> : null}
            <LocationList
              activeLocation={selectedSourceLocation}
              items={selectedFinding.locations}
              onSelectLocation={setSelectedSourceLocation}
              title="Evidence anchors"
            />
            <SourcePreviewCard error={sourceError} loading={sourceLoading} preview={sourcePreview} />
          </>
        )}

        {activeTab === "source" && (
          <>
            <LocationList
              activeLocation={selectedSourceLocation}
              items={selectedFinding.locations}
              onSelectLocation={setSelectedSourceLocation}
              title="Source locations"
            />
            <SourcePreviewCard error={sourceError} loading={sourceLoading} preview={sourcePreview} />
          </>
        )}

        {activeTab === "history" && (
          <FindingProvenance finding={selectedFinding} />
        )}

        {activeTab === "delivery" && selectedDecision && (
          <>
            <DeliveryReadiness decision={selectedDecision} />
            <DecisionPanel decision={selectedDecision} onChange={updateSelectedDecision} />
          </>
        )}
      </div>
    </div>
  );
});

// DetailBlock
const DetailBlock = React.memo(function DetailBlock({ title, body }: { title: string; body?: string }) {
  return (
    <section className="detail-block">
      <div className="detail-block-title">{title}</div>
      <p>{body || "—"}</p>
    </section>
  );
});

// InfoList
const InfoList = React.memo(function InfoList({ title, items, mono = false }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <section className="detail-block">
      <div className="detail-block-title">{title}</div>
      {items.length === 0 ? (
        <p>—</p>
      ) : (
        <ul className={`detail-list ${mono ? "is-mono" : ""}`}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
});

// EvidenceProfileCard
const EvidenceProfileCard = React.memo(function EvidenceProfileCard({ profile }: { profile: EvidenceProfile }) {
  return (
    <section className="evidence-card">
      <div className="evidence-card-head">
        <div>
          <div className="detail-block-title">Evidence strength</div>
          <span>Finding completeness profile</span>
        </div>
        <strong>{profile.score}<small>/100</small></strong>
      </div>
      <div className="evidence-meter">
        <span style={{ width: `${profile.score}%` }} />
      </div>
    </section>
  );
});

const FindingProvenance = React.memo(function FindingProvenance({ finding }: { finding: Finding }) {
  return (
    <section className="finding-history">
      <div className="finding-history-summary">
        <Fingerprint size={16} />
        <div>
          <span>Canonical root-cause fingerprint</span>
          <code>{finding.fingerprint ?? finding.id}</code>
        </div>
      </div>
      <div className="finding-history-timeline">
        <div className="finding-history-event">
          <span className="history-node" />
          <div>
            <strong>First retained</strong>
            <small>{finding.id}{finding.round ? ` · round ${finding.round}` : ""}</small>
          </div>
          <span>Canonical merge</span>
        </div>
        {finding.source_agents.map((agent) => (
          <div className="finding-history-event" key={agent}>
            <span className="history-node" />
            <div>
              <strong>{agent}</strong>
              <small>Worker attribution</small>
            </div>
            <span>Supporting source</span>
          </div>
        ))}
      </div>
    </section>
  );
});

const DeliveryReadiness = React.memo(function DeliveryReadiness({ decision }: { decision: FindingDecision }) {
  const checks = [
    { label: "Reviewer disposition", ready: ["Confirmed", "False Positive", "Duplicate", "Accepted Risk", "Fixed", "Retest Passed"].includes(decision.status) },
    { label: "Evidence sufficient", ready: decision.evidenceSufficient },
    { label: "Reproduction recorded", ready: decision.reproducible },
    { label: "Recommended fix", ready: Boolean(decision.recommendedFix.trim()) },
    { label: "Owner assigned", ready: Boolean(decision.assignee.trim()) },
    { label: "Retest disposition", ready: decision.retestStatus === "passed" || ["False Positive", "Duplicate", "Accepted Risk"].includes(decision.status) },
  ];
  const readyCount = checks.filter((item) => item.ready).length;
  return (
    <section className="delivery-readiness">
      <div className="delivery-readiness-head">
        <PackageCheck size={17} />
        <div><span>Delivery readiness</span><strong>{readyCount} of {checks.length} gates complete</strong></div>
      </div>
      <div className="delivery-checks">
        {checks.map((item) => (
          <span className={item.ready ? "is-ready" : ""} key={item.label}>
            {item.ready ? <Check size={11} /> : <Circle size={9} />}
            {item.label}
          </span>
        ))}
      </div>
    </section>
  );
});

// DecisionPanel
const DecisionPanel = React.memo(function DecisionPanel({
  decision,
  onChange,
}: {
  decision: FindingDecision;
  onChange: (patch: Partial<FindingDecision>) => void;
}) {
  const [commentBody, setCommentBody] = useState("");
  const addComment = () => {
    const body = commentBody.trim();
    if (!body) {
      return;
    }
    onChange({
      comments: [
        ...decision.comments,
        {
          id: `comment-${Date.now()}`,
          author: decision.assignee || "Reviewer",
          body,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setCommentBody("");
  };

  return (
    <section className="decision-panel">
      <div className="decision-head">
        <div>
          <div className="detail-block-title">Decision</div>
          <h4>Reviewer judgment</h4>
        </div>
        <select value={decision.status} onChange={(event) => onChange({ status: event.target.value as TriageStatus })}>
          {triageStatusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
      <div className="decision-toggles">
        <label className="switch-row">
          <input
            checked={decision.evidenceSufficient}
            onChange={(event) => onChange({ evidenceSufficient: event.target.checked })}
            type="checkbox"
          />
          <span>Evidence sufficient</span>
        </label>
        <label className="switch-row">
          <input
            checked={decision.reproducible}
            onChange={(event) => onChange({ reproducible: event.target.checked })}
            type="checkbox"
          />
          <span>Reproducible</span>
        </label>
      </div>
      <div className="decision-field-grid">
        <label className="decision-field">
          <span><UserRound size={13} /> Assignee</span>
          <input value={decision.assignee} onChange={(event) => onChange({ assignee: event.target.value })} placeholder="Reviewer or remediation owner" />
        </label>
        <label className="decision-field">
          <span><CalendarDays size={13} /> Due date</span>
          <input value={decision.dueDate} onChange={(event) => onChange({ dueDate: event.target.value })} type="date" />
        </label>
      </div>
      <label className="decision-field">
        <span>Impact scope</span>
        <input value={decision.impactScope} onChange={(event) => onChange({ impactScope: event.target.value })} />
      </label>
      <label className="decision-field">
        <span>Recommended fix</span>
        <textarea value={decision.recommendedFix} onChange={(event) => onChange({ recommendedFix: event.target.value })} rows={3} />
      </label>
      <label className="decision-field">
        <span><GitPullRequest size={13} /> Fix commit / PR</span>
        <input value={decision.fixReference} onChange={(event) => onChange({ fixReference: event.target.value })} placeholder="https://github.com/org/repo/pull/123 or commit SHA" />
      </label>
      {decision.status === "Duplicate" && (
        <label className="decision-field">
          <span>Duplicate of</span>
          <input value={decision.duplicateOf} onChange={(event) => onChange({ duplicateOf: event.target.value })} placeholder="Finding ID" />
        </label>
      )}
      {decision.status === "Accepted Risk" && (
        <label className="decision-field">
          <span>Risk acceptance rationale</span>
          <textarea value={decision.riskAcceptance} onChange={(event) => onChange({ riskAcceptance: event.target.value })} rows={3} />
        </label>
      )}
      <div className="decision-field-grid">
        <label className="decision-field">
          <span>Retest status</span>
          <select
            value={decision.retestStatus}
            onChange={(event) => onChange({ retestStatus: event.target.value as FindingDecision["retestStatus"] })}
          >
            <option value="not-requested">Not requested</option>
            <option value="ready">Ready for retest</option>
            <option value="queued">Retest queued</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="decision-field">
          <span>Retest run</span>
          <input value={decision.retestRunId} onChange={(event) => onChange({ retestRunId: event.target.value })} placeholder="Run ID" />
        </label>
      </div>
      <label className="decision-field">
        <span>Reviewer notes</span>
        <textarea value={decision.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={4} />
      </label>
      <div className="decision-comments">
        <div className="detail-block-title"><MessageSquareText size={13} /> Review discussion</div>
        {decision.comments.length > 0 && (
          <div className="decision-comment-list">
            {decision.comments.map((comment) => (
              <article key={comment.id}>
                <div><strong>{comment.author}</strong><time>{new Date(comment.createdAt).toLocaleString()}</time></div>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
        )}
        <div className="decision-comment-compose">
          <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a durable review note…" rows={2} />
          <button className="button secondary" disabled={!commentBody.trim()} onClick={addComment} type="button">Add note</button>
        </div>
      </div>
    </section>
  );
});

// LocationList
const LocationList = React.memo(function LocationList({
  title,
  items,
  activeLocation,
  onSelectLocation,
}: {
  title: string;
  items: string[];
  activeLocation: string | null;
  onSelectLocation: (value: string | null) => void;
}) {
  return (
    <section className="detail-block">
      <div className="detail-block-title">{title}</div>
      {items.length === 0 ? (
        <p>—</p>
      ) : (
        <div className="location-list">
          {items.map((item) => (
            <button
              key={item}
              className={`location-button ${activeLocation === item ? "is-active" : ""}`}
              onClick={() => onSelectLocation(activeLocation === item ? null : item)}
              type="button"
            >
              <FileCode2 size={14} />
              <span>{item}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
});

// SourcePreviewCard
const SourcePreviewCard = React.memo(function SourcePreviewCard({
  preview,
  loading,
  error,
}: {
  preview: SourcePayload | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="detail-block source-preview">
      <div className="source-preview-head">
        <div className="source-preview-head-left">
          <span className="detail-block-title">Source view</span>
        </div>
        {preview && (
          <code>
            {preview.relativeFilePath}
            {preview.line ? `:${preview.line}` : ""}
          </code>
        )}
      </div>

      {loading && <CodePreviewSkeleton />}
      {!loading && error && <p style={{ padding: "12px 14px", margin: 0 }} className="banner error">{error}</p>}
      {!loading && !error && !preview && <p style={{ padding: "12px 14px", margin: 0 }} className="muted">Click a location to preview source.</p>}
      {!loading && !error && preview && (
        <div className="source-code-surface">
          {preview.lines.map((line) => (
            <div
              key={`${preview.relativeFilePath}:${line.number}`}
              className={`source-line ${line.highlight ? "is-highlighted" : ""}`}
            >
              <span className="source-line-number">{line.number}</span>
              <code className="source-line-text">{line.text || " "}</code>
            </div>
          ))}
        </div>
      )}
    </section>
  );
});
