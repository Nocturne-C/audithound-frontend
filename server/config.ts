import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";

import { CONFIG_FILE, OUTPUT_ROOT, STATE_ROOT } from "./platform";
import { getAuthSummary } from "./auth";
import { readRuntimeEnvironment } from "./environment";
import { DEFAULT_WORKFLOW_ID } from "../shared/workflow";

export type JobAgent = "codex" | "claude" | "opencode" | "pi";
export type ScanProfile = "preview" | "deep" | "release";
export type LanguageProfile = "solidity" | "solana-rust" | "generic";
export type MergeMode = "codex" | "manual";
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type FocusPolicy = "off" | "suggest" | "auto";
export type ExecutionMode = "local" | "worker";

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

export type ServerConfig = {
  version: 1;
  updatedAt: string;
  defaults: JobDefaults;
};

export type SystemConfigPayload = {
  config: ServerConfig;
  auth: ReturnType<typeof getAuthSummary>;
  providers: {
    openai: boolean;
    anthropic: boolean;
    deepseek: boolean;
    google: boolean;
  };
  providerHealth: {
    deepseek: DeepSeekProviderHealth;
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

export type DeepSeekProviderHealth = {
  status: "unconfigured" | "ready" | "insufficient_balance" | "invalid_key" | "unreachable";
  available: boolean;
  checkedAt: string | null;
  message: string;
};

let deepSeekHealthCache:
  | {
      fingerprint: string;
      expiresAt: number;
      value: DeepSeekProviderHealth;
    }
  | null = null;

const DEFAULTS: JobDefaults = {
  executionMode: "local",
  workerPool: "default",
  workerRetries: 2,
  workflowId: DEFAULT_WORKFLOW_ID,
  focusPolicy: "suggest",
  focusWorkers: 2,
  maxFocusRounds: 2,
  scanProfile: "deep",
  agent: "pi",
  model: process.env.AUDITHOUND_PI_MODEL?.trim() || process.env.PI_MODEL?.trim() || "deepseek/deepseek-v4-flash",
  mergeAgent: "pi",
  mergeModel: process.env.AUDITHOUND_MERGE_MODEL?.trim() || process.env.AUDITHOUND_PI_MODEL?.trim() || process.env.PI_MODEL?.trim() || "deepseek/deepseek-v4-flash",
  summaryAgent: "pi",
  summaryModel: process.env.AUDITHOUND_SUMMARY_MODEL?.trim() || process.env.AUDITHOUND_PI_MODEL?.trim() || process.env.PI_MODEL?.trim() || "deepseek/deepseek-v4-flash",
  workers: 2,
  maxRounds: 6,
  convergeAfter: 2,
  reasoningEffort: "xhigh",
  mergeMode: "codex",
  languageProfile: "solidity",
  include: [],
  exclude: [],
  extensions: [],
  uploadSizeMb: 150,
  taskTimeoutMinutes: 90,
};

export async function loadServerConfig(): Promise<ServerConfig> {
  await fs.mkdir(STATE_ROOT, { recursive: true });

  try {
    const raw = JSON.parse(await fs.readFile(CONFIG_FILE, "utf-8")) as Partial<ServerConfig>;
    return normalizeServerConfig(raw);
  } catch {
    return normalizeServerConfig({});
  }
}

export async function saveServerConfig(nextValue: unknown): Promise<ServerConfig> {
  const normalized = normalizeServerConfig(nextValue);
  await fs.mkdir(STATE_ROOT, { recursive: true });
  await fs.writeFile(CONFIG_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf-8");
  return normalized;
}

export async function loadSystemConfigPayload(): Promise<SystemConfigPayload> {
  const config = await loadServerConfig();
  const environment = await loadRuntimeEnvironment();
  const deepseekConfigured = Boolean(environment.DEEPSEEK_API_KEY?.trim());
  const deepseekHealth = await loadDeepSeekProviderHealth(environment.DEEPSEEK_API_KEY?.trim());
  return {
    config,
    auth: getAuthSummary(),
    providers: {
      openai: Boolean(environment.OPENAI_API_KEY?.trim()),
      anthropic: Boolean(environment.ANTHROPIC_API_KEY?.trim()),
      deepseek: deepseekConfigured,
      google: Boolean(environment.GOOGLE_API_KEY?.trim()),
    },
    providerHealth: {
      deepseek: deepseekHealth,
    },
    agents: {
      codex: Boolean(environment.AUDITHOUND_FORCE_CODEX_DISABLED !== "1"),
      claude: Boolean(environment.AUDITHOUND_FORCE_CLAUDE_DISABLED !== "1"),
      opencode: Boolean(environment.AUDITHOUND_FORCE_OPENCODE_DISABLED !== "1"),
      pi: Boolean(environment.AUDITHOUND_FORCE_PI_DISABLED !== "1"),
    },
    paths: {
      outputRoot: OUTPUT_ROOT,
      stateRoot: STATE_ROOT,
    },
  };
}

async function loadDeepSeekProviderHealth(apiKey: string | undefined): Promise<DeepSeekProviderHealth> {
  if (!apiKey) {
    return {
      status: "unconfigured",
      available: false,
      checkedAt: null,
      message: "Add DEEPSEEK_API_KEY to the server environment.",
    };
  }

  const fingerprint = createHash("sha256").update(apiKey).digest("hex");
  if (
    deepSeekHealthCache
    && deepSeekHealthCache.fingerprint === fingerprint
    && deepSeekHealthCache.expiresAt > Date.now()
  ) {
    return deepSeekHealthCache.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  const checkedAt = new Date().toISOString();
  let value: DeepSeekProviderHealth;

  try {
    const response = await fetch("https://api.deepseek.com/user/balance", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    if (response.ok) {
      const payload = await response.json() as { is_available?: boolean };
      value = payload.is_available
        ? {
            status: "ready",
            available: true,
            checkedAt,
            message: "Credential and API balance are ready.",
          }
        : {
            status: "insufficient_balance",
            available: false,
            checkedAt,
            message: "Credential is valid, but the API account has no available balance.",
          };
    } else if (response.status === 401 || response.status === 403) {
      value = {
        status: "invalid_key",
        available: false,
        checkedAt,
        message: "DeepSeek rejected this API credential.",
      };
    } else if (response.status === 402) {
      value = {
        status: "insufficient_balance",
        available: false,
        checkedAt,
        message: "Credential is valid, but the API account has no available balance.",
      };
    } else {
      value = {
        status: "unreachable",
        available: false,
        checkedAt,
        message: `Balance check returned HTTP ${response.status}.`,
      };
    }
  } catch {
    value = {
      status: "unreachable",
      available: false,
      checkedAt,
      message: "DeepSeek availability could not be checked.",
    };
  } finally {
    clearTimeout(timeout);
  }

  deepSeekHealthCache = {
    fingerprint,
    expiresAt: Date.now() + 30_000,
    value,
  };
  return value;
}

async function loadRuntimeEnvironment(): Promise<Record<string, string | undefined>> {
  return readRuntimeEnvironment();
}

export function normalizeJobDefaults(value: unknown): JobDefaults {
  const source = isRecord(value) ? value : {};
  return {
    executionMode: source.executionMode === "worker" ? "worker" : "local",
    workerPool: normalizeIdentifier(source.workerPool, DEFAULTS.workerPool),
    workerRetries: clampInteger(source.workerRetries, 0, 5, DEFAULTS.workerRetries),
    workflowId: normalizeString(source.workflowId, DEFAULTS.workflowId),
    focusPolicy: normalizeFocusPolicy(source.focusPolicy),
    focusWorkers: clampInteger(source.focusWorkers, 1, 8, DEFAULTS.focusWorkers),
    maxFocusRounds: clampInteger(source.maxFocusRounds, 0, 12, DEFAULTS.maxFocusRounds),
    scanProfile: normalizeScanProfile(source.scanProfile),
    agent: normalizeAgent(source.agent),
    model: normalizeString(source.model, DEFAULTS.model),
    mergeAgent: normalizeAgent(source.mergeAgent ?? source.agent),
    mergeModel: normalizeString(source.mergeModel, normalizeString(source.model, DEFAULTS.mergeModel)),
    summaryAgent: normalizeAgent(source.summaryAgent),
    summaryModel: normalizeString(source.summaryModel, DEFAULTS.summaryModel),
    workers: clampInteger(source.workers, 1, 8, DEFAULTS.workers),
    maxRounds: clampInteger(source.maxRounds, 1, 12, DEFAULTS.maxRounds),
    convergeAfter: clampInteger(source.convergeAfter, 1, 6, DEFAULTS.convergeAfter),
    reasoningEffort: normalizeReasoningEffort(source.reasoningEffort),
    mergeMode: normalizeMergeMode(source.mergeMode),
    languageProfile: normalizeLanguageProfile(source.languageProfile),
    include: normalizeStringArray(source.include),
    exclude: normalizeStringArray(source.exclude),
    extensions: normalizeExtensions(source.extensions),
    uploadSizeMb: clampInteger(source.uploadSizeMb, 10, 1024, DEFAULTS.uploadSizeMb),
    taskTimeoutMinutes: clampInteger(source.taskTimeoutMinutes, 10, 480, DEFAULTS.taskTimeoutMinutes),
  };
}

function normalizeServerConfig(value: unknown): ServerConfig {
  const source = isRecord(value) ? value : {};
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    defaults: normalizeJobDefaults(source.defaults),
  };
}

function normalizeAgent(value: unknown): JobAgent {
  if (value === "claude" || value === "opencode" || value === "pi") {
    return value;
  }
  return value === "codex" ? "codex" : DEFAULTS.agent;
}

function normalizeScanProfile(value: unknown): ScanProfile {
  if (value === "preview" || value === "release") {
    return value;
  }
  return "deep";
}

function normalizeLanguageProfile(value: unknown): LanguageProfile {
  if (value === "solana-rust" || value === "generic") {
    return value;
  }
  return "solidity";
}

function normalizeMergeMode(value: unknown): MergeMode {
  return value === "manual" ? "manual" : "codex";
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return DEFAULTS.reasoningEffort;
}

function normalizeFocusPolicy(value: unknown): FocusPolicy {
  if (value === "off" || value === "auto") {
    return value;
  }
  return "suggest";
}

function normalizeExtensions(value: unknown) {
  return normalizeStringArray(value).map((item) => (item.startsWith(".") ? item : `.${item}`));
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeIdentifier(value: unknown, fallback: string) {
  const normalized = normalizeString(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
