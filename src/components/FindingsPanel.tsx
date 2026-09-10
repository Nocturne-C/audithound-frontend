import React from "react";
import { Filter, ListChecks, RotateCcw, Search, Star, TriangleAlert } from "lucide-react";
import type { Confidence, Finding, Severity, TriageStatus } from "../types";
import { confidenceFilterOptions, severityFilterOptions, triageStatusOptions } from "../lib/utils";
import { confidenceTone, severityTone } from "../lib/format";
import { EmptyBlock } from "./Common";
import { FindingsListSkeleton } from "./Skeleton";

const starKey = (runId: string, findingId: string) => `${runId}::${findingId}`;

interface FindingsPanelProps {
  runId: string;
  findingSearch: string;
  setFindingSearch: (val: string) => void;
  severityFilters: Severity[];
  setSeverityFilters: React.Dispatch<React.SetStateAction<Severity[]>>;
  confidenceFilters: Confidence[];
  setConfidenceFilters: React.Dispatch<React.SetStateAction<Confidence[]>>;
  statusFilters: TriageStatus[];
  setStatusFilters: (val: TriageStatus[]) => void;
  agentFilter: string;
  setAgentFilter: (val: string) => void;
  roundFilter: string;
  setRoundFilter: (val: string) => void;
  fileFilter: string;
  setFileFilter: (val: string) => void;
  starredOnly: boolean;
  setStarredOnly: React.Dispatch<React.SetStateAction<boolean>>;
  unreviewedOnly: boolean;
  setUnreviewedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  changedOnly: boolean;
  setChangedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  
  agentOptions: string[];
  roundOptions: number[];
  fileOptions: string[];
  
  filteredFindings: Finding[];
  selectedFindingId: string | null;
  setSelectedFindingId: (val: string | null) => void;
  starred: Record<string, boolean>;
  onToggleStar: (findingId: string) => void;
  children?: React.ReactNode;
  loading?: boolean;
  findingsListWidth: number;
  onResizeStart: (e: React.MouseEvent) => void;
}

export const FindingsPanel = React.memo(function FindingsPanel({
  runId,
  findingSearch,
  setFindingSearch,
  severityFilters,
  setSeverityFilters,
  confidenceFilters,
  setConfidenceFilters,
  statusFilters,
  setStatusFilters,
  agentFilter,
  setAgentFilter,
  roundFilter,
  setRoundFilter,
  fileFilter,
  setFileFilter,
  starredOnly,
  setStarredOnly,
  unreviewedOnly,
  setUnreviewedOnly,
  changedOnly,
  setChangedOnly,
  agentOptions,
  roundOptions,
  fileOptions,
  filteredFindings,
  selectedFindingId,
  setSelectedFindingId,
  starred,
  onToggleStar,
  children,
  loading,
  findingsListWidth,
  onResizeStart,
}: FindingsPanelProps) {
  return (
    <div className={`panel findings-panel ${selectedFindingId ? "has-selection" : ""}`}>
      <div className="findings-toolbar">
        <div>
          <div className="eyebrow">Findings</div>
          <h3>Merged findings</h3>
        </div>
        <label className="field compact">
          <div className="field-input">
            <Search size={15} />
            <input
              value={findingSearch}
              onChange={(event) => setFindingSearch(event.target.value)}
              placeholder="Search title, claim, file, agent..."
            />
          </div>
        </label>
      </div>

      <div className="filter-row">
        <div className="filter-group">
          <Filter size={15} style={{ marginRight: "4px" }} />
          {severityFilterOptions.map((severity) => (
            <button
              key={severity}
              className={`chip ${severityFilters.includes(severity) ? "is-active" : ""} tone-${severityTone(severity)}`}
              onClick={() => {
                setSeverityFilters((current) =>
                  current.includes(severity) ? current.filter((item) => item !== severity) : [...current, severity]
                );
              }}
              type="button"
            >
              {severity}
            </button>
          ))}
          <div style={{ width: "1px", height: "16px", backgroundColor: "var(--separator)", margin: "0 4px" }} />
          {confidenceFilterOptions.map((confidence) => (
            <button
              key={confidence}
              className={`chip ${confidenceFilters.includes(confidence) ? "is-active" : ""} tone-${confidenceTone(confidence)}`}
              onClick={() => {
                setConfidenceFilters((current) =>
                  current.includes(confidence) ? current.filter((item) => item !== confidence) : [...current, confidence]
                );
              }}
              type="button"
            >
              {confidence}
            </button>
          ))}
        </div>

        <div className="filter-group" style={{ borderTop: "1px solid var(--separator)", paddingTop: "8px", marginTop: "4px" }}>
          <div className="filter-selects">
            <select
              value={statusFilters[0] ?? "all"}
              onChange={(event) => setStatusFilters(event.target.value === "all" ? [] : [event.target.value as TriageStatus])}
            >
              <option value="all">All status</option>
              {triageStatusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
              <option value="all">All agents</option>
              {agentOptions.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </select>
            <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
              <option value="all">All rounds</option>
              {roundOptions.map((round) => (
                <option key={round} value={String(round)}>
                  Round {round}
                </option>
              ))}
            </select>
            <select value={fileFilter} onChange={(event) => setFileFilter(event.target.value)}>
              <option value="all">All files</option>
              {fileOptions.map((file) => (
                <option key={file} value={file}>
                  {file}
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: "1px", height: "16px", backgroundColor: "var(--separator)", margin: "0 4px" }} />
          <button
            className={`chip ${starredOnly ? "is-active" : ""}`}
            onClick={() => setStarredOnly((current) => !current)}
            type="button"
          >
            <Star size={14} />
            Starred only
          </button>
          <button
            className={`chip ${unreviewedOnly ? "is-active" : ""}`}
            onClick={() => setUnreviewedOnly((current) => !current)}
            type="button"
          >
            <ListChecks size={14} />
            Unreviewed
          </button>
          <button
            className={`chip ${changedOnly ? "is-active" : ""}`}
            onClick={() => setChangedOnly((current) => !current)}
            type="button"
          >
            <RotateCcw size={14} />
            Changed
          </button>
          <div className="filter-meta">{filteredFindings.length} visible</div>
        </div>
      </div>

      <div
        className="findings-layout"
        style={{
          position: "relative",
          "--findings-list-width": `${findingsListWidth}px`,
        } as React.CSSProperties}
      >
        <div
          className="split-handle"
          style={{ left: "calc(var(--findings-list-width) - 2px)" }}
          onMouseDown={onResizeStart}
        />
        {loading ? (
          <FindingsListSkeleton />
        ) : (
          <div className="finding-list">
            {filteredFindings.map((finding) => {
              const isStarred = Boolean(starred[starKey(runId, finding.id)]);
              return (
                <div
                  key={finding.id}
                  className={`finding-row ${selectedFindingId === finding.id ? "is-active" : ""}`}
                  onClick={() => setSelectedFindingId(finding.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedFindingId(finding.id);
                    }
                  }}
                >
                  <span className={`severity-dot ${severityTone(finding.severity)}`} title={finding.severity ?? "Unknown"} />
                  <span className="finding-title">{finding.title ?? "Untitled finding"}</span>
                  <span className="finding-meta-badge">{finding.locations.length}</span>
                  <button
                    className={`star-button ${isStarred ? "is-active" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleStar(finding.id);
                    }}
                    type="button"
                  >
                    <Star size={12} />
                  </button>
                </div>
              );
            })}

            {filteredFindings.length === 0 && (
              <EmptyBlock
                icon={<TriangleAlert size={18} />}
                title="No findings in view"
                body="Broaden the filters or clear the search query."
              />
            )}
          </div>
        )}
        
        {children}
      </div>
    </div>
  );
});
