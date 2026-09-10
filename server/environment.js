import { readFileSync } from "node:fs";
import path from "node:path";
import { AUDIT_ROOT } from "./platform";
let cachedEnvironment = null;
export function readRuntimeEnvironment() {
    if (cachedEnvironment) {
        return { ...cachedEnvironment, ...process.env };
    }
    const configuredPath = process.env.AUDITHOUND_ENV_FILE?.trim();
    const envPath = configuredPath
        ? path.resolve(AUDIT_ROOT, configuredPath)
        : path.join(AUDIT_ROOT, ".env");
    const environment = {};
    try {
        const contents = readFileSync(envPath, "utf-8");
        for (const line of contents.split(/\r?\n/)) {
            const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (match) {
                environment[match[1]] = parseEnvironmentValue(match[2]);
            }
        }
    }
    catch { }
    cachedEnvironment = environment;
    return { ...environment, ...process.env };
}
export function runtimeEnvironmentValue(key) {
    return readRuntimeEnvironment()[key]?.trim() ?? "";
}
function parseEnvironmentValue(rawValue) {
    const value = rawValue.trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
        return value.slice(1, -1);
    }
    return value.replace(/\s+#.*$/, "").trim();
}
