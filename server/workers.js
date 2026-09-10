import { timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import { runtimeEnvironmentValue } from "./environment";
import { WORKER_REGISTRY_FILE, WORKERS_ROOT } from "./platform";
const DEFAULT_OFFLINE_MS = 45_000;
export class WorkerRegistry {
    workers = new Map();
    initPromise = null;
    async listWorkers() {
        await this.init();
        return [...this.workers.values()]
            .map((worker) => this.snapshot(worker))
            .sort((left, right) => (workerStatusOrder(left.status) - workerStatusOrder(right.status)
            || left.pool.localeCompare(right.pool)
            || left.name.localeCompare(right.name)));
    }
    async getWorker(workerId) {
        await this.init();
        const worker = this.workers.get(normalizeWorkerId(workerId));
        return worker ? this.snapshot(worker) : null;
    }
    async register(input) {
        await this.init();
        if (!isRecord(input)) {
            throw new Error("Invalid worker registration payload.");
        }
        const id = normalizeWorkerId(input.id);
        if (!id) {
            throw new Error("Worker id is required.");
        }
        const existing = this.workers.get(id);
        const now = new Date().toISOString();
        const worker = {
            id,
            name: normalizeText(input.name, existing?.name ?? id, 80),
            pool: normalizeWorkerPool(input.pool, existing?.pool ?? "default"),
            registeredAt: existing?.registeredAt ?? now,
            lastHeartbeat: now,
            maxConcurrency: boundedInteger(input.maxConcurrency, 1, 16, existing?.maxConcurrency ?? 1),
            activeJobIds: existing?.activeJobIds ?? [],
            capabilities: normalizeStringArray(input.capabilities, 24),
            labels: normalizeLabels(input.labels),
            hostname: normalizeText(input.hostname, existing?.hostname ?? os.hostname(), 120),
            platform: normalizeText(input.platform, existing?.platform ?? process.platform, 80),
            version: normalizeText(input.version, existing?.version ?? "unknown", 40),
        };
        this.workers.set(id, worker);
        await this.persist();
        return this.snapshot(worker);
    }
    async heartbeat(workerId, input) {
        await this.init();
        const id = normalizeWorkerId(workerId);
        const current = this.workers.get(id);
        if (!current) {
            throw new Error(`Worker is not registered: ${workerId}`);
        }
        const payload = isRecord(input) ? input : {};
        const worker = {
            ...current,
            lastHeartbeat: new Date().toISOString(),
            activeJobIds: normalizeStringArray(payload.activeJobIds, 32).map(normalizeWorkerId).filter(Boolean),
            maxConcurrency: boundedInteger(payload.maxConcurrency, 1, 16, current.maxConcurrency),
        };
        this.workers.set(id, worker);
        await this.persist();
        return this.snapshot(worker);
    }
    async forget(workerId) {
        await this.init();
        const deleted = this.workers.delete(normalizeWorkerId(workerId));
        if (deleted) {
            await this.persist();
        }
        return deleted;
    }
    snapshot(worker) {
        const online = Date.now() - Date.parse(worker.lastHeartbeat) <= workerOfflineMs();
        return {
            ...worker,
            status: online ? (worker.activeJobIds.length > 0 ? "busy" : "online") : "offline",
        };
    }
    async init() {
        if (!this.initPromise) {
            this.initPromise = this.initialize();
        }
        return this.initPromise;
    }
    async initialize() {
        await fs.mkdir(WORKERS_ROOT, { recursive: true });
        try {
            const raw = JSON.parse(await fs.readFile(WORKER_REGISTRY_FILE, "utf-8"));
            const records = Array.isArray(raw) ? raw : [];
            for (const value of records) {
                const worker = normalizePersistedWorker(value);
                if (worker) {
                    this.workers.set(worker.id, worker);
                }
            }
        }
        catch { }
    }
    async persist() {
        await fs.mkdir(WORKERS_ROOT, { recursive: true });
        const temporaryPath = `${WORKER_REGISTRY_FILE}.tmp`;
        await fs.writeFile(temporaryPath, `${JSON.stringify([...this.workers.values()], null, 2)}\n`, "utf-8");
        await fs.rename(temporaryPath, WORKER_REGISTRY_FILE);
    }
}
let singleton = null;
export function getWorkerRegistry() {
    singleton ??= new WorkerRegistry();
    return singleton;
}
export function ensureWorkerAuthorized(req, res) {
    const expected = runtimeEnvironmentValue("AUDITHOUND_WORKER_TOKEN");
    if (!expected) {
        if (isLoopbackAddress(req.socket.remoteAddress)) {
            return true;
        }
        sendWorkerAuthError(res, 503, "Set AUDITHOUND_WORKER_TOKEN before accepting remote workers.");
        return false;
    }
    const authorization = req.headers.authorization ?? "";
    const provided = authorization.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : String(req.headers["x-audithound-worker-token"] ?? "").trim();
    if (!safeEqual(provided, expected)) {
        sendWorkerAuthError(res, 401, "Invalid worker token.");
        return false;
    }
    return true;
}
export function workerControlSummary() {
    return {
        tokenConfigured: Boolean(runtimeEnvironmentValue("AUDITHOUND_WORKER_TOKEN")),
        heartbeatSeconds: 10,
        offlineAfterSeconds: Math.round(workerOfflineMs() / 1000),
        leaseSeconds: 45,
    };
}
function normalizePersistedWorker(value) {
    if (!isRecord(value)) {
        return null;
    }
    const id = normalizeWorkerId(value.id);
    if (!id) {
        return null;
    }
    const now = new Date().toISOString();
    return {
        id,
        name: normalizeText(value.name, id, 80),
        pool: normalizeWorkerPool(value.pool, "default"),
        registeredAt: normalizeDate(value.registeredAt, now),
        lastHeartbeat: normalizeDate(value.lastHeartbeat, now),
        maxConcurrency: boundedInteger(value.maxConcurrency, 1, 16, 1),
        activeJobIds: normalizeStringArray(value.activeJobIds, 32).map(normalizeWorkerId).filter(Boolean),
        capabilities: normalizeStringArray(value.capabilities, 24),
        labels: normalizeLabels(value.labels),
        hostname: normalizeText(value.hostname, "unknown", 120),
        platform: normalizeText(value.platform, "unknown", 80),
        version: normalizeText(value.version, "unknown", 40),
    };
}
function normalizeWorkerId(value) {
    if (typeof value !== "string") {
        return "";
    }
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 96);
}
function normalizeWorkerPool(value, fallback) {
    return normalizeWorkerId(typeof value === "string" ? value : fallback) || "default";
}
function normalizeText(value, fallback, maxLength) {
    return typeof value === "string" && value.trim()
        ? value.trim().slice(0, maxLength)
        : fallback;
}
function normalizeStringArray(value, maxItems) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value
            .filter((item) => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
            .slice(0, maxItems))];
}
function normalizeLabels(value) {
    if (!isRecord(value)) {
        return {};
    }
    return Object.fromEntries(Object.entries(value)
        .filter((entry) => typeof entry[1] === "string")
        .slice(0, 24)
        .map(([key, label]) => [key.slice(0, 48), label.trim().slice(0, 120)]));
}
function normalizeDate(value, fallback) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}
function boundedInteger(value, minimum, maximum, fallback) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.trunc(parsed))) : fallback;
}
function workerOfflineMs() {
    return boundedInteger(process.env.AUDITHOUND_WORKER_OFFLINE_MS, 20_000, 300_000, DEFAULT_OFFLINE_MS);
}
function workerStatusOrder(status) {
    return status === "busy" ? 0 : status === "online" ? 1 : 2;
}
function safeEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function isLoopbackAddress(value) {
    return value === "127.0.0.1" || value === "::1" || value === "::ffff:127.0.0.1";
}
function sendWorkerAuthError(res, statusCode, error) {
    const payload = JSON.stringify({ error });
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(payload));
    res.end(payload);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
