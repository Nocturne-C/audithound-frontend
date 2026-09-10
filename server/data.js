import { createReadStream, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { ensureAuthorized } from "./auth";
import { loadSystemConfigPayload, saveServerConfig } from "./config";
import { getJobManager } from "./jobs";
import { AUDIT_ROOT, OUTPUT_ROOT, WORKSPACE_ROOT } from "./platform";
import { ensureWorkerAuthorized, getWorkerRegistry, workerControlSummary } from "./workers";
import { cloneWorkflow, deleteWorkflow, getWorkflow, listWorkflowVersions, listWorkflows, restoreWorkflowVersion, saveWorkflow, validateWorkflow, } from "./workflows";
import { DEFAULT_WORKFLOW, } from "../shared/workflow";
const CACHE_TTL_MS = 1200;
const STUDIO_STATE_FILE = "studio_state.json";
const FOCUS_STATE_FILE = "focus_state.json";
const SEVERITY_ORDER = ["Critical", "High", "Medium", "Low", "Informational", "Unknown"];
const CONFIDENCE_ORDER = ["high", "medium", "low", "unknown"];
const TRIAGE_STATUSES = [
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
const execFileAsync = promisify(execFile);
const REVIEWED_TRIAGE_STATUSES = new Set([
    "Confirmed",
    "False Positive",
    "Duplicate",
    "Accepted Risk",
    "Fixed",
    "Retest Passed",
]);
const FORMAL_TRIAGE_STATUSES = new Set(["Confirmed", "Accepted Risk", "Fixed", "Retest Passed"]);
const listCache = new Map();
const detailCache = new Map();
const jobManager = getJobManager();
const workerRegistry = getWorkerRegistry();
export function createAuditDataPlugin() {
    const attachMiddleware = (middlewares) => {
        middlewares.use((req, res, next) => {
            const workerEndpoint = req.url?.startsWith("/api/worker/") === true;
            if (workerEndpoint ? !ensureWorkerAuthorized(req, res) : !ensureAuthorized(req, res)) {
                return;
            }
            if (!req.url?.startsWith("/api/")) {
                next();
                return;
            }
            void handleApiRequest(req, res).catch((error) => {
                sendJson(res, 500, {
                    error: error instanceof Error ? error.message : "Unexpected API failure",
                });
            });
        });
    };
    return {
        name: "audithound-local-data",
        configureServer(server) {
            attachMiddleware(server.middlewares);
        },
        configurePreviewServer(server) {
            attachMiddleware(server.middlewares);
        },
    };
}
async function handleApiRequest(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;
    const fresh = url.searchParams.get("fresh") === "1";
    if (pathname === "/api/workers") {
        if (req.method !== "GET") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        sendJson(res, 200, {
            workers: await workerRegistry.listWorkers(),
            control: workerControlSummary(),
        });
        return;
    }
    if (pathname.startsWith("/api/workers/")) {
        if (req.method !== "DELETE") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        const workerId = decodeURIComponent(pathname.replace("/api/workers/", ""));
        sendJson(res, 200, { deleted: await workerRegistry.forget(workerId) });
        return;
    }
    if (pathname === "/api/worker/register") {
        if (req.method !== "POST") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        sendJson(res, 200, { worker: await workerRegistry.register(JSON.parse(await readRequestBody(req))) });
        return;
    }
    if (pathname.startsWith("/api/worker/")) {
        await handleWorkerRequest(req, res, url);
        return;
    }
    if (pathname === "/api/system-config") {
        if (req.method === "GET") {
            const payload = await loadSystemConfigPayload();
            sendJson(res, 200, payload);
            return;
        }
        if (req.method === "PUT") {
            const raw = await readRequestBody(req);
            const parsed = JSON.parse(raw);
            await saveServerConfig(parsed.config ?? parsed);
            const payload = await loadSystemConfigPayload();
            sendJson(res, 200, payload);
            return;
        }
        sendJson(res, 405, { error: "Unsupported method" });
        return;
    }
    if (pathname === "/api/workflows") {
        if (req.method !== "GET") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        sendJson(res, 200, { workflows: await listWorkflows() });
        return;
    }
    if (pathname === "/api/workflows/validate") {
        if (req.method !== "POST") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        const validation = validateWorkflow(JSON.parse(await readRequestBody(req)));
        sendJson(res, 200, { validation });
        return;
    }
    if (pathname.startsWith("/api/workflows/")) {
        const suffix = pathname.replace("/api/workflows/", "");
        const segments = suffix.split("/").filter(Boolean);
        const workflowId = decodeURIComponent(segments[0] ?? "");
        if (!workflowId) {
            sendJson(res, 400, { error: "Missing workflow id" });
            return;
        }
        if (segments[1] === "clone") {
            if (req.method !== "POST") {
                sendJson(res, 405, { error: "Unsupported method" });
                return;
            }
            sendJson(res, 201, { workflow: await cloneWorkflow(workflowId) });
            return;
        }
        if (segments[1] === "versions") {
            if (segments.length === 2 && req.method === "GET") {
                sendJson(res, 200, { versions: await listWorkflowVersions(workflowId) });
                return;
            }
            if (segments[2] && segments[3] === "restore" && req.method === "POST") {
                const version = Number.parseInt(segments[2], 10);
                if (!Number.isFinite(version) || version < 1) {
                    sendJson(res, 400, { error: "Invalid workflow version" });
                    return;
                }
                sendJson(res, 200, { workflow: await restoreWorkflowVersion(workflowId, version) });
                return;
            }
            sendJson(res, 405, { error: "Unsupported workflow version action" });
            return;
        }
        if (req.method === "GET") {
            const workflow = await getWorkflow(workflowId);
            if (!workflow) {
                sendJson(res, 404, { error: `Workflow not found: ${workflowId}` });
                return;
            }
            sendJson(res, 200, { workflow });
            return;
        }
        if (req.method === "PUT") {
            const workflow = await saveWorkflow(workflowId, JSON.parse(await readRequestBody(req)));
            sendJson(res, 200, { workflow });
            return;
        }
        if (req.method === "DELETE") {
            await deleteWorkflow(workflowId);
            sendJson(res, 200, { deleted: true });
            return;
        }
        sendJson(res, 405, { error: "Unsupported method" });
        return;
    }
    if (pathname === "/api/jobs") {
        if (req.method === "GET") {
            const jobs = await jobManager.listJobs();
            sendJson(res, 200, { jobs });
            return;
        }
        if (req.method === "POST") {
            const contentType = req.headers["content-type"] ?? "";
            const created = contentType.includes("multipart/form-data")
                ? await jobManager.createUploadJob(await readMultipartFormData(req))
                : await jobManager.createGithubJob(JSON.parse(await readRequestBody(req)));
            sendJson(res, 201, { job: created });
            return;
        }
        sendJson(res, 405, { error: "Unsupported method" });
        return;
    }
    if (pathname.startsWith("/api/jobs/")) {
        const suffix = pathname.replace("/api/jobs/", "");
        const segments = suffix.split("/").filter(Boolean);
        const jobId = decodeURIComponent(segments[0] ?? "");
        if (!jobId) {
            sendJson(res, 400, { error: "Missing job id" });
            return;
        }
        if (segments[1] === "cancel") {
            if (req.method !== "POST") {
                sendJson(res, 405, { error: "Unsupported method" });
                return;
            }
            const job = await jobManager.cancelJob(jobId);
            if (!job) {
                sendJson(res, 404, { error: `Job not found: ${jobId}` });
                return;
            }
            sendJson(res, 200, { job });
            return;
        }
        if (segments[1] === "pause" || segments[1] === "resume") {
            if (req.method !== "POST") {
                sendJson(res, 405, { error: "Unsupported method" });
                return;
            }
            const job = segments[1] === "pause" ? await jobManager.pauseJob(jobId) : await jobManager.resumeJob(jobId);
            if (!job) {
                sendJson(res, 404, { error: `Job not found: ${jobId}` });
                return;
            }
            sendJson(res, 200, { job });
            return;
        }
        if (req.method === "GET") {
            const tailLinesRaw = url.searchParams.get("tailLines");
            const tailLines = tailLinesRaw ? Number.parseInt(tailLinesRaw, 10) : undefined;
            const job = await jobManager.getJob(jobId, Number.isFinite(tailLines) ? tailLines : undefined);
            if (!job) {
                sendJson(res, 404, { error: `Job not found: ${jobId}` });
                return;
            }
            sendJson(res, 200, { job });
            return;
        }
        sendJson(res, 405, { error: "Unsupported method" });
        return;
    }
    if (pathname === "/api/runs") {
        const runs = await listRuns(fresh);
        sendJson(res, 200, { runs });
        return;
    }
    if (pathname === "/api/benchmarks") {
        sendJson(res, 200, { benchmark: await buildBenchmarkOverview() });
        return;
    }
    if (pathname === "/api/delivery/finalize") {
        if (req.method !== "POST") {
            sendJson(res, 405, { error: "Unsupported method" });
            return;
        }
        const parsed = JSON.parse(await readRequestBody(req));
        if (typeof parsed.runId !== "string" || !parsed.runId.trim()) {
            sendJson(res, 400, { error: "Missing runId" });
            return;
        }
        const result = await finalizeDelivery(parsed.runId.trim());
        if (result.blockers.length > 0) {
            sendJson(res, 409, {
                error: "The human evidence gate is incomplete.",
                blockers: result.blockers,
            });
            return;
        }
        sendJson(res, 200, result);
        return;
    }
    if (pathname.startsWith("/api/runs/")) {
        const suffix = pathname.replace("/api/runs/", "");
        const segments = suffix.split("/").filter(Boolean).map(decodeURIComponent);
        const runId = segments[0] ?? "";
        if (!runId) {
            sendJson(res, 400, { error: "Missing run id" });
            return;
        }
        if (segments[1] === "resume") {
            if (req.method !== "POST") {
                sendJson(res, 405, { error: "Unsupported method" });
                return;
            }
            const runSummary = await buildRunSummary(runId);
            if (!runSummary) {
                sendJson(res, 404, { error: `Run not found: ${runId}` });
                return;
            }
            const parsed = parseJsonObject(await readRequestBody(req));
            const stage = normalizeResumeStage(parsed.stage);
            if (!stage) {
                sendJson(res, 400, { error: "Unknown resume stage." });
                return;
            }
            const round = typeof parsed.round === "number" ? parsed.round : undefined;
            try {
                const linkedJob = await jobManager.findJobByRunId(runId);
                if (runSummary.workflowStatus === "running" ||
                    (linkedJob && ["queued", "preparing", "running", "paused"].includes(linkedJob.status))) {
                    throw new Error("Stop or wait for the active execution before selecting a resume stage.");
                }
                if (stage === "review") {
                    const job = await reopenHumanReview(runId);
                    invalidateRunCaches(runId);
                    sendJson(res, 200, { mode: "review", runId, job });
                    return;
                }
                if (stage === "regression" || stage === "report") {
                    const delivery = await finalizeDelivery(runId, { fromStage: stage });
                    if (delivery.blockers.length > 0) {
                        sendJson(res, 409, {
                            error: "The human review gate is incomplete.",
                            blockers: delivery.blockers,
                        });
                        return;
                    }
                    invalidateRunCaches(runId);
                    sendJson(res, 200, { mode: "completed", delivery });
                    return;
                }
                const job = await jobManager.resumeFromStage(runId, stage, round);
                if (!job) {
                    sendJson(res, 409, { error: "The run could not be queued for resume." });
                    return;
                }
                invalidateRunCaches(runId);
                sendJson(res, 202, { mode: "queued", job });
            }
            catch (error) {
                sendJson(res, 409, { error: error instanceof Error ? error.message : "Failed to resume run." });
            }
            return;
        }
        if (segments[1] === "focus") {
            if (!(await buildRunSummary(runId))) {
                sendJson(res, 404, { error: `Run not found: ${runId}` });
                return;
            }
            if (segments.length === 2 && req.method === "GET") {
                sendJson(res, 200, { focus: await runFocusManager(runId, ["snapshot"]) });
                return;
            }
            if (segments[2] === "evaluate" && req.method === "POST") {
                const parsed = parseJsonObject(await readRequestBody(req));
                const round = await resolveFocusRound(runId, parsed.round);
                const focus = await runFocusManager(runId, [
                    "evaluate",
                    "--round-dir",
                    path.join(OUTPUT_ROOT, runId, "rounds", `round_${round}`),
                    "--round",
                    String(round),
                ]);
                invalidateRunCaches(runId);
                sendJson(res, 200, { focus });
                return;
            }
            if (segments[2] === "config" && req.method === "PUT") {
                const parsed = parseJsonObject(await readRequestBody(req));
                const args = ["configure"];
                if (typeof parsed.policy === "string") {
                    args.push("--policy", parsed.policy);
                }
                if (typeof parsed.maxWorkers === "number") {
                    args.push("--max-workers", String(parsed.maxWorkers));
                }
                if (typeof parsed.maxFocusRounds === "number") {
                    args.push("--max-focus-rounds", String(parsed.maxFocusRounds));
                }
                const focus = await runFocusManager(runId, args);
                invalidateRunCaches(runId);
                sendJson(res, 200, { focus });
                return;
            }
            if (segments[2] === "requests" && req.method === "POST") {
                const parsed = parseJsonObject(await readRequestBody(req));
                if (typeof parsed.objective !== "string" || !parsed.objective.trim()) {
                    sendJson(res, 400, { error: "Focus objective is required." });
                    return;
                }
                const focus = await runFocusManager(runId, [
                    "request",
                    "--title",
                    typeof parsed.title === "string" ? parsed.title : "",
                    "--objective",
                    parsed.objective,
                    "--rationale",
                    typeof parsed.rationale === "string" ? parsed.rationale : "",
                    "--finding-id",
                    typeof parsed.findingId === "string" ? parsed.findingId : "",
                    "--target-paths",
                    JSON.stringify(Array.isArray(parsed.targetPaths) ? parsed.targetPaths : []),
                    "--priority",
                    normalizeFocusPriority(parsed.priority),
                    "--requested-by",
                    typeof parsed.requestedBy === "string" ? parsed.requestedBy : "reviewer",
                    "--after-round",
                    String(await resolveFocusRound(runId, parsed.afterRound, true)),
                ]);
                invalidateRunCaches(runId);
                sendJson(res, 201, { focus });
                return;
            }
            if (segments[2] === "suggestions" && segments[3] && segments[4] && req.method === "POST") {
                if (segments[4] !== "queue" && segments[4] !== "unqueue" && segments[4] !== "dismiss") {
                    sendJson(res, 404, { error: "Unknown focus suggestion action" });
                    return;
                }
                const focus = await runFocusManager(runId, [
                    "mutate",
                    "--suggestion-id",
                    segments[3],
                    "--action",
                    segments[4],
                ]);
                invalidateRunCaches(runId);
                sendJson(res, 200, { focus });
                return;
            }
            if (segments[2] === "continue" && req.method === "POST") {
                const parsed = parseJsonObject(await readRequestBody(req));
                const additionalRounds = typeof parsed.additionalRounds === "number" ? parsed.additionalRounds : 2;
                const job = await jobManager.continueWithFocus(runId, additionalRounds);
                if (!job) {
                    sendJson(res, 409, {
                        error: "This run was not created by the local job queue. Its focus work is queued; resume it with the CLI command.",
                    });
                    return;
                }
                sendJson(res, 200, { job });
                return;
            }
            sendJson(res, 405, { error: "Unsupported focus action" });
            return;
        }
        if (segments.length !== 1 || req.method !== "GET") {
            sendJson(res, 404, { error: "Unknown run endpoint" });
            return;
        }
        const run = await getRunDetail(runId, fresh);
        if (!run) {
            sendJson(res, 404, { error: `Run not found: ${runId}` });
            return;
        }
        sendJson(res, 200, { run });
        return;
    }
    if (pathname === "/api/artifact") {
        const relativePath = url.searchParams.get("path");
        if (!relativePath) {
            sendJson(res, 400, { error: "Missing artifact path" });
            return;
        }
        const tailLinesRaw = url.searchParams.get("tailLines");
        const tailLines = tailLinesRaw ? Number.parseInt(tailLinesRaw, 10) : undefined;
        const payload = await loadArtifact(relativePath, {
            tailLines: Number.isFinite(tailLines) ? tailLines : undefined,
        });
        sendJson(res, 200, payload);
        return;
    }
    if (pathname === "/api/source") {
        const runId = url.searchParams.get("runId");
        const location = url.searchParams.get("location");
        const contextRaw = url.searchParams.get("context");
        const context = contextRaw ? Number.parseInt(contextRaw, 10) : 12;
        if (!runId || !location) {
            sendJson(res, 400, { error: "Missing runId or location" });
            return;
        }
        const payload = await loadSourceSnippet(runId, location, Number.isFinite(context) ? context : 12);
        sendJson(res, 200, payload);
        return;
    }
    if (pathname === "/api/studio-state") {
        if (req.method === "GET") {
            const runId = url.searchParams.get("runId");
            if (!runId) {
                sendJson(res, 400, { error: "Missing runId" });
                return;
            }
            const state = await loadStudioState(runId);
            sendJson(res, 200, { state });
            return;
        }
        if (req.method === "PUT") {
            const raw = await readRequestBody(req);
            const state = normalizeStudioState(JSON.parse(raw));
            await saveStudioState(state);
            sendJson(res, 200, { state });
            return;
        }
        sendJson(res, 405, { error: "Unsupported method" });
        return;
    }
    sendJson(res, 404, { error: "Unknown endpoint" });
}
async function handleWorkerRequest(req, res, url) {
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const workerId = segments[2] ?? "";
    if (!workerId) {
        sendJson(res, 400, { error: "Missing worker id" });
        return;
    }
    const worker = await workerRegistry.getWorker(workerId);
    if (!worker) {
        sendJson(res, 404, { error: `Worker is not registered: ${workerId}` });
        return;
    }
    if (segments.length === 4 && segments[3] === "heartbeat" && req.method === "POST") {
        const payload = parseJsonObject(await readRequestBody(req));
        sendJson(res, 200, { worker: await workerRegistry.heartbeat(workerId, payload) });
        return;
    }
    if (segments.length === 4 && segments[3] === "lease" && req.method === "POST") {
        await workerRegistry.heartbeat(workerId, { activeJobIds: [] });
        const job = await jobManager.leaseWorkerJob(workerId, worker.pool);
        sendJson(res, 200, {
            job,
            leaseSeconds: workerControlSummary().leaseSeconds,
        });
        return;
    }
    if (segments[3] !== "jobs" || !segments[4] || !segments[5]) {
        sendJson(res, 404, { error: "Unknown worker endpoint" });
        return;
    }
    const jobId = segments[4];
    const action = segments[5];
    if (action === "heartbeat" && req.method === "POST") {
        const payload = parseJsonObject(await readRequestBody(req));
        const leaseId = readString(payload, "leaseId") ?? "";
        const job = await jobManager.heartbeatWorkerJob(workerId, jobId, leaseId, readString(payload, "stage") ?? undefined);
        await workerRegistry.heartbeat(workerId, { activeJobIds: [jobId] });
        sendJson(res, 200, { job, cancelRequested: job?.cancelRequested === true });
        return;
    }
    if (action === "logs" && req.method === "POST") {
        const payload = parseJsonObject(await readRequestBody(req));
        const leaseId = readString(payload, "leaseId") ?? "";
        const lines = readString(payload, "lines") ?? "";
        await jobManager.appendWorkerLog(workerId, jobId, leaseId, lines);
        sendJson(res, 200, { accepted: true });
        return;
    }
    if (action === "source" && req.method === "GET") {
        const leaseId = url.searchParams.get("leaseId") ?? "";
        const source = await jobManager.getWorkerSourceArchive(workerId, jobId, leaseId);
        if (!source) {
            sendJson(res, 404, { error: "This job uses a repository source." });
            return;
        }
        await sendFileResponse(res, source.path, source.name, "application/octet-stream");
        return;
    }
    if (action === "resume" && req.method === "GET") {
        const leaseId = url.searchParams.get("leaseId") ?? "";
        const archivePath = await jobManager.createWorkerResumeArchive(workerId, jobId, leaseId);
        if (!archivePath) {
            sendJson(res, 404, { error: "This job has no resume snapshot." });
            return;
        }
        await sendFileResponse(res, archivePath, `${jobId}-resume.tar.gz`, "application/gzip");
        await fs.rm(archivePath, { force: true });
        return;
    }
    if ((action === "result" || action === "workspace") && req.method === "POST") {
        const formData = await readMultipartFormData(req);
        const leaseIdValue = formData.get("leaseId");
        const leaseId = typeof leaseIdValue === "string" ? leaseIdValue : "";
        const job = action === "result"
            ? await jobManager.installWorkerResult(workerId, jobId, leaseId, formData.get("archive"))
            : await jobManager.installWorkerWorkspace(workerId, jobId, leaseId, formData.get("archive"));
        sendJson(res, 200, { job });
        return;
    }
    if ((action === "complete" || action === "fail") && req.method === "POST") {
        const payload = parseJsonObject(await readRequestBody(req));
        const leaseId = readString(payload, "leaseId") ?? "";
        const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
        const job = action === "complete"
            ? await jobManager.completeWorkerJob(workerId, jobId, leaseId, exitCode ?? 0)
            : await jobManager.failWorkerJob(workerId, jobId, leaseId, readString(payload, "error") ?? "Remote worker failed.", exitCode);
        await workerRegistry.heartbeat(workerId, { activeJobIds: [] });
        if (action === "complete") {
            invalidateRunCaches(jobId);
        }
        sendJson(res, 200, { job });
        return;
    }
    sendJson(res, 405, { error: "Unsupported worker action" });
}
async function sendFileResponse(res, filePath, downloadName, contentType) {
    const stat = await fs.stat(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Content-Disposition", `attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._-]+/g, "_")}"`);
    await new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on("error", reject);
        res.on("close", resolve);
        stream.pipe(res);
    });
}
async function runFocusManager(runId, args) {
    const runDir = resolveRunDirectory(runId);
    const pythonCommand = process.env.AUDITHOUND_PYTHON_BIN?.trim() || "python3";
    const [command, ...rest] = args;
    const { stdout } = await execFileAsync(pythonCommand, [
        path.join(AUDIT_ROOT, "scripts", "focus_manager.py"),
        command,
        "--run-dir",
        runDir,
        ...rest,
    ], {
        cwd: AUDIT_ROOT,
        encoding: "utf-8",
        maxBuffer: 5 * 1024 * 1024,
    });
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const payload = lines.length > 0 ? JSON.parse(lines[lines.length - 1]) : {};
    return normalizeFocusState(payload);
}
function resolveRunDirectory(runId) {
    const outputRoot = path.resolve(OUTPUT_ROOT);
    const resolved = path.resolve(outputRoot, runId);
    if (resolved === outputRoot || !resolved.startsWith(`${outputRoot}${path.sep}`)) {
        throw new Error("Invalid run id.");
    }
    return resolved;
}
async function resolveFocusRound(runId, requested, allowZero = false) {
    const parsed = typeof requested === "number" ? requested : Number.parseInt(String(requested ?? ""), 10);
    if (Number.isFinite(parsed) && parsed >= (allowZero ? 0 : 1)) {
        return Math.trunc(parsed);
    }
    const loopState = await readJsonIfExists(path.join(resolveRunDirectory(runId), "loop_state.json"));
    const lastCompletedRound = readNumber(loopState, "last_completed_round") ?? 0;
    if (!allowZero && lastCompletedRound < 1) {
        throw new Error("No completed round is available for focus evaluation.");
    }
    return lastCompletedRound;
}
function parseJsonObject(raw) {
    if (!raw.trim()) {
        return {};
    }
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
        throw new Error("Request body must be a JSON object.");
    }
    return parsed;
}
function normalizeResumeStage(value) {
    if (value === "scope" ||
        value === "map" ||
        value === "investigate" ||
        value === "focus" ||
        value === "normalize" ||
        value === "summary" ||
        value === "review" ||
        value === "regression" ||
        value === "report") {
        return value;
    }
    return null;
}
function normalizeFocusPriority(value) {
    if (value === "critical" || value === "high" || value === "normal") {
        return value;
    }
    return "medium";
}
function invalidateRunCaches(runId) {
    detailCache.delete(runId);
    listCache.delete("runs");
}
async function listRuns(fresh = false) {
    const cached = listCache.get("runs");
    if (!fresh && cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    const entries = await safeReadDir(OUTPUT_ROOT);
    const summaries = await Promise.all(entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => buildRunSummary(entry.name)));
    const filtered = summaries
        .filter((run) => run !== null)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    listCache.set("runs", {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: filtered,
    });
    return filtered;
}
async function getRunDetail(runId, fresh = false) {
    const cached = detailCache.get(runId);
    if (!fresh && cached && cached.expiresAt > Date.now()) {
        return cached.value;
    }
    const summary = await buildRunSummary(runId);
    if (!summary) {
        return null;
    }
    const runDir = path.join(OUTPUT_ROOT, runId);
    const [findingsRaw, loopState, workflowRunRaw, sourceContextRaw, ledgerRaw, codeMap, focusRaw] = await Promise.all([
        readJsonIfExists(path.join(runDir, "findings_acc.json")),
        readJsonIfExists(path.join(runDir, "loop_state.json")),
        readJsonIfExists(path.join(runDir, "workflow_run.json")),
        readJsonIfExists(path.join(runDir, "source_context.json")),
        readJsonIfExists(path.join(runDir, "investigation_ledger.json")),
        readTextIfExists(path.join(runDir, "code_map.md")),
        readJsonIfExists(path.join(runDir, FOCUS_STATE_FILE)),
    ]);
    const findings = normalizeFindings(findingsRaw).map((finding) => ({
        ...finding,
        fingerprint: finding.fingerprint ?? findingFingerprint(finding),
    }));
    const roundsDir = path.join(runDir, "rounds");
    const roundNumbers = await listRoundNumbers(roundsDir);
    const lastCompletedRound = readNumber(loopState, "last_completed_round") ?? roundNumbers[roundNumbers.length - 1] ?? 0;
    const activeRound = computeActiveRound(roundNumbers, lastCompletedRound);
    const roundsDetail = await Promise.all(roundNumbers.map((round) => buildRoundDetail(runDir, runId, round)));
    const artifacts = await buildArtifactCatalog(runDir, runId, roundsDetail);
    const liveTailArtifacts = activeRound ? await buildLiveTailArtifacts(runDir, runId, activeRound) : [];
    const workflowRun = normalizeWorkflowRun(workflowRunRaw, {
        runId,
        targetPath: summary.targetPath,
        activeRound,
        rounds: roundNumbers,
        findings: findings.length,
        hasCodeMap: Boolean(codeMap),
        hasReport: artifacts.some((artifact) => artifact.relativePath === `output/${runId}/final_report.md`),
        updatedAt: summary.updatedAt,
    });
    const workflow = (await getWorkflow(workflowRun.workflowId)) ?? DEFAULT_WORKFLOW;
    const { items: sourceFiles, scope } = normalizeSourceContext(sourceContextRaw, ledgerRaw, codeMap ?? "", findings);
    const detail = {
        ...summary,
        findings,
        workflow,
        workflowRun,
        sourceFiles,
        scope,
        hotspots: buildHotspots(findings),
        roundsDetail,
        artifacts,
        globalSummaryAvailable: artifacts.some((artifact) => artifact.relativePath === `output/${runId}/global_summary.md`),
        codeMapAvailable: artifacts.some((artifact) => artifact.relativePath === `output/${runId}/code_map.md`),
        lastCompletedRound,
        activeRound,
        liveTailArtifacts,
        focus: normalizeFocusState(focusRaw),
    };
    detailCache.set(runId, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: detail,
    });
    return detail;
}
async function buildRunSummary(runId) {
    const runDir = path.join(OUTPUT_ROOT, runId);
    try {
        const dirStat = await fs.stat(runDir);
        if (!dirStat.isDirectory()) {
            return null;
        }
    }
    catch {
        return null;
    }
    const [findingsRaw, loopState, prompt, manifestRaw, workflowRaw, sourceContextRaw] = await Promise.all([
        readJsonIfExists(path.join(runDir, "findings_acc.json")),
        readJsonIfExists(path.join(runDir, "loop_state.json")),
        loadPrimaryPrompt(runDir),
        readJsonIfExists(path.join(runDir, "run_manifest.json")),
        readJsonIfExists(path.join(runDir, "workflow_run.json")),
        readJsonIfExists(path.join(runDir, "source_context.json")),
    ]);
    const findings = normalizeFindings(findingsRaw);
    const severityCounts = createCounter(SEVERITY_ORDER, findings.map((finding) => normalizeSeverity(finding.severity)));
    const confidenceCounts = createCounter(CONFIDENCE_ORDER, findings.map((finding) => normalizeConfidence(finding.confidence)));
    const sourceAgentCounts = collectSourceAgentCounts(findings);
    const rounds = await listRoundNumbers(path.join(runDir, "rounds"));
    const updatedAt = isRecord(loopState) && typeof loopState.updated_at === "string" ? loopState.updated_at : (await fs.stat(runDir)).mtime.toISOString();
    const manifest = isRecord(manifestRaw) ? manifestRaw : {};
    const manifestTargetPath = readString(manifest, "targetPath");
    const recordedTargetPath = manifestTargetPath ?? (prompt ? parseTargetPath(prompt) : null);
    const linkedJob = await jobManager.findJobByRunId(runId);
    const linkedWorkspaceAvailable = linkedJob?.workspacePath
        ? (await fs.stat(linkedJob.workspacePath).catch(() => null))?.isDirectory() === true
        : false;
    const targetPath = linkedWorkspaceAvailable ? linkedJob?.workspacePath ?? recordedTargetPath : recordedTargetPath;
    const indexedSourceCount = isRecord(sourceContextRaw) && Array.isArray(sourceContextRaw.items)
        ? sourceContextRaw.items.filter(isRecord).length
        : 0;
    const scopeFileCount = indexedSourceCount || (prompt ? countScopeFiles(prompt) : 0);
    const title = recordedTargetPath ? path.basename(recordedTargetPath) || runId : prettyRunId(runId);
    const subtitle = readString(manifest, "repository") ?? recordedTargetPath ?? runId;
    const dominantSeverity = [...SEVERITY_ORDER].find((severity) => severityCounts[severity] > 0) ?? "Unknown";
    return {
        id: runId,
        title,
        subtitle,
        projectId: readString(manifest, "projectId") ?? title,
        engagementId: readString(manifest, "engagementId") ?? runId,
        scanProfile: normalizeScanProfile(readString(manifest, "scanProfile")),
        repository: readString(manifest, "repository"),
        commit: readString(manifest, "commit"),
        workflowStatus: normalizeWorkflowRunStatus(readString(isRecord(workflowRaw) ? workflowRaw : {}, "status")),
        targetPath,
        relativePath: `output/${runId}`,
        updatedAt,
        totalFindings: findings.length,
        rounds,
        converged: Boolean(isRecord(loopState) && loopState.converged === true),
        latestDelta: isRecord(loopState) && typeof loopState.last_delta === "number" ? loopState.last_delta : 0,
        noNewStreak: isRecord(loopState) && typeof loopState.no_new_streak === "number" ? loopState.no_new_streak : 0,
        scopeFileCount,
        severityCounts,
        confidenceCounts,
        sourceAgentCounts,
        dominantSeverity,
    };
}
async function buildRoundDetail(runDir, runId, round) {
    const roundDir = path.join(runDir, "rounds", `round_${round}`);
    const [mergeViewRaw, mergeRejectionsRaw, roundSummaryMarkdown] = await Promise.all([
        readJsonIfExists(path.join(roundDir, "merge_view.json")),
        readJsonIfExists(path.join(roundDir, "merge_rejections.json")),
        readTextIfExists(path.join(roundDir, "round_summary.md")),
    ]);
    const agentDirs = (await safeReadDir(roundDir))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith("agent_"))
        .map((entry) => entry.name)
        .sort();
    const agentOutputs = await Promise.all(agentDirs.map(async (dirName) => {
        const agentDir = path.join(roundDir, dirName);
        const stdoutPath = path.join(agentDir, "stdout.log");
        const stderrPath = path.join(agentDir, "stderr.log");
        const currentTaskPath = path.join(agentDir, "current_task.md");
        const taskJsonPath = path.join(agentDir, "task.json");
        const piSessionPath = path.join(agentDir, "session.jsonl");
        const extractedOutput = extractJsonPayload(await readTextIfExists(stdoutPath));
        const findingPayload = Array.isArray(extractedOutput)
            ? extractedOutput
            : isRecord(extractedOutput) && Array.isArray(extractedOutput.findings)
                ? extractedOutput.findings
                : null;
        const findings = normalizeFindings(findingPayload);
        const artifacts = [];
        if (await fileExists(stdoutPath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, stdoutPath), "Agent output", "log", "Round"));
        }
        if (await fileExists(stderrPath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, stderrPath), "Agent trace", "log", "Round"));
        }
        if (await fileExists(currentTaskPath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, currentTaskPath), "Agent brief", "markdown", "Round"));
        }
        if (await fileExists(taskJsonPath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, taskJsonPath), "Worker assignment", "json", "Round"));
        }
        if (await fileExists(piSessionPath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, piSessionPath), "Pi session", "log", "Round"));
        }
        return {
            id: dirName,
            label: prettifyAgentLabel(dirName),
            findingCount: findings.length,
            findingCountReliable: findingPayload !== null,
            findings,
            artifacts,
        };
    }));
    const mergeView = isRecord(mergeViewRaw) ? mergeViewRaw : null;
    const summary = {
        totalFindings: readNumber(mergeView?.summary, "total_findings") ?? 0,
        newFindings: readNumber(mergeView?.summary, "new_findings") ?? inferRoundNewFindings(agentOutputs),
        updatedExistingFindings: readNumber(mergeView?.summary, "updated_existing_findings") ?? 0,
        rejectedCandidates: readNumber(mergeView?.summary, "rejected_candidates") ?? arrayLength(mergeRejectionsRaw),
        actionCounts: readRecordNumberMap(mergeView?.summary, "action_counts"),
        rejectionReasonCounts: readRecordNumberMap(mergeView?.summary, "rejection_reason_counts"),
    };
    const artifacts = [];
    for (const [fileName, label, kind] of [
        ["prompt.md", "Round prompt", "markdown"],
        ["merge_prompt.md", "Merge prompt", "markdown"],
        ["merge_view.md", "Merge review", "markdown"],
        ["merge_stdout.log", "Merge output", "log"],
        ["merge_stderr.log", "Merge trace", "log"],
        ["merge_view.json", "Merge data", "json"],
        ["merge_rejections.json", "Rejected candidates", "json"],
        ["round_summary.md", "Round summary", "markdown"],
        ["round_summary_stdout.log", "Round summary output", "log"],
        ["round_summary_stderr.log", "Round summary trace", "log"],
        ["global_summary_task.md", "Global memory brief", "markdown"],
        ["global_summary_stdout.log", "Global memory output", "log"],
        ["global_summary_stderr.log", "Global memory trace", "log"],
        ["round_state.json", "Round state", "json"],
    ]) {
        const absolutePath = path.join(roundDir, fileName);
        if (await fileExists(absolutePath)) {
            artifacts.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, absolutePath), label, kind, "Round", round));
        }
    }
    return {
        round,
        summary,
        artifacts,
        agentOutputs,
        summaryMarkdown: roundSummaryMarkdown ?? undefined,
        mergeView: {
            findings: Array.isArray(mergeView?.findings) ? mergeView.findings : [],
            rejectedCandidates: Array.isArray(mergeRejectionsRaw)
                ? mergeRejectionsRaw
                : Array.isArray(mergeView?.rejected_candidates)
                    ? mergeView.rejected_candidates
                    : [],
        },
    };
}
async function buildArtifactCatalog(runDir, runId, roundsDetail) {
    const catalog = [];
    for (const [fileName, label, kind] of [
        ["run_manifest.json", "Run manifest", "json"],
        ["global_summary.md", "Global memory", "markdown"],
        ["code_map.md", "Code map", "markdown"],
        ["findings_acc.json", "Merged findings", "json"],
        ["loop_state.json", "Run state", "json"],
        ["convergence_state.json", "Convergence analysis", "json"],
        ["workflow_run.json", "Workflow execution", "json"],
        ["source_context.json", "Source context", "json"],
        ["investigation_ledger.json", "Investigation ledger", "json"],
        ["finding_lineage.json", "Finding lineage", "json"],
        ["focus_state.json", "Adaptive focus state", "json"],
        ["benchmark_result.json", "Benchmark result", "json"],
        ["automated_preview.md", "Automated preview", "markdown"],
        ["final_report.md", "Final report", "markdown"],
        ["regression_baseline.json", "Regression baseline", "json"],
        ["delivery_manifest.json", "Delivery manifest", "json"],
    ]) {
        const absolutePath = path.join(runDir, fileName);
        if (await fileExists(absolutePath)) {
            catalog.push(await createArtifactMeta(runId, path.relative(AUDIT_ROOT, absolutePath), label, kind, "Run"));
        }
    }
    for (const round of roundsDetail) {
        catalog.push(...round.artifacts, ...round.agentOutputs.flatMap((agent) => agent.artifacts));
    }
    return dedupeArtifacts(catalog).sort((left, right) => {
        if (left.group !== right.group) {
            return left.group.localeCompare(right.group);
        }
        return left.relativePath.localeCompare(right.relativePath);
    });
}
async function loadArtifact(relativePath, options) {
    const absolutePath = resolveAuditPath(relativePath);
    const ext = path.extname(absolutePath).toLowerCase();
    const stat = await fs.stat(absolutePath);
    const raw = await fs.readFile(absolutePath, "utf-8");
    if (ext === ".json") {
        return {
            relativePath,
            kind: "json",
            data: JSON.parse(raw),
            updatedAt: stat.mtime.toISOString(),
            absolutePath,
        };
    }
    if (typeof options?.tailLines === "number" && options.tailLines > 0) {
        const allLines = raw.split("\n");
        const startIndex = Math.max(0, allLines.length - options.tailLines);
        return {
            relativePath,
            kind: "text",
            data: allLines.slice(startIndex).join("\n"),
            updatedAt: stat.mtime.toISOString(),
            absolutePath,
            mode: "tail",
            tailLines: options.tailLines,
            truncated: startIndex > 0,
            lineCount: allLines.length,
        };
    }
    return {
        relativePath,
        kind: "text",
        data: raw,
        updatedAt: stat.mtime.toISOString(),
        absolutePath,
        mode: "full",
    };
}
async function loadSourceSnippet(runId, location, contextLines) {
    const summary = await buildRunSummary(runId);
    const linkedJob = await jobManager.findJobByRunId(runId);
    const linkedWorkspaceAvailable = linkedJob?.workspacePath
        ? (await fs.stat(linkedJob.workspacePath).catch(() => null))?.isDirectory() === true
        : false;
    const sourceRoot = linkedWorkspaceAvailable ? linkedJob?.workspacePath ?? null : summary?.targetPath;
    if (!sourceRoot) {
        throw new Error(`Run target path is unavailable for ${runId}`);
    }
    const parsed = parseLocation(location);
    if (!parsed) {
        throw new Error(`Cannot parse source location: ${location}`);
    }
    const absolutePath = resolveSourcePath(sourceRoot, parsed.relativeFilePath);
    const raw = await fs.readFile(absolutePath, "utf-8");
    const lines = raw.split("\n");
    const anchorLine = parsed.line ?? 1;
    const startLine = Math.max(1, anchorLine - contextLines);
    const endLine = Math.min(lines.length, anchorLine + contextLines);
    return {
        runId,
        location,
        relativeFilePath: parsed.relativeFilePath,
        absolutePath,
        line: parsed.line,
        column: parsed.column,
        startLine,
        endLine,
        totalLines: lines.length,
        lines: lines.slice(startLine - 1, endLine).map((text, index) => ({
            number: startLine + index,
            text,
            highlight: startLine + index === anchorLine,
        })),
    };
}
async function loadStudioState(runId) {
    const runDir = path.join(OUTPUT_ROOT, runId);
    const statePath = path.join(runDir, STUDIO_STATE_FILE);
    const raw = await readJsonIfExists(statePath);
    if (!raw) {
        return createEmptyStudioState(runId);
    }
    return normalizeStudioState({ ...raw, runId });
}
async function saveStudioState(state) {
    const runDir = path.join(OUTPUT_ROOT, state.runId);
    const statePath = path.join(runDir, STUDIO_STATE_FILE);
    const absolute = path.resolve(statePath);
    if (!absolute.startsWith(`${OUTPUT_ROOT}${path.sep}`)) {
        throw new Error(`Refusing to write outside output: ${state.runId}`);
    }
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf-8");
}
async function finalizeDelivery(runId, options) {
    const runDir = path.join(OUTPUT_ROOT, runId);
    const findingsRaw = await readJsonIfExists(path.join(runDir, "findings_acc.json"));
    const findings = normalizeFindings(findingsRaw);
    const state = await loadStudioState(runId);
    const blockers = [];
    for (const finding of findings) {
        const decision = state.findings[finding.id];
        if (!decision || !REVIEWED_TRIAGE_STATUSES.has(decision.status)) {
            blockers.push({ findingId: finding.id, message: "Reviewer disposition is required." });
            continue;
        }
        if (decision.status === "Confirmed") {
            if (!decision.evidenceSufficient) {
                blockers.push({ findingId: finding.id, message: "Confirmed findings require sufficient evidence." });
            }
            if (!decision.recommendedFix.trim()) {
                blockers.push({ findingId: finding.id, message: "Confirmed findings require a recommended fix." });
            }
            if (!decision.assignee.trim()) {
                blockers.push({ findingId: finding.id, message: "Confirmed findings require an owner." });
            }
        }
        if (decision.status === "Accepted Risk" && !decision.riskAcceptance.trim()) {
            blockers.push({ findingId: finding.id, message: "Accepted risk requires a rationale." });
        }
        if (decision.status === "Duplicate" && !decision.duplicateOf.trim()) {
            blockers.push({ findingId: finding.id, message: "Duplicate findings require a canonical finding ID." });
        }
        if ((decision.status === "Fixed" || decision.status === "Retest Passed") && !decision.fixReference.trim()) {
            blockers.push({ findingId: finding.id, message: "Fixed findings require a commit or PR reference." });
        }
        if (decision.status === "Retest Passed" && decision.retestStatus !== "passed") {
            blockers.push({ findingId: finding.id, message: "Retest Passed requires a passed retest record." });
        }
    }
    if (blockers.length > 0) {
        return { runId, blockers };
    }
    if (options?.fromStage) {
        await prepareRunCheckpoint(runId, options.fromStage);
    }
    let regressionRecords;
    const regressionPath = path.join(runDir, "regression_baseline.json");
    if (options?.fromStage === "report") {
        regressionRecords = normalizeRegressionRecords(await readJsonIfExists(regressionPath));
    }
    else {
        const previousFingerprints = await loadPreviousFindingFingerprints(runId);
        regressionRecords = findings.map((finding) => {
            const decision = state.findings[finding.id];
            const fingerprint = finding.fingerprint ?? findingFingerprint(finding);
            return {
                findingId: finding.id,
                fingerprint,
                classification: decision?.status === "Fixed" || decision?.status === "Retest Passed"
                    ? "fixed"
                    : previousFingerprints.has(fingerprint)
                        ? "persistent"
                        : "new",
                reviewStatus: decision?.status ?? "New",
                retestStatus: decision?.retestStatus ?? "not-requested",
                fixReference: decision?.fixReference ?? "",
            };
        });
        await atomicWriteJson(regressionPath, {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            runId,
            records: regressionRecords,
        });
    }
    const reportPath = path.join(runDir, "final_report.md");
    await execFileAsync("python3", [
        path.join(AUDIT_ROOT, "scripts", "gen_report.py"),
        "--findings",
        path.join(runDir, "findings_acc.json"),
        "--manifest",
        path.join(runDir, "run_manifest.json"),
        "--studio-state",
        path.join(runDir, STUDIO_STATE_FILE),
        "--mode",
        "formal",
        "--output",
        reportPath,
    ], {
        cwd: AUDIT_ROOT,
        maxBuffer: 4 * 1024 * 1024,
    });
    const reportContent = await fs.readFile(reportPath);
    const reportSha256 = createHash("sha256").update(reportContent).digest("hex");
    const workflowPath = path.join(runDir, "workflow_run.json");
    const workflowRaw = await readJsonIfExists(workflowPath);
    const workflow = isRecord(workflowRaw) ? workflowRaw : {};
    const now = new Date().toISOString();
    const workflowNodes = Array.isArray(workflow.nodes) ? workflow.nodes.filter(isRecord) : [];
    for (const node of workflowNodes) {
        const kind = typeof node.nodeKind === "string" ? node.nodeKind : inferWorkflowNodeKind(String(node.nodeId ?? ""));
        if (kind === "review" || kind === "regression" || kind === "report") {
            node.status = "completed";
            node.progress = 100;
            node.finishedAt = now;
            node.message =
                kind === "review"
                    ? "All findings received a reviewer disposition."
                    : kind === "regression"
                        ? "Target-scoped regression classifications were recorded."
                        : "Formal reviewer-approved delivery package generated.";
            const artifacts = Array.isArray(node.artifactPaths) ? node.artifactPaths.filter((item) => typeof item === "string") : [];
            if (kind === "regression") {
                artifacts.push(`output/${runId}/regression_baseline.json`);
            }
            if (kind === "report") {
                artifacts.push(`output/${runId}/final_report.md`);
            }
            node.artifactPaths = [...new Set(artifacts)];
        }
    }
    workflow.nodes = workflowNodes;
    workflow.status = "completed";
    workflow.updatedAt = now;
    workflow.finishedAt = now;
    workflow.currentNodeId = null;
    await atomicWriteJson(workflowPath, workflow);
    const formalFindings = findings.filter((finding) => {
        const decision = state.findings[finding.id];
        return Boolean(decision && FORMAL_TRIAGE_STATUSES.has(decision.status));
    });
    const deliveryManifest = {
        schemaVersion: 1,
        generatedAt: now,
        runId,
        reportPath: `output/${runId}/final_report.md`,
        reportSha256,
        findingCount: formalFindings.length,
        reviewerGateComplete: true,
    };
    await atomicWriteJson(path.join(runDir, "delivery_manifest.json"), deliveryManifest);
    await fs.rm(path.join(runDir, "resume_request.json"), { force: true });
    const job = await jobManager.markDelivered(runId);
    listCache.clear();
    detailCache.delete(runId);
    return {
        runId,
        blockers: [],
        report: deliveryManifest,
        regression: {
            path: `output/${runId}/regression_baseline.json`,
            records: regressionRecords,
        },
        job,
    };
}
async function reopenHumanReview(runId) {
    const runDir = resolveRunDirectory(runId);
    const findings = normalizeFindings(await readJsonIfExists(path.join(runDir, "findings_acc.json")));
    await prepareRunCheckpoint(runId, "review");
    const workflowPath = path.join(runDir, "workflow_run.json");
    const raw = await readJsonIfExists(workflowPath);
    const workflow = isRecord(raw) ? raw : {};
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.filter(isRecord) : [];
    const now = new Date().toISOString();
    let reviewNodeId = null;
    for (const node of nodes) {
        const kind = typeof node.nodeKind === "string" ? node.nodeKind : inferWorkflowNodeKind(String(node.nodeId ?? ""));
        if (kind === "review") {
            reviewNodeId = typeof node.nodeId === "string" ? node.nodeId : null;
            node.status = "waiting";
            node.progress = 0;
            node.inputCount = findings.length;
            node.outputCount = 0;
            node.startedAt = now;
            node.finishedAt = null;
            node.message = "Canonical findings are ready for reviewer disposition.";
            node.artifactPaths = (await fs.stat(path.join(runDir, "automated_preview.md")).catch(() => null))?.isFile()
                ? [`output/${runId}/automated_preview.md`]
                : [];
        }
        else if (kind === "regression" || kind === "report") {
            node.status = "blocked";
            node.progress = 0;
            node.startedAt = null;
            node.finishedAt = null;
            node.message = kind === "regression" ? "Waiting for human review." : "Waiting for regression baseline.";
            node.artifactPaths = [];
        }
    }
    workflow.nodes = nodes;
    workflow.status = "awaiting_review";
    workflow.updatedAt = now;
    workflow.finishedAt = null;
    workflow.currentNodeId = reviewNodeId;
    await atomicWriteJson(workflowPath, workflow);
    await fs.rm(path.join(runDir, "resume_request.json"), { force: true });
    return jobManager.markReviewReady(runId);
}
async function prepareRunCheckpoint(runId, stage) {
    const runDir = resolveRunDirectory(runId);
    const pythonCommand = process.env.AUDITHOUND_PYTHON_BIN?.trim() || "python3";
    await execFileAsync(pythonCommand, [
        path.join(AUDIT_ROOT, "scripts", "prepare_resume.py"),
        "--run-dir",
        runDir,
        "--from-stage",
        stage,
    ], { cwd: AUDIT_ROOT, maxBuffer: 4 * 1024 * 1024 });
    if ((await fs.stat(path.join(runDir, "workflow_run.json")).catch(() => null))?.isFile()) {
        await execFileAsync(pythonCommand, [
            path.join(AUDIT_ROOT, "scripts", "workflow_runtime.py"),
            "rewind",
            "--output-dir",
            runDir,
            "--from-stage",
            stage,
        ], { cwd: AUDIT_ROOT, maxBuffer: 4 * 1024 * 1024 });
    }
}
function normalizeRegressionRecords(value) {
    if (!isRecord(value) || !Array.isArray(value.records)) {
        throw new Error("The preserved regression baseline is unavailable or invalid.");
    }
    return value.records.flatMap((record) => {
        if (!isRecord(record) || typeof record.findingId !== "string" || typeof record.fingerprint !== "string") {
            return [];
        }
        const classification = record.classification === "fixed" || record.classification === "persistent"
            ? record.classification
            : "new";
        return [{
                findingId: record.findingId,
                fingerprint: record.fingerprint,
                classification,
                reviewStatus: normalizeTriageStatus(record.reviewStatus),
                retestStatus: normalizeRetestStatus(record.retestStatus),
                fixReference: typeof record.fixReference === "string" ? record.fixReference : "",
            }];
    });
}
function inferWorkflowNodeKind(nodeId) {
    if (nodeId.includes("review")) {
        return "review";
    }
    if (nodeId.includes("regression")) {
        return "regression";
    }
    if (nodeId.includes("delivery") || nodeId.includes("report")) {
        return "report";
    }
    return "";
}
async function atomicWriteJson(filePath, payload) {
    const temporary = `${filePath}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
    await fs.rename(temporary, filePath);
}
function createEmptyStudioState(runId) {
    return {
        version: 1,
        runId,
        updatedAt: new Date().toISOString(),
        findings: {},
        preferences: {},
    };
}
function normalizeStudioState(value) {
    if (!isRecord(value) || typeof value.runId !== "string") {
        throw new Error("Invalid studio state");
    }
    const findings = {};
    const sourceFindings = isRecord(value.findings) ? value.findings : {};
    for (const [findingId, decision] of Object.entries(sourceFindings)) {
        if (!isRecord(decision)) {
            continue;
        }
        findings[findingId] = {
            status: normalizeTriageStatus(decision.status),
            evidenceSufficient: decision.evidenceSufficient === true,
            reproducible: decision.reproducible === true,
            impactScope: typeof decision.impactScope === "string" ? decision.impactScope : "",
            recommendedFix: typeof decision.recommendedFix === "string" ? decision.recommendedFix : "",
            notes: typeof decision.notes === "string" ? decision.notes : "",
            assignee: typeof decision.assignee === "string" ? decision.assignee : "",
            dueDate: typeof decision.dueDate === "string" ? decision.dueDate : "",
            fixReference: typeof decision.fixReference === "string" ? decision.fixReference : "",
            duplicateOf: typeof decision.duplicateOf === "string" ? decision.duplicateOf : "",
            riskAcceptance: typeof decision.riskAcceptance === "string" ? decision.riskAcceptance : "",
            retestStatus: normalizeRetestStatus(decision.retestStatus),
            retestRunId: typeof decision.retestRunId === "string" ? decision.retestRunId : "",
            comments: Array.isArray(decision.comments)
                ? decision.comments
                    .filter(isRecord)
                    .map((comment, index) => ({
                    id: typeof comment.id === "string" ? comment.id : `${findingId}-comment-${index + 1}`,
                    author: typeof comment.author === "string" ? comment.author : "Reviewer",
                    body: typeof comment.body === "string" ? comment.body : "",
                    createdAt: typeof comment.createdAt === "string" ? comment.createdAt : new Date().toISOString(),
                }))
                    .filter((comment) => comment.body.trim())
                : [],
            updatedAt: typeof decision.updatedAt === "string" ? decision.updatedAt : undefined,
        };
    }
    return {
        version: 1,
        runId: value.runId,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
        findings,
        preferences: isRecord(value.preferences) ? value.preferences : {},
    };
}
function normalizeTriageStatus(value) {
    return TRIAGE_STATUSES.includes(value) ? value : "New";
}
function normalizeRetestStatus(value) {
    if (value === "ready" || value === "queued" || value === "passed" || value === "failed") {
        return value;
    }
    return "not-requested";
}
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        req.on("error", reject);
    });
}
async function readMultipartFormData(req) {
    const request = new Request("http://localhost", {
        method: req.method,
        headers: req.headers,
        body: Readable.toWeb(req),
        duplex: "half",
    });
    return request.formData();
}
async function loadPrimaryPrompt(runDir) {
    const roundsDir = path.join(runDir, "rounds");
    const rounds = await listRoundNumbers(roundsDir);
    if (rounds.length === 0) {
        return null;
    }
    return readTextIfExists(path.join(roundsDir, `round_${rounds[0]}`, "prompt.md"));
}
async function listRoundNumbers(roundsDir) {
    const entries = await safeReadDir(roundsDir);
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => /^round_(\d+)$/.exec(entry.name))
        .filter((match) => match !== null)
        .map((match) => Number.parseInt(match[1], 10))
        .sort((left, right) => left - right);
}
function buildHotspots(findings) {
    const counts = new Map();
    for (const finding of findings) {
        for (const location of finding.locations ?? []) {
            const file = location.split(":")[0]?.trim();
            if (!file) {
                continue;
            }
            counts.set(file, (counts.get(file) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([file, count]) => ({ file, count }))
        .sort((left, right) => right.count - left.count || left.file.localeCompare(right.file))
        .slice(0, 10);
}
async function loadPreviousFindingFingerprints(runId) {
    const current = await buildRunSummary(runId);
    if (!current) {
        return new Set();
    }
    const previous = (await listRuns(true))
        .filter((run) => run.id !== runId && run.projectId === current.projectId && run.updatedAt < current.updatedAt)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!previous) {
        return new Set();
    }
    const raw = await readJsonIfExists(path.join(OUTPUT_ROOT, previous.id, "findings_acc.json"));
    return new Set(normalizeFindings(raw).map((finding) => finding.fingerprint ?? findingFingerprint(finding)));
}
async function createArtifactMeta(runId, relativePath, label, kind, group, round) {
    const absolutePath = resolveAuditPath(relativePath);
    const stat = await fs.stat(absolutePath);
    return {
        id: `${runId}:${relativePath}`,
        label,
        relativePath: normalizeRelativePath(relativePath),
        kind,
        group,
        round,
        updatedAt: stat.mtime.toISOString(),
    };
}
function dedupeArtifacts(artifacts) {
    const seen = new Map();
    for (const artifact of artifacts) {
        seen.set(artifact.relativePath, artifact);
    }
    return [...seen.values()];
}
function inferRoundNewFindings(agentOutputs) {
    return Math.max(0, ...agentOutputs.map((agent) => agent.findingCount));
}
async function buildBenchmarkOverview() {
    const runs = await listRuns();
    let confirmedFindings = 0;
    let reviewedFindings = 0;
    let reproducibleFindings = 0;
    let totalRounds = 0;
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let evaluatedCases = 0;
    const targetRuns = new Map();
    for (const run of runs) {
        const runDir = path.join(OUTPUT_ROOT, run.id);
        const [findingsRaw, studioState, benchmarkRaw] = await Promise.all([
            readJsonIfExists(path.join(runDir, "findings_acc.json")),
            loadStudioState(run.id),
            readJsonIfExists(path.join(runDir, "benchmark_result.json")),
        ]);
        const findings = normalizeFindings(findingsRaw);
        const decisions = Object.values(studioState.findings);
        const reviewedCount = decisions.filter((decision) => REVIEWED_TRIAGE_STATUSES.has(decision.status)).length;
        const confirmedCount = decisions.filter((decision) => decision.status === "Confirmed").length;
        const reproducibleCount = decisions.filter((decision) => decision.reproducible).length;
        confirmedFindings += confirmedCount;
        reviewedFindings += reviewedCount;
        reproducibleFindings += reproducibleCount;
        totalRounds += run.rounds.length;
        if (isRecord(benchmarkRaw) && isRecord(benchmarkRaw.counts)) {
            truePositives += clampNumber(benchmarkRaw.counts.truePositives, 0, 1_000_000, 0);
            falsePositives += clampNumber(benchmarkRaw.counts.falsePositives, 0, 1_000_000, 0);
            falseNegatives += clampNumber(benchmarkRaw.counts.falseNegatives, 0, 1_000_000, 0);
            evaluatedCases += clampNumber(benchmarkRaw.evaluatedCases, 0, 1_000_000, 0);
        }
        const key = run.title || run.targetPath || run.id;
        const records = targetRuns.get(key) ?? [];
        records.push({
            run: { ...run, totalFindings: findings.length },
            reviewed: reviewedCount,
            confirmed: confirmedCount,
            reproducible: reproducibleCount,
        });
        targetRuns.set(key, records);
    }
    const targets = [...targetRuns.entries()]
        .map(([title, records]) => {
        const sorted = [...records].sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
        const latest = sorted[0];
        const previous = sorted[1] ?? null;
        return {
            id: normalizeRelativePath(title).replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase(),
            title,
            runCount: sorted.length,
            latestRunId: latest.run.id,
            previousRunId: previous?.run.id ?? null,
            latestFindings: latest.run.totalFindings,
            findingDelta: previous ? latest.run.totalFindings - previous.run.totalFindings : null,
            converged: latest.run.converged,
            reviewed: latest.reviewed,
            confirmed: latest.confirmed,
            reviewRate: latest.run.totalFindings > 0
                ? Math.round((latest.reviewed / latest.run.totalFindings) * 100)
                : 0,
        };
    })
        .sort((left, right) => right.runCount - left.runCount || left.title.localeCompare(right.title));
    return {
        generatedAt: new Date().toISOString(),
        totalRuns: runs.length,
        convergedRuns: runs.filter((run) => run.converged).length,
        totalFindings: runs.reduce((sum, run) => sum + run.totalFindings, 0),
        confirmedFindings,
        reviewedFindings,
        reproducibleFindings,
        averageRounds: runs.length > 0 ? Number((totalRounds / runs.length).toFixed(1)) : 0,
        precision: evaluatedCases > 0 ? safeRatio(truePositives, truePositives + falsePositives) : null,
        recall: evaluatedCases > 0 ? safeRatio(truePositives, truePositives + falseNegatives) : null,
        falsePositiveRate: null,
        falseNegativeRate: evaluatedCases > 0 ? safeRatio(falseNegatives, truePositives + falseNegatives) : null,
        evaluatedCases,
        targets,
    };
}
function safeRatio(numerator, denominator) {
    return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}
function normalizeSourceContext(value, ledgerValue, codeMap, findings) {
    const findingsByFile = new Map();
    for (const finding of findings) {
        for (const location of finding.locations) {
            const file = location.split(":")[0]?.trim();
            if (!file) {
                continue;
            }
            const related = findingsByFile.get(file) ?? [];
            related.push(finding);
            findingsByFile.set(file, related);
        }
    }
    const tasks = isRecord(ledgerValue) && isRecord(ledgerValue.tasks)
        ? Object.values(ledgerValue.tasks).filter(isRecord)
        : [];
    const assignedPaths = new Set(tasks.map((task) => typeof task.path === "string" ? task.path : null).filter((item) => Boolean(item)));
    const completedTasks = tasks.filter((task) => task.status === "completed");
    const rawItems = isRecord(value) && Array.isArray(value.items) ? value.items : [];
    const items = rawItems
        .filter(isRecord)
        .map((item, index) => {
        const filePath = typeof item.path === "string" ? item.path : `source-${index + 1}`;
        const related = findingsByFile.get(filePath) ?? [];
        return {
            id: typeof item.id === "string" ? item.id : `source-${index + 1}`,
            path: typeof item.path === "string" ? item.path : `source-${index + 1}`,
            kind: normalizeSourceFileKind(item.kind),
            linesOfCode: clampNumber(item.linesOfCode, 0, 10_000_000, 0),
            state: related.length > 0 ? "finding" : assignedPaths.has(filePath) ? "assigned" : "indexed",
            findingIds: related.map((finding) => finding.id),
            symbols: [...new Set([
                    ...(Array.isArray(item.entrypoints) ? item.entrypoints.filter((entry) => typeof entry === "string") : []),
                    ...(Array.isArray(item.symbols) ? item.symbols.filter((entry) => typeof entry === "string") : []),
                ])],
        };
    });
    const resolvedItems = items.length > 0 ? items : inferSourceFiles(codeMap, findings, assignedPaths);
    const plannedTasks = tasks.length;
    const completedTaskCount = completedTasks.length;
    return {
        items: resolvedItems,
        scope: {
            coverageMode: plannedTasks > 0 ? "workflow-tasks" : "open-scope",
            scopeFiles: resolvedItems.length,
            assignedFiles: assignedPaths.size,
            filesWithFindings: resolvedItems.filter((item) => item.findingIds.length > 0).length,
            totalFindings: findings.length,
            assignmentCoverage: plannedTasks > 0 ? Math.round((completedTaskCount / plannedTasks) * 100) : 0,
            plannedTasks,
            completedTasks: completedTaskCount,
        },
    };
}
function inferSourceFiles(codeMap, findings, assignedPaths) {
    const findingsByFile = new Map();
    for (const finding of findings) {
        for (const location of finding.locations) {
            const file = location.split(":")[0]?.trim();
            if (!file) {
                continue;
            }
            const related = findingsByFile.get(file) ?? [];
            related.push(finding);
            findingsByFile.set(file, related);
        }
    }
    return codeMap
        .split("\n")
        .map((line) => /^-\s+(.+?)\s+\((\d+)\s+LOC\)/.exec(line.trim()))
        .filter((match) => match !== null)
        .map((match) => {
        const filePath = match[1].trim();
        const related = findingsByFile.get(filePath) ?? [];
        return {
            id: createHash("sha256").update(filePath).digest("hex").slice(0, 12),
            path: filePath,
            kind: inferSourceFileKind(filePath),
            linesOfCode: Number.parseInt(match[2], 10),
            state: related.length > 0 ? "finding" : assignedPaths.has(filePath) ? "assigned" : "indexed",
            findingIds: related.map((finding) => finding.id),
            symbols: [],
        };
    });
}
function normalizeWorkflowRun(value, fallback) {
    if (isRecord(value) && Array.isArray(value.nodes)) {
        const nodes = value.nodes.filter(isRecord).map(normalizeWorkflowNodeExecution);
        return {
            schemaVersion: 1,
            runId: typeof value.runId === "string" ? value.runId : fallback.runId,
            workflowId: typeof value.workflowId === "string" ? value.workflowId : DEFAULT_WORKFLOW.id,
            workflowVersion: clampNumber(value.workflowVersion, 1, 9999, 1),
            status: normalizeWorkflowRunStatus(value.status),
            targetPath: typeof value.targetPath === "string" ? value.targetPath : fallback.targetPath,
            startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
            updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : fallback.updatedAt,
            finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
            currentNodeId: typeof value.currentNodeId === "string" ? value.currentNodeId : null,
            nodes,
        };
    }
    const hasRounds = fallback.rounds.length > 0;
    const automatedComplete = hasRounds && fallback.activeRound === null;
    const status = fallback.activeRound ? "running" : fallback.hasReport || automatedComplete ? "completed" : "pending";
    const statusByNode = new Map([
        ["scope-contract", "completed"],
        ["source-context", fallback.hasCodeMap ? "completed" : "pending"],
        ["independent-general-audit", fallback.activeRound ? "running" : hasRounds ? "completed" : "pending"],
        ["canonical-findings", fallback.findings > 0 ? "completed" : "pending"],
        ["human-review", "pending"],
        ["regression-baseline", "pending"],
        ["delivery", fallback.hasReport ? "completed" : "pending"],
    ]);
    const nodes = DEFAULT_WORKFLOW.nodes.map((node) => {
        const nodeStatus = statusByNode.get(node.id) ?? "pending";
        return {
            nodeId: node.id,
            status: nodeStatus,
            attempt: nodeStatus === "pending" ? 0 : 1,
            startedAt: null,
            finishedAt: nodeStatus === "completed" ? fallback.updatedAt : null,
            progress: nodeStatus === "completed" ? 100 : nodeStatus === "running" ? 50 : 0,
            inputCount: 0,
            outputCount: node.id === "canonical-findings" ? fallback.findings : 0,
            message: fallback.activeRound && node.id === "independent-general-audit"
                ? `Round ${fallback.activeRound} is running.`
                : nodeStatus === "completed"
                    ? "Recovered from existing run artifacts."
                    : "",
            artifactPaths: [],
        };
    });
    return {
        schemaVersion: 1,
        runId: fallback.runId,
        workflowId: DEFAULT_WORKFLOW.id,
        workflowVersion: DEFAULT_WORKFLOW.version,
        status,
        targetPath: fallback.targetPath,
        startedAt: null,
        updatedAt: fallback.updatedAt,
        finishedAt: status === "completed" ? fallback.updatedAt : null,
        currentNodeId: fallback.activeRound ? "independent-general-audit" : null,
        nodes,
    };
}
function normalizeWorkflowNodeExecution(value) {
    return {
        nodeId: typeof value.nodeId === "string" ? value.nodeId : "unknown-node",
        status: normalizeWorkflowNodeStatus(value.status),
        attempt: clampNumber(value.attempt, 0, 999, 0),
        startedAt: typeof value.startedAt === "string" ? value.startedAt : null,
        finishedAt: typeof value.finishedAt === "string" ? value.finishedAt : null,
        progress: clampNumber(value.progress, 0, 100, 0),
        inputCount: clampNumber(value.inputCount, 0, 10_000_000, 0),
        outputCount: clampNumber(value.outputCount, 0, 10_000_000, 0),
        message: typeof value.message === "string" ? value.message : "",
        artifactPaths: Array.isArray(value.artifactPaths)
            ? value.artifactPaths.filter((entry) => typeof entry === "string")
            : [],
    };
}
function normalizeFindings(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter(isRecord)
        .map((item, index) => ({
        id: typeof item.id === "string" ? item.id : `item-${index + 1}`,
        fingerprint: typeof item.fingerprint === "string" ? item.fingerprint : undefined,
        severity: typeof item.severity === "string" ? item.severity : undefined,
        confidence: typeof item.confidence === "string" ? item.confidence : undefined,
        title: typeof item.title === "string" ? item.title : undefined,
        claim: typeof item.claim === "string" ? item.claim : undefined,
        impact: typeof item.impact === "string" ? item.impact : undefined,
        round: typeof item.round === "number" ? item.round : undefined,
        locations: Array.isArray(item.locations)
            ? item.locations.map(normalizeFindingLocation).filter((entry) => Boolean(entry))
            : typeof item.locations === "string"
                ? [item.locations]
                : [],
        paths: Array.isArray(item.paths) ? item.paths.filter((entry) => typeof entry === "string") : [],
        source_agents: Array.isArray(item.source_agents)
            ? item.source_agents.filter((entry) => typeof entry === "string")
            : [],
        vulnerability_class: typeof item.vulnerability_class === "string" ? item.vulnerability_class : undefined,
        root_cause: isRecord(item.root_cause)
            ? {
                component: typeof item.root_cause.component === "string" ? item.root_cause.component : undefined,
                symbol: typeof item.root_cause.symbol === "string" ? item.root_cause.symbol : undefined,
                mechanism: typeof item.root_cause.mechanism === "string" ? item.root_cause.mechanism : undefined,
            }
            : undefined,
        actor: typeof item.actor === "string" ? item.actor : undefined,
        entrypoint: typeof item.entrypoint === "string" ? item.entrypoint : undefined,
        prerequisites: Array.isArray(item.prerequisites)
            ? item.prerequisites.filter((entry) => typeof entry === "string")
            : [],
        reachability: typeof item.reachability === "string" ? item.reachability : undefined,
        controllability: typeof item.controllability === "string" ? item.controllability : undefined,
        reproduction: isRecord(item.reproduction) ? item.reproduction : undefined,
    }));
}
function normalizeFindingLocation(value) {
    if (typeof value === "string") {
        return value.trim() || null;
    }
    if (!isRecord(value) || typeof value.path !== "string" || !value.path.trim()) {
        return null;
    }
    const line = typeof value.lines === "string" || typeof value.lines === "number"
        ? value.lines
        : typeof value.line === "string" || typeof value.line === "number"
            ? value.line
            : null;
    return line === null || !String(line).trim()
        ? value.path.trim()
        : `${value.path.trim()}:${String(line).trim()}`;
}
function normalizeSeverity(value) {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized === "critical") {
        return "Critical";
    }
    if (normalized === "high") {
        return "High";
    }
    if (normalized === "medium") {
        return "Medium";
    }
    if (normalized === "low") {
        return "Low";
    }
    if (normalized === "informational" || normalized === "info") {
        return "Informational";
    }
    return "Unknown";
}
function normalizeConfidence(value) {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized === "high" || normalized === "medium" || normalized === "low") {
        return normalized;
    }
    return "unknown";
}
function createCounter(keys, values) {
    const base = Object.fromEntries(keys.map((key) => [key, 0]));
    for (const value of values) {
        if (value in base) {
            base[value] += 1;
        }
    }
    return base;
}
function collectSourceAgentCounts(findings) {
    const counts = {};
    for (const finding of findings) {
        for (const agent of finding.source_agents ?? []) {
            counts[agent] = (counts[agent] ?? 0) + 1;
        }
    }
    return counts;
}
function prettyRunId(runId) {
    return runId
        .replace(/[_-]\d{9,}$/, "")
        .replaceAll("_", " ")
        .replaceAll("-", " ")
        .trim();
}
function prettifyAgentLabel(name) {
    return name
        .replace(/^agent_/, "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}
function parseTargetPath(prompt) {
    const firstLine = prompt.split("\n")[0] ?? "";
    const match = / in (.+?)(?:\.\s*)?$/.exec(firstLine.trim());
    return match?.[1] ?? null;
}
function countScopeFiles(prompt) {
    return prompt
        .split("\n")
        .filter((line) => /^- .+\(\d+ LOC\)/.test(line.trim()))
        .length;
}
function extractJsonPayload(raw) {
    if (!raw) {
        return null;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        const candidates = [
            [trimmed.indexOf("["), trimmed.lastIndexOf("]")],
            [trimmed.indexOf("{"), trimmed.lastIndexOf("}")],
        ];
        for (const [start, end] of candidates) {
            if (start < 0 || end < start) {
                continue;
            }
            const slice = trimmed.slice(start, end + 1);
            try {
                return JSON.parse(slice);
            }
            catch {
                continue;
            }
        }
    }
    return null;
}
async function readJsonIfExists(filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function readTextIfExists(filePath) {
    try {
        return await fs.readFile(filePath, "utf-8");
    }
    catch {
        return null;
    }
}
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
async function safeReadDir(directory) {
    try {
        return await fs.readdir(directory, { withFileTypes: true });
    }
    catch {
        return [];
    }
}
function resolveAuditPath(relativePath) {
    const normalized = normalizeRelativePath(relativePath);
    const absolute = path.resolve(AUDIT_ROOT, normalized);
    if (!absolute.startsWith(AUDIT_ROOT)) {
        throw new Error(`Refusing to access path outside AuditV2: ${relativePath}`);
    }
    return absolute;
}
function resolveSourcePath(targetRoot, relativeFilePath) {
    const normalized = normalizeRelativePath(relativeFilePath);
    const absolute = path.resolve(targetRoot, normalized);
    const normalizedTargetRoot = `${path.resolve(targetRoot)}${path.sep}`;
    const normalizedWorkspaceRoot = `${WORKSPACE_ROOT}${path.sep}`;
    if (!absolute.startsWith(normalizedTargetRoot) && absolute !== path.resolve(targetRoot)) {
        throw new Error(`Refusing to access source outside target root: ${relativeFilePath}`);
    }
    if (!absolute.startsWith(normalizedWorkspaceRoot) && absolute !== WORKSPACE_ROOT) {
        throw new Error(`Refusing to access source outside workspace: ${relativeFilePath}`);
    }
    return absolute;
}
function parseLocation(location) {
    const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(location.trim());
    if (match) {
        return {
            relativeFilePath: match[1],
            line: Number.parseInt(match[2], 10),
            column: match[3] ? Number.parseInt(match[3], 10) : null,
        };
    }
    if (location.trim()) {
        return {
            relativeFilePath: location.trim(),
            line: null,
            column: null,
        };
    }
    return null;
}
function computeActiveRound(roundNumbers, lastCompletedRound) {
    const latestRound = roundNumbers[roundNumbers.length - 1] ?? null;
    if (!latestRound) {
        return null;
    }
    return latestRound > lastCompletedRound ? latestRound : null;
}
async function buildLiveTailArtifacts(runDir, runId, round) {
    const roundDir = path.join(runDir, "rounds", `round_${round}`);
    const candidates = await collectLiveLogCandidates(roundDir);
    const sorted = candidates
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 8);
    return Promise.all(sorted.map((candidate) => createArtifactMeta(runId, path.relative(AUDIT_ROOT, candidate.absolutePath), candidate.label, "log", "Round", round)));
}
async function collectLiveLogCandidates(roundDir) {
    const results = [];
    const entries = await safeReadDir(roundDir);
    for (const entry of entries) {
        const absolutePath = path.join(roundDir, entry.name);
        if (entry.isDirectory()) {
            const nested = await safeReadDir(absolutePath);
            for (const child of nested) {
                const childPath = path.join(absolutePath, child.name);
                if (!child.isFile() || !child.name.endsWith(".log")) {
                    continue;
                }
                const stat = await fs.stat(childPath);
                results.push({
                    absolutePath: childPath,
                    updatedAt: stat.mtime.toISOString(),
                    label: child.name.includes("stderr") ? "Live trace" : "Live output",
                });
            }
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".log")) {
            continue;
        }
        const stat = await fs.stat(absolutePath);
        results.push({
            absolutePath,
            updatedAt: stat.mtime.toISOString(),
            label: entry.name.includes("stderr") ? "Live trace" : "Live output",
        });
    }
    return results;
}
function normalizeRelativePath(relativePath) {
    return relativePath.replaceAll(path.sep, "/");
}
function findingFingerprint(finding) {
    const firstFile = [...new Set(finding.locations.map((location) => location.split(":")[0]?.trim()).filter(Boolean))]
        .sort()[0] ?? "";
    const identity = [firstFile, finding.title ?? "", finding.claim ?? ""]
        .map((item) => item.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
        .join("|");
    return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}
function normalizeSourceFileKind(value) {
    if (value === "contract" ||
        value === "interface" ||
        value === "library" ||
        value === "script" ||
        value === "test") {
        return value;
    }
    return "source";
}
function inferSourceFileKind(filePath) {
    const lowered = filePath.toLowerCase();
    const fileName = path.basename(lowered);
    if (lowered.includes("/test") || fileName.startsWith("test") || fileName.includes(".t.")) {
        return "test";
    }
    if (lowered.includes("interface") || /^i[A-Z]/.test(path.basename(filePath))) {
        return "interface";
    }
    if (lowered.includes("library") || lowered.includes("/lib/")) {
        return "library";
    }
    if (lowered.includes("/script") || /\.(?:sh|py|js|ts)$/.test(fileName)) {
        return "script";
    }
    if (/\.(?:sol|move)$/.test(fileName)) {
        return "contract";
    }
    return "source";
}
function normalizeWorkflowRunStatus(value) {
    if (value === "running" ||
        value === "paused" ||
        value === "awaiting_review" ||
        value === "completed" ||
        value === "failed" ||
        value === "cancelled") {
        return value;
    }
    return "pending";
}
function normalizeFocusState(value) {
    const source = isRecord(value) ? value : {};
    const validStatuses = [
        "suggested",
        "queued",
        "scheduled",
        "running",
        "completed",
        "failed",
        "dismissed",
    ];
    const suggestions = Array.isArray(source.suggestions)
        ? source.suggestions
            .filter((item) => isRecord(item) && typeof item.id === "string")
            .map((item) => ({
            ...item,
            id: String(item.id),
            status: validStatuses.includes(item.status)
                ? item.status
                : "suggested",
        }))
        : [];
    const counts = Object.fromEntries(validStatuses.map((status) => [
        status,
        suggestions.filter((item) => item.status === status).length,
    ]));
    const executions = Array.isArray(source.executions)
        ? source.executions.filter((item) => isRecord(item))
        : [];
    const focusRoundsUsed = new Set(executions
        .filter((item) => item.status !== "interrupted")
        .map((item) => readNumber(item, "round"))
        .filter((round) => round !== null)).size;
    const maxFocusRounds = clampNumber(source.maxFocusRounds, 0, 12, 2);
    return {
        schemaVersion: 1,
        policy: source.policy === "off" || source.policy === "auto" ? source.policy : "suggest",
        maxWorkers: clampNumber(source.maxWorkers, 1, 8, 2),
        maxFocusRounds,
        updatedAt: readString(source, "updatedAt") ?? new Date(0).toISOString(),
        lastEvaluatedRound: clampNumber(source.lastEvaluatedRound, 0, 999, 0),
        suggestions,
        executions,
        counts,
        focusRoundsUsed,
        budgetExhausted: focusRoundsUsed >= maxFocusRounds,
    };
}
function normalizeScanProfile(value) {
    if (value === "preview" || value === "release") {
        return value;
    }
    return "deep";
}
function normalizeWorkflowNodeStatus(value) {
    if (value === "blocked" ||
        value === "running" ||
        value === "waiting" ||
        value === "completed" ||
        value === "failed" ||
        value === "skipped") {
        return value;
    }
    return "pending";
}
function clampNumber(value, minimum, maximum, fallback) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}
function readNumber(record, key) {
    if (!isRecord(record)) {
        return null;
    }
    return typeof record[key] === "number" ? record[key] : null;
}
function readString(record, key) {
    if (!isRecord(record)) {
        return null;
    }
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function readRecordNumberMap(record, key) {
    const source = isRecord(record) && isRecord(record[key]) ? record[key] : {};
    return Object.fromEntries(Object.entries(source)
        .filter((entry) => typeof entry[1] === "number")
        .sort(([left], [right]) => left.localeCompare(right)));
}
function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
}
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function sendJson(res, statusCode, body) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
}
