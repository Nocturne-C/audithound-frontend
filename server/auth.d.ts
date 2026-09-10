import type { IncomingMessage, ServerResponse } from "node:http";
type AuthSummary = {
    enabled: boolean;
    mode: "none" | "basic";
    username: string | null;
};
export declare function getAuthSummary(): AuthSummary;
export declare function ensureAuthorized(req: IncomingMessage, res: ServerResponse): boolean;
export {};
