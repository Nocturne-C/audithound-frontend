import { promises as fs } from "node:fs";
import path from "node:path";

import {
  BUILT_IN_WORKFLOW_IDS,
  BUILT_IN_WORKFLOWS,
  WORKFLOW_NODE_KINDS,
  type WorkflowCatalogItem,
  type WorkflowDefinition,
  type WorkflowInputMode,
  type WorkflowNodeDefinition,
  type WorkflowNodeKind,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  type WorkflowVersionSummary,
} from "../shared/workflow";
import { WORKFLOWS_ROOT } from "./platform";

export async function listWorkflows(): Promise<WorkflowCatalogItem[]> {
  const workflows = [...BUILT_IN_WORKFLOWS, ...(await loadCustomWorkflows())];
  return workflows
    .map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      version: workflow.version,
      builtIn: workflow.builtIn,
      executable: workflow.executable,
      tags: workflow.tags,
      updatedAt: workflow.updatedAt,
      nodeCount: workflow.nodes.length,
      workerScope: workflow.nodes.find((node) => node.kind === "investigate")?.inputMode === "each"
        ? "mapped-items" as const
        : "full" as const,
      hasAdaptiveFocus: workflow.nodes.some((node) => node.kind === "focus"),
    }))
    .sort((left, right) => Number(right.builtIn) - Number(left.builtIn) || right.updatedAt.localeCompare(left.updatedAt));
}

export async function getWorkflow(workflowId: string): Promise<WorkflowDefinition | null> {
  const builtIn = BUILT_IN_WORKFLOWS.find((workflow) => workflow.id === workflowId);
  if (builtIn) {
    return builtIn;
  }
  const safeId = normalizeId(workflowId);
  if (!safeId) {
    return null;
  }
  try {
    const raw = JSON.parse(await fs.readFile(workflowPath(safeId), "utf-8"));
    return normalizeWorkflow(raw, safeId);
  } catch {
    return null;
  }
}

export async function saveWorkflow(workflowId: string, input: unknown): Promise<WorkflowDefinition> {
  const safeId = normalizeId(workflowId);
  if (!safeId || BUILT_IN_WORKFLOW_IDS.has(safeId)) {
    throw new Error("Built-in workflows cannot be overwritten.");
  }

  const current = await getWorkflow(safeId);
  const workflow = normalizeWorkflow(input, safeId, {
    version: Math.max(1, (current?.version ?? 0) + 1),
    updatedAt: new Date().toISOString(),
  });
  const validation = validateWorkflow(workflow);
  if (!validation.valid) {
    throw new Error(validation.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join(" "));
  }

  await fs.mkdir(WORKFLOWS_ROOT, { recursive: true });
  await persistWorkflow(workflow);
  return workflow;
}

export async function cloneWorkflow(workflowId: string): Promise<WorkflowDefinition> {
  const source = await getWorkflow(workflowId);
  if (!source) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const baseId = normalizeId(`${source.id}-copy`) || "workflow-copy";
  let cloneId = baseId;
  let suffix = 2;
  while (BUILT_IN_WORKFLOW_IDS.has(cloneId) || (await getWorkflow(cloneId))) {
    cloneId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const clone: WorkflowDefinition = {
    ...source,
    id: cloneId,
    name: `${source.name} Copy`,
    description: source.description,
    version: 1,
    builtIn: false,
    executable: true,
    tags: [...new Set([...source.tags.filter((tag) => tag !== "default"), "custom"])],
    updatedAt: new Date().toISOString(),
    nodes: source.nodes.map((node) => ({
      ...node,
      dependsOn: [...node.dependsOn],
      postProcessors: [...node.postProcessors],
      position: { ...node.position },
    })),
  };

  await fs.mkdir(WORKFLOWS_ROOT, { recursive: true });
  await persistWorkflow(clone);
  return clone;
}

export async function deleteWorkflow(workflowId: string) {
  const safeId = normalizeId(workflowId);
  if (!safeId || BUILT_IN_WORKFLOW_IDS.has(safeId)) {
    throw new Error("Built-in workflows cannot be deleted.");
  }
  await fs.rm(workflowPath(safeId), { force: true });
  await fs.rm(workflowVersionsPath(safeId), { recursive: true, force: true });
}

export async function listWorkflowVersions(workflowId: string): Promise<WorkflowVersionSummary[]> {
  const workflow = await getWorkflow(workflowId);
  if (!workflow) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  if (workflow.builtIn) {
    return [{
      workflowId: workflow.id,
      version: workflow.version,
      name: workflow.name,
      updatedAt: workflow.updatedAt,
      nodeCount: workflow.nodes.length,
      current: true,
      restorable: false,
    }];
  }

  const versions = new Map<number, WorkflowDefinition>();
  const entries = await fs.readdir(workflowVersionsPath(workflow.id), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = /^v(\d+)\.json$/.exec(entry.name);
    if (!match) {
      continue;
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(workflowVersionsPath(workflow.id), entry.name), "utf-8"));
      const version = normalizeWorkflow(raw, workflow.id);
      versions.set(version.version, version);
    } catch {}
  }
  versions.set(workflow.version, workflow);

  return [...versions.values()]
    .sort((left, right) => right.version - left.version)
    .map((version) => ({
      workflowId: workflow.id,
      version: version.version,
      name: version.name,
      updatedAt: version.updatedAt,
      nodeCount: version.nodes.length,
      current: version.version === workflow.version,
      restorable: version.version !== workflow.version,
    }));
}

export async function restoreWorkflowVersion(workflowId: string, version: number) {
  const safeId = normalizeId(workflowId);
  if (!safeId || BUILT_IN_WORKFLOW_IDS.has(safeId)) {
    throw new Error("Built-in workflows do not have restorable versions.");
  }
  const current = await getWorkflow(safeId);
  if (!current) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }
  const raw = JSON.parse(
    await fs.readFile(path.join(workflowVersionsPath(safeId), `v${version}.json`), "utf-8"),
  );
  const historical = normalizeWorkflow(raw, safeId);
  return saveWorkflow(safeId, {
    ...historical,
    id: safeId,
    name: historical.name,
    builtIn: false,
  });
}

export function validateWorkflow(input: unknown): WorkflowValidationResult {
  let workflow: WorkflowDefinition;
  try {
    workflow = normalizeWorkflow(input, isRecord(input) && typeof input.id === "string" ? input.id : "draft");
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          level: "error",
          nodeId: null,
          message: error instanceof Error ? error.message : "Workflow is invalid.",
        },
      ],
    };
  }

  const issues: WorkflowValidationIssue[] = [];
  const nodeIds = new Set<string>();
  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({ level: "error", nodeId: node.id, message: `Duplicate node id: ${node.id}.` });
    }
    nodeIds.add(node.id);
  }

  for (const node of workflow.nodes) {
    for (const dependencyId of node.dependsOn) {
      if (!nodeIds.has(dependencyId)) {
        issues.push({
          level: "error",
          nodeId: node.id,
          message: `${node.title} depends on missing node ${dependencyId}.`,
        });
      }
      if (dependencyId === node.id) {
        issues.push({ level: "error", nodeId: node.id, message: `${node.title} cannot depend on itself.` });
      }
    }
    if (node.inputMode === "each" && node.dependsOn.length === 0) {
      issues.push({
        level: "warning",
        nodeId: node.id,
        message: `${node.title} fans out per item but has no upstream producer.`,
      });
    }
    if (node.kind === "investigate" && node.inputMode === "all") {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `${node.title} must use complete scope or each mapped item.`,
      });
    }
    if (node.kind === "focus" && node.inputMode !== "each") {
      issues.push({
        level: "error",
        nodeId: node.id,
        message: `${node.title} must fan out over evidence-driven focus items.`,
      });
    }
    if (node.requiresHumanGate && node.kind !== "review") {
      issues.push({
        level: "warning",
        nodeId: node.id,
        message: `${node.title} uses a human gate outside a review node.`,
      });
    }
  }

  if (hasCycle(workflow.nodes)) {
    issues.push({ level: "error", nodeId: null, message: "Workflow contains a dependency cycle." });
  }
  const requiredKinds: WorkflowNodeKind[] = ["scope", "map", "investigate", "normalize", "review", "regression", "report"];
  for (const kind of requiredKinds) {
    if (!workflow.nodes.some((node) => node.kind === kind)) {
      issues.push({ level: "error", nodeId: null, message: `Executable workflows require a ${kind} node.` });
    }
  }

  return {
    valid: !issues.some((issue) => issue.level === "error"),
    issues,
  };
}

async function loadCustomWorkflows() {
  await fs.mkdir(WORKFLOWS_ROOT, { recursive: true });
  const entries = await fs.readdir(WORKFLOWS_ROOT, { withFileTypes: true });
  const workflows: WorkflowDefinition[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = JSON.parse(await fs.readFile(path.join(WORKFLOWS_ROOT, entry.name), "utf-8"));
      workflows.push(normalizeWorkflow(raw, entry.name.replace(/\.json$/i, "")));
    } catch {
      continue;
    }
  }
  return workflows;
}

function normalizeWorkflow(
  input: unknown,
  fallbackId: string,
  overrides?: { version?: number; updatedAt?: string },
): WorkflowDefinition {
  if (!isRecord(input)) {
    throw new Error("Workflow must be a JSON object.");
  }
  const id = normalizeId(typeof input.id === "string" ? input.id : fallbackId);
  if (!id) {
    throw new Error("Workflow id is required.");
  }
  const nodesRaw = Array.isArray(input.nodes) ? input.nodes : [];
  if (nodesRaw.length === 0) {
    throw new Error("Workflow must contain at least one node.");
  }

  return {
    schemaVersion: 1,
    id,
    name: readString(input.name, humanizeId(id)),
    description: readString(input.description, "Custom source-code review workflow."),
    version: overrides?.version ?? clampInteger(input.version, 1, 9999, 1),
    builtIn: BUILT_IN_WORKFLOW_IDS.has(id),
    executable: true,
    tags: readStringArray(input.tags),
    updatedAt: overrides?.updatedAt ?? readString(input.updatedAt, new Date().toISOString()),
    nodes: nodesRaw.map((node, index) => normalizeNode(node, index)),
  };
}

function normalizeNode(input: unknown, index: number): WorkflowNodeDefinition {
  if (!isRecord(input)) {
    throw new Error(`Workflow node ${index + 1} must be an object.`);
  }
  const id = normalizeId(typeof input.id === "string" ? input.id : `node-${index + 1}`);
  if (!id) {
    throw new Error(`Workflow node ${index + 1} requires an id.`);
  }
  const kind = normalizeKind(input.kind);
  return {
    id,
    kind,
    title: readString(input.title, humanizeId(id)),
    description: readString(input.description, ""),
    dependsOn: readStringArray(input.dependsOn).map(normalizeId).filter(Boolean),
    inputMode: normalizeInputMode(input.inputMode),
    prompt: readString(input.prompt, ""),
    model: readNullableString(input.model),
    reasoningEffort: normalizeReasoningEffort(input.reasoningEffort),
    concurrency: clampInteger(input.concurrency, 1, 32, 1),
    repeat: clampInteger(input.repeat, 1, 8, 1),
    requiresHumanGate: input.requiresHumanGate === true,
    outputContract: readString(input.outputContract, `${kind}.v1`),
    postProcessors: readStringArray(input.postProcessors),
    position: normalizePosition(input.position, index),
  };
}

function hasCycle(nodes: WorkflowNodeDefinition[]) {
  const dependencies = new Map(nodes.map((node) => [node.id, node.dependsOn]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const dependencyId of dependencies.get(nodeId) ?? []) {
      if (dependencies.has(dependencyId) && visit(dependencyId)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  return nodes.some((node) => visit(node.id));
}

function workflowPath(workflowId: string) {
  return path.join(WORKFLOWS_ROOT, `${workflowId}.json`);
}

function workflowVersionsPath(workflowId: string) {
  return path.join(WORKFLOWS_ROOT, `${workflowId}.versions`);
}

async function persistWorkflow(workflow: WorkflowDefinition) {
  const currentPath = workflowPath(workflow.id);
  const versionDirectory = workflowVersionsPath(workflow.id);
  await fs.mkdir(versionDirectory, { recursive: true });
  await Promise.all([
    writeJsonAtomic(currentPath, workflow),
    writeJsonAtomic(path.join(versionDirectory, `v${workflow.version}.json`), workflow),
  ]);
}

async function writeJsonAtomic(filePath: string, payload: unknown) {
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  await fs.rename(temporary, filePath);
}

function normalizeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function humanizeId(value: string) {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeKind(value: unknown): WorkflowNodeKind {
  return WORKFLOW_NODE_KINDS.includes(value as WorkflowNodeKind) ? (value as WorkflowNodeKind) : "investigate";
}

function normalizeInputMode(value: unknown): WorkflowInputMode {
  if (value === "each" || value === "all") {
    return value;
  }
  return "scope";
}

function normalizeReasoningEffort(value: unknown): WorkflowNodeDefinition["reasoningEffort"] {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return null;
}

function normalizePosition(value: unknown, index: number) {
  const source = isRecord(value) ? value : {};
  return {
    column: clampInteger(source.column, 0, 99, index),
    row: clampInteger(source.row, 0, 99, 0),
  };
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
