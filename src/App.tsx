import { useEffect, useMemo, useState, useCallback, useRef, type ReactNode } from "react";
import {
  ArrowUpRight,
  ChartNoAxesColumn,
  Command,
  FileSearch,
  GitCompareArrows,
  LayoutPanelTop,
  Network,
  PackageOpen,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";

import {
  cancelJob,
  createGithubJob,
  createUploadJob,
  fetchArtifact,
  fetchJob,
  fetchJobs,
  fetchRun,
  fetchRuns,
  fetchSource,
  fetchStudioState,
  fetchSystemConfig,
  fetchWorkers,
  finalizeDelivery,
  forgetWorker,
  pauseJob,
  resumeJob,
  resumeRunFromStage,
  saveStudioState,
  saveSystemConfig,
} from "./lib/api";
import {
  confidenceOrder,
  formatAbsoluteDate,
  formatRelativeDate,
  severityOrder,
} from "./lib/format";
import type {
  ArtifactPayload,
  Confidence,
  ExportFormat,
  FindingDecision,
  FocusState,
  GithubJobRequest,
  JobDetail,
  JobRecord,
  ResumeStage,
  RunDetail,
  RunSummary,
  Severity,
  SourcePayload,
  SystemConfigPayload,
  StudioPreferences,
  StudioState,
  TriageStatus,
  WorkerControlPayload,
} from "./types";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyBlock, MetricCard, PanelHeader, StatusPill } from "./components/Common";
import { Sidebar, type AppView } from "./components/Sidebar";
import { FindingsPanel } from "./components/FindingsPanel";
import { FindingDetail } from "./components/FindingDetail";
import { Inspector } from "./components/Inspector";
import { LiveRoundPanel } from "./components/LiveRoundPanel";
import { RunDiffPanel } from "./components/RunDiffPanel";
import { TriageSummaryPanel, ExportPanel } from "./components/TriageSummaryPanel";
import { TimelineChart } from "./components/TimelineChart";
import { DistributionList, HotspotList, AgentMix } from "./components/Intelligence";
import { RoundsPanel } from "./components/RoundsPanel";
import { ToastWrapper, type ToastType } from "./components/Toast";
import { Dashboard } from "./components/Dashboard";
import { ProjectsView } from "./components/ProjectsView";
import { JobsView } from "./components/JobsView";
import { ReviewHub } from "./components/ReviewHub";
import { Settings } from "./components/Settings";
import { SubmitRunView } from "./components/SubmitRunView";
import { WorkflowStudio } from "./components/WorkflowStudio";
import { WorkersView } from "./components/WorkersView";
import { BenchmarksView } from "./components/BenchmarksView";
import { ExecutionGraph } from "./components/ExecutionGraph";
import { SourceScopePanel } from "./components/SourceScopePanel";
import { FocusPanel } from "./components/FocusPanel";
import { ResumeRunModal } from "./components/ResumeRunModal";
import {
  applyPreferences,
  buildExportPayload,
  buildEvidenceProfile,
  buildRunDiff,
  buildTriageSummary,
  copyText,
  downloadTextFile,
  exportFormats,
  getFindingDecision,
  groupArtifacts,
  reviewedStatuses,
  starKey,
  toggleStar,
  updateFindingDecisionState,
  createDefaultStudioState,
  pickDefaultArtifact,
  buildArtifactCacheKey,
  normalize,
  findingSignature,
  sourceFileFromLocation,
  normalizeSeverityLabel,
  normalizeConfidenceLabel,
} from "./lib/utils";

type ArtifactCache = Record<string, ArtifactPayload>;
type StarMap = Record<string, boolean>;
type ScanTab = "overview" | "execution" | "findings" | "coverage" | "artifacts" | "diff";

const LIVE_TAIL_LINES = 160;
const LIVE_REFRESH_MS = 2500;
const SOURCE_CONTEXT_LINES = 12;

function pickDefaultReviewRun(runs: RunSummary[]) {
  return [...runs].sort((left, right) => {
    const leftScore =
      left.severityCounts.Critical * 10_000 +
      left.severityCounts.High * 1_000 +
      left.severityCounts.Medium * 100 +
      Math.max(left.latestDelta, 0) * 20 +
      Number(!left.converged) * 10 +
      left.totalFindings;
    const rightScore =
      right.severityCounts.Critical * 10_000 +
      right.severityCounts.High * 1_000 +
      right.severityCounts.Medium * 100 +
      Math.max(right.latestDelta, 0) * 20 +
      Number(!right.converged) * 10 +
      right.totalFindings;
    return rightScore - leftScore || right.updatedAt.localeCompare(left.updatedAt);
  })[0];
}

export default function App() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [compareRunId, setCompareRunId] = useState<string>("");
  const [compareRunDetail, setCompareRunDetail] = useState<RunDetail | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [selectedSourceLocation, setSelectedSourceLocation] = useState<string | null>(null);
  const [sourcePreview, setSourcePreview] = useState<SourcePayload | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [activeArtifactPath, setActiveArtifactPath] = useState<string | null>(null);
  const [artifactCache, setArtifactCache] = useState<ArtifactCache>({});
  const [globalSearch, setGlobalSearch] = useState("");
  const [findingSearch, setFindingSearch] = useState("");
  const [severityFilters, setSeverityFilters] = useState<Severity[]>(["Critical", "High", "Medium"]);
  const [confidenceFilters, setConfidenceFilters] = useState<Confidence[]>(["high", "medium", "low", "unknown"]);
  const [statusFilters, setStatusFilters] = useState<TriageStatus[]>([]);
  const [agentFilter, setAgentFilter] = useState("all");
  const [roundFilter, setRoundFilter] = useState("all");
  const [fileFilter, setFileFilter] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: ToastType }>>([]);

  const showToast = useCallback((message: string, type: ToastType = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((current) => [...current, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const [exportConfirmedOnly, setExportConfirmedOnly] = useState(true);
  const [batchStatus, setBatchStatus] = useState<TriageStatus>("Confirmed");
  const [studioState, setStudioState] = useState<StudioState | null>(null);
  const [studioStateLoading, setStudioStateLoading] = useState(false);
  const [studioStateDirty, setStudioStateDirty] = useState(false);
  const [studioStateSaveError, setStudioStateSaveError] = useState<string | null>(null);
  const [deliveryFinalizing, setDeliveryFinalizing] = useState(false);
  const [resumeModalOpen, setResumeModalOpen] = useState(false);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [starred, setStarred] = useLocalStorageState<StarMap>("audithound:starred", {});

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [selectedJobLoading, setSelectedJobLoading] = useState(false);
  const [jobMutationLoading, setJobMutationLoading] = useState(false);
  const [workerControl, setWorkerControl] = useState<WorkerControlPayload | null>(null);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [systemConfig, setSystemConfig] = useState<SystemConfigPayload | null>(null);
  const [systemConfigLoading, setSystemConfigLoading] = useState(true);
  const [systemConfigSaving, setSystemConfigSaving] = useState(false);
  const [systemConfigSaveError, setSystemConfigSaveError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<AppView>(() =>
    new URLSearchParams(window.location.search).has("run") ? "workspace" : "dashboard",
  );
  const [scanTab, setScanTab] = useState<ScanTab>("overview");
  const [sidebarWidth, setSidebarWidth] = useLocalStorageState<number>("audithound:sidebarWidth", 260);
  const [findingsListWidth, setFindingsListWidth] = useLocalStorageState<number>("audithound:findingsListWidth", 280);
  const [inspectorWidth, setInspectorWidth] = useLocalStorageState<number>("audithound:inspectorWidth", 340);
  const [theme, setTheme] = useLocalStorageState<"dark" | "light">("audithound:theme", "dark");
  const [paletteSearch, setPaletteSearch] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (theme === "light") {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
  }, [theme]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [activeView, scanTab, selectedRunId]);

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(180, Math.min(450, startWidth + (moveEvent.clientX - startX)));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [sidebarWidth, setSidebarWidth]);

  const handleFindingsResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = findingsListWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (moveEvent.clientX - startX)));
      setFindingsListWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [findingsListWidth, setFindingsListWidth]);

  const handleInspectorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = inspectorWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(250, Math.min(600, startWidth - (moveEvent.clientX - startX)));
      setInspectorWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [inspectorWidth, setInspectorWidth]);

  useEffect(() => {
    if (paletteOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [paletteOpen]);

  useEffect(() => {
    void (async () => {
      try {
        setRunsLoading(true);
        const loaded = await fetchRuns();
        setRuns(loaded);
        const fromUrl = new URLSearchParams(window.location.search).get("run");
        setSelectedRunId((current) =>
          loaded.find((run) => run.id === current)?.id ??
          loaded.find((run) => run.id === fromUrl)?.id ??
          pickDefaultReviewRun(loaded)?.id ??
          null,
        );
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load runs");
      } finally {
        setRunsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setWorkersLoading(true);
        const loaded = await fetchWorkers();
        if (!cancelled) {
          setWorkerControl(loaded);
        }
      } catch (error) {
        if (!cancelled) {
          setRunError(error instanceof Error ? error.message : "Failed to load workers");
        }
      } finally {
        if (!cancelled) {
          setWorkersLoading(false);
        }
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (activeView === "workers") {
        void load();
      }
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeView]);

  useEffect(() => {
    void (async () => {
      try {
        setJobsLoading(true);
        const loaded = await fetchJobs();
        setJobs(loaded);
        setSelectedJobId((current) => current ?? loaded[0]?.id ?? null);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load jobs");
      } finally {
        setJobsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setSystemConfigLoading(true);
        const loaded = await fetchSystemConfig();
        setSystemConfig(loaded);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load system settings");
      } finally {
        setSystemConfigLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (activeView === "workspace" && selectedRunId) {
      params.set("run", selectedRunId);
    } else {
      params.delete("run");
    }
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [activeView, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      setStudioState(null);
      return;
    }

    void (async () => {
      try {
        setDetailLoading(true);
        const loaded = await fetchRun(selectedRunId);
        setRunDetail(loaded);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load run details");
      } finally {
        setDetailLoading(false);
      }
    })();
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }

    void (async () => {
      try {
        setSelectedJobLoading(true);
        const loaded = await fetchJob(selectedJobId, { tailLines: 220 });
        setSelectedJob(loaded);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load job details");
      } finally {
        setSelectedJobLoading(false);
      }
    })();
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }

    void (async () => {
      try {
        setStudioStateLoading(true);
        setStudioStateSaveError(null);
        const loaded = await fetchStudioState(selectedRunId);
        setStudioState(loaded);
        applyPreferences(loaded.preferences, {
          setActiveArtifactPath,
          setAgentFilter,
          setChangedOnly,
          setConfidenceFilters,
          setFileFilter,
          setRoundFilter,
          setSelectedFindingId,
          setSeverityFilters,
          setStarredOnly,
          setStatusFilters,
          setUnreviewedOnly,
        });
        setStudioStateDirty(false);
      } catch (error) {
        setStudioState(createDefaultStudioState(selectedRunId));
        setStudioStateSaveError(error instanceof Error ? error.message : "Failed to load workspace state");
      } finally {
        setStudioStateLoading(false);
      }
    })();
  }, [selectedRunId]);

  useEffect(() => {
    if (!studioState || !studioStateDirty) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await saveStudioState(studioState);
          setStudioState((current) => (current?.runId === saved.runId ? saved : current));
          setStudioStateDirty(false);
          setStudioStateSaveError(null);
        } catch (error) {
          setStudioStateSaveError(error instanceof Error ? error.message : "Failed to save workspace state");
        }
      })();
    }, 550);

    return () => window.clearTimeout(timeout);
  }, [studioState, studioStateDirty]);

  useEffect(() => {
    if (!runDetail) {
      setSelectedFindingId(null);
      setActiveArtifactPath(null);
      return;
    }

    const findingStillExists = runDetail.findings.some((finding) => finding.id === selectedFindingId);
    const intentionallyShowingFindingList = scanTab === "findings" && selectedFindingId === null;
    if (!findingStillExists && !intentionallyShowingFindingList) {
      setSelectedFindingId(runDetail.findings[0]?.id ?? null);
    }

    const artifactStillExists = runDetail.artifacts.some((artifact) => artifact.relativePath === activeArtifactPath);
    if (!artifactStillExists) {
      setActiveArtifactPath(pickDefaultArtifact(runDetail)?.relativePath ?? null);
    }
  }, [activeArtifactPath, runDetail, scanTab, selectedFindingId]);

  useEffect(() => {
    if (!runDetail) {
      setCompareRunDetail(null);
      return;
    }

    const compareCandidates = runs.filter((run) => run.id !== runDetail.id);
    if (compareRunId === runDetail.id) {
      setCompareRunId("");
      return;
    }

    if (!compareRunId && compareCandidates.length > 0) {
      const sibling =
        compareCandidates.find((candidate) => candidate.title === runDetail.title) ??
        compareCandidates.find((candidate) => candidate.subtitle === runDetail.subtitle) ??
        compareCandidates[0];
      if (sibling) {
        setCompareRunId(sibling.id);
      }
    }
  }, [compareRunId, runDetail, runs]);

  useEffect(() => {
    if (!compareRunId) {
      setCompareRunDetail(null);
      return;
    }

    void (async () => {
      try {
        setCompareLoading(true);
        const loaded = await fetchRun(compareRunId);
        setCompareRunDetail(loaded);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to load compare run");
      } finally {
        setCompareLoading(false);
      }
    })();
  }, [compareRunId]);

  useEffect(() => {
    const shouldTailArtifact = Boolean(
      runDetail?.activeRound &&
        activeArtifactPath &&
        runDetail.artifacts.some(
          (artifact) => artifact.relativePath === activeArtifactPath && artifact.kind === "log" && artifact.round === runDetail.activeRound,
        ),
    );
    const artifactCacheKey = buildArtifactCacheKey(activeArtifactPath, shouldTailArtifact ? LIVE_TAIL_LINES : null);
    if (!activeArtifactPath || !artifactCacheKey || artifactCache[artifactCacheKey]) {
      return;
    }

    void (async () => {
      try {
        const payload = await fetchArtifact(activeArtifactPath, shouldTailArtifact ? { tailLines: LIVE_TAIL_LINES } : undefined);
        setArtifactCache((current) => ({ ...current, [artifactCacheKey]: payload }));
      } catch (error) {
        setArtifactCache((current) => ({
          ...current,
          [artifactCacheKey]: {
            relativePath: activeArtifactPath,
            kind: "text",
            data: error instanceof Error ? error.message : "Failed to load artifact",
          },
        }));
      }
    })();
  }, [activeArtifactPath, artifactCache, runDetail]);

  useEffect(() => {
    const shouldRefreshLiveRun =
      runDetail?.workflowRun.status === "running" ||
      runDetail?.workflowRun.status === "paused" ||
      Boolean(runDetail?.activeRound);
    if (!selectedRunId || activeView !== "workspace" || !shouldRefreshLiveRun) {
      return;
    }

    let cancelled = false;
    const refresh = () => {
      void (async () => {
        try {
          const [loadedRun, loadedRuns] = await Promise.all([fetchRun(selectedRunId, { fresh: true }), fetchRuns({ fresh: true })]);
          if (cancelled) {
            return;
          }
          setRunDetail(loadedRun);
          setRuns(loadedRuns);
        } catch {
          return;
        }
      })();
    };

    refresh();
    const interval = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeView, selectedRunId, runDetail?.activeRound, runDetail?.workflowRun.status]);

  useEffect(() => {
    if (!activeArtifactPath || !runDetail?.activeRound) {
      return;
    }

    const activeArtifact = runDetail.artifacts.find((artifact) => artifact.relativePath === activeArtifactPath);
    if (!activeArtifact || activeArtifact.kind !== "log" || activeArtifact.round !== runDetail.activeRound) {
      return;
    }

    const artifactCacheKey = buildArtifactCacheKey(activeArtifactPath, LIVE_TAIL_LINES);
    if (!artifactCacheKey) {
      return;
    }
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const payload = await fetchArtifact(activeArtifactPath, { tailLines: LIVE_TAIL_LINES, fresh: true });
          setArtifactCache((current) => ({ ...current, [artifactCacheKey]: payload }));
        } catch {
          return;
        }
      })();
    }, 1800);

    return () => window.clearInterval(interval);
  }, [activeArtifactPath, runDetail]);

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null);
      return;
    }
    if (selectedJobId && jobs.some((job) => job.id === selectedJobId)) {
      return;
    }
    setSelectedJobId(jobs[0]?.id ?? null);
  }, [jobs, selectedJobId]);

  useEffect(() => {
    const hasActiveJobs = jobs.some((job) => job.status === "queued" || job.status === "preparing" || job.status === "running");
    if (!hasActiveJobs) {
      return;
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const [loadedJobs, loadedRuns] = await Promise.all([fetchJobs({ fresh: true }), fetchRuns({ fresh: true })]);
          setJobs(loadedJobs);
          setRuns(loadedRuns);
          if (selectedJobId) {
            const loadedJob = await fetchJob(selectedJobId, { fresh: true, tailLines: 220 });
            setSelectedJob(loadedJob);
          }
        } catch {
          return;
        }
      })();
    }, LIVE_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [jobs, selectedJobId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setPaletteSearch("");
        setPaletteIndex(0);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!studioState || studioStateLoading) {
      return;
    }

    const preferences: StudioPreferences = {
      ...studioState.preferences,
      lastSelectedFindingId: selectedFindingId ?? undefined,
      lastSelectedArtifactPath: activeArtifactPath ?? undefined,
      severityFilters,
      confidenceFilters,
      statusFilters,
      agentFilter,
      roundFilter,
      fileFilter,
      starredOnly,
      unreviewedOnly,
      changedOnly,
    };

    if (JSON.stringify(preferences) === JSON.stringify(studioState.preferences)) {
      return;
    }

    setStudioState((current) => (current ? { ...current, preferences, updatedAt: new Date().toISOString() } : current));
    setStudioStateDirty(true);
  }, [
    activeArtifactPath,
    agentFilter,
    changedOnly,
    confidenceFilters,
    fileFilter,
    roundFilter,
    selectedFindingId,
    severityFilters,
    starredOnly,
    statusFilters,
    studioState,
    studioStateLoading,
    unreviewedOnly,
  ]);

  const filteredRuns = useMemo(() => {
    const query = normalize(globalSearch);
    if (!query) {
      return runs;
    }
    return runs.filter((run) => normalize([run.title, run.subtitle, run.id].join(" ")).includes(query));
  }, [globalSearch, runs]);

  const runDiff = useMemo(() => buildRunDiff(runDetail, compareRunDetail), [compareRunDetail, runDetail]);
  const changedFindingKeys = useMemo(() => {
    if (!runDiff) {
      return new Set<string>();
    }
    return new Set([...runDiff.currentOnly.map(findingSignature), ...runDiff.changed.map((item) => findingSignature(item.current))]);
  }, [runDiff]);

  const agentOptions = useMemo(() => {
    const agents = new Set<string>();
    for (const finding of runDetail?.findings ?? []) {
      for (const agent of finding.source_agents) {
        agents.add(agent);
      }
    }
    return [...agents].sort();
  }, [runDetail?.findings]);

  const roundOptions = useMemo(() => {
    const rounds = new Set<number>();
    for (const finding of runDetail?.findings ?? []) {
      if (typeof finding.round === "number") {
        rounds.add(finding.round);
      }
    }
    return [...rounds].sort((left, right) => left - right);
  }, [runDetail?.findings]);

  const fileOptions = useMemo(() => {
    const files = new Set<string>();
    for (const finding of runDetail?.findings ?? []) {
      for (const location of finding.locations) {
        const file = sourceFileFromLocation(location);
        if (file) {
          files.add(file);
        }
      }
    }
    return [...files].sort();
  }, [runDetail?.findings]);

  const filteredFindings = useMemo(() => {
    if (!runDetail) {
      return [];
    }

    const query = normalize(findingSearch);
    return runDetail.findings.filter((finding) => {
      const decision = getFindingDecision(studioState, finding.id);
      if (!severityFilters.includes(normalizeSeverityLabel(finding.severity))) {
        return false;
      }

      if (!confidenceFilters.includes(normalizeConfidenceLabel(finding.confidence))) {
        return false;
      }

      if (statusFilters.length > 0 && !statusFilters.includes(decision.status)) {
        return false;
      }

      if (unreviewedOnly && reviewedStatuses.has(decision.status)) {
        return false;
      }

      if (starredOnly && !starred[starKey(runDetail.id, finding.id)]) {
        return false;
      }

      if (agentFilter !== "all" && !finding.source_agents.includes(agentFilter)) {
        return false;
      }

      if (roundFilter !== "all" && String(finding.round ?? "") !== roundFilter) {
        return false;
      }

      if (fileFilter !== "all" && !finding.locations.some((location) => sourceFileFromLocation(location) === fileFilter)) {
        return false;
      }

      if (changedOnly && !changedFindingKeys.has(findingSignature(finding))) {
        return false;
      }

      if (!query) {
        return true;
      }

      return normalize(
        [
          finding.id,
          finding.title,
          finding.claim,
          finding.impact,
          finding.locations.join(" "),
          finding.paths.join(" "),
          finding.source_agents.join(" "),
        ].join(" "),
      ).includes(query);
    });
  }, [
    agentFilter,
    changedFindingKeys,
    changedOnly,
    confidenceFilters,
    fileFilter,
    findingSearch,
    roundFilter,
    runDetail,
    severityFilters,
    starred,
    starredOnly,
    statusFilters,
    studioState,
    unreviewedOnly,
  ]);

  const selectedFinding = useMemo(() => {
    return filteredFindings.find((finding) => finding.id === selectedFindingId) ??
      runDetail?.findings.find((finding) => finding.id === selectedFindingId) ??
      filteredFindings[0] ??
      null;
  }, [filteredFindings, runDetail?.findings, selectedFindingId]);

  useEffect(() => {
    if (!selectedFinding) {
      setSelectedSourceLocation(null);
      setSourcePreview(null);
      setSourceError(null);
      return;
    }

    setSelectedSourceLocation((current) =>
      current && selectedFinding.locations.includes(current) ? current : selectedFinding.locations[0] ?? null,
    );
  }, [selectedFinding]);

  useEffect(() => {
    if (!runDetail || !selectedSourceLocation) {
      setSourcePreview(null);
      setSourceError(null);
      return;
    }

    void (async () => {
      try {
        setSourceLoading(true);
        setSourceError(null);
        const preview = await fetchSource(runDetail.id, selectedSourceLocation, { context: SOURCE_CONTEXT_LINES });
        setSourcePreview(preview);
      } catch (error) {
        setSourcePreview(null);
        setSourceError(error instanceof Error ? error.message : "Failed to load source snippet");
      } finally {
        setSourceLoading(false);
      }
    })();
  }, [runDetail?.id, selectedSourceLocation]);

  const artifactGroups = useMemo(() => groupArtifacts(runDetail?.artifacts ?? []), [runDetail?.artifacts]);
  const activeArtifact = useMemo(() => runDetail?.artifacts.find((artifact) => artifact.relativePath === activeArtifactPath) ?? null, [runDetail?.artifacts, activeArtifactPath]);
  const shouldTailActiveArtifact = Boolean(
    runDetail?.activeRound && activeArtifact?.kind === "log" && activeArtifact.round === runDetail.activeRound,
  );
  const activeArtifactCacheKey = buildArtifactCacheKey(activeArtifactPath, shouldTailActiveArtifact ? LIVE_TAIL_LINES : null);
  const activeArtifactPayload = activeArtifactCacheKey ? artifactCache[activeArtifactCacheKey] || null : null;
  const compareCandidates = useMemo(
    () => runs.filter((run) => run.id !== runDetail?.id).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [runDetail?.id, runs],
  );
  const triageSummary = useMemo(() => buildTriageSummary(runDetail?.findings ?? [], studioState), [runDetail?.findings, studioState]);
  const selectedDecision = selectedFinding ? getFindingDecision(studioState, selectedFinding.id) : null;
  const selectedEvidence = selectedFinding && runDetail ? buildEvidenceProfile(selectedFinding, runDetail) : null;
  const exportableFindings = useMemo(() => {
    if (!runDetail) {
      return [];
    }
    const source = exportConfirmedOnly
      ? runDetail.findings.filter((finding) => getFindingDecision(studioState, finding.id).status === "Confirmed")
      : filteredFindings;
    return source;
  }, [exportConfirmedOnly, filteredFindings, runDetail, studioState]);

  const managedRunJob = useMemo(
    () => jobs.find((job) => job.runId === runDetail?.id || job.id === runDetail?.id) ?? null,
    [jobs, runDetail?.id],
  );
  const resumeExecutionActive = Boolean(
    runDetail?.workflowRun.status === "running" ||
    (managedRunJob && ["queued", "preparing", "running", "paused"].includes(managedRunJob.status)),
  );

  const updateSelectedDecision = useCallback((patch: Partial<FindingDecision>) => {
    if (!runDetail || !selectedFinding) {
      return;
    }
    updateFindingDecisionState(setStudioState, runDetail.id, selectedFinding.id, patch);
    setStudioStateDirty(true);
  }, [runDetail, selectedFinding]);

  const applyBatchStatus = useCallback(() => {
    if (!runDetail || filteredFindings.length === 0) {
      return;
    }
    setStudioState((current) => {
      const base = current ?? createDefaultStudioState(runDetail.id);
      const findings = { ...base.findings };
      for (const finding of filteredFindings) {
        findings[finding.id] = {
          ...getFindingDecision(base, finding.id),
          status: batchStatus,
          updatedAt: new Date().toISOString(),
        };
      }
      return { ...base, findings, updatedAt: new Date().toISOString() };
    });
    setStudioStateDirty(true);
  }, [runDetail, filteredFindings, batchStatus]);

  const exportFindings = useCallback((format: ExportFormat) => {
    if (!runDetail) {
      return;
    }
    const payload = buildExportPayload(runDetail, exportableFindings, studioState, format);
    downloadTextFile(payload.fileName, payload.mimeType, payload.content);
    showToast(`Exported findings successfully as ${format.toUpperCase()}`, "success");
  }, [runDetail, exportableFindings, studioState, showToast]);

  const handleFinalizeDelivery = useCallback(() => {
    if (!runDetail) {
      return;
    }
    void (async () => {
      try {
        setDeliveryFinalizing(true);
        const stateToSave = studioState ?? createDefaultStudioState(runDetail.id);
        const savedState = studioStateDirty ? await saveStudioState(stateToSave) : stateToSave;
        if (studioStateDirty) {
          setStudioState(savedState);
          setStudioStateDirty(false);
          setStudioStateSaveError(null);
        }
        const result = await finalizeDelivery(runDetail.id);
        const [loadedRun, loadedRuns, loadedJobs] = await Promise.all([
          fetchRun(runDetail.id, { fresh: true }),
          fetchRuns({ fresh: true }),
          fetchJobs({ fresh: true }),
        ]);
        setRunDetail(loadedRun);
        setRuns(loadedRuns);
        setJobs(loadedJobs);
        showToast(`Formal report sealed with ${result.report.findingCount} deliverable findings.`, "success");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to finalize delivery";
        setRunError(message);
        showToast(message, "error");
      } finally {
        setDeliveryFinalizing(false);
      }
    })();
  }, [runDetail, showToast, studioState, studioStateDirty]);

  const handleResumeFromStage = useCallback((stage: ResumeStage, round?: number) => {
    if (!runDetail) {
      return;
    }
    void (async () => {
      try {
        setResumeBusy(true);
        if (studioStateDirty) {
          const savedState = await saveStudioState(studioState ?? createDefaultStudioState(runDetail.id));
          setStudioState(savedState);
          setStudioStateDirty(false);
          setStudioStateSaveError(null);
        }
        const result = await resumeRunFromStage(runDetail.id, stage, round);
        const [loadedRun, loadedRuns, loadedJobs] = await Promise.all([
          fetchRun(runDetail.id, { fresh: true }),
          fetchRuns({ fresh: true }),
          fetchJobs({ fresh: true }),
        ]);
        setRunDetail(loadedRun);
        setRuns(loadedRuns);
        setJobs(loadedJobs);
        setResumeModalOpen(false);
        if (result.mode === "queued") {
          setSelectedJobId(result.job.id);
          setScanTab("execution");
          showToast(`Checkpoint created. Resuming from ${stage}${round ? ` in round ${round}` : ""}.`, "success");
        } else if (result.mode === "review") {
          setScanTab("findings");
          showToast("Human review reopened without rerunning automated analysis.", "success");
        } else {
          setScanTab("artifacts");
          showToast(`${stage === "report" ? "Delivery package" : "Regression baseline"} rebuilt from its checkpoint.`, "success");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to resume run";
        setRunError(message);
        showToast(message, "error");
      } finally {
        setResumeBusy(false);
      }
    })();
  }, [runDetail, showToast, studioState, studioStateDirty]);

  const toggleStarCallback = useCallback((findingId: string) => {
    if (!runDetail) return;
    toggleStar(setStarred, runDetail.id, findingId);
  }, [runDetail, setStarred]);

  const onCopyPath = useCallback((path: string) => {
    void copyText(path, () => {
      showToast("Copied path to clipboard!", "success");
    });
  }, [showToast]);

  const selectableItems = useMemo(() => {
    const query = normalize(paletteSearch);
    
    // 1. Commands
    const cmds = [
      {
        id: "cmd-toggle-theme",
        category: "commands" as const,
        title: "Toggle Color Theme",
        subtitle: `Switch to ${theme === "light" ? "Dark" : "Light"} mode`,
        action: () => setTheme(theme === "light" ? "dark" : "light"),
      },
      {
        id: "cmd-export-md",
        category: "commands" as const,
        title: "Export to Markdown",
        subtitle: "Download all triaged/visible findings as Markdown file",
        action: () => exportFindings("markdown"),
      },
      {
        id: "cmd-export-json",
        category: "commands" as const,
        title: "Export to JSON",
        subtitle: "Download all triaged/visible findings as JSON file",
        action: () => exportFindings("json"),
      },
      {
        id: "cmd-clear-filters",
        category: "commands" as const,
        title: "Clear Active Filters",
        subtitle: "Reset all severity, confidence, status, agent, and file filters",
        action: () => {
          setSeverityFilters(["Critical", "High", "Medium", "Low", "Informational"]);
          setConfidenceFilters(["high", "medium", "low", "unknown"]);
          setStatusFilters([]);
          setAgentFilter("all");
          setRoundFilter("all");
          setFileFilter("all");
          setStarredOnly(false);
          setUnreviewedOnly(false);
          setChangedOnly(false);
          setFindingSearch("");
          showToast("Cleared all filters!", "success");
        },
      },
      {
        id: "cmd-go-dashboard",
        category: "commands" as const,
        title: "Go to Dashboard",
        subtitle: "Navigate to global runs analytics and summary panel",
        action: () => setActiveView("dashboard"),
      },
      {
        id: "cmd-go-submit",
        category: "commands" as const,
        title: "Go to Submit",
        subtitle: "Create a new GitHub or archive-backed audit job",
        action: () => setActiveView("submit"),
      },
      {
        id: "cmd-go-jobs",
        category: "commands" as const,
        title: "Go to Jobs",
        subtitle: "Inspect the queue and tail execution logs",
        action: () => setActiveView("jobs"),
      },
      {
        id: "cmd-go-review",
        category: "commands" as const,
        title: "Open Review Queue",
        subtitle: "Choose a live, pending, partial, or delivered review",
        action: () => setActiveView("review"),
      },
      {
        id: "cmd-go-workflows",
        category: "commands" as const,
        title: "Open Workflow Studio",
        subtitle: "Inspect and version typed security review contracts",
        action: () => setActiveView("workflows"),
      },
      {
        id: "cmd-go-benchmarks",
        category: "commands" as const,
        title: "Open Benchmarks",
        subtitle: "Measure evidence readiness and repeat-run stability",
        action: () => setActiveView("benchmarks"),
      },
      {
        id: "cmd-go-settings",
        category: "commands" as const,
        title: "Go to Settings",
        subtitle: "Navigate to studio configuration and credentials settings",
        action: () => setActiveView("settings"),
      },
    ];

    // 2. Runs
    const runItems = runs.map((r) => ({
      id: `run-${r.id}`,
      category: "runs" as const,
      title: r.title,
      subtitle: `Select run ${r.id}`,
      action: () => {
        setSelectedRunId(r.id);
        setActiveView("workspace");
        setScanTab("overview");
      },
    }));

    // 3. Findings
    const findingItems = (runDetail?.findings ?? []).map((f) => ({
      id: `finding-${f.id}`,
      category: "findings" as const,
      title: f.title ?? f.id,
      subtitle: `Jump to finding ${f.id} (${f.severity})`,
      action: () => {
        setSelectedFindingId(f.id);
        setActiveView("workspace");
        setScanTab("findings");
      },
    }));

    const jobItems = jobs.map((job) => ({
      id: `job-${job.id}`,
      category: "jobs" as const,
      title: job.name,
      subtitle: `Open job ${job.id} (${job.status})`,
      action: () => {
        setSelectedJobId(job.id);
        setActiveView("jobs");
      },
    }));

    const all = [...cmds, ...jobItems, ...runItems, ...findingItems];
    if (!query) {
      return [
        ...cmds,
        ...jobItems.slice(0, 5),
        ...runItems.slice(0, 5),
        ...findingItems.slice(0, 5),
      ];
    }

    return all.filter(
      (item) =>
        normalize(item.title).includes(query) ||
        normalize(item.subtitle).includes(query)
    );
  }, [paletteSearch, theme, runs, jobs, runDetail, exportFindings, showToast, setTheme, setSeverityFilters, setConfidenceFilters, setStatusFilters, setAgentFilter, setRoundFilter, setFileFilter, setStarredOnly, setUnreviewedOnly, setChangedOnly, setFindingSearch]);

  const handlePaletteKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPaletteIndex((curr) => (curr + 1) % Math.max(selectableItems.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPaletteIndex((curr) => (curr - 1 + selectableItems.length) % Math.max(selectableItems.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selectedItem = selectableItems[paletteIndex];
      if (selectedItem) {
        selectedItem.action();
        setPaletteOpen(false);
        setPaletteSearch("");
        setPaletteIndex(0);
      }
    }
  }, [selectableItems, paletteIndex]);

  const handleSelectRun = useCallback((id: string) => {
    setSelectedRunId(id);
    setActiveView("workspace");
    setScanTab("overview");
  }, []);

  const handleSelectJob = useCallback((jobId: string) => {
    setSelectedJobId(jobId);
    setActiveView("jobs");
  }, []);

  const handleRefreshJobs = useCallback(() => {
    void (async () => {
      try {
        const [loadedJobs, loadedRuns] = await Promise.all([fetchJobs({ fresh: true }), fetchRuns({ fresh: true })]);
        setJobs(loadedJobs);
        setRuns(loadedRuns);
        if (selectedJobId) {
          const loadedJob = await fetchJob(selectedJobId, { fresh: true, tailLines: 220 });
          setSelectedJob(loadedJob);
        }
        showToast("Refreshed job queue.", "success");
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to refresh jobs");
      }
    })();
  }, [selectedJobId, showToast]);

  const handleRefreshWorkers = useCallback(() => {
    void (async () => {
      try {
        setWorkersLoading(true);
        setWorkerControl(await fetchWorkers());
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to refresh workers.", "error");
      } finally {
        setWorkersLoading(false);
      }
    })();
  }, [showToast]);

  const handleForgetWorker = useCallback((workerId: string) => {
    void (async () => {
      try {
        await forgetWorker(workerId);
        setWorkerControl(await fetchWorkers());
        showToast("Offline worker removed.");
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to remove worker.", "error");
      }
    })();
  }, [showToast]);

  const handleSubmitGithubJob = useCallback(async (payload: GithubJobRequest) => {
    try {
      setJobMutationLoading(true);
      const created = await createGithubJob(payload);
      const loadedJobs = await fetchJobs({ fresh: true });
      setJobs(loadedJobs);
      setSelectedJobId(created.id);
      setActiveView("jobs");
      showToast("Queued GitHub audit job.", "success");
    } finally {
      setJobMutationLoading(false);
    }
  }, [showToast]);

  const handleSubmitUploadJob = useCallback(async (payload: FormData) => {
    try {
      setJobMutationLoading(true);
      const created = await createUploadJob(payload);
      const loadedJobs = await fetchJobs({ fresh: true });
      setJobs(loadedJobs);
      setSelectedJobId(created.id);
      setActiveView("jobs");
      showToast("Queued archive audit job.", "success");
    } finally {
      setJobMutationLoading(false);
    }
  }, [showToast]);

  const handleCancelJob = useCallback((jobId: string) => {
    void (async () => {
      try {
        setJobMutationLoading(true);
        const updated = await cancelJob(jobId);
        setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
        if (selectedJobId === updated.id) {
          const detail = await fetchJob(updated.id, { fresh: true, tailLines: 220 });
          setSelectedJob(detail);
        }
        showToast("Cancellation request sent.", "success");
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to cancel job");
      } finally {
        setJobMutationLoading(false);
      }
    })();
  }, [selectedJobId, showToast]);

  const handlePauseJob = useCallback((jobId: string) => {
    void (async () => {
      try {
        const updated = await pauseJob(jobId);
        setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
        if (selectedJobId === updated.id) {
          setSelectedJob(await fetchJob(updated.id, { fresh: true, tailLines: 220 }));
        }
        showToast("Execution paused with artifacts preserved.", "info");
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to pause job");
      }
    })();
  }, [selectedJobId, showToast]);

  const handleResumeJob = useCallback((jobId: string) => {
    void (async () => {
      try {
        const updated = await resumeJob(jobId);
        setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
        if (selectedJobId === updated.id) {
          setSelectedJob(await fetchJob(updated.id, { fresh: true, tailLines: 220 }));
        }
        showToast("Execution resumed.", "success");
      } catch (error) {
        setRunError(error instanceof Error ? error.message : "Failed to resume job");
      }
    })();
  }, [selectedJobId, showToast]);

  const handleSaveSettings = useCallback((config: SystemConfigPayload["config"]) => {
    void (async () => {
      try {
        setSystemConfigSaving(true);
        setSystemConfigSaveError(null);
        const saved = await saveSystemConfig(config);
        setSystemConfig(saved);
        showToast("Saved server defaults.", "success");
      } catch (error) {
        setSystemConfigSaveError(error instanceof Error ? error.message : "Failed to save settings");
      } finally {
        setSystemConfigSaving(false);
      }
    })();
  }, [showToast]);

  const handleBackToList = useCallback(() => {
    setSelectedFindingId(null);
  }, []);

  const handleFocusChange = useCallback((focus: FocusState) => {
    setRunDetail((current) => (current ? { ...current, focus } : current));
  }, []);

  const handleFocusContinuationQueued = useCallback((job: JobRecord) => {
    setJobs((current) => (
      current.some((item) => item.id === job.id)
        ? current.map((item) => (item.id === job.id ? job : item))
        : [job, ...current]
    ));
  }, []);

  const inspectorOpen = activeView === "workspace" && scanTab === "artifacts";
  const deliveryComplete = Boolean(
    runDetail?.artifacts.some((artifact) => artifact.relativePath === `output/${runDetail.id}/delivery_manifest.json`),
  );
  const scanTabs: Array<{ id: ScanTab; label: string; icon: ReactNode; badge?: number }> = [
    { id: "overview", label: "Overview", icon: <ChartNoAxesColumn size={14} /> },
    { id: "execution", label: "Execution", icon: <Network size={14} /> },
    { id: "findings", label: "Findings", icon: <ShieldCheck size={14} />, badge: runDetail?.findings.length },
    { id: "coverage", label: "Source scope", icon: <FileSearch size={14} /> },
    { id: "artifacts", label: "Artifacts", icon: <PackageOpen size={14} />, badge: runDetail?.artifacts.length },
    { id: "diff", label: "Diff", icon: <GitCompareArrows size={14} /> },
  ];

  return (
    <ErrorBoundary>
      <div
        className={`app-shell is-view-${activeView} theme-${theme} ${inspectorOpen ? "is-inspector-open" : ""}`}
        style={{
          position: "relative",
          "--sidebar-width": `${sidebarWidth}px`,
          "--inspector-width": `${inspectorWidth}px`,
        } as React.CSSProperties}
      >
        <Sidebar
          runs={runs}
          runsLoading={runsLoading}
          filteredRuns={filteredRuns}
          selectedRunId={selectedRunId}
          globalSearch={globalSearch}
          setGlobalSearch={setGlobalSearch}
          setSelectedRunId={setSelectedRunId}
          setPaletteOpen={setPaletteOpen}
          activeView={activeView}
          setActiveView={setActiveView}
        />

        {/* Sidebar Resize Split Handle */}
        <div
          className="split-handle"
          style={{ left: "calc(var(--sidebar-width) - 2px)" }}
          onMouseDown={handleSidebarResizeStart}
        />

        {/* Inspector Resize Split Handle */}
        {inspectorOpen && (
          <div
            className="split-handle"
            style={{ right: "calc(var(--inspector-width) - 2px)", left: "auto" }}
            onMouseDown={handleInspectorResizeStart}
          />
        )}

        <main className="content" ref={contentRef}>
          {activeView === "dashboard" && (
            <Dashboard
              runs={runs}
              onSelectRun={handleSelectRun}
              onNewScan={() => setActiveView("submit")}
            />
          )}

          {activeView === "projects" && (
            <ProjectsView
              runs={runs}
              onOpenRun={handleSelectRun}
              onNewScan={() => setActiveView("submit")}
            />
          )}

          {activeView === "submit" && (
            <SubmitRunView
              configPayload={systemConfig}
              loading={systemConfigLoading}
              submitting={jobMutationLoading}
              onSubmitGithub={handleSubmitGithubJob}
              onSubmitUpload={handleSubmitUploadJob}
            />
          )}

          {activeView === "jobs" && (
            <JobsView
              jobs={jobs}
              jobsLoading={jobsLoading}
              selectedJobId={selectedJobId}
              selectedJob={selectedJob}
              selectedJobLoading={selectedJobLoading}
              onSelectJob={handleSelectJob}
              onCancelJob={handleCancelJob}
              onPauseJob={handlePauseJob}
              onResumeJob={handleResumeJob}
              onRefresh={handleRefreshJobs}
              onOpenRun={handleSelectRun}
            />
          )}

          {activeView === "review" && (
            <ReviewHub
              jobs={jobs}
              loading={jobsLoading || runsLoading}
              onOpenJob={handleSelectJob}
              onOpenRun={handleSelectRun}
              onRefresh={handleRefreshJobs}
              runs={runs}
            />
          )}

          {activeView === "workflows" && (
            <WorkflowStudio onNotify={showToast} />
          )}

          {activeView === "workers" && (
            <WorkersView
              loading={workersLoading}
              onForget={handleForgetWorker}
              onRefresh={handleRefreshWorkers}
              payload={workerControl}
            />
          )}

          {activeView === "benchmarks" && (
            <BenchmarksView onOpenRun={handleSelectRun} />
          )}

          {activeView === "settings" && (
            <Settings
              theme={theme}
              setTheme={setTheme}
              systemConfig={systemConfig}
              loading={systemConfigLoading}
              saving={systemConfigSaving}
              saveError={systemConfigSaveError}
              onSave={handleSaveSettings}
            />
          )}

          {activeView === "workspace" && (
            <>
              {runError && <div className="banner error">{runError}</div>}

              {!runDetail && detailLoading && (
                <section className="panel hero">
                  <EmptyBlock icon={<LayoutPanelTop size={18} />} title="Loading workspace" body="Fetching run details and assembling round intelligence." />
                </section>
              )}

              {runDetail && (
                <>
                  <section className="scan-header">
                    <div className="scan-header-main">
                      <div className="scan-header-kicker">
                        <button onClick={() => setActiveView("review")} type="button">Review</button>
                        <span>/</span>
                        <code>{runDetail.id}</code>
                      </div>
                      <div className="scan-header-title">
                        <h2>{managedRunJob?.name ?? runDetail.title}</h2>
                        <StatusPill
                          tone={
                            deliveryComplete
                              ? "safe"
                              : runDetail.workflowRun.status === "running"
                              ? "info"
                              : runDetail.workflowRun.status === "awaiting_review"
                                ? "medium"
                                : runDetail.workflowRun.status === "completed"
                                  ? "medium"
                                  : runDetail.workflowRun.status === "failed"
                                    ? "critical"
                                    : "neutral"
                          }
                          label={
                            deliveryComplete
                              ? "Delivered"
                              : runDetail.workflowRun.status === "running"
                              ? "Running"
                              : runDetail.workflowRun.status === "awaiting_review"
                                ? "Review ready"
                                : runDetail.workflowRun.status === "completed"
                                  ? "Legacy report · review open"
                                  : runDetail.workflowRun.status === "failed"
                                    ? "Failed"
                                    : runDetail.converged
                                      ? "Automation converged"
                                      : "Pending"
                          }
                        />
                      </div>
                      <p>{runDetail.targetPath ?? runDetail.relativePath}</p>
                      <div className="scan-header-meta">
                        <span>{runDetail.workflow.name}</span>
                        <span>{runDetail.rounds.length} rounds</span>
                        <span>{runDetail.scopeFileCount} files</span>
                        <span>Updated {formatRelativeDate(runDetail.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="scan-header-actions">
                      <button className="button secondary" onClick={() => setResumeModalOpen(true)} type="button">
                        <RotateCcw size={14} />
                        <span>Resume from…</span>
                      </button>
                      {runDetail.codeMapAvailable && (
                        <button
                          className="button secondary"
                          onClick={() => {
                            setActiveArtifactPath(`output/${runDetail.id}/code_map.md`);
                            setScanTab("artifacts");
                          }}
                          type="button"
                        >
                          <ArrowUpRight size={14} />
                          <span>Code map</span>
                        </button>
                      )}
                      <button
                        className="button primary"
                        onClick={() => setScanTab(runDetail.workflowRun.status === "running" ? "execution" : "findings")}
                        type="button"
                      >
                        {runDetail.workflowRun.status === "running" ? <Network size={14} /> : <ShieldCheck size={14} />}
                        {runDetail.workflowRun.status === "running" ? "Follow execution" : "Review findings"}
                      </button>
                    </div>
                  </section>

                  <nav aria-label="Scan sections" className="scan-tabs">
                    {scanTabs.map((tab) => (
                      <button
                        aria-current={scanTab === tab.id ? "page" : undefined}
                        className={scanTab === tab.id ? "is-active" : ""}
                        key={tab.id}
                        onClick={() => setScanTab(tab.id)}
                        type="button"
                      >
                        {tab.icon}
                        <span>{tab.label}</span>
                        {typeof tab.badge === "number" && <small>{tab.badge}</small>}
                      </button>
                    ))}
                  </nav>

                  {scanTab === "overview" && (
                    <div className="scan-tab-content">
                      <section className="metric-strip scan-metric-strip">
                        <MetricCard label="Unreviewed" value={String(triageSummary.unreviewed)} hint="Needs an explicit decision" tone={triageSummary.unreviewed > 0 ? "medium" : "safe"} />
                        <MetricCard label="Reviewed" value={String(runDetail.totalFindings - triageSummary.unreviewed)} hint={`${triageSummary.unreviewed} still need a decision`} tone={triageSummary.unreviewed === 0 ? "safe" : "medium"} />
                        <MetricCard label="Confirmed" value={String(triageSummary.confirmed)} hint="Ready for delivery" tone="safe" />
                        <MetricCard label="Last delta" value={`${runDetail.latestDelta >= 0 ? "+" : ""}${runDetail.latestDelta}`} hint="Latest round net change" tone={runDetail.latestDelta > 0 ? "medium" : "safe"} />
                        <MetricCard label="Updated" value={formatRelativeDate(runDetail.updatedAt)} hint={formatAbsoluteDate(runDetail.updatedAt)} tone="neutral" />
                      </section>

                      <section className="review-priority-grid">
                        <article className="review-priority-card is-primary">
                          <div className="review-priority-icon"><ShieldCheck size={18} /></div>
                          <div>
                            <div className="eyebrow">Reviewer focus</div>
                            <h3>
                              {runDetail.workflowRun.status === "running"
                                ? "Automation is still producing evidence."
                                : triageSummary.unreviewed > 0
                                  ? `${triageSummary.unreviewed} findings still need judgment.`
                                  : "The review queue is clear."}
                            </h3>
                            <p>
                              {runDetail.workflowRun.status === "running"
                                ? "Follow the execution graph now; findings become reviewable here as each stage lands."
                                : "Confirm evidence, actor capability, impact, and remediation before anything enters delivery."}
                            </p>
                          </div>
                          <button
                            className="button primary"
                            onClick={() => setScanTab(runDetail.workflowRun.status === "running" ? "execution" : "findings")}
                            type="button"
                          >
                            {runDetail.workflowRun.status === "running" ? "Follow live execution" : "Open review queue"}
                            <ArrowUpRight size={14} />
                          </button>
                        </article>
                        <article className="review-priority-card">
                          <div className="eyebrow">Source scope</div>
                          <strong>{runDetail.scope.scopeFiles}</strong>
                          <p>{runDetail.scope.coverageMode === "workflow-tasks" ? `${runDetail.scope.completedTasks} of ${runDetail.scope.plannedTasks} explicit assignments completed.` : "General workers receive every in-scope source file without pre-assignment."}</p>
                          <button className="text-button" onClick={() => setScanTab("coverage")} type="button">Inspect source inventory</button>
                        </article>
                        <article className="review-priority-card">
                          <div className="eyebrow">Independent support</div>
                          <strong>{runDetail.findings.filter((finding) => new Set(finding.source_agents).size > 1).length}</strong>
                          <p>Findings retain support from more than one independent worker.</p>
                          <button className="text-button" onClick={() => setScanTab("diff")} type="button">Compare baseline</button>
                        </article>
                      </section>

                      <section className="workflow-grid">
                        <div className="panel">
                          <TriageSummaryPanel
                            batchStatus={batchStatus}
                            filteredCount={filteredFindings.length}
                            onApplyBatchStatus={applyBatchStatus}
                            onBatchStatusChange={setBatchStatus}
                            saveError={studioStateSaveError}
                            saving={studioStateDirty}
                            summary={triageSummary}
                          />
                        </div>
                        <div className="panel">
                          <ExportPanel
                            confirmedOnly={exportConfirmedOnly}
                            deliveryComplete={deliveryComplete}
                            exportCount={exportableFindings.length}
                            finalizing={deliveryFinalizing}
                            formats={exportFormats}
                            onExport={exportFindings}
                            onFinalize={handleFinalizeDelivery}
                            onToggleConfirmedOnly={setExportConfirmedOnly}
                          />
                        </div>
                      </section>

                      <section className="overview-grid">
                        <div className="panel">
                          <PanelHeader title="Round deltas" eyebrow="History" />
                          <TimelineChart rounds={runDetail.roundsDetail} />
                        </div>
                        <div className="panel">
                          <PanelHeader title="Severity mix" eyebrow="Risk profile" />
                          <DistributionList counts={runDetail.severityCounts} order={severityOrder} mode="severity" />
                          <div className="subdivider" />
                          <PanelHeader title="Confidence" eyebrow="Signal confidence" compact />
                          <DistributionList counts={runDetail.confidenceCounts} order={confidenceOrder} mode="confidence" />
                        </div>
                        <div className="panel">
                          <PanelHeader title="Hotspots" eyebrow="Source pressure" />
                          <HotspotList hotspots={runDetail.hotspots} />
                          <div className="subdivider" />
                          <PanelHeader title="Source agents" eyebrow="Attribution" compact />
                          <AgentMix counts={runDetail.sourceAgentCounts} />
                        </div>
                      </section>
                    </div>
                  )}

                  {scanTab === "execution" && (
                    <div className="scan-tab-content">
                      <section className="panel execution-panel">
                        <ExecutionGraph workflow={runDetail.workflow} snapshot={runDetail.workflowRun} />
                      </section>
                      {runDetail.workflow.nodes.some((node) => node.kind === "focus") && (
                        <FocusPanel
                          findings={runDetail.findings}
                          focus={runDetail.focus}
                          lastCompletedRound={runDetail.lastCompletedRound}
                          managedJob={managedRunJob}
                          onChange={handleFocusChange}
                          onContinuationQueued={handleFocusContinuationQueued}
                          onNotify={showToast}
                          runId={runDetail.id}
                          workflowStatus={runDetail.workflowRun.status}
                        />
                      )}
                      <section className="instrumentation-grid">
                        <div className="panel">
                          <PanelHeader title="Live execution" eyebrow="Current activity" />
                          <LiveRoundPanel
                            activeRound={runDetail.activeRound}
                            artifacts={runDetail.liveTailArtifacts}
                            activeArtifactPath={activeArtifactPath}
                            lastCompletedRound={runDetail.lastCompletedRound}
                            onOpenArtifact={(artifactPath) => {
                              setActiveArtifactPath(artifactPath);
                              setScanTab("artifacts");
                            }}
                            rounds={runDetail.rounds}
                          />
                        </div>
                        <RoundsPanel
                          roundsDetail={runDetail.roundsDetail}
                          activeArtifactPath={activeArtifactPath}
                          setActiveArtifactPath={(artifactPath) => {
                            setActiveArtifactPath(artifactPath);
                            if (artifactPath) {
                              setScanTab("artifacts");
                            }
                          }}
                        />
                      </section>
                    </div>
                  )}

                  {scanTab === "findings" && (
                    <section className="workspace-grid is-review-tab">
                      <FindingsPanel
                        runId={runDetail.id}
                        findingSearch={findingSearch}
                        setFindingSearch={setFindingSearch}
                        severityFilters={severityFilters}
                        setSeverityFilters={setSeverityFilters}
                        confidenceFilters={confidenceFilters}
                        setConfidenceFilters={setConfidenceFilters}
                        statusFilters={statusFilters}
                        setStatusFilters={setStatusFilters}
                        agentFilter={agentFilter}
                        setAgentFilter={setAgentFilter}
                        roundFilter={roundFilter}
                        setRoundFilter={setRoundFilter}
                        fileFilter={fileFilter}
                        setFileFilter={setFileFilter}
                        starredOnly={starredOnly}
                        setStarredOnly={setStarredOnly}
                        unreviewedOnly={unreviewedOnly}
                        setUnreviewedOnly={setUnreviewedOnly}
                        changedOnly={changedOnly}
                        setChangedOnly={setChangedOnly}
                        agentOptions={agentOptions}
                        roundOptions={roundOptions}
                        fileOptions={fileOptions}
                        filteredFindings={filteredFindings}
                        selectedFindingId={selectedFindingId}
                        setSelectedFindingId={setSelectedFindingId}
                        starred={starred}
                        onToggleStar={toggleStarCallback}
                        loading={detailLoading}
                        findingsListWidth={findingsListWidth}
                        onResizeStart={handleFindingsResizeStart}
                      >
                        <FindingDetail
                          key={selectedFinding?.id ?? "empty"}
                          selectedFinding={selectedFinding}
                          selectedDecision={selectedDecision}
                          selectedEvidence={selectedEvidence}
                          updateSelectedDecision={updateSelectedDecision}
                          selectedSourceLocation={selectedSourceLocation}
                          setSelectedSourceLocation={setSelectedSourceLocation}
                          sourcePreview={sourcePreview}
                          sourceLoading={sourceLoading}
                          sourceError={sourceError}
                          onBackToList={handleBackToList}
                        />
                      </FindingsPanel>
                    </section>
                  )}

                  {scanTab === "coverage" && (
                    <div className="scan-tab-content">
                      <section className="panel coverage-panel">
                        <SourceScopePanel
                          scope={runDetail.scope}
                          items={runDetail.sourceFiles}
                          onOpenFinding={(findingId) => {
                            setSelectedFindingId(findingId);
                            setScanTab("findings");
                          }}
                        />
                      </section>
                    </div>
                  )}

                  {scanTab === "artifacts" && (
                    <div className="scan-tab-content artifact-tab-content">
                      <RoundsPanel
                        roundsDetail={runDetail.roundsDetail}
                        activeArtifactPath={activeArtifactPath}
                        setActiveArtifactPath={setActiveArtifactPath}
                      />
                    </div>
                  )}

                  {scanTab === "diff" && (
                    <div className="scan-tab-content">
                      <section className="panel diff-panel">
                        <PanelHeader title="Regression baseline" eyebrow="Cross-run lineage" />
                        <RunDiffPanel
                          compareCandidates={compareCandidates}
                          compareLoading={compareLoading}
                          compareRunDetail={compareRunDetail}
                          compareRunId={compareRunId}
                          currentRun={runDetail}
                          diff={runDiff}
                          onSelectCompareRun={setCompareRunId}
                        />
                      </section>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>

        {inspectorOpen && (
          <Inspector
            activeArtifact={activeArtifact}
            activeArtifactPayload={activeArtifactPayload}
            activeArtifactPath={activeArtifactPath}
            artifactGroups={artifactGroups}
            setActiveArtifactPath={setActiveArtifactPath}
            onCopyPath={onCopyPath}
          />
        )}

        {paletteOpen && (
          <div
            className="palette-backdrop"
            onClick={() => {
              setPaletteOpen(false);
              setPaletteSearch("");
              setPaletteIndex(0);
            }}
          >
            <div
              className="palette"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="palette-header" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: "8px", padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <Command size={15} />
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--label-secondary)" }}>Command Palette</span>
                </div>
                <input
                  ref={inputRef}
                  className="palette-input"
                  style={{
                    background: "none",
                    border: "none",
                    outline: "none",
                    padding: "0",
                    margin: "0",
                    height: "32px",
                    fontSize: "14px"
                  }}
                  value={paletteSearch}
                  onChange={(e) => {
                    setPaletteSearch(e.target.value);
                    setPaletteIndex(0);
                  }}
                  onKeyDown={handlePaletteKeyDown}
                  placeholder="Type a command, run title, or finding ID..."
                  autoFocus
                />
              </div>

              <div className="palette-list">
                {selectableItems.map((item, index) => (
                  <button
                    key={item.id}
                    className={`palette-item ${index === paletteIndex ? "is-selected" : ""}`}
                    onClick={() => {
                      item.action();
                      setPaletteOpen(false);
                      setPaletteSearch("");
                      setPaletteIndex(0);
                    }}
                    type="button"
                    style={{
                      border: "none",
                      background: "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                      <span>{item.title}</span>
                      <small style={{
                        textTransform: "uppercase",
                        fontSize: "8px",
                        backgroundColor: index === paletteIndex ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)",
                        color: index === paletteIndex ? "#ffffff" : "var(--label-secondary)",
                        padding: "2px 6px",
                        borderRadius: "4px"
                      }}>
                        {item.category}
                      </small>
                    </div>
                    <small>{item.subtitle}</small>
                  </button>
                ))}
                {selectableItems.length === 0 && (
                  <div style={{ padding: "16px", textAlign: "center", color: "var(--label-tertiary)", fontSize: "12px" }}>
                    No matching commands, runs, or findings.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {resumeModalOpen && runDetail && (
          <ResumeRunModal
            busy={resumeBusy}
            executionActive={resumeExecutionActive}
            onClose={() => setResumeModalOpen(false)}
            onResume={handleResumeFromStage}
            open={resumeModalOpen}
            run={runDetail}
          />
        )}
        <ToastWrapper toasts={toasts} onRemove={removeToast} />
      </div>
    </ErrorBoundary>
  );
}

// ----------------------------------------------------
// Pure Utility Hooks and Functions
// ----------------------------------------------------

function useLocalStorageState<T>(key: string, initialValue: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      return;
    }
  }, [key, state]);

  return [state, setState] as const;
}
