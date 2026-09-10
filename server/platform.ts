import path from "node:path";

export const AUDIT_ROOT = path.resolve(__dirname, "../..");
export const OUTPUT_ROOT = path.join(AUDIT_ROOT, "output");
export const WORKSPACE_ROOT = path.resolve(AUDIT_ROOT, "..");
export const STATE_ROOT = path.join(AUDIT_ROOT, ".audithound");
export const JOBS_ROOT = path.join(STATE_ROOT, "jobs");
export const SOURCES_ROOT = path.join(STATE_ROOT, "sources");
export const UPLOADS_ROOT = path.join(STATE_ROOT, "uploads");
export const WORKFLOWS_ROOT = path.join(STATE_ROOT, "workflows");
export const WORKERS_ROOT = path.join(STATE_ROOT, "workers");
export const WORKER_RESULTS_ROOT = path.join(STATE_ROOT, "worker-results");
export const WORKER_REGISTRY_FILE = path.join(WORKERS_ROOT, "registry.json");
export const CONFIG_FILE = path.join(STATE_ROOT, "config.json");
export const DEFAULT_JOB_LOG_TAIL = 200;
