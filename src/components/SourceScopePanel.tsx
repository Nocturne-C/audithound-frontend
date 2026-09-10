import React, { useMemo, useState } from "react";
import { Braces, FileCode2, Search, ShieldAlert } from "lucide-react";

import type { ScopeSnapshot, SourceFileItem } from "../types";

type SourceScopePanelProps = {
  items: SourceFileItem[];
  scope: ScopeSnapshot;
  onOpenFinding: (findingId: string) => void;
};

type SourceFilter = "all" | "finding" | "assigned" | "indexed";

export const SourceScopePanel = React.memo(function SourceScopePanel({
  items,
  scope,
  onOpenFinding,
}: SourceScopePanelProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const hasAssignments = scope.coverageMode === "workflow-tasks";
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter !== "all" && item.state !== filter) {
        return false;
      }
      return !normalizedQuery
        || item.path.toLowerCase().includes(normalizedQuery)
        || (item.symbols ?? []).some((symbol) => symbol.toLowerCase().includes(normalizedQuery));
    });
  }, [filter, items, query]);

  return (
    <div className="coverage-view">
      <div className="coverage-overview">
        <div className="coverage-score">
          <span className="coverage-score-value">{hasAssignments ? `${scope.assignmentCoverage}%` : "Open"}</span>
          <span>{hasAssignments ? "assignment completion" : "full-scope investigation"}</span>
          <small>
            {hasAssignments
              ? "This opt-in workflow tracks completed source assignments without treating them as proof of safety."
              : "Every General worker receives the complete source scope; files are not ranked or pre-assigned."}
          </small>
        </div>
        <div className="coverage-metrics">
          <div><FileCode2 size={14} /><span>Source files</span><strong>{scope.scopeFiles}</strong></div>
          <div><Braces size={14} /><span>Assigned</span><strong>{hasAssignments ? scope.assignedFiles : "Off"}</strong></div>
          <div><ShieldAlert size={14} /><span>With findings</span><strong>{scope.filesWithFindings}</strong></div>
          <div><ShieldAlert size={14} /><span>Candidates</span><strong>{scope.totalFindings}</strong></div>
        </div>
        {hasAssignments && (
          <div className="coverage-bars">
            <CoverageBar label="Task completion" value={scope.assignmentCoverage} />
          </div>
        )}
      </div>

      <div className="coverage-toolbar">
        <div className="field-input coverage-search">
          <Search size={14} />
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Search source files or symbols…" value={query} />
        </div>
        <div className="segmented-control compact">
          {(["all", "finding", "assigned", "indexed"] as const).map((value) => (
            <button className={filter === value ? "is-active" : ""} key={value} onClick={() => setFilter(value)} type="button">
              {value === "all" ? "All" : value}
            </button>
          ))}
        </div>
      </div>

      <div className="surface-table">
        <div className="surface-table-header">
          <span>Source file</span>
          <span>Type</span>
          <span>State</span>
          <span>Symbols</span>
          <span>Findings</span>
        </div>
        {filtered.map((item) => {
          const findingIds = [...new Set(item.findingIds)];
          return (
            <div className="surface-row" key={item.id}>
              <div className="surface-path">
                <FileCode2 size={14} />
                <span>
                  <strong>{item.path}</strong>
                  <small>{item.linesOfCode.toLocaleString()} LOC</small>
                </span>
              </div>
              <span className="surface-kind">{item.kind}</span>
              <span className={`surface-state is-${item.state}`}>{item.state}</span>
              <span className="surface-kind">{(item.symbols ?? []).slice(0, 2).join(", ") || "—"}</span>
              <div className="surface-findings">
                {findingIds.length > 0 ? (
                  findingIds.slice(0, 3).map((findingId) => (
                    <button key={findingId} onClick={() => onOpenFinding(findingId)} type="button">{findingId}</button>
                  ))
                ) : (
                  <span>No retained finding</span>
                )}
                {findingIds.length > 3 && <small>+{findingIds.length - 3}</small>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="surface-empty">No source files match the current filter.</div>
        )}
      </div>
    </div>
  );
});

function CoverageBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="coverage-bar">
      <div><span>{label}</span><strong>{value}%</strong></div>
      <div className="coverage-bar-track"><span style={{ width: `${value}%` }} /></div>
    </div>
  );
}
