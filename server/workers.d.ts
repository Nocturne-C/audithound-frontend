import type { IncomingMessage, ServerResponse } from "node:http";
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
export declare class WorkerRegistry {
    private readonly workers;
    private initPromise;
    listWorkers(): Promise<WorkerRecord[]>;
    getWorker(workerId: string): Promise<WorkerRecord>;
    register(input: unknown): Promise<WorkerRecord>;
    heartbeat(workerId: string, input: unknown): Promise<WorkerRecord>;
    forget(workerId: string): Promise<boolean>;
    private snapshot;
    private init;
    private initialize;
    private persist;
}
export declare function getWorkerRegistry(): WorkerRegistry;
export declare function ensureWorkerAuthorized(req: IncomingMessage, res: ServerResponse): boolean;
export declare function workerControlSummary(): {
    tokenConfigured: boolean;
    heartbeatSeconds: number;
    offlineAfterSeconds: number;
    leaseSeconds: number;
};
