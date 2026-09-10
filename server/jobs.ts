import { promises as fs } from "node:fs";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";

import { loadServerConfig, normalizeJobDefaults, type JobDefaults } from "./config";
import {
  AUDIT_ROOT,
  DEFAULT_JOB_LOG_TAIL,
  JOBS_ROOT,
  OUTPUT_ROOT,
  SOURCES_ROOT,
  UPLOADS_ROOT,
  WORKER_RESULTS_ROOT,
} from "./platform";

const execFileAsync = promisify(execFile);
const WORKER_LEASE_MS = 45_000;

export type JobStatus = "queued" | "preparing" | "running" | "paused" | "rate_limited" | "review_ready" | "succeeded" | "failed" | "cancelled";
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

type GithubJobInput = {
  sourceType: "github";
  repoUrl: string;
  ref?: string | null;
  name?: string;
  projectId?: string;
  engagementId?: string;
  settings?: unknown;
};

type RuntimeState = {
  activeJobId: string | null;
  activeChild: ChildProcessWithoutNullStreams | null;
  activeTimedOut: boolean;
};

export class JobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly runtime: RuntimeState = {
    activeJobId: null,
    activeChild: null,
    activeTimedOut: false,
  };
  private initPromise: Promise<void> | null = null;
  private queuePromise: Promise<void> | null = null;
  private leasePromise: Promise<void> | null = null;

  async listJobs() {
    await this.init();
    await this.recoverExpiredWorkerLeases();
    return [...this.jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getJob(id: string, tailLines = DEFAULT_JOB_LOG_TAIL): Promise<JobDetail | null> {
    await this.init();
    await this.recoverExpiredWorkerLeases();
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }
    return {
      ...job,
      logTail: await readTail(job.logPath, tailLines),
    };
  }

  async markDelivered(runId: string) {
    await this.init();
    const job = [...this.jobs.values()].find((candidate) => candidate.runId === runId || candidate.id === runId);
    if (!job) {
      return null;
    }
    const updated = await this.updateJob(job.id, {
      status: "succeeded",
      stage: "delivery-completed",
      finishedAt: new Date().toISOString(),
    });
    await this.appendLog(job.id, "Reviewer gate completed and formal delivery package generated.");
    return updated;
  }

  async markReviewReady(runId: string) {
    await this.init();
    const job = [...this.jobs.values()].find((candidate) => candidate.runId === runId || candidate.id === runId);
    if (!job) {
      return null;
    }
    const updated = await this.updateJob(job.id, {
      status: "review_ready",
      stage: "awaiting-review",
      finishedAt: new Date().toISOString(),
      error: null,
      exitCode: 0,
      cancelRequested: false,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
    });
    await this.appendLog(job.id, "Reopened the preserved canonical findings at the human review checkpoint.");
    return updated;
  }

  async findJobByRunId(runId: string) {
    await this.init();
    return [...this.jobs.values()].find((candidate) => candidate.runId === runId || candidate.id === runId) ?? null;
  }

  async continueWithFocus(runId: string, additionalRounds = 2) {
    await this.init();
    const job = await this.findJobByRunId(runId);
    if (!job) {
      return null;
    }
    if (job.status === "queued" || job.status === "preparing" || job.status === "running" || job.status === "paused") {
      return job;
    }
    if (job.status !== "review_ready" && job.status !== "failed") {
      throw new Error("Only review-ready or interrupted jobs can continue with queued focus work.");
    }
    if (!job.workspacePath) {
      throw new Error("The preserved source workspace is unavailable.");
    }
    const loopState = await readJsonFile(path.join(job.outputDir, "loop_state.json"));
    const focusState = await readJsonFile(path.join(job.outputDir, "focus_state.json"));
    if (focusState?.policy === "off") {
      throw new Error("Adaptive focus is paused by the General only policy.");
    }
    const focusSuggestions = Array.isArray(focusState?.suggestions)
      ? focusState.suggestions.filter(isRecord)
      : [];
    const resumableFocusCount = focusSuggestions.filter((suggestion) => (
      suggestion.status === "queued" ||
      suggestion.status === "scheduled" ||
      suggestion.status === "running"
    )).length;
    if (resumableFocusCount === 0) {
      throw new Error("Queue at least one focus question before continuing the run.");
    }
    const focusExecutions = Array.isArray(focusState?.executions)
      ? focusState.executions.filter(isRecord)
      : [];
    const usedFocusRounds = new Set(
      focusExecutions
        .filter((execution) => execution.status !== "interrupted" && execution.status !== "running")
        .map((execution) => typeof execution.round === "number" ? execution.round : null)
        .filter((round): round is number => round !== null),
    ).size;
    const maxFocusRounds = boundedInteger(
      focusState?.maxFocusRounds,
      0,
      12,
      job.settings.maxFocusRounds,
    );
    if (usedFocusRounds >= maxFocusRounds) {
      throw new Error("The adaptive focus round budget is exhausted.");
    }
    const lastCompletedRound = typeof loopState?.last_completed_round === "number"
      ? loopState.last_completed_round
      : 0;
    const maxRounds = Math.min(12, Math.max(job.settings.maxRounds, lastCompletedRound + Math.max(1, additionalRounds)));
    if (maxRounds <= lastCompletedRound) {
      throw new Error("The 12-round execution limit is exhausted for this run.");
    }
    const updated = await this.updateJob(job.id, {
      status: "queued",
      stage: "queued-focus-continuation",
      finishedAt: null,
      exitCode: null,
      error: null,
      cancelRequested: false,
      resumeRequested: true,
      resumeFromStage: null,
      resumeRound: null,
      assignedWorkerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      settings: {
        ...job.settings,
        maxRounds,
        focusPolicy: focusState?.policy === "off" || focusState?.policy === "auto"
          ? focusState.policy
          : "suggest",
        focusWorkers: boundedInteger(focusState?.maxWorkers, 1, 8, job.settings.focusWorkers),
        maxFocusRounds,
      },
    });
    await this.appendLog(job.id, `Queued adaptive focus continuation through round ${maxRounds}.`);
    void this.kickQueue();
    return updated;
  }

  async resumeFromStage(runId: string, stage: ResumeStage, requestedRound?: number) {
    await this.init();
    if (stage === "regression" || stage === "report") {
      throw new Error(`${stage} is regenerated synchronously after the reviewer gate.`);
    }
    let job = await this.findJobByRunId(runId);
    if (!job) {
      job = await this.adoptExistingRun(runId);
    }
    if (job.status === "queued" || job.status === "preparing" || job.status === "running" || job.status === "paused") {
      throw new Error("Stop the active execution before selecting a resume stage.");
    }
    if (!job.workspacePath) {
      throw new Error("The preserved source workspace is unavailable.");
    }
    const workspaceStat = await fs.stat(job.workspacePath).catch(() => null);
    if (!workspaceStat?.isDirectory()) {
      throw new Error("The preserved source workspace no longer exists.");
    }
    const loopState = await readJsonFile(path.join(job.outputDir, "loop_state.json"));
    const lastCompletedRound = typeof loopState?.last_completed_round === "number"
      ? loopState.last_completed_round
      : 0;
    const roundStage = stage === "investigate" || stage === "focus" || stage === "normalize" || stage === "summary";
    const resumeRound = roundStage
      ? boundedInteger(requestedRound, 1, 12, Math.max(1, lastCompletedRound))
      : null;
    const maxRounds = resumeRound === null
      ? job.settings.maxRounds
      : Math.max(job.settings.maxRounds, resumeRound);
    const updated = await this.updateJob(job.id, {
      status: "queued",
      stage: `queued-resume-${stage}`,
      finishedAt: null,
      exitCode: null,
      error: null,
      cancelRequested: false,
      resumeRequested: true,
      resumeFromStage: stage,
      resumeRound,
      assignedWorkerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      settings: {
        ...job.settings,
        maxRounds,
      },
    });
    await this.appendLog(
      job.id,
      `Queued checkpointed resume from ${stage}${resumeRound === null ? "" : ` in round ${resumeRound}`}.`,
    );
    void this.kickQueue();
    return updated;
  }

  private async adoptExistingRun(runId: string) {
    if (!runId || path.basename(runId) !== runId) {
      throw new Error("Invalid run id.");
    }
    const outputDir = path.resolve(OUTPUT_ROOT, runId);
    if (!outputDir.startsWith(`${path.resolve(OUTPUT_ROOT)}${path.sep}`)) {
      throw new Error("Run output is outside the configured output root.");
    }
    const [outputStat, manifest, loopState, config] = await Promise.all([
      fs.stat(outputDir).catch(() => null),
      readJsonFile(path.join(outputDir, "run_manifest.json")),
      readJsonFile(path.join(outputDir, "loop_state.json")),
      loadServerConfig(),
    ]);
    if (!outputStat?.isDirectory()) {
      throw new Error(`Run not found: ${runId}`);
    }
    const workspacePath = recordString(manifest, "targetPath");
    if (!workspacePath || !(await fs.stat(workspacePath).catch(() => null))?.isDirectory()) {
      throw new Error("This historical run has no accessible source snapshot to resume.");
    }
    const lastCompletedRound = boundedInteger(loopState?.last_completed_round, 0, 12, 0);
    const settings = normalizeJobDefaults({
      ...config.defaults,
      executionMode: "local",
      workflowId: recordString(manifest, "workflowId") ?? config.defaults.workflowId,
      focusPolicy: recordString(manifest, "focusPolicy") ?? config.defaults.focusPolicy,
      focusWorkers: manifest?.focusWorkers ?? config.defaults.focusWorkers,
      maxFocusRounds: manifest?.maxFocusRounds ?? config.defaults.maxFocusRounds,
      scanProfile: recordString(manifest, "scanProfile") ?? config.defaults.scanProfile,
      agent: recordString(manifest, "agent") ?? config.defaults.agent,
      model: recordString(manifest, "model") ?? config.defaults.model,
      mergeAgent: recordString(manifest, "mergeAgent") ?? config.defaults.mergeAgent,
      mergeModel: recordString(manifest, "mergeModel") ?? config.defaults.mergeModel,
      summaryAgent: recordString(manifest, "summaryAgent") ?? config.defaults.summaryAgent,
      summaryModel: recordString(manifest, "summaryModel") ?? config.defaults.summaryModel,
      workers: manifest?.workers ?? config.defaults.workers,
      maxRounds: Math.max(lastCompletedRound, boundedInteger(manifest?.maxRounds, 1, 12, config.defaults.maxRounds)),
      convergeAfter: manifest?.convergeAfter ?? config.defaults.convergeAfter,
      reasoningEffort: recordString(manifest, "reasoningEffort") ?? config.defaults.reasoningEffort,
      mergeMode: recordString(manifest, "mergeMode") ?? config.defaults.mergeMode,
      languageProfile: recordString(manifest, "languageProfile") ?? config.defaults.languageProfile,
      include: Array.isArray(manifest?.include) ? manifest.include : config.defaults.include,
      exclude: Array.isArray(manifest?.exclude) ? manifest.exclude : config.defaults.exclude,
      extensions: Array.isArray(manifest?.extensions) ? manifest.extensions : config.defaults.extensions,
    });
    const createdAt = recordString(manifest, "startedAt") ?? outputStat.birthtime.toISOString();
    const projectId = recordString(manifest, "projectId") ?? path.basename(workspacePath);
    const engagementId = recordString(manifest, "engagementId") ?? runId;
    const job: JobRecord = {
      id: runId,
      name: projectId,
      projectId,
      engagementId,
      status: "failed",
      stage: "historical-run-adopted",
      createdAt,
      updatedAt: new Date().toISOString(),
      startedAt: createdAt,
      finishedAt: outputStat.mtime.toISOString(),
      source: { type: "local", path: workspacePath },
      settings,
      workspacePath,
      outputDir,
      runId,
      exitCode: null,
      error: null,
      logPath: path.join(JOBS_ROOT, `${runId}.log`),
      cancelRequested: false,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
      assignedWorkerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      attempt: 0,
    };
    await this.persistJob(job);
    this.jobs.set(job.id, job);
    await this.appendLog(job.id, `Adopted historical run with source snapshot ${workspacePath}.`);
    return job;
  }

  async createGithubJob(input: unknown) {
    await this.init();
    const config = await loadServerConfig();
    const payload = normalizeGithubJobInput(input, config.defaults);
    const id = createJobId();
    const outputDir = path.join(OUTPUT_ROOT, id);
    const workspacePath = path.join(SOURCES_ROOT, id, "repo");
    const job: JobRecord = {
      id,
      name: payload.name,
      projectId: payload.projectId || normalizeIdentifier(payload.name, repoSlugFromUrl(payload.repoUrl)),
      engagementId: payload.engagementId || id,
      status: "queued",
      stage: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      source: {
        type: "github",
        repoUrl: payload.repoUrl,
        ref: payload.ref,
      },
      settings: payload.settings,
      workspacePath,
      outputDir,
      runId: id,
      exitCode: null,
      error: null,
      logPath: path.join(JOBS_ROOT, `${id}.log`),
      cancelRequested: false,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
      assignedWorkerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      attempt: 0,
    };
    await this.persistJob(job);
    this.jobs.set(job.id, job);
    await this.appendLog(job.id, `Job created for GitHub source ${payload.repoUrl}`);
    void this.kickQueue();
    return job;
  }

  async createUploadJob(formData: FormData) {
    await this.init();
    const config = await loadServerConfig();
    const defaults = config.defaults;
    const settings = normalizeFormSettings(formData, defaults);
    const fileValue = formData.get("archive");
    if (!isUploadFile(fileValue)) {
      throw new Error("Upload payload is missing `archive`.");
    }
    const sourceName = sanitizeArchiveName(fileValue.name || "upload.zip");
    const maxBytes = settings.uploadSizeMb * 1024 * 1024;
    if (fileValue.size > maxBytes) {
      throw new Error(`Archive exceeds upload limit of ${settings.uploadSizeMb} MB.`);
    }

    const id = createJobId();
    const uploadDir = path.join(UPLOADS_ROOT, id);
    const workspacePath = path.join(SOURCES_ROOT, id, "upload");
    const storedName = `${Date.now()}_${sourceName}`;
    const archivePath = path.join(uploadDir, storedName);

    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(archivePath, Buffer.from(await fileValue.arrayBuffer()));

    const outputDir = path.join(OUTPUT_ROOT, id);
    const name = normalizeFormName(formData, sourceName);
    const job: JobRecord = {
      id,
      name,
      projectId: normalizeFormIdentifier(formData, "projectId", name),
      engagementId: normalizeFormIdentifier(formData, "engagementId", id),
      status: "queued",
      stage: "queued",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      source: {
        type: "upload",
        originalName: sourceName,
        storedName,
        sizeBytes: fileValue.size,
      },
      settings,
      workspacePath,
      outputDir,
      runId: id,
      exitCode: null,
      error: null,
      logPath: path.join(JOBS_ROOT, `${id}.log`),
      cancelRequested: false,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
      assignedWorkerId: null,
      leaseId: null,
      leaseExpiresAt: null,
      attempt: 0,
    };

    await this.persistJob(job);
    this.jobs.set(job.id, job);
    await this.appendLog(job.id, `Job created for uploaded archive ${sourceName}`);
    void this.kickQueue();
    return job;
  }

  async leaseWorkerJob(workerId: string, pool: string) {
    await this.init();
    while (this.leasePromise) {
      await this.leasePromise;
    }
    let releaseLeaseLock = () => {};
    this.leasePromise = new Promise<void>((resolve) => {
      releaseLeaseLock = resolve;
    });

    try {
      await this.recoverExpiredWorkerLeases();
      const workerPool = normalizeIdentifier(pool, "default");
      const nextJob = [...this.jobs.values()]
        .filter((job) => (
          job.status === "queued"
          && job.settings.executionMode === "worker"
          && job.settings.workerPool === workerPool
          && !job.cancelRequested
        ))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
      if (!nextJob) {
        return null;
      }

      const leaseId = randomUUID();
      const now = new Date();
      const leased = await this.updateJob(nextJob.id, {
        status: "preparing",
        stage: "worker-leased",
        startedAt: nextJob.startedAt ?? now.toISOString(),
        finishedAt: null,
        error: null,
        exitCode: null,
        assignedWorkerId: workerId,
        leaseId,
        leaseExpiresAt: new Date(now.getTime() + WORKER_LEASE_MS).toISOString(),
        attempt: nextJob.attempt + 1,
      });
      await this.appendLog(nextJob.id, `Leased to worker ${workerId} in pool ${workerPool} (attempt ${nextJob.attempt + 1}).`);
      return leased;
    } finally {
      this.leasePromise = null;
      releaseLeaseLock();
    }
  }

  async heartbeatWorkerJob(workerId: string, jobId: string, leaseId: string, stage?: string) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    const nextStage = typeof stage === "string" && stage.trim()
      ? stage.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").slice(0, 96)
      : job.stage === "worker-leased" ? "worker-preparing" : job.stage;
    return this.updateJob(jobId, {
      status: job.cancelRequested ? job.status : "running",
      stage: job.cancelRequested ? "cancelling" : nextStage,
      leaseExpiresAt: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
    });
  }

  async appendWorkerLog(workerId: string, jobId: string, leaseId: string, lines: string) {
    await this.init();
    this.assertWorkerLease(workerId, jobId, leaseId);
    const safeLines = lines.replace(/\0/g, "").slice(-256_000);
    if (safeLines) {
      await fs.appendFile(path.join(JOBS_ROOT, `${jobId}.log`), safeLines.endsWith("\n") ? safeLines : `${safeLines}\n`, "utf-8");
    }
    return this.jobs.get(jobId) ?? null;
  }

  async getWorkerSourceArchive(workerId: string, jobId: string, leaseId: string) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    if (job.source.type !== "upload") {
      return null;
    }
    const sourcePath = path.join(UPLOADS_ROOT, job.id, job.source.storedName);
    await fs.access(sourcePath);
    return {
      path: sourcePath,
      name: job.source.originalName,
    };
  }

  async createWorkerResumeArchive(workerId: string, jobId: string, leaseId: string) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    if (!job.resumeRequested) {
      return null;
    }
    const outputStat = await fs.stat(job.outputDir).catch(() => null);
    if (!outputStat?.isDirectory()) {
      throw new Error("The preserved remote output is unavailable for continuation.");
    }
    await fs.mkdir(WORKER_RESULTS_ROOT, { recursive: true });
    const archivePath = path.join(WORKER_RESULTS_ROOT, `${job.id}-${leaseId}-resume.tar.gz`);
    await fs.rm(archivePath, { force: true });
    await execFileAsync("tar", ["-czf", archivePath, "-C", job.outputDir, "."], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return archivePath;
  }

  async installWorkerResult(
    workerId: string,
    jobId: string,
    leaseId: string,
    archive: unknown,
  ) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    if (!isUploadFile(archive)) {
      throw new Error("Worker result is missing the output archive.");
    }
    const maximumBytes = Math.max(512, job.settings.uploadSizeMb * 4) * 1024 * 1024;
    await fs.mkdir(WORKER_RESULTS_ROOT, { recursive: true });
    const archivePath = path.join(WORKER_RESULTS_ROOT, `${job.id}-${leaseId}.tar.gz`);
    const stagingPath = `${job.outputDir}.worker-${leaseId}`;
    const entries = await installTarArchive(archive, archivePath, stagingPath, job.outputDir, maximumBytes);
    await this.appendLog(job.id, `Worker ${workerId} uploaded ${entries} output entries.`);
    return this.jobs.get(jobId) ?? null;
  }

  async installWorkerWorkspace(
    workerId: string,
    jobId: string,
    leaseId: string,
    archive: unknown,
  ) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    if (!isUploadFile(archive)) {
      throw new Error("Worker result is missing the source snapshot.");
    }
    const destination = job.workspacePath ?? path.join(SOURCES_ROOT, job.id, "snapshot");
    const maximumBytes = Math.max(512, job.settings.uploadSizeMb * 2) * 1024 * 1024;
    await fs.mkdir(WORKER_RESULTS_ROOT, { recursive: true });
    const archivePath = path.join(WORKER_RESULTS_ROOT, `${job.id}-${leaseId}-source.tar.gz`);
    const stagingPath = `${destination}.worker-${leaseId}`;
    const entries = await installTarArchive(archive, archivePath, stagingPath, destination, maximumBytes);
    const updated = await this.updateJob(job.id, { workspacePath: destination });
    await this.appendLog(job.id, `Worker ${workerId} preserved ${entries} source entries for review.`);
    return updated;
  }

  async completeWorkerJob(workerId: string, jobId: string, leaseId: string, exitCode = 0) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    if (job.cancelRequested) {
      return this.updateJob(jobId, {
        status: "cancelled",
        stage: "cancelled",
        finishedAt: new Date().toISOString(),
        error: null,
        exitCode,
        leaseId: null,
        leaseExpiresAt: null,
        resumeRequested: false,
        resumeFromStage: null,
        resumeRound: null,
      });
    }
    const [manifestStat, workspaceStat] = await Promise.all([
      fs.stat(path.join(job.outputDir, "run_manifest.json")).catch(() => null),
      job.workspacePath ? fs.stat(job.workspacePath).catch(() => null) : null,
    ]);
    if (!manifestStat?.isFile()) {
      throw new Error("Worker cannot complete before a valid output snapshot is installed.");
    }
    if (!workspaceStat?.isDirectory()) {
      throw new Error("Worker cannot complete before the review source snapshot is installed.");
    }
    const workflowSnapshot = await readJsonFile(path.join(job.outputDir, "workflow_run.json"));
    const awaitingReview = workflowSnapshot?.status === "awaiting_review";
    const completed = await this.updateJob(jobId, {
      status: awaitingReview ? "review_ready" : "succeeded",
      stage: awaitingReview ? "awaiting-review" : "completed",
      finishedAt: new Date().toISOString(),
      exitCode,
      error: null,
      runId: job.id,
      leaseId: null,
      leaseExpiresAt: null,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
    });
    await this.appendLog(
      job.id,
      awaitingReview
        ? `Worker ${workerId} completed automation; reviewer evidence decisions are required.`
        : `Worker ${workerId} completed the job successfully.`,
    );
    return completed;
  }

  async failWorkerJob(workerId: string, jobId: string, leaseId: string, error: string, exitCode: number | null = null) {
    await this.init();
    const job = this.assertWorkerLease(workerId, jobId, leaseId);
    const message = error.trim().slice(0, 2_000) || "Remote worker failed without an error message.";
    if (job.cancelRequested) {
      const cancelled = await this.updateJob(jobId, {
        status: "cancelled",
        stage: "cancelled",
        finishedAt: new Date().toISOString(),
        error: null,
        exitCode,
        leaseId: null,
        leaseExpiresAt: null,
        resumeRequested: false,
        resumeFromStage: null,
        resumeRound: null,
      });
      await this.appendLog(job.id, `Worker ${workerId} acknowledged cancellation.`);
      return cancelled;
    }
    if (job.attempt <= job.settings.workerRetries) {
      const retried = await this.updateJob(jobId, {
        status: "queued",
        stage: "worker-retry-queued",
        finishedAt: null,
        error: message,
        exitCode,
        assignedWorkerId: null,
        leaseId: null,
        leaseExpiresAt: null,
      });
      await this.appendLog(job.id, `Worker ${workerId} failed: ${message}. Requeued for retry ${job.attempt}/${job.settings.workerRetries}.`);
      return retried;
    }
    const failed = await this.updateJob(jobId, {
      status: "failed",
      stage: "worker-failed",
      finishedAt: new Date().toISOString(),
      error: message,
      exitCode,
      leaseId: null,
      leaseExpiresAt: null,
      resumeRequested: false,
      resumeFromStage: null,
      resumeRound: null,
    });
    await this.appendLog(job.id, `Worker ${workerId} failed after ${job.attempt} attempts: ${message}`);
    return failed;
  }

  async cancelJob(id: string) {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }

    if (job.status === "review_ready" || job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") {
      return job;
    }

    if (this.runtime.activeJobId === id && this.runtime.activeChild) {
      await this.updateJob(id, {
        cancelRequested: true,
        stage: "cancelling",
      });
      await this.appendLog(id, "Cancellation requested.");
      if (job.status === "paused") {
        signalProcessTree(this.runtime.activeChild, "SIGCONT");
      }
      signalProcessTree(this.runtime.activeChild, "SIGTERM");
      return this.jobs.get(id) ?? null;
    }

    await this.updateJob(id, {
      status: "cancelled",
      stage: "cancelled",
      finishedAt: new Date().toISOString(),
      cancelRequested: true,
    });
    await this.appendLog(id, "Queued job cancelled before execution.");
    return this.jobs.get(id) ?? null;
  }

  async pauseJob(id: string) {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }
    if (job.status !== "running" || this.runtime.activeJobId !== id || !this.runtime.activeChild) {
      return job;
    }
    signalProcessTree(this.runtime.activeChild, "SIGSTOP");
    await this.updateJob(id, {
      status: "paused",
      stage: "paused-by-reviewer",
    });
    await this.appendLog(id, "Execution paused. Completed artifacts and the current checkpoint were preserved.");
    return this.jobs.get(id) ?? null;
  }

  async resumeJob(id: string) {
    await this.init();
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }
    if (job.status !== "paused" || this.runtime.activeJobId !== id || !this.runtime.activeChild) {
      return job;
    }
    signalProcessTree(this.runtime.activeChild, "SIGCONT");
    await this.updateJob(id, {
      status: "running",
      stage: "running-audit",
    });
    await this.appendLog(id, "Execution resumed from the preserved process checkpoint.");
    return this.jobs.get(id) ?? null;
  }

  private assertWorkerLease(workerId: string, jobId: string, leaseId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    if (!leaseId || job.leaseId !== leaseId || job.assignedWorkerId !== workerId) {
      throw new Error("Worker lease is stale or does not belong to this worker.");
    }
    if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < Date.now()) {
      throw new Error("Worker lease has expired.");
    }
    return job;
  }

  private async recoverExpiredWorkerLeases() {
    const expired = [...this.jobs.values()].filter((job) => (
      job.settings.executionMode === "worker"
      && (job.status === "preparing" || job.status === "running")
      && (!job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) < Date.now())
    ));
    for (const job of expired) {
      if (job.cancelRequested) {
        await this.updateJob(job.id, {
          status: "cancelled",
          stage: "cancelled-after-worker-timeout",
          finishedAt: new Date().toISOString(),
          leaseId: null,
          leaseExpiresAt: null,
          resumeRequested: false,
        });
        await this.appendLog(job.id, "Remote worker lease expired after cancellation.");
        continue;
      }
      if (job.attempt <= job.settings.workerRetries) {
        await this.updateJob(job.id, {
          status: "queued",
          stage: "worker-lease-expired",
          assignedWorkerId: null,
          leaseId: null,
          leaseExpiresAt: null,
          error: "Remote worker stopped heartbeating before completion.",
        });
        await this.appendLog(job.id, `Remote lease expired; requeued after attempt ${job.attempt}.`);
        continue;
      }
      await this.updateJob(job.id, {
        status: "failed",
        stage: "worker-lease-expired",
        finishedAt: new Date().toISOString(),
        leaseId: null,
        leaseExpiresAt: null,
        error: "Remote worker stopped heartbeating and the retry budget is exhausted.",
        resumeRequested: false,
      });
      await this.appendLog(job.id, "Remote lease expired and retry budget is exhausted.");
    }
  }

  private async init() {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize() {
    await Promise.all([
      fs.mkdir(JOBS_ROOT, { recursive: true }),
      fs.mkdir(SOURCES_ROOT, { recursive: true }),
      fs.mkdir(UPLOADS_ROOT, { recursive: true }),
      fs.mkdir(OUTPUT_ROOT, { recursive: true }),
    ]);

    const entries = await fs.readdir(JOBS_ROOT, { withFileTypes: true });
    const jobFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
    for (const entry of jobFiles) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(JOBS_ROOT, entry.name), "utf-8")) as JobRecord;
        const normalized = normalizeJobRecord(raw);
        this.jobs.set(normalized.id, normalized);
      } catch {
        continue;
      }
    }

    for (const job of this.jobs.values()) {
      if (job.settings.executionMode === "worker" && (job.status === "preparing" || job.status === "running")) {
        continue;
      }
      if (job.status === "preparing" || job.status === "running") {
        job.status = "failed";
        job.stage = "startup-recovery";
        job.error = "Server restarted before the job completed.";
        job.finishedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        await this.persistJob(job);
        await this.appendLog(job.id, "Marked as failed after server restart.");
      }
    }
  }

  private async kickQueue() {
    await this.init();
    if (this.queuePromise) {
      return this.queuePromise;
    }

    this.queuePromise = (async () => {
      try {
        while (!this.runtime.activeJobId) {
          const nextJob = [...this.jobs.values()]
            .filter((job) => job.status === "queued" && job.settings.executionMode === "local")
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
          if (!nextJob) {
            break;
          }
          await this.executeJob(nextJob.id);
        }
      } finally {
        this.queuePromise = null;
      }
    })();

    return this.queuePromise;
  }

  private async executeJob(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return;
    }

    this.runtime.activeJobId = jobId;
    const resumeRequested = job.resumeRequested === true;
    try {
      await this.updateJob(jobId, {
        status: "preparing",
        stage: "preparing",
        startedAt: new Date().toISOString(),
        error: null,
        exitCode: null,
      });

      let targetDir: string;
      if (resumeRequested) {
        if (!job.workspacePath) {
          throw new Error("Cannot continue because the preserved workspace is unavailable.");
        }
        const workspaceStat = await fs.stat(job.workspacePath).catch(() => null);
        if (!workspaceStat?.isDirectory()) {
          throw new Error("Cannot continue because the preserved workspace no longer exists.");
        }
        targetDir = job.workspacePath;
        await this.appendLog(jobId, "Continuing the preserved run with queued adaptive focus work.");
      } else {
        await fs.rm(job.outputDir, { recursive: true, force: true });
        await fs.rm(path.dirname(job.workspacePath ?? path.join(SOURCES_ROOT, jobId)), { recursive: true, force: true });
        targetDir = await this.prepareWorkspace(jobId);
      }
      await this.ensureNotCancelled(jobId);

      await this.updateJob(jobId, {
        workspacePath: targetDir,
        status: "running",
        stage: "running-audit",
      });
      await this.appendLog(jobId, `Launching audit CLI for ${targetDir}`);

      const pythonCommand = await resolvePythonCommand();
      const exitCode = await this.runLoggedCommand(
        jobId,
        pythonCommand,
        buildAuditCommandArgs(
          targetDir,
          job.outputDir,
          job.settings,
          job.projectId,
          job.engagementId,
          resumeRequested,
          job.resumeFromStage,
          job.resumeRound,
        ),
        {
          cwd: AUDIT_ROOT,
          timeoutMs: job.settings.taskTimeoutMinutes * 60 * 1000,
        },
      );

      await this.ensureNotCancelled(jobId);
      if (exitCode !== 0) {
        throw new Error(`Audit runner exited with code ${exitCode}.`);
      }

      const workflowSnapshot = await readJsonFile(path.join(job.outputDir, "workflow_run.json"));
      const awaitingReview = workflowSnapshot?.status === "awaiting_review";
      await this.updateJob(jobId, {
        status: awaitingReview ? "review_ready" : "succeeded",
        stage: awaitingReview ? "awaiting-review" : "completed",
        finishedAt: new Date().toISOString(),
        exitCode,
        runId: jobId,
        resumeRequested: false,
        resumeFromStage: null,
        resumeRound: null,
      });
      await this.appendLog(
        jobId,
        awaitingReview
          ? "Automated analysis completed. Reviewer decisions are required before formal delivery."
          : "Job completed successfully.",
      );
    } catch (error) {
      const latest = this.jobs.get(jobId);
      if (latest?.cancelRequested) {
        await this.updateJob(jobId, {
          status: "cancelled",
          stage: "cancelled",
          finishedAt: new Date().toISOString(),
          error: null,
          resumeRequested: false,
          resumeFromStage: null,
          resumeRound: null,
        });
        await this.appendLog(jobId, "Job cancelled.");
      } else {
        const message = error instanceof Error ? error.message : "Unexpected job failure";
        await this.updateJob(jobId, {
          status: "failed",
          stage: "failed",
          finishedAt: new Date().toISOString(),
          error: message,
          resumeRequested: false,
          resumeFromStage: null,
          resumeRound: null,
        });
        await this.appendLog(jobId, `Job failed: ${message}`);
      }
    } finally {
      this.runtime.activeChild = null;
      this.runtime.activeTimedOut = false;
      this.runtime.activeJobId = null;
    }
  }

  private async prepareWorkspace(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || !job.workspacePath) {
      throw new Error("Job workspace path is unavailable.");
    }

    if (job.source.type === "github") {
      await this.updateJob(jobId, { stage: "cloning-repository" });
      await this.appendLog(jobId, `Cloning ${job.source.repoUrl}`);
      await fs.mkdir(path.dirname(job.workspacePath), { recursive: true });
      await this.runLoggedCommand(
        jobId,
        "git",
        ["clone", "--depth", "1", job.source.repoUrl, job.workspacePath],
        { cwd: AUDIT_ROOT, timeoutMs: 20 * 60 * 1000 },
      );
      if (job.source.ref) {
        await this.appendLog(jobId, `Checking out ref ${job.source.ref}`);
        await this.runLoggedCommand(
          jobId,
          "git",
          ["fetch", "--depth", "1", "origin", job.source.ref],
          { cwd: job.workspacePath, timeoutMs: 10 * 60 * 1000 },
        );
        await this.runLoggedCommand(
          jobId,
          "git",
          ["checkout", "FETCH_HEAD"],
          { cwd: job.workspacePath, timeoutMs: 10 * 60 * 1000 },
        );
      }
      return job.workspacePath;
    }

    if (job.source.type === "local") {
      return job.source.path;
    }

    await this.updateJob(jobId, { stage: "extracting-archive" });
    await this.appendLog(jobId, `Extracting ${job.source.originalName}`);
    const uploadPath = path.join(UPLOADS_ROOT, jobId, job.source.storedName);
    await fs.mkdir(job.workspacePath, { recursive: true });
    if (uploadPath.endsWith(".zip")) {
      await this.runLoggedCommand(
        jobId,
        "unzip",
        ["-q", uploadPath, "-d", job.workspacePath],
        { cwd: AUDIT_ROOT, timeoutMs: 20 * 60 * 1000 },
      );
    } else if (uploadPath.endsWith(".tar.gz") || uploadPath.endsWith(".tgz") || uploadPath.endsWith(".tar")) {
      await this.runLoggedCommand(
        jobId,
        "tar",
        ["-xf", uploadPath, "-C", job.workspacePath],
        { cwd: AUDIT_ROOT, timeoutMs: 20 * 60 * 1000 },
      );
    } else {
      throw new Error("Unsupported archive format. Upload a .zip, .tar, .tar.gz, or .tgz file.");
    }
    return await detectTargetRoot(job.workspacePath);
  }

  private async runLoggedCommand(
    jobId: string,
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
  ) {
    await this.ensureNotCancelled(jobId);
    await this.appendLog(jobId, `$ ${command} ${args.join(" ")}`);
    return new Promise<number>((resolve, reject) => {
      const logStream = createWriteStream(path.join(JOBS_ROOT, `${jobId}.log`), { flags: "a" });
      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      this.runtime.activeChild = proc;
      this.runtime.activeTimedOut = false;

      const timeout = setTimeout(() => {
        this.runtime.activeTimedOut = true;
        signalProcessTree(proc, "SIGTERM");
        setTimeout(() => signalProcessTree(proc, "SIGKILL"), 10_000).unref();
      }, options.timeoutMs);

      proc.stdout.on("data", (chunk: Buffer) => {
        logStream.write(chunk);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        logStream.write(chunk);
      });

      proc.on("error", (error) => {
        clearTimeout(timeout);
        logStream.end();
        reject(error);
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        logStream.end();
        this.runtime.activeChild = null;
        if (this.runtime.activeTimedOut) {
          reject(new Error(`Command timed out after ${Math.round(options.timeoutMs / 60_000)} minutes.`));
          return;
        }
        resolve(code ?? 0);
      });
    });
  }

  private async appendLog(jobId: string, message: string) {
    const timestamp = new Date().toISOString();
    await fs.mkdir(JOBS_ROOT, { recursive: true });
    await fs.appendFile(path.join(JOBS_ROOT, `${jobId}.log`), `[${timestamp}] ${message}\n`, "utf-8");
  }

  private async updateJob(jobId: string, patch: Partial<JobRecord>) {
    const current = this.jobs.get(jobId);
    if (!current) {
      return null;
    }
    const next = normalizeJobRecord({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    this.jobs.set(jobId, next);
    await this.persistJob(next);
    return next;
  }

  private async persistJob(job: JobRecord) {
    await fs.mkdir(JOBS_ROOT, { recursive: true });
    await fs.writeFile(path.join(JOBS_ROOT, `${job.id}.json`), `${JSON.stringify(job, null, 2)}\n`, "utf-8");
  }

  private async ensureNotCancelled(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job?.cancelRequested) {
      throw new Error("Job was cancelled.");
    }
  }
}

let singleton: JobManager | null = null;

export function getJobManager() {
  singleton ??= new JobManager();
  return singleton;
}

function normalizeGithubJobInput(value: unknown, defaults: JobDefaults) {
  if (!isRecord(value)) {
    throw new Error("Invalid GitHub job payload.");
  }
  if (value.sourceType !== "github") {
    throw new Error("GitHub job payload is missing `sourceType=github`.");
  }

  const repoUrl = normalizeGithubUrl(value.repoUrl);
  const rawRef = typeof value.ref === "string" ? value.ref.trim() : "";
  const ref = rawRef || null;
  const fallbackName = repoSlugFromUrl(repoUrl);

  return {
    repoUrl,
    ref,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallbackName,
    projectId: normalizeOptionalIdentifier(value.projectId),
    engagementId: normalizeOptionalIdentifier(value.engagementId),
    settings: normalizeJobDefaults(value.settings ?? defaults),
  };
}

function normalizeFormSettings(formData: FormData, defaults: JobDefaults) {
  return normalizeJobDefaults({
    ...defaults,
    executionMode: formData.get("executionMode"),
    workerPool: formData.get("workerPool"),
    workerRetries: formData.get("workerRetries"),
    workflowId: formData.get("workflowId"),
    focusPolicy: formData.get("focusPolicy"),
    focusWorkers: formData.get("focusWorkers"),
    maxFocusRounds: formData.get("maxFocusRounds"),
    scanProfile: formData.get("scanProfile"),
    agent: formData.get("agent"),
    model: formData.get("model"),
    mergeAgent: formData.get("mergeAgent"),
    mergeModel: formData.get("mergeModel"),
    summaryAgent: formData.get("summaryAgent"),
    summaryModel: formData.get("summaryModel"),
    workers: formData.get("workers"),
    maxRounds: formData.get("maxRounds"),
    convergeAfter: formData.get("convergeAfter"),
    reasoningEffort: formData.get("reasoningEffort"),
    mergeMode: formData.get("mergeMode"),
    languageProfile: formData.get("languageProfile"),
    include: splitLines(formData.get("include")),
    exclude: splitLines(formData.get("exclude")),
    extensions: splitCsv(formData.get("extensions")),
    uploadSizeMb: formData.get("uploadSizeMb"),
    taskTimeoutMinutes: formData.get("taskTimeoutMinutes"),
  });
}

function normalizeFormName(formData: FormData, fallback: string) {
  const explicit = formData.get("name");
  return typeof explicit === "string" && explicit.trim() ? explicit.trim() : fallback.replace(/\.[^.]+$/, "");
}

function normalizeFormIdentifier(formData: FormData, field: string, fallback: string) {
  return normalizeIdentifier(formData.get(field), fallback);
}

function splitLines(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCsv(value: unknown) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function buildAuditCommandArgs(
  targetDir: string,
  outputDir: string,
  settings: JobDefaults,
  projectId: string,
  engagementId: string,
  resume = false,
  resumeFromStage: ResumeStage | null = null,
  resumeRound: number | null = null,
) {
  const args = [
    path.join(AUDIT_ROOT, "scripts", "audithound.py"),
    "run",
    targetDir,
    "--output-dir",
    outputDir,
    "--workflow-id",
    settings.workflowId,
    "--focus-policy",
    settings.focusPolicy,
    "--focus-workers",
    String(settings.focusWorkers),
    "--max-focus-rounds",
    String(settings.maxFocusRounds),
    "--project-id",
    projectId,
    "--engagement-id",
    engagementId,
    "--scan-profile",
    settings.scanProfile,
    "--agent",
    settings.agent,
    "--model",
    settings.model,
    "--summary-agent",
    settings.summaryAgent,
    "--summary-model",
    settings.summaryModel,
    "--merge-agent",
    settings.mergeAgent,
    "--merge-model",
    settings.mergeModel,
    "--reasoning-effort",
    settings.reasoningEffort,
    "--max-rounds",
    String(settings.maxRounds),
    "--converge-after",
    String(settings.convergeAfter),
    "--merge-mode",
    settings.mergeMode,
    "--workers",
    String(settings.workers),
    "--language-profile",
    settings.languageProfile,
  ];

  for (const include of settings.include) {
    args.push("--include", include);
  }
  for (const exclude of settings.exclude) {
    args.push("--exclude", exclude);
  }
  if (settings.extensions.length > 0) {
    args.push("--extensions", settings.extensions.join(","));
  }
  if (resume) {
    args.push("--resume");
    if (resumeFromStage) {
      args.push("--resume-from", resumeFromStage);
    }
    if (resumeRound !== null) {
      args.push("--resume-round", String(resumeRound));
    }
  }

  return args;
}

async function resolvePythonCommand() {
  const configured = process.env.AUDITHOUND_PYTHON_BIN?.trim();
  if (configured) {
    return configured;
  }

  const candidates = process.platform === "win32"
    ? [
        path.join(AUDIT_ROOT, ".venv", "Scripts", "python.exe"),
        path.resolve(AUDIT_ROOT, "..", ".venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(AUDIT_ROOT, ".venv", "bin", "python3"),
        path.resolve(AUDIT_ROOT, "..", ".venv", "bin", "python3"),
      ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return "python3";
}

async function detectTargetRoot(extractedRoot: string) {
  const entries = (await fs.readdir(extractedRoot, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("__MACOSX"));
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(extractedRoot, entries[0].name);
  }
  return extractedRoot;
}

function normalizeGithubUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("GitHub repository URL is required.");
  }
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "https:") {
    throw new Error("GitHub repository URL must use https.");
  }
  if (!["github.com", "www.github.com"].includes(parsed.hostname)) {
    throw new Error("Only public GitHub repositories are supported in this MVP.");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    throw new Error("GitHub repository URL must include owner and repository name.");
  }
  parsed.pathname = `/${segments[0]}/${segments[1].replace(/\.git$/, "")}.git`;
  parsed.search = "";
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function repoSlugFromUrl(repoUrl: string) {
  const parsed = new URL(repoUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments[1]?.replace(/\.git$/, "") ?? "github-run";
}

function sanitizeArchiveName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normalizeJobRecord(value: JobRecord): JobRecord {
  return {
    ...value,
    projectId: normalizeIdentifier(value.projectId, value.name || value.id),
    engagementId: normalizeIdentifier(value.engagementId, value.id),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
    stage: typeof value.stage === "string" && value.stage ? value.stage : "queued",
    status: normalizeJobStatus(value.status),
    runId: typeof value.runId === "string" && value.runId ? value.runId : null,
    workspacePath: typeof value.workspacePath === "string" && value.workspacePath ? value.workspacePath : null,
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
    error: typeof value.error === "string" && value.error ? value.error : null,
    cancelRequested: value.cancelRequested === true,
    resumeRequested: value.resumeRequested === true,
    resumeFromStage: normalizeResumeStage(value.resumeFromStage),
    resumeRound: typeof value.resumeRound === "number" ? boundedInteger(value.resumeRound, 1, 12, 1) : null,
    assignedWorkerId: typeof value.assignedWorkerId === "string" && value.assignedWorkerId ? value.assignedWorkerId : null,
    leaseId: typeof value.leaseId === "string" && value.leaseId ? value.leaseId : null,
    leaseExpiresAt: typeof value.leaseExpiresAt === "string" && Number.isFinite(Date.parse(value.leaseExpiresAt))
      ? value.leaseExpiresAt
      : null,
    attempt: boundedInteger(value.attempt, 0, 100, 0),
    settings: normalizeJobDefaults(value.settings),
  };
}

function normalizeResumeStage(value: unknown): ResumeStage | null {
  if (
    value === "scope" ||
    value === "map" ||
    value === "investigate" ||
    value === "focus" ||
    value === "normalize" ||
    value === "summary" ||
    value === "review" ||
    value === "regression" ||
    value === "report"
  ) {
    return value;
  }
  return null;
}

function recordString(value: Record<string, unknown> | null, key: string) {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normalizeOptionalIdentifier(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  return normalizeIdentifier(value, "");
}

function normalizeIdentifier(value: unknown, fallback: string) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : fallback;
  const normalized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "unassigned";
}

function normalizeJobStatus(value: unknown): JobStatus {
  if (
    value === "preparing" ||
    value === "running" ||
    value === "paused" ||
    value === "rate_limited" ||
    value === "review_ready" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "queued";
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, "utf-8"));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

async function readTail(filePath: string, tailLines: number) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const allLines = raw.split("\n");
    return allLines.slice(Math.max(0, allLines.length - tailLines)).join("\n");
  } catch {
    return "";
  }
}

function createJobId() {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `job_${timestamp}_${suffix}`;
}

function isUploadFile(value: unknown): value is Blob & { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof value.arrayBuffer === "function" &&
      "size" in value &&
      typeof value.size === "number",
  );
}

function isUnsafeArchiveEntry(entry: string) {
  if (entry === "." || entry === "./") {
    return false;
  }
  const normalized = entry.replace(/\\/g, "/").replace(/^\.\/+/, "");
  return !normalized
    || normalized.startsWith("/")
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("/../");
}

async function installTarArchive(
  archive: Blob & { size: number; arrayBuffer(): Promise<ArrayBuffer> },
  archivePath: string,
  stagingPath: string,
  destinationPath: string,
  maximumBytes: number,
) {
  if (archive.size > maximumBytes) {
    throw new Error(`Worker archive exceeds ${Math.round(maximumBytes / 1024 / 1024)} MB.`);
  }
  await fs.writeFile(archivePath, Buffer.from(await archive.arrayBuffer()));
  try {
    const { stdout } = await execFileAsync("tar", ["-tzf", archivePath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const entries = stdout.split(/\r?\n/).filter(Boolean);
    if (entries.length === 0 || entries.some(isUnsafeArchiveEntry)) {
      throw new Error("Worker archive contains an invalid path.");
    }
    await fs.rm(stagingPath, { recursive: true, force: true });
    await fs.mkdir(stagingPath, { recursive: true });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", stagingPath], {
      maxBuffer: 32 * 1024 * 1024,
    });
    await fs.rm(destinationPath, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.rename(stagingPath, destinationPath);
    return entries.length;
  } finally {
    await fs.rm(archivePath, { force: true });
    await fs.rm(stagingPath, { recursive: true, force: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function signalProcessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals) {
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      child.kill(signal);
      return;
    }
  }
  child.kill(signal);
}
