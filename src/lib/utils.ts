import type { Dispatch, SetStateAction } from "react";
import type {
  Confidence,
  Severity,
  TriageStatus,
  ExportFormat,
  Finding,
  FindingDecision,
  RunDetail,
  ArtifactMeta,
  StudioState,
  StudioPreferences,
} from "../types";

export type StarMap = Record<string, boolean>;
export type DiffFinding = RunDetail["findings"][number];
export type RunDiff = {
  sharedCount: number;
  currentOnly: DiffFinding[];
  compareOnly: DiffFinding[];
  changed: Array<{
    current: DiffFinding;
    compare: DiffFinding;
    changes: string[];
  }>;
};

export interface EvidenceProfile {
  score: number;
  signals: Array<{ label: string; value: string; ok: boolean }>;
}

// Option Constants
export const severityFilterOptions: Severity[] = ["Critical", "High", "Medium", "Low"];
export const confidenceFilterOptions: Confidence[] = ["high", "medium", "low", "unknown"];
export const triageStatusOptions: TriageStatus[] = [
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
export const reviewedStatuses = new Set<TriageStatus>([
  "Confirmed",
  "False Positive",
  "Duplicate",
  "Accepted Risk",
  "Fixed",
  "Retest Passed",
]);

export const exportFormats: Array<{ format: ExportFormat; label: string }> = [
  { format: "markdown", label: "Markdown" },
  { format: "csv", label: "CSV" },
  { format: "json", label: "JSON" },
  { format: "github", label: "GitHub" },
];

export function normalize(value: string) {
  return value.toLowerCase();
}

export function buildArtifactCacheKey(relativePath: string | null, tailLines: number | null) {
  if (!relativePath) {
    return null;
  }
  return `${relativePath}::${tailLines ?? "full"}`;
}

export function normalizeSeverityLabel(value?: string): Severity {
  const lowered = (value ?? "").toLowerCase();
  if (lowered === "critical") {
    return "Critical";
  }
  if (lowered === "high") {
    return "High";
  }
  if (lowered === "medium") {
    return "Medium";
  }
  if (lowered === "low") {
    return "Low";
  }
  return "Unknown";
}

export function normalizeConfidenceLabel(value?: string): Confidence {
  const lowered = (value ?? "").toLowerCase();
  if (lowered === "high" || lowered === "medium" || lowered === "low") {
    return lowered;
  }
  return "unknown";
}

export function createDefaultDecision(): FindingDecision {
  return {
    status: "New",
    evidenceSufficient: false,
    reproducible: false,
    impactScope: "",
    recommendedFix: "",
    notes: "",
    assignee: "",
    dueDate: "",
    fixReference: "",
    duplicateOf: "",
    riskAcceptance: "",
    retestStatus: "not-requested",
    retestRunId: "",
    comments: [],
  };
}

export function getFindingDecision(state: StudioState | null, findingId: string): FindingDecision {
  return state?.findings[findingId] ?? createDefaultDecision();
}

export function createDefaultStudioState(runId: string): StudioState {
  return {
    version: 1,
    runId,
    updatedAt: new Date().toISOString(),
    findings: {},
    preferences: {},
  };
}

export function updateFindingDecisionState(
  setState: Dispatch<SetStateAction<StudioState | null>>,
  runId: string,
  findingId: string,
  patch: Partial<FindingDecision>,
) {
  setState((current) => {
    const base = current ?? createDefaultStudioState(runId);
    const nextDecision = {
      ...getFindingDecision(base, findingId),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...base,
      findings: {
        ...base.findings,
        [findingId]: nextDecision,
      },
      updatedAt: new Date().toISOString(),
    };
  });
}

export function applyPreferences(
  preferences: StudioPreferences,
  setters: {
    setActiveArtifactPath: (value: string | null) => void;
    setAgentFilter: (value: string) => void;
    setChangedOnly: (value: boolean) => void;
    setConfidenceFilters: (value: Confidence[]) => void;
    setFileFilter: (value: string) => void;
    setRoundFilter: (value: string) => void;
    setSelectedFindingId: (value: string | null) => void;
    setSeverityFilters: (value: Severity[]) => void;
    setStarredOnly: (value: boolean) => void;
    setStatusFilters: (value: TriageStatus[]) => void;
    setUnreviewedOnly: (value: boolean) => void;
  },
) {
  if (preferences.lastSelectedFindingId) {
    setters.setSelectedFindingId(preferences.lastSelectedFindingId);
  }
  if (preferences.lastSelectedArtifactPath) {
    setters.setActiveArtifactPath(preferences.lastSelectedArtifactPath);
  }
  if (preferences.severityFilters?.length) {
    setters.setSeverityFilters(preferences.severityFilters);
  }
  if (preferences.confidenceFilters?.length) {
    setters.setConfidenceFilters(preferences.confidenceFilters);
  }
  setters.setStatusFilters(preferences.statusFilters ?? []);
  setters.setAgentFilter(preferences.agentFilter ?? "all");
  setters.setRoundFilter(preferences.roundFilter ?? "all");
  setters.setFileFilter(preferences.fileFilter ?? "all");
  setters.setStarredOnly(preferences.starredOnly === true);
  setters.setUnreviewedOnly(preferences.unreviewedOnly === true);
  setters.setChangedOnly(preferences.changedOnly === true);
}

export function sourceFileFromLocation(location: string) {
  return location.split(":")[0]?.trim() ?? "";
}

export function buildTriageSummary(findings: Finding[], state: StudioState | null) {
  const byStatus = Object.fromEntries(triageStatusOptions.map((status) => [status, 0])) as Record<TriageStatus, number>;
  for (const finding of findings) {
    byStatus[getFindingDecision(state, finding.id).status] += 1;
  }
  return {
    total: findings.length,
    byStatus,
    confirmed: byStatus.Confirmed,
    falsePositive: byStatus["False Positive"],
    fixed: byStatus.Fixed,
    acceptedRisk: byStatus["Accepted Risk"],
    retestPassed: byStatus["Retest Passed"],
    needsEvidence: byStatus["Needs Evidence"],
    unreviewed:
      findings.length -
      byStatus.Confirmed -
      byStatus["False Positive"] -
      byStatus.Duplicate -
      byStatus["Accepted Risk"] -
      byStatus.Fixed -
      byStatus["Retest Passed"],
  };
}

export function buildEvidenceProfile(finding: Finding, run: RunDetail): EvidenceProfile {
  const hasSource = finding.locations.length > 0;
  const hasPath = finding.paths.length > 0;
  const multiAgent = finding.source_agents.length > 1;
  const highConfidence = normalizeConfidenceLabel(finding.confidence) === "high";
  const roundSeen = typeof finding.round === "number" ? 1 : 0;
  const hotspotHit = finding.locations.some((location) => run.hotspots.some((hotspot) => hotspot.file === sourceFileFromLocation(location)));
  const score = Math.min(
    100,
    (hasSource ? 24 : 0) +
      (hasPath ? 22 : 0) +
      (multiAgent ? 18 : 0) +
      (highConfidence ? 18 : 0) +
      (hotspotHit ? 10 : 0) +
      (roundSeen ? 8 : 0),
  );

  return {
    score,
    signals: [
      { label: "Source", value: String(finding.locations.length), ok: hasSource },
      { label: "Exploit paths", value: String(finding.paths.length), ok: hasPath },
      { label: "Agents", value: String(finding.source_agents.length), ok: multiAgent },
      { label: "Confidence", value: finding.confidence ?? "unknown", ok: highConfidence },
      { label: "Hotspot", value: hotspotHit ? "yes" : "no", ok: hotspotHit },
      { label: "Round", value: finding.round ? `R${finding.round}` : "-", ok: roundSeen > 0 },
    ],
  };
}

export function groupRank(label: string) {
  if (label === "Run") {
    return 0;
  }
  const match = /^Round (\d+)$/.exec(label);
  if (match) {
    return 10 + Number.parseInt(match[1], 10);
  }
  return 100;
}

export function groupArtifacts(artifacts: ArtifactMeta[]) {
  const groups = new Map<string, ArtifactMeta[]>();
  for (const artifact of artifacts) {
    const key = artifact.group === "Round" && artifact.round ? `${artifact.group} ${artifact.round}` : artifact.group;
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
  }

  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      items: items.sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => groupRank(left.label) - groupRank(right.label) || left.label.localeCompare(right.label));
}

export function severityRank(value?: string) {
  const label = normalizeSeverityLabel(value);
  if (label === "Critical") {
    return 0;
  }
  if (label === "High") {
    return 1;
  }
  if (label === "Medium") {
    return 2;
  }
  if (label === "Low") {
    return 3;
  }
  return 4;
}

export function compareFindings(left: DiffFinding, right: DiffFinding) {
  const severityDelta = severityRank(left.severity) - severityRank(right.severity);
  if (severityDelta !== 0) {
    return severityDelta;
  }
  return (left.title ?? left.id).localeCompare(right.title ?? right.id);
}

export function findingSignature(finding: DiffFinding) {
  const primaryFile = (finding.locations[0] ?? "").replace(/:\d+(?::\d+)?$/, "");
  return normalize([finding.title ?? finding.id, primaryFile].join("::"));
}

export function buildRunDiff(currentRun: RunDetail | null, compareRun: RunDetail | null): RunDiff | null {
  if (!currentRun || !compareRun) {
    return null;
  }

  const currentMap = new Map(currentRun.findings.map((finding) => [findingSignature(finding), finding] as const));
  const compareMap = new Map(compareRun.findings.map((finding) => [findingSignature(finding), finding] as const));

  const currentOnly = [...currentMap.entries()]
    .filter(([key]) => !compareMap.has(key))
    .map(([, finding]) => finding)
    .sort(compareFindings);
  const compareOnly = [...compareMap.entries()]
    .filter(([key]) => !currentMap.has(key))
    .map(([, finding]) => finding)
    .sort(compareFindings);
  const changed = [...currentMap.entries()]
    .map(([key, current]) => {
      const compare = compareMap.get(key);
      if (!compare) {
        return null;
      }
      const changes = [];
      if (normalizeSeverityLabel(current.severity) !== normalizeSeverityLabel(compare.severity)) {
        changes.push(`${compare.severity ?? "Unknown"} -> ${current.severity ?? "Unknown"}`);
      }
      if (normalizeConfidenceLabel(current.confidence) !== normalizeConfidenceLabel(compare.confidence)) {
        changes.push(`${compare.confidence ?? "unknown"} -> ${current.confidence ?? "unknown"}`);
      }
      if (changes.length === 0) {
        return null;
      }
      return { current, compare, changes };
    })
    .filter((item): item is RunDiff["changed"][number] => item !== null)
    .sort((left, right) => compareFindings(left.current, right.current));
  const sharedCount = [...currentMap.keys()].filter((key) => compareMap.has(key)).length;

  return {
    sharedCount,
    currentOnly,
    compareOnly,
    changed,
  };
}

export function escapeCsvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function serializeFinding(finding: Finding, state: StudioState | null) {
  const decision = getFindingDecision(state, finding.id);
  return {
    ...finding,
    decision,
  };
}

export function buildMarkdownFinding(finding: Finding, decision: FindingDecision) {
  return [
    `## ${finding.id}: ${finding.title ?? "Untitled finding"}`,
    "",
    `- Status: ${decision.status}`,
    `- Severity: ${finding.severity ?? "Unknown"}`,
    `- Confidence: ${finding.confidence ?? "unknown"}`,
    `- Locations: ${finding.locations.join(", ") || "-"}`,
    `- Source agents: ${finding.source_agents.join(", ") || "-"}`,
    "",
    "### Claim",
    finding.claim ?? "-",
    "",
    "### Impact",
    finding.impact ?? "-",
    "",
    "### Exploit Paths",
    finding.paths.length ? finding.paths.map((item) => `- ${item}`).join("\n") : "-",
    "",
    "### Reviewer Decision",
    `Evidence sufficient: ${decision.evidenceSufficient ? "yes" : "no"}`,
    `Reproducible: ${decision.reproducible ? "yes" : "no"}`,
    `Impact scope: ${decision.impactScope || "-"}`,
    `Assignee: ${decision.assignee || "-"}`,
    `Due date: ${decision.dueDate || "-"}`,
    `Fix reference: ${decision.fixReference || "-"}`,
    `Risk acceptance: ${decision.riskAcceptance || "-"}`,
    `Retest status: ${decision.retestStatus}`,
    `Retest run: ${decision.retestRunId || "-"}`,
    "",
    "### Recommended Fix",
    decision.recommendedFix || "-",
    "",
    "### Notes",
    decision.notes || "-",
    "",
  ];
}

export function buildGithubIssue(run: RunDetail, finding: Finding, decision: FindingDecision) {
  return [
    `# ${finding.title ?? finding.id}`,
    "",
    `Run: ${run.id}`,
    `Status: ${decision.status}`,
    `Severity: ${finding.severity ?? "Unknown"}`,
    `Confidence: ${finding.confidence ?? "unknown"}`,
    "",
    "## Evidence",
    finding.locations.length ? finding.locations.map((location) => `- ${location}`).join("\n") : "-",
    "",
    "## Impact",
    finding.impact ?? "-",
    "",
    "## Fix",
    decision.recommendedFix || "-",
    "",
    "## Reviewer Notes",
    decision.notes || "-",
  ].join("\n");
}

export function buildExportPayload(run: RunDetail, findings: Finding[], state: StudioState | null, format: ExportFormat) {
  const baseName = `${run.id}_findings_${format}`;
  if (format === "json") {
    return {
      fileName: `${baseName}.json`,
      mimeType: "application/json",
      content: JSON.stringify(
        {
          run: {
            id: run.id,
            title: run.title,
            targetPath: run.targetPath,
            updatedAt: run.updatedAt,
          },
          findings: findings.map((finding) => serializeFinding(finding, state)),
        },
        null,
        2,
      ),
    };
  }

  if (format === "csv") {
    const header = ["id", "status", "severity", "confidence", "title", "locations", "agents", "assignee", "due_date", "fix_reference", "retest_status", "impact_scope", "recommended_fix", "notes"];
    const rows = findings.map((finding) => {
      const decision = getFindingDecision(state, finding.id);
      return [
        finding.id,
        decision.status,
        finding.severity ?? "",
        finding.confidence ?? "",
        finding.title ?? "",
        finding.locations.join("; "),
        finding.source_agents.join("; "),
        decision.assignee,
        decision.dueDate,
        decision.fixReference,
        decision.retestStatus,
        decision.impactScope,
        decision.recommendedFix,
        decision.notes,
      ];
    });
    return {
      fileName: `${baseName}.csv`,
      mimeType: "text/csv",
      content: [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n"),
    };
  }

  if (format === "github") {
    return {
      fileName: `${baseName}.md`,
      mimeType: "text/markdown",
      content: findings.map((finding) => buildGithubIssue(run, finding, getFindingDecision(state, finding.id))).join("\n\n---\n\n"),
    };
  }

  return {
    fileName: `${baseName}.md`,
    mimeType: "text/markdown",
    content: [
      `# ${run.title} Findings`,
      "",
      `Target: ${run.targetPath ?? run.id}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      ...findings.flatMap((finding) => buildMarkdownFinding(finding, getFindingDecision(state, finding.id))),
    ].join("\n"),
  };
}

export function downloadTextFile(fileName: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function pickDefaultArtifact(run: RunDetail) {
  return (
    run.artifacts.find((artifact) => artifact.relativePath.endsWith("/global_summary.md")) ??
    run.artifacts.find((artifact) => artifact.relativePath.endsWith("/round_summary.md")) ??
    run.artifacts.find((artifact) => artifact.relativePath.endsWith("/code_map.md")) ??
    run.artifacts[0] ??
    null
  );
}

export function starKey(runId: string, findingId: string) {
  return `${runId}:${findingId}`;
}

export function toggleStar(setState: Dispatch<SetStateAction<StarMap>>, runId: string, findingId: string) {
  setState((current) => {
    const key = starKey(runId, findingId);
    const next = { ...current };
    if (next[key]) {
      delete next[key];
    } else {
      next[key] = true;
    }
    return next;
  });
}

export async function copyText(value: string, onCopySuccess: (type: "resume" | "artifact") => void) {
  try {
    await navigator.clipboard.writeText(value);
    onCopySuccess(value.includes("audithound.py run") ? "resume" : "artifact");
  } catch (err) {
    console.error("Failed to copy text:", err);
  }
}
