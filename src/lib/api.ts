import type {
  ArtifactPayload,
  BenchmarkPayload,
  DeliveryResult,
  FocusPolicy,
  FocusState,
  GithubJobRequest,
  JobDetail,
  JobRecord,
  ResumeStage,
  RunDetail,
  RunSummary,
  SourcePayload,
  StudioState,
  SystemConfigPayload,
  WorkflowCatalogItem,
  WorkflowDefinition,
  WorkflowValidationResult,
  WorkflowVersionSummary,
  WorkerControlPayload,
} from "../types";

function request(url: string, init?: RequestInit) {
  if (typeof window === "undefined") {
    return globalThis.fetch(url, init);
  }
  const requestUrl = new URL(url, window.location.href);
  requestUrl.username = "";
  requestUrl.password = "";
  return globalThis.fetch(requestUrl, init);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await request(url);
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchRuns(options?: { fresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.fresh) {
    params.set("fresh", "1");
  }
  const query = params.toString();
  const payload = await getJson<{ runs: RunSummary[] }>(`/api/runs${query ? `?${query}` : ""}`);
  return payload.runs;
}

export async function fetchRun(runId: string, options?: { fresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.fresh) {
    params.set("fresh", "1");
  }
  const query = params.toString();
  const payload = await getJson<{ run: RunDetail }>(`/api/runs/${encodeURIComponent(runId)}${query ? `?${query}` : ""}`);
  return payload.run;
}

export async function resumeRunFromStage(runId: string, stage: ResumeStage, round?: number) {
  const response = await request(`/api/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ stage, round }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { mode: "queued"; job: JobRecord }
    | { mode: "review"; runId: string; job: JobRecord | null }
    | { mode: "completed"; delivery: DeliveryResult }
    | { error?: string; blockers?: Array<{ findingId: string; message: string }> }
    | null;
  if (!response.ok) {
    const blockers = payload && "blockers" in payload && Array.isArray(payload.blockers) ? payload.blockers : [];
    const detail = blockers.slice(0, 3).map((blocker) => `${blocker.findingId}: ${blocker.message}`).join(" · ");
    const message = payload && "error" in payload && payload.error ? payload.error : `Request failed: ${response.status}`;
    throw new Error(detail ? `${message} ${detail}` : message);
  }
  return payload as
    | { mode: "queued"; job: JobRecord }
    | { mode: "review"; runId: string; job: JobRecord | null }
    | { mode: "completed"; delivery: DeliveryResult };
}

export async function evaluateFocus(runId: string, round?: number) {
  return mutateFocus(runId, "evaluate", typeof round === "number" ? { round } : {});
}

export async function configureFocus(
  runId: string,
  config: { policy?: FocusPolicy; maxWorkers?: number; maxFocusRounds?: number },
) {
  const response = await request(`/api/runs/${encodeURIComponent(runId)}/focus/config`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  });
  return readFocusResponse(response);
}

export async function requestFocus(
  runId: string,
  focusRequest: {
    title?: string;
    objective: string;
    rationale?: string;
    findingId?: string;
    targetPaths?: string[];
    priority?: "critical" | "high" | "medium" | "normal";
    requestedBy?: string;
    afterRound?: number;
  },
) {
  const response = await request(`/api/runs/${encodeURIComponent(runId)}/focus/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(focusRequest),
  });
  return readFocusResponse(response);
}

export async function queueFocusSuggestion(runId: string, suggestionId: string) {
  return mutateFocusSuggestion(runId, suggestionId, "queue");
}

export async function unqueueFocusSuggestion(runId: string, suggestionId: string) {
  return mutateFocusSuggestion(runId, suggestionId, "unqueue");
}

export async function dismissFocusSuggestion(runId: string, suggestionId: string) {
  return mutateFocusSuggestion(runId, suggestionId, "dismiss");
}

export async function continueWithFocus(runId: string, additionalRounds = 2) {
  const response = await request(`/api/runs/${encodeURIComponent(runId)}/focus/continue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ additionalRounds }),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(parseApiError(fallback) || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { job: JobRecord };
  return payload.job;
}

async function mutateFocus(runId: string, action: "evaluate", body: Record<string, unknown>) {
  const response = await request(`/api/runs/${encodeURIComponent(runId)}/focus/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return readFocusResponse(response);
}

async function mutateFocusSuggestion(runId: string, suggestionId: string, action: "queue" | "unqueue" | "dismiss") {
  const response = await request(
    `/api/runs/${encodeURIComponent(runId)}/focus/suggestions/${encodeURIComponent(suggestionId)}/${action}`,
    { method: "POST" },
  );
  return readFocusResponse(response);
}

async function readFocusResponse(response: Response) {
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(parseApiError(fallback) || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { focus: FocusState };
  return payload.focus;
}

function parseApiError(raw: string) {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error : raw;
  } catch {
    return raw;
  }
}

export async function fetchArtifact(relativePath: string, options?: { tailLines?: number; fresh?: boolean }) {
  const params = new URLSearchParams();
  params.set("path", relativePath);
  if (typeof options?.tailLines === "number" && options.tailLines > 0) {
    params.set("tailLines", String(options.tailLines));
  }
  if (options?.fresh) {
    params.set("fresh", "1");
  }
  const payload = await getJson<ArtifactPayload>(`/api/artifact?${params.toString()}`);
  return payload;
}

export async function fetchSource(runId: string, location: string, options?: { context?: number }) {
  const params = new URLSearchParams({
    runId,
    location,
  });
  if (typeof options?.context === "number" && options.context > 0) {
    params.set("context", String(options.context));
  }
  const payload = await getJson<SourcePayload>(`/api/source?${params.toString()}`);
  return payload;
}

export async function fetchStudioState(runId: string) {
  const params = new URLSearchParams({ runId });
  const payload = await getJson<{ state: StudioState }>(`/api/studio-state?${params.toString()}`);
  return payload.state;
}

export async function saveStudioState(state: StudioState) {
  const response = await request("/api/studio-state", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { state: StudioState };
  return payload.state;
}

export async function fetchJobs(options?: { fresh?: boolean }) {
  const params = new URLSearchParams();
  if (options?.fresh) {
    params.set("fresh", "1");
  }
  const payload = await getJson<{ jobs: JobRecord[] }>(`/api/jobs${params.toString() ? `?${params.toString()}` : ""}`);
  return payload.jobs;
}

export async function fetchWorkers() {
  return getJson<WorkerControlPayload>("/api/workers");
}

export async function forgetWorker(workerId: string) {
  const response = await request(`/api/workers/${encodeURIComponent(workerId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(parseApiError(fallback) || `Request failed: ${response.status}`);
  }
  return (await response.json()) as { deleted: boolean };
}

export async function fetchJob(jobId: string, options?: { fresh?: boolean; tailLines?: number }) {
  const params = new URLSearchParams();
  if (options?.fresh) {
    params.set("fresh", "1");
  }
  if (typeof options?.tailLines === "number" && options.tailLines > 0) {
    params.set("tailLines", String(options.tailLines));
  }
  const payload = await getJson<{ job: JobDetail }>(`/api/jobs/${encodeURIComponent(jobId)}${params.toString() ? `?${params.toString()}` : ""}`);
  return payload.job;
}

export async function createGithubJob(payload: GithubJobRequest) {
  const response = await request("/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const parsed = (await response.json()) as { job: JobRecord };
  return parsed.job;
}

export async function createUploadJob(formData: FormData) {
  const response = await request("/api/jobs", {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const parsed = (await response.json()) as { job: JobRecord };
  return parsed.job;
}

export async function cancelJob(jobId: string) {
  const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const parsed = (await response.json()) as { job: JobRecord };
  return parsed.job;
}

export async function pauseJob(jobId: string) {
  return mutateJob(jobId, "pause");
}

export async function resumeJob(jobId: string) {
  return mutateJob(jobId, "resume");
}

async function mutateJob(jobId: string, action: "pause" | "resume") {
  const response = await request(`/api/jobs/${encodeURIComponent(jobId)}/${action}`, {
    method: "POST",
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const parsed = (await response.json()) as { job: JobRecord };
  return parsed.job;
}

export async function fetchSystemConfig() {
  return getJson<SystemConfigPayload>("/api/system-config");
}

export async function saveSystemConfig(config: SystemConfigPayload["config"]) {
  const response = await request("/api/system-config", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ config }),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<SystemConfigPayload>;
}

export async function fetchWorkflows() {
  const payload = await getJson<{ workflows: WorkflowCatalogItem[] }>("/api/workflows");
  return payload.workflows;
}

export async function fetchWorkflow(workflowId: string) {
  const payload = await getJson<{ workflow: WorkflowDefinition }>(`/api/workflows/${encodeURIComponent(workflowId)}`);
  return payload.workflow;
}

export async function saveWorkflow(workflow: WorkflowDefinition) {
  const response = await request(`/api/workflows/${encodeURIComponent(workflow.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(workflow),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { workflow: WorkflowDefinition };
  return payload.workflow;
}

export async function cloneWorkflow(workflowId: string) {
  const response = await request(`/api/workflows/${encodeURIComponent(workflowId)}/clone`, {
    method: "POST",
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { workflow: WorkflowDefinition };
  return payload.workflow;
}

export async function deleteWorkflow(workflowId: string) {
  const response = await request(`/api/workflows/${encodeURIComponent(workflowId)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
}

export async function fetchWorkflowVersions(workflowId: string) {
  const payload = await getJson<{ versions: WorkflowVersionSummary[] }>(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions`,
  );
  return payload.versions;
}

export async function restoreWorkflowVersion(workflowId: string, version: number) {
  const response = await request(
    `/api/workflows/${encodeURIComponent(workflowId)}/versions/${version}/restore`,
    { method: "POST" },
  );
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { workflow: WorkflowDefinition };
  return payload.workflow;
}

export async function validateWorkflow(workflow: WorkflowDefinition) {
  const response = await request("/api/workflows/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(workflow),
  });
  if (!response.ok) {
    const fallback = await response.text();
    throw new Error(fallback || `Request failed: ${response.status}`);
  }
  const payload = (await response.json()) as { validation: WorkflowValidationResult };
  return payload.validation;
}

export async function fetchBenchmarks() {
  const payload = await getJson<{ benchmark: BenchmarkPayload }>("/api/benchmarks");
  return payload.benchmark;
}

export async function finalizeDelivery(runId: string) {
  const response = await request("/api/delivery/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ runId }),
  });
  const payload = (await response.json().catch(() => null)) as
    | DeliveryResult
    | {
        error?: string;
        blockers?: Array<{ findingId: string; message: string }>;
      }
    | null;
  if (!response.ok) {
    const blockers = payload && "blockers" in payload && Array.isArray(payload.blockers) ? payload.blockers : [];
    const detail = blockers
      .slice(0, 3)
      .map((blocker) => `${blocker.findingId}: ${blocker.message}`)
      .join(" · ");
    const remaining = blockers.length > 3 ? ` · +${blockers.length - 3} more` : "";
    const message = payload && "error" in payload && payload.error ? payload.error : `Request failed: ${response.status}`;
    throw new Error(`${message}${detail ? ` ${detail}${remaining}` : ""}`);
  }
  return payload as DeliveryResult;
}
