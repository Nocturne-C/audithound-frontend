import type {
  BenchmarkOverview,
  ScopeSnapshot,
  SourceFileItem,
  WorkflowDefinition,
  WorkflowRunSnapshot,
} from "../shared/workflow";

export type {
  BenchmarkOverview,
  BenchmarkTarget,
  ScopeSnapshot,
  SourceFileItem,
  WorkflowCatalogItem,
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeExecution,
  WorkflowNodeKind,
  WorkflowNodePosition,
  WorkflowRunSnapshot,
  WorkflowValidationIssue,
  WorkflowValidationResult,
  WorkflowVersionSummary,
} from "../shared/workflow";

export type Severity = "Critical" | "High" | "Medium" | "Low" | "Informational" | "Unknown";
export type Confidence = "high" | "medium" | "low" | "unknown";
export type TriageStatus =
  | "New"
  | "Reviewing"
  | "Confirmed"
  | "False Positive"
  | "Duplicate"
  | "Needs Evidence"
  | "Accepted Risk"
  | "Fixed"
  | "Retest Passed";
export type ExportFormat = "markdown" | "csv" | "json" | "github";
export type JobAgent = "codex" | "claude" | "opencode" | "pi";
export type ScanProfile = "preview" | "deep" | "release";
export type LanguageProfile = "solidity" | "solana-rust" | "generic";
export type MergeMode = "codex" | "manual";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type FocusPolicy = "off" | "suggest" | "auto";
export type ExecutionMode = "local" | "worker";
export type ResumeStage =
  | "scope"
  | "map"
  | "investigate"
  | "focus"
  | "normalize"
  | "summary"
  | "review"
  | "regression"
  | "report";

export type CountMap<T extends string = string> = Record<T, number>;

export type Finding = {
  id: string;
  fingerprint?: string;
  severity?: string;
  confidence?: string;
  title?: string;
  claim?: string;
  impact?: string;
  round?: number;
  locations: string[];
  paths: string[];
  source_agents: string[];
  vulnerability_class?: string;
  root_cause?: {
    component?: string;
    symbol?: string;
    mechanism?: string;
  };
  actor?: string;
  entrypoint?: string;
  prerequisites?: string[];
  reachability?: string;
  controllability?: string;
  reproduction?: {
    status?: "not-run" | "attempted" | "reproduced";
    commands?: string[];
    output_summary?: string;
    artifact_paths?: string[];
  };
};

export type ArtifactMeta = {
  id: string;
  label: string;
  relativePath: string;
  kind: "markdown" | "json" | "log" | "text";
  group: string;
  round?: number;
  updatedAt?: string;
};

export type AgentOutput = {
  id: string;
  label: string;
  findingCount: number;
  findingCountReliable: boolean;
  findings: Finding[];
  artifacts: ArtifactMeta[];
};

export type RoundSummary = {
  round: number;
  summary: {
    totalFindings: number;
    newFindings: number;
    updatedExistingFindings: number;
    rejectedCandidates: number;
    actionCounts: Record<string, number>;
    rejectionReasonCounts: Record<string, number>;
  };
  artifacts: ArtifactMeta[];
  agentOutputs: AgentOutput[];
  summaryMarkdown?: string;
  mergeView?: {
    findings: Array<Record<string, unknown>>;
    rejectedCandidates: Array<Record<string, unknown>>;
  };
};

export type RunSummary = {
  id: string;
  title: string;
  subtitle: string;
  projectId: string;
  engagementId: string;
  scanProfile: ScanProfile;
  repository: string | null;
  commit: string | null;
  workflowStatus: WorkflowRunSnapshot["status"];
  targetPath: string | null;
  relativePath: string;
  updatedAt: string;
  totalFindings: number;
  rounds: number[];
  converged: boolean;
  latestDelta: number;
  noNewStreak: number;
  scopeFileCount: number;
  severityCounts: CountMap<Severity>;
  confidenceCounts: CountMap<Confidence>;
  sourceAgentCounts: CountMap;
  dominantSeverity: Severity;
};

export type RunDetail = RunSummary & {
  findings: Finding[];
  workflow: WorkflowDefinition;
  workflowRun: WorkflowRunSnapshot;
  sourceFiles: SourceFileItem[];
  scope: ScopeSnapshot;
  hotspots: Array<{ file: string; count: number }>;
  roundsDetail: RoundSummary[];
  artifacts: ArtifactMeta[];
  globalSummaryAvailable: boolean;
  codeMapAvailable: boolean;
  lastCompletedRound: number;
  activeRound: number | null;
  liveTailArtifacts: ArtifactMeta[];
  focus: FocusState;
};

export type FocusSuggestionStatus =
  | "suggested"
  | "queued"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "dismissed";

export type FocusSuggestion = {
  id: string;
  key: string;
  source: "automatic" | "manual";
  status: FocusSuggestionStatus;
  createdAt: string;
  updatedAt: string;
  createdAfterRound: number;
  scheduledRound: number | null;
  completedRound: number | null;
  findingIds: string[];
  title: string;
  objective: string;
  rationale: string;
  targetPaths: string[];
  evidenceGaps: string[];
  priority: "critical" | "high" | "medium" | "normal";
  score: number;
  requestedBy: string | null;
  queuedBy?: "policy-auto" | "reviewer" | null;
  dismissedBy?: "planner" | "reviewer" | null;
  dismissedReason?: string | null;
  taskPath: string | null;
  outputPath: string | null;
  agent: string | null;
};

export type FocusState = {
  schemaVersion: 1;
  policy: FocusPolicy;
  maxWorkers: number;
  maxFocusRounds: number;
  updatedAt: string;
  lastEvaluatedRound: number;
  suggestions: FocusSuggestion[];
  executions: Array<{
    round: number;
    status: "running" | "completed" | "failed" | "interrupted";
    startedAt: string;
    finishedAt: string | null;
    suggestionIds: string[];
    taskPaths: string[];
  }>;
  counts: Record<FocusSuggestionStatus, number>;
  focusRoundsUsed: number;
  budgetExhausted: boolean;
};

export type FindingDecision = {
  status: TriageStatus;
  evidenceSufficient: boolean;
  reproducible: boolean;
  impactScope: string;
  recommendedFix: string;
  notes: string;
  assignee: string;
  dueDate: string;
  fixReference: string;
  duplicateOf: string;
  riskAcceptance: string;
  retestStatus: "not-requested" | "ready" | "queued" | "passed" | "failed";
  retestRunId: string;
  comments: Array<{
    id: string;
    author: string;
    body: string;
    createdAt: string;
  }>;
  updatedAt?: string;
};

export type StudioPreferences = {
  lastSelectedFindingId?: string;
  lastSelectedArtifactPath?: string;
  severityFilters?: Severity[];
  confidenceFilters?: Confidence[];
  statusFilters?: TriageStatus[];
  agentFilter?: string;
  roundFilter?: string;
  fileFilter?: string;
  starredOnly?: boolean;
  unreviewedOnly?: boolean;
  changedOnly?: boolean;
};

export type StudioState = {
  version: 1;
  runId: string;
  updatedAt: string;
  findings: Record<string, FindingDecision>;
  preferences: StudioPreferences;
};

export type ArtifactPayload =
  | {
      relativePath: string;
      kind: "json";
      data: unknown;
      updatedAt?: string;
      absolutePath?: string;
    }
  | {
      relativePath: string;
      kind: "text";
      data: string;
      updatedAt?: string;
      absolutePath?: string;
      mode?: "full" | "tail";
      tailLines?: number;
      truncated?: boolean;
      lineCount?: number;
    };

export type SourceLine = {
  number: number;
  text: string;
  highlight: boolean;
};

export type SourcePayload = {
  runId: string;
  location: string;
  relativeFilePath: string;
  absolutePath: string;
  line: number | null;
  column: number | null;
  startLine: number;
  endLine: number;
  totalLines: number;
  lines: SourceLine[];
};

export type JobDefaults = {
  executionMode: ExecutionMode;
  workerPool: string;
  workerRetries: number;
  workflowId: string;
  focusPolicy: FocusPolicy;
  focusWorkers: number;
  maxFocusRounds: number;
  scanProfile: ScanProfile;
  agent: JobAgent;
  model: string;
  mergeAgent: JobAgent;
  mergeModel: string;
  summaryAgent: JobAgent;
  summaryModel: string;
  workers: number;
  maxRounds: number;
  convergeAfter: number;
  reasoningEffort: ReasoningEffort;
  mergeMode: MergeMode;
  languageProfile: LanguageProfile;
  include: string[];
  exclude: string[];
  extensions: string[];
  uploadSizeMb: number;
  taskTimeoutMinutes: number;
};

export type JobSource =
  | {
      type: "github";
      repoUrl: string;
      ref: string | null;
    }
  | {
      type: "upload";
      originalName: string;
      storedName: string;
      sizeBytes: number;
    }
  | {
      type: "local";
      path: string;
    };

export type JobStatus = "queued" | "preparing" | "running" | "paused" | "rate_limited" | "review_ready" | "succeeded" | "failed" | "cancelled";

export type JobRecord = {
  id: string;
  name: string;
  projectId: string;
  engagementId: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  source: JobSource;
  settings: JobDefaults;
  workspacePath: string | null;
  outputDir: string;
  runId: string | null;
  exitCode: number | null;
  error: string | null;
  logPath: string;
  cancelRequested: boolean;
  resumeRequested: boolean;
  resumeFromStage: ResumeStage | null;
  resumeRound: number | null;
  assignedWorkerId: string | null;
  leaseId: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
};

export type JobDetail = JobRecord & {
  logTail: string;
};

export type DeliveryResult = {
  runId: string;
  blockers: Array<{
    findingId: string;
    message: string;
  }>;
  report: {
    schemaVersion: number;
    generatedAt: string;
    runId: string;
    reportPath: string;
    reportSha256: string;
    findingCount: number;
    reviewerGateComplete: boolean;
  };
  regression: {
    path: string;
    records: Array<{
      findingId: string;
      fingerprint: string;
      classification: "new" | "persistent" | "fixed";
      reviewStatus: TriageStatus;
      retestStatus: FindingDecision["retestStatus"];
      fixReference: string;
    }>;
  };
  job: JobRecord | null;
};

export type GithubJobRequest = {
  sourceType: "github";
  repoUrl: string;
  ref?: string | null;
  name?: string;
  projectId?: string;
  engagementId?: string;
  settings?: Partial<JobDefaults>;
};

export type ServerConfig = {
  version: 1;
  updatedAt: string;
  defaults: JobDefaults;
};

export type SystemConfigPayload = {
  config: ServerConfig;
  auth: {
    enabled: boolean;
    mode: "none" | "basic";
    username: string | null;
  };
  providers: {
    openai: boolean;
    anthropic: boolean;
    deepseek: boolean;
    google: boolean;
  };
  providerHealth: {
    deepseek: {
      status: "unconfigured" | "ready" | "insufficient_balance" | "invalid_key" | "unreachable";
      available: boolean;
      checkedAt: string | null;
      message: string;
    };
  };
  agents: {
    codex: boolean;
    claude: boolean;
    opencode: boolean;
    pi: boolean;
  };
  paths: {
    outputRoot: string;
    stateRoot: string;
  };
};

export type WorkerStatus = "online" | "busy" | "offline";

export type WorkerRecord = {
  id: string;
  name: string;
  pool: string;
  status: WorkerStatus;
  registeredAt: string;
  lastHeartbeat: string;
  maxConcurrency: number;
  activeJobIds: string[];
  capabilities: string[];
  labels: Record<string, string>;
  hostname: string;
  platform: string;
  version: string;
};

export type WorkerControlPayload = {
  workers: WorkerRecord[];
  control: {
    tokenConfigured: boolean;
    heartbeatSeconds: number;
    offlineAfterSeconds: number;
    leaseSeconds: number;
  };
};

export type BenchmarkPayload = BenchmarkOverview;
