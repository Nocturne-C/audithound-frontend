import React, { useState } from "react";
import { CheckCircle2, Download, LoaderCircle, PackageCheck, Save, XCircle } from "lucide-react";
import type { ExportFormat, TriageStatus } from "../types";
import { statusTone } from "../lib/format";
import { MetricInline, PanelHeader, StatusPill } from "./Common";
import { triageStatusOptions } from "../lib/utils";
import { ConfirmModal } from "./ConfirmModal";

interface TriageSummaryPanelProps {
  summary: {
    unreviewed: number;
    confirmed: number;
    falsePositive: number;
    fixed: number;
    needsEvidence: number;
    byStatus: Record<TriageStatus, number>;
  };
  filteredCount: number;
  batchStatus: TriageStatus;
  saving: boolean;
  saveError: string | null;
  onBatchStatusChange: (status: TriageStatus) => void;
  onApplyBatchStatus: () => void;
}

export const TriageSummaryPanel = React.memo(function TriageSummaryPanel({
  summary,
  filteredCount,
  batchStatus,
  saving,
  saveError,
  onBatchStatusChange,
  onApplyBatchStatus,
}: TriageSummaryPanelProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  return (
    <div className="workflow-panel">
      <PanelHeader title="Triage queue" eyebrow="Review state" compact />
      <div className="triage-grid">
        <MetricInline label="Open" value={String(summary.unreviewed)} />
        <MetricInline label="Confirmed" value={String(summary.confirmed)} />
        <MetricInline label="False positive" value={String(summary.falsePositive)} />
        <MetricInline label="Fixed" value={String(summary.fixed)} />
      </div>
      <div className="status-stack">
        {triageStatusOptions.map((status) => (
          <div className="status-row" key={status}>
            <StatusPill tone={statusTone(status)} label={status} />
            <span>{summary.byStatus[status] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="batch-row">
        <select value={batchStatus} onChange={(event) => onBatchStatusChange(event.target.value as TriageStatus)}>
          {triageStatusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button className="ghost-button" onClick={() => setIsConfirmOpen(true)} type="button">
          <CheckCircle2 size={15} />
          <span>Apply to {filteredCount}</span>
        </button>
      </div>
      <div className="save-state">
        {saveError ? <XCircle size={14} /> : <Save size={14} />}
        <span>{saveError ?? (saving ? "Saving" : "Saved")}</span>
      </div>

      <ConfirmModal
        isOpen={isConfirmOpen}
        title="Batch Triage Confirmation"
        message={`Are you sure you want to change the status of ${filteredCount} visible finding(s) to "${batchStatus}"?`}
        onConfirm={() => {
          setIsConfirmOpen(false);
          onApplyBatchStatus();
        }}
        onCancel={() => setIsConfirmOpen(false)}
        confirmText="Apply Status"
      />
    </div>
  );
});

// ExportPanel Component
interface ExportPanelProps {
  formats: Array<{ format: ExportFormat; label: string }>;
  confirmedOnly: boolean;
  exportCount: number;
  deliveryComplete: boolean;
  finalizing: boolean;
  onToggleConfirmedOnly: (value: boolean) => void;
  onExport: (format: ExportFormat) => void;
  onFinalize: () => void;
}

export const ExportPanel = React.memo(function ExportPanel({
  formats,
  confirmedOnly,
  exportCount,
  deliveryComplete,
  finalizing,
  onToggleConfirmedOnly,
  onExport,
  onFinalize,
}: ExportPanelProps) {
  const delivered = deliveryComplete;

  return (
    <div className="workflow-panel">
      <PanelHeader title="Delivery" eyebrow="Reviewer gate" compact />
      <div className={`delivery-gate-card ${delivered ? "is-complete" : ""}`}>
        <div className="delivery-gate-icon">
          <PackageCheck size={18} />
        </div>
        <div>
          <strong>{delivered ? "Formal package sealed" : "Human approval required"}</strong>
          <span>
            {delivered
              ? "Report and regression baseline are reviewer-approved."
              : "Every finding needs a disposition and complete handoff details."}
          </span>
        </div>
      </div>
      <button
        className="button primary delivery-finalize-button"
        disabled={finalizing || delivered}
        onClick={onFinalize}
        type="button"
      >
        {finalizing ? <LoaderCircle className="is-spinning" size={15} /> : <PackageCheck size={15} />}
        <span>{finalizing ? "Validating delivery" : delivered ? "Delivery complete" : "Complete review & generate report"}</span>
      </button>
      <div className="delivery-separator">
        <span>Quick exports</span>
      </div>
      <div className="export-summary">
        <strong>{exportCount}</strong>
        <span>{confirmedOnly ? "confirmed findings" : "visible findings"}</span>
      </div>
      <label className="switch-row">
        <input
          checked={confirmedOnly}
          onChange={(event) => onToggleConfirmedOnly(event.target.checked)}
          type="checkbox"
        />
        <span>Confirmed only</span>
      </label>
      <div className="export-actions">
        {formats.map((item) => (
          <button key={item.format} className="action-button" onClick={() => onExport(item.format)} type="button">
            <Download size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
});
