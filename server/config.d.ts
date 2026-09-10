import { getAuthSummary } from "./auth";
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
export declare function loadServerConfig(): Promise<ServerConfig>;
export declare function saveServerConfig(nextValue: unknown): Promise<ServerConfig>;
export declare function loadSystemConfigPayload(): Promise<SystemConfigPayload>;
export declare function normalizeJobDefaults(value: unknown): JobDefaults;
