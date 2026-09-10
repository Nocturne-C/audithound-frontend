import type { IncomingMessage, ServerResponse } from "node:http";
import { runtimeEnvironmentValue } from "./environment";

type AuthSummary = {
  enabled: boolean;
  mode: "none" | "basic";
  username: string | null;
};

const basicUser = runtimeEnvironmentValue("AUDITHOUND_BASIC_AUTH_USER");
const basicPass = runtimeEnvironmentValue("AUDITHOUND_BASIC_AUTH_PASS");
const authEnabled = basicUser.length > 0 && basicPass.length > 0;

export function getAuthSummary(): AuthSummary {
  return {
    enabled: authEnabled,
    mode: authEnabled ? "basic" : "none",
    username: authEnabled ? basicUser : null,
  };
}

export function ensureAuthorized(req: IncomingMessage, res: ServerResponse) {
  if (!authEnabled) {
    return true;
  }

  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) {
    challenge(res);
    return false;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : decoded;
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== basicUser || password !== basicPass) {
    challenge(res);
    return false;
  }

  return true;
}

function challenge(res: ServerResponse) {
  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Basic realm="AuditHound Studio", charset="UTF-8"');
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Authentication required" }));
}
