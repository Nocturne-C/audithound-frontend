import React from "react";
import {
  Activity,
  Command,
  Cpu,
  FlaskConical,
  FolderSearch2,
  GitBranch,
  LayoutDashboard,
  FolderKanban,
  Layers,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
} from "lucide-react";
import type { RunSummary } from "../types";
import { formatRelativeDate } from "../lib/format";
import { EmptyBlock } from "./Common";

export type AppView = "dashboard" | "projects" | "submit" | "jobs" | "review" | "workflows" | "workers" | "workspace" | "benchmarks" | "settings";

interface SidebarProps {
  runs: RunSummary[];
  runsLoading: boolean;
  filteredRuns: RunSummary[];
  selectedRunId: string | null;
  globalSearch: string;
  setGlobalSearch: (val: string) => void;
  setSelectedRunId: (val: string | null) => void;
  setPaletteOpen: (val: boolean) => void;
  activeView: AppView;
  setActiveView: (view: AppView) => void;
}

export const Sidebar = React.memo(function Sidebar({
  runs,
  runsLoading,
  filteredRuns,
  selectedRunId,
  globalSearch,
  setGlobalSearch,
  setSelectedRunId,
  setPaletteOpen,
  activeView,
  setActiveView,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark"><Shield size={15} /></div>
        <div>
          <div className="eyebrow">AuditV2</div>
          <h1>Security Review OS</h1>
        </div>
      </div>

      <div className="sidebar-product-status">
        <span className="status-beacon" />
        <span>{runsLoading ? "Indexing evidence" : "Evidence workspace ready"}</span>
        <small>{runs.length} runs</small>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-nav-label">Operate</div>
        <button
          className={`sidebar-nav-item ${activeView === "dashboard" ? "is-active" : ""}`}
          onClick={() => setActiveView("dashboard")}
          type="button"
        >
          <LayoutDashboard size={15} />
          <span>Portfolio</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "projects" ? "is-active" : ""}`}
          onClick={() => setActiveView("projects")}
          type="button"
        >
          <FolderKanban size={15} />
          <span>Projects</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "submit" ? "is-active" : ""}`}
          onClick={() => setActiveView("submit")}
          type="button"
        >
          <Plus size={15} />
          <span>New scan</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "jobs" ? "is-active" : ""}`}
          onClick={() => setActiveView("jobs")}
          type="button"
        >
          <Activity size={15} />
          <span>Scans</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "review" || activeView === "workspace" ? "is-active" : ""}`}
          onClick={() => setActiveView("review")}
          type="button"
        >
          <Layers size={15} />
          <span>Review</span>
        </button>

        <div className="sidebar-nav-label">Build</div>
        <button
          className={`sidebar-nav-item ${activeView === "workflows" ? "is-active" : ""}`}
          onClick={() => setActiveView("workflows")}
          type="button"
        >
          <GitBranch size={15} />
          <span>Workflows</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "workers" ? "is-active" : ""}`}
          onClick={() => setActiveView("workers")}
          type="button"
        >
          <Cpu size={15} />
          <span>Workers</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "benchmarks" ? "is-active" : ""}`}
          onClick={() => setActiveView("benchmarks")}
          type="button"
        >
          <FlaskConical size={15} />
          <span>Benchmarks</span>
        </button>
        <button
          className={`sidebar-nav-item ${activeView === "settings" ? "is-active" : ""}`}
          onClick={() => setActiveView("settings")}
          type="button"
        >
          <Settings size={15} />
          <span>Settings</span>
        </button>
      </nav>

      <div className="sidebar-search-area">
        <label className="field">
          <span className="field-label">Recent reviews</span>
          <div className="field-input">
            <Search size={14} />
            <input
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search runs…"
            />
          </div>
        </label>

        <button
          className="command-button"
          onClick={() => setPaletteOpen(true)}
          type="button"
        >
          <Command size={14} />
          <span>Quick actions</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <div className="run-list">
        {runsLoading && <EmptyBlock icon={<Sparkles size={18} />} title="Loading runs" body="Indexing local audit outputs." />}
        {!runsLoading && filteredRuns.length === 0 && (
          <EmptyBlock
            icon={<FolderSearch2 size={18} />}
            title="No runs found"
            body="Start a scan or adjust the search."
          />
        )}
        {filteredRuns.map((run) => (
          <button
            key={run.id}
            className={`run-row ${activeView === "workspace" && run.id === selectedRunId ? "is-active" : ""}`}
            onClick={() => {
              setSelectedRunId(run.id);
              setActiveView("workspace");
            }}
            type="button"
          >
            <div className="run-row-left">
              <Activity size={13} className="run-icon" />
              <div className="run-row-info">
                <div className="run-row-title">{run.title}</div>
                <div className="run-row-subtitle">{formatRelativeDate(run.updatedAt)}</div>
              </div>
            </div>
            <div className="run-row-right">
              <span className="run-row-badge">{run.totalFindings}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="sidebar-footnote">
        <span>Local-first</span>
        <span>Evidence retained on disk</span>
      </div>
    </aside>
  );
});
