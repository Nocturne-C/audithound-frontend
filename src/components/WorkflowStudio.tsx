import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Download,
  GitBranch,
  History,
  LayoutGrid,
  LockKeyhole,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";

import {
  cloneWorkflow,
  deleteWorkflow,
  fetchWorkflow,
  fetchWorkflowVersions,
  fetchWorkflows,
  restoreWorkflowVersion,
  saveWorkflow,
  validateWorkflow,
} from "../lib/api";
import type {
  WorkflowCatalogItem,
  WorkflowDefinition,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
  WorkflowNodePosition,
  WorkflowValidationResult,
  WorkflowVersionSummary,
} from "../types";
import { WORKFLOW_NODE_KINDS } from "../../shared/workflow";
import { EmptyBlock } from "./Common";
import { WorkflowGraphCanvas, WORKFLOW_KIND_COPY } from "./WorkflowGraphCanvas";

type WorkflowStudioProps = {
  onNotify: (message: string, type?: "success" | "error" | "info") => void;
};

export const WorkflowStudio = React.memo(function WorkflowStudio({ onNotify }: WorkflowStudioProps) {
  const [catalog, setCatalog] = useState<WorkflowCatalogItem[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [versions, setVersions] = useState<WorkflowVersionSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [, setHistoryRevision] = useState(0);
  const undoStackRef = useRef<WorkflowDefinition[]>([]);
  const redoStackRef = useRef<WorkflowDefinition[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);

  const resetEditHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setHistoryRevision((current) => current + 1);
  }, []);

  const refreshCatalog = useCallback(async (preferredId?: string) => {
    const workflows = await fetchWorkflows();
    setCatalog(workflows);
    setSelectedWorkflowId((current) => {
      const candidate = preferredId ?? current;
      return candidate && workflows.some((item) => item.id === candidate) ? candidate : workflows[0]?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void refreshCatalog()
      .catch((error) => onNotify(error instanceof Error ? error.message : "Unable to load workflows.", "error"))
      .finally(() => setLoading(false));
  }, [onNotify, refreshCatalog]);

  useEffect(() => {
    if (!selectedWorkflowId) {
      setWorkflow(null);
      return;
    }
    void fetchWorkflow(selectedWorkflowId)
      .then((loaded) => {
        setWorkflow(loaded);
        setSelectedNodeId(loaded.nodes[0]?.id ?? null);
        setValidation(null);
        setDirty(false);
        setConnectingFrom(null);
        setHistoryOpen(false);
        setVersions([]);
        resetEditHistory();
      })
      .catch((error) => onNotify(error instanceof Error ? error.message : "Unable to open workflow.", "error"));
  }, [onNotify, resetEditHistory, selectedWorkflowId]);

  const selectedNode = useMemo(
    () => workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, workflow],
  );

  const orderedNodes = useMemo(
    () => [...(workflow?.nodes ?? [])].sort((left, right) => left.position.column - right.position.column || left.position.row - right.position.row),
    [workflow],
  );

  const updateWorkflow = useCallback((updater: (current: WorkflowDefinition) => WorkflowDefinition) => {
    if (!workflow) {
      return;
    }
    const next = updater(workflow);
    if (next === workflow) {
      return;
    }
    undoStackRef.current = [...undoStackRef.current.slice(-49), workflow];
    redoStackRef.current = [];
    setWorkflow(next);
    setDirty(true);
    setValidation(null);
    setHistoryRevision((current) => current + 1);
  }, [workflow]);

  const updateSelectedNode = useCallback(
    (patch: Partial<WorkflowNodeDefinition>) => {
      if (!selectedNodeId) {
        return;
      }
      updateWorkflow((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === selectedNodeId ? { ...node, ...patch } : node)),
      }));
    },
    [selectedNodeId, updateWorkflow],
  );

  const handleValidate = useCallback(async () => {
    if (!workflow) {
      return;
    }
    const result = await validateWorkflow(workflow);
    setValidation(result);
    onNotify(result.valid ? "Workflow contract is valid." : "Workflow contract needs attention.", result.valid ? "success" : "error");
  }, [onNotify, workflow]);

  const handleClone = useCallback(async () => {
    if (!workflow) {
      return;
    }
    const cloned = await cloneWorkflow(workflow.id);
    await refreshCatalog(cloned.id);
    onNotify("Created an editable workflow copy.");
  }, [onNotify, refreshCatalog, workflow]);

  const loadVersions = useCallback(async (workflowId: string) => {
    const loaded = await fetchWorkflowVersions(workflowId);
    setVersions(loaded);
    return loaded;
  }, []);

  const handleSave = useCallback(async () => {
    if (!workflow || workflow.builtIn) {
      return;
    }
    setSaving(true);
    try {
      const result = await validateWorkflow(workflow);
      setValidation(result);
      if (!result.valid) {
        onNotify("Resolve workflow validation errors before saving.", "error");
        return;
      }
      const saved = await saveWorkflow(workflow);
      setWorkflow(saved);
      setDirty(false);
      resetEditHistory();
      await refreshCatalog(saved.id);
      await loadVersions(saved.id);
      onNotify("Workflow version saved.");
    } finally {
      setSaving(false);
    }
  }, [loadVersions, onNotify, refreshCatalog, resetEditHistory, workflow]);

  const handleDelete = useCallback(async () => {
    if (!workflow || workflow.builtIn) {
      return;
    }
    await deleteWorkflow(workflow.id);
    await refreshCatalog();
    onNotify("Workflow deleted.", "info");
  }, [onNotify, refreshCatalog, workflow]);

  const handleExport = useCallback(() => {
    if (!workflow) {
      return;
    }
    const blob = new Blob([`${JSON.stringify(workflow, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workflow.id}.workflow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    onNotify("Workflow JSON exported.");
  }, [onNotify, workflow]);

  const handleImport = useCallback(
    async (file: File) => {
      const imported = JSON.parse(await file.text()) as WorkflowDefinition;
      const sourceId = typeof imported.id === "string" ? imported.id : "imported-workflow";
      const safeId = `${sourceId.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase()}-${Date.now().toString(36)}`;
      const draft: WorkflowDefinition = {
        ...imported,
        id: safeId,
        name: imported.name ? `${imported.name} Imported` : "Imported Workflow",
        builtIn: false,
        executable: false,
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      const result = await validateWorkflow(draft);
      setValidation(result);
      if (!result.valid) {
        setWorkflow(draft);
        setSelectedWorkflowId(null);
        setSelectedNodeId(draft.nodes[0]?.id ?? null);
        setDirty(true);
        resetEditHistory();
        onNotify("Imported as an unsaved draft with validation errors.", "error");
        return;
      }
      const saved = await saveWorkflow(draft);
      await refreshCatalog(saved.id);
      onNotify("Workflow imported and saved.");
    },
    [onNotify, refreshCatalog, resetEditHistory],
  );

  const addNode = useCallback((kind: WorkflowNodeKind = "investigate", requestedPosition?: WorkflowNodePosition) => {
    if (!workflow || workflow.builtIn) {
      return;
    }
    const position = requestedPosition ?? {
      column: (orderedNodes[orderedNodes.length - 1]?.position.column ?? -1) + 1,
      row: 0,
    };
    const baseId = `${kind}-stage`;
    let suffix = workflow.nodes.filter((node) => node.kind === kind).length + 1;
    let nodeId = `${baseId}-${suffix}`;
    while (workflow.nodes.some((node) => node.id === nodeId)) {
      suffix += 1;
      nodeId = `${baseId}-${suffix}`;
    }
    const closestUpstream = [...workflow.nodes]
      .filter((node) => node.position.column < position.column)
      .sort((left, right) => (
        right.position.column - left.position.column ||
        Math.abs(left.position.row - position.row) - Math.abs(right.position.row - position.row)
      ))[0];
    const node = createNodeTemplate(kind, nodeId, position, closestUpstream?.id);
    updateWorkflow((current) => ({ ...current, executable: false, nodes: [...current.nodes, node] }));
    setSelectedNodeId(nodeId);
  }, [orderedNodes, updateWorkflow, workflow]);

  const removeNode = useCallback(() => {
    if (!workflow || workflow.builtIn || !selectedNodeId) {
      return;
    }
    updateWorkflow((current) => ({
      ...current,
      executable: false,
      nodes: current.nodes
        .filter((node) => node.id !== selectedNodeId)
        .map((node) => ({ ...node, dependsOn: node.dependsOn.filter((dependency) => dependency !== selectedNodeId) })),
    }));
    setSelectedNodeId(workflow.nodes.find((node) => node.id !== selectedNodeId)?.id ?? null);
  }, [selectedNodeId, updateWorkflow, workflow]);

  const moveNode = useCallback((nodeId: string, position: WorkflowNodePosition) => {
    updateWorkflow((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, position } : node),
    }));
  }, [updateWorkflow]);

  const connectNodes = useCallback((sourceNodeId: string, targetNodeId: string) => {
    if (!workflow || sourceNodeId === targetNodeId) {
      return;
    }
    if (dependsOnTransitively(workflow, sourceNodeId, targetNodeId)) {
      onNotify("That connection would create a dependency cycle.", "error");
      return;
    }
    updateWorkflow((current) => ({
      ...current,
      executable: false,
      nodes: current.nodes.map((node) => node.id === targetNodeId && !node.dependsOn.includes(sourceNodeId)
        ? { ...node, dependsOn: [...node.dependsOn, sourceNodeId] }
        : node),
    }));
  }, [onNotify, updateWorkflow, workflow]);

  const toggleDependency = useCallback((dependencyId: string) => {
    if (!selectedNode) {
      return;
    }
    if (!selectedNode.dependsOn.includes(dependencyId) && workflow && dependsOnTransitively(workflow, dependencyId, selectedNode.id)) {
      onNotify("That dependency would create a cycle.", "error");
      return;
    }
    updateSelectedNode({
      dependsOn: selectedNode.dependsOn.includes(dependencyId)
        ? selectedNode.dependsOn.filter((item) => item !== dependencyId)
        : [...selectedNode.dependsOn, dependencyId],
    });
  }, [onNotify, selectedNode, updateSelectedNode, workflow]);

  const autoLayout = useCallback(() => {
    updateWorkflow((current) => ({
      ...current,
      nodes: layoutWorkflowNodes(current.nodes),
    }));
  }, [updateWorkflow]);

  const undo = useCallback(() => {
    if (!workflow) {
      return;
    }
    const previous = undoStackRef.current.pop();
    if (!previous) {
      return;
    }
    redoStackRef.current.push(workflow);
    setWorkflow(previous);
    setSelectedNodeId((current) => previous.nodes.some((node) => node.id === current) ? current : previous.nodes[0]?.id ?? null);
    setDirty(true);
    setValidation(null);
    setHistoryRevision((current) => current + 1);
  }, [workflow]);

  const redo = useCallback(() => {
    if (!workflow) {
      return;
    }
    const next = redoStackRef.current.pop();
    if (!next) {
      return;
    }
    undoStackRef.current.push(workflow);
    setWorkflow(next);
    setSelectedNodeId((current) => next.nodes.some((node) => node.id === current) ? current : next.nodes[0]?.id ?? null);
    setDirty(true);
    setValidation(null);
    setHistoryRevision((current) => current + 1);
  }, [workflow]);

  const toggleHistory = useCallback(async () => {
    if (!workflow) {
      return;
    }
    if (!historyOpen || versions.length === 0) {
      await loadVersions(workflow.id);
    }
    setHistoryOpen((current) => !current);
  }, [historyOpen, loadVersions, versions.length, workflow]);

  const handleRestoreVersion = useCallback(async (version: number) => {
    if (!workflow || workflow.builtIn) {
      return;
    }
    const restored = await restoreWorkflowVersion(workflow.id, version);
    setWorkflow(restored);
    setSelectedNodeId(restored.nodes[0]?.id ?? null);
    setDirty(false);
    setValidation(null);
    resetEditHistory();
    await Promise.all([refreshCatalog(restored.id), loadVersions(restored.id)]);
    onNotify(`Restored v${version} as v${restored.version}.`);
  }, [loadVersions, onNotify, refreshCatalog, resetEditHistory, workflow]);

  if (loading) {
    return (
      <div className="product-view">
        <EmptyBlock icon={<GitBranch size={18} />} title="Loading workflow contracts" body="Indexing built-in and operator-defined review graphs." />
      </div>
    );
  }

  return (
    <div className="workflow-studio product-view">
      <header className="product-header">
        <div>
          <div className="eyebrow">Workflow Studio</div>
          <h2>Keep the general loop intact. Insert focus only when evidence asks for it.</h2>
          <p>Adaptive focus is a conditional branch after merged results, not a competing scan mode or a predefined vulnerability checklist.</p>
        </div>
        <div className="product-actions">
          <input
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImport(file).catch((error) =>
                  onNotify(error instanceof Error ? error.message : "Unable to import workflow.", "error"),
                );
              }
              event.target.value = "";
            }}
            ref={importInputRef}
            type="file"
          />
          <button className="button secondary" onClick={() => importInputRef.current?.click()} type="button">
            <Upload size={14} />
            Import
          </button>
          <button className="button secondary" disabled={!workflow} onClick={handleExport} type="button">
            <Download size={14} />
            Export
          </button>
          <button className="button secondary" disabled={!workflow} onClick={() => void handleValidate()} type="button">
            <Check size={14} />
            Validate
          </button>
          <div className="workflow-history-anchor">
            <button className="button secondary" disabled={!workflow} onClick={() => void toggleHistory()} type="button">
              <History size={14} />
              Versions
            </button>
            {historyOpen && workflow && (
              <div className="workflow-version-popover">
                <div className="workflow-version-heading">
                  <div>
                    <strong>Version history</strong>
                    <span>Restores create a new immutable version.</span>
                  </div>
                  <button className="icon-button" onClick={() => setHistoryOpen(false)} type="button">
                    <X size={13} />
                  </button>
                </div>
                <div className="workflow-version-list">
                  {versions.map((version) => (
                    <div className={`workflow-version-row ${version.current ? "is-current" : ""}`} key={version.version}>
                      <div>
                        <strong>v{version.version}</strong>
                        <span>{version.nodeCount} stages · {new Date(version.updatedAt).toLocaleString()}</span>
                      </div>
                      {version.current ? (
                        <span className="contract-badge">Current</span>
                      ) : (
                        <button
                          className="button tertiary compact"
                          disabled={!version.restorable}
                          onClick={() => void handleRestoreVersion(version.version).catch((error) =>
                            onNotify(error instanceof Error ? error.message : "Unable to restore workflow.", "error"),
                          )}
                          type="button"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {workflow?.builtIn ? (
            <button className="button primary" onClick={() => void handleClone()} type="button">
              <Copy size={14} />
              Create editable copy
            </button>
          ) : (
            <button className="button primary" disabled={!dirty || saving} onClick={() => void handleSave()} type="button">
              <Save size={14} />
              {saving ? "Saving…" : "Save version"}
            </button>
          )}
        </div>
      </header>

      <div className="workflow-studio-layout">
        <aside className="workflow-catalog">
          <div className="section-label">Review contracts</div>
          <div className="workflow-catalog-list">
            {catalog.map((item) => (
              <button
                className={`workflow-catalog-item ${item.id === selectedWorkflowId ? "is-active" : ""}`}
                key={item.id}
                onClick={() => setSelectedWorkflowId(item.id)}
                type="button"
              >
                <span className="workflow-catalog-icon">{item.builtIn ? <LockKeyhole size={13} /> : <GitBranch size={13} />}</span>
                <span>
                  <strong>{item.name}</strong>
                  <small>
                    {item.tags.includes("legacy")
                      ? "Legacy focused-only"
                      : item.hasAdaptiveFocus
                        ? "General loop + adaptive focus"
                        : item.workerScope === "full"
                          ? "Full-scope workers"
                          : "Mapped-item fan-out"} · v{item.version}
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
            ))}
          </div>
          <div className="workflow-catalog-note">
            <CircleDot size={13} />
            <span>Built-in contracts are immutable. Clone before changing execution semantics.</span>
          </div>
        </aside>

        <section className="workflow-canvas">
          {workflow && (
            <>
              <div className="workflow-canvas-header">
                <div>
                  {workflow.builtIn ? <span className="contract-badge is-locked">Built-in</span> : <span className="contract-badge">Custom draft</span>}
                  <input
                    className="workflow-title-input"
                    disabled={workflow.builtIn}
                    onChange={(event) => updateWorkflow((current) => ({ ...current, name: event.target.value }))}
                    value={workflow.name}
                  />
                  <textarea
                    className="workflow-description-input"
                    disabled={workflow.builtIn}
                    onChange={(event) => updateWorkflow((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    value={workflow.description}
                  />
                </div>
                {!workflow.builtIn && (
                  <div className="workflow-canvas-actions">
                    <button className="icon-button" onClick={() => addNode()} title="Add general audit stage" type="button">
                      <Plus size={15} />
                    </button>
                    <button className="icon-button danger" onClick={() => void handleDelete()} title="Delete workflow" type="button">
                      <Trash2 size={15} />
                    </button>
                  </div>
                )}
              </div>

              <div className="workflow-builder-toolbar">
                <div className="workflow-node-palette" aria-label="Workflow stage palette">
                  {WORKFLOW_NODE_KINDS.map((kind) => (
                    <button
                      className={`workflow-palette-item is-${kind}`}
                      disabled={workflow.builtIn}
                      draggable={!workflow.builtIn}
                      key={kind}
                      onClick={() => addNode(kind)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData("application/x-audithound-workflow-kind", kind);
                      }}
                      title={WORKFLOW_KIND_COPY[kind].detail}
                      type="button"
                    >
                      <Plus size={10} />
                      {WORKFLOW_KIND_COPY[kind].label}
                    </button>
                  ))}
                </div>
                <div className="workflow-builder-actions">
                  {connectingFrom && (
                    <button className="workflow-connection-state" onClick={() => setConnectingFrom(null)} type="button">
                      <span />
                      Choose a destination
                      <X size={11} />
                    </button>
                  )}
                  <button
                    className="icon-button"
                    disabled={workflow.builtIn}
                    onClick={autoLayout}
                    title="Auto layout"
                    type="button"
                  >
                    <LayoutGrid size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={workflow.builtIn || undoStackRef.current.length === 0}
                    onClick={undo}
                    title="Undo"
                    type="button"
                  >
                    <Undo2 size={14} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={workflow.builtIn || redoStackRef.current.length === 0}
                    onClick={redo}
                    title="Redo"
                    type="button"
                  >
                    <Redo2 size={14} />
                  </button>
                </div>
              </div>

              <WorkflowGraphCanvas
                connectingFrom={connectingFrom}
                onAddNode={addNode}
                onConnect={connectNodes}
                onConnectingChange={setConnectingFrom}
                onMoveNode={moveNode}
                onSelectNode={setSelectedNodeId}
                selectedNodeId={selectedNodeId}
                workflow={workflow}
              />

              {validation && (
                <div className={`workflow-validation ${validation.valid ? "is-valid" : "is-invalid"}`}>
                  <div className="workflow-validation-title">
                    {validation.valid ? <Check size={14} /> : <AlertTriangle size={14} />}
                    <strong>{validation.valid ? "Contract is valid" : "Contract needs attention"}</strong>
                  </div>
                  {validation.issues.length > 0 ? (
                    validation.issues.map((issue, index) => (
                      <button
                        key={`${issue.nodeId ?? "workflow"}-${index}`}
                        onClick={() => issue.nodeId && setSelectedNodeId(issue.nodeId)}
                        type="button"
                      >
                        <span className={`issue-dot is-${issue.level}`} />
                        {issue.message}
                      </button>
                    ))
                  ) : (
                    <span>Dependencies are acyclic and all required contracts are present.</span>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="workflow-inspector">
          {selectedNode && workflow ? (
            <>
              <div className="workflow-inspector-header">
                <div>
                  <div className="eyebrow">Stage contract</div>
                  <strong>{selectedNode.title}</strong>
                </div>
                {!workflow.builtIn && (
                  <button className="icon-button danger" onClick={removeNode} title="Remove stage" type="button">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              <div className="workflow-inspector-body">
                <label className="field">
                  <span className="field-label">Title</span>
                  <div className="field-input">
                    <input
                      disabled={workflow.builtIn}
                      onChange={(event) => updateSelectedNode({ title: event.target.value })}
                      value={selectedNode.title}
                    />
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">Stage type</span>
                  <div className="field-input field-select">
                    <select
                      disabled={workflow.builtIn}
                      onChange={(event) => updateSelectedNode({ kind: event.target.value as WorkflowNodeKind })}
                      value={selectedNode.kind}
                    >
                      {WORKFLOW_NODE_KINDS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">Description</span>
                  <div className="field-textarea">
                    <textarea
                      disabled={workflow.builtIn}
                      onChange={(event) => updateSelectedNode({ description: event.target.value })}
                      rows={4}
                      value={selectedNode.description}
                    />
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">Prompt contract</span>
                  <div className="field-textarea">
                    <textarea
                      disabled={workflow.builtIn}
                      onChange={(event) => updateSelectedNode({ prompt: event.target.value })}
                      placeholder="No model prompt for deterministic stages."
                      rows={8}
                      value={selectedNode.prompt}
                    />
                  </div>
                </label>
                <div className="workflow-inspector-grid">
                  <label className="field">
                    <span className="field-label">Input</span>
                    <div className="field-input field-select">
                      <select
                        disabled={workflow.builtIn}
                        onChange={(event) => updateSelectedNode({ inputMode: event.target.value as WorkflowNodeDefinition["inputMode"] })}
                        value={selectedNode.inputMode}
                      >
                        <option value="scope">Complete audit scope</option>
                        <option value="each">{selectedNode.kind === "focus" ? "Each focus request" : "Each mapped item"}</option>
                        <option value="all">All upstream items</option>
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Concurrency</span>
                    <div className="field-input">
                      <input
                        disabled={workflow.builtIn}
                        max={32}
                        min={1}
                        onChange={(event) => updateSelectedNode({ concurrency: Number(event.target.value) })}
                        type="number"
                        value={selectedNode.concurrency}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Repeat</span>
                    <div className="field-input">
                      <input
                        disabled={workflow.builtIn}
                        max={8}
                        min={1}
                        onChange={(event) => updateSelectedNode({ repeat: Number(event.target.value) })}
                        type="number"
                        value={selectedNode.repeat}
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Reasoning</span>
                    <div className="field-input field-select">
                      <select
                        disabled={workflow.builtIn}
                        onChange={(event) =>
                          updateSelectedNode({
                            reasoningEffort: event.target.value
                              ? event.target.value as WorkflowNodeDefinition["reasoningEffort"]
                              : null,
                          })
                        }
                        value={selectedNode.reasoningEffort ?? ""}
                      >
                        <option value="">Deterministic</option>
                        <option value="minimal">Minimal</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="xhigh">XHigh</option>
                      </select>
                    </div>
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Dependencies</span>
                  <div className="workflow-dependency-picker">
                    {workflow.nodes.filter((node) => node.id !== selectedNode.id).map((node) => {
                      const active = selectedNode.dependsOn.includes(node.id);
                      return (
                        <button
                          className={active ? "is-active" : ""}
                          disabled={workflow.builtIn}
                          key={node.id}
                          onClick={() => toggleDependency(node.id)}
                          type="button"
                        >
                          <span className={`dependency-mark is-${node.kind}`} />
                          <span>
                            <strong>{node.title}</strong>
                            <small>{active ? "Upstream dependency" : WORKFLOW_KIND_COPY[node.kind].label}</small>
                          </span>
                          {active && <Check size={12} />}
                        </button>
                      );
                    })}
                  </div>
                </label>
                <label className="field">
                  <span className="field-label">Output contract</span>
                  <div className="field-input">
                    <input
                      disabled={workflow.builtIn}
                      onChange={(event) => updateSelectedNode({ outputContract: event.target.value })}
                      value={selectedNode.outputContract}
                    />
                  </div>
                </label>
                <label className="workflow-human-gate">
                  <input
                    checked={selectedNode.requiresHumanGate}
                    disabled={workflow.builtIn}
                    onChange={(event) => updateSelectedNode({ requiresHumanGate: event.target.checked })}
                    type="checkbox"
                  />
                  <span>
                    <strong>Require human evidence gate</strong>
                    <small>Execution pauses until a reviewer records a decision.</small>
                  </span>
                </label>
              </div>
            </>
          ) : (
            <EmptyBlock icon={<GitBranch size={18} />} title="Select a stage" body="Inspect its execution and evidence contract." />
          )}
        </aside>
      </div>
    </div>
  );
});

function createNodeTemplate(
  kind: WorkflowNodeKind,
  id: string,
  position: WorkflowNodePosition,
  upstreamId?: string,
): WorkflowNodeDefinition {
  const common = {
    id,
    kind,
    dependsOn: upstreamId ? [upstreamId] : [],
    model: null,
    repeat: 1,
    postProcessors: [] as string[],
    position,
  };

  switch (kind) {
    case "scope":
      return {
        ...common,
        title: "Scope contract",
        description: "Freeze target identity, source boundaries, exclusions, and runtime configuration.",
        inputMode: "scope",
        prompt: "",
        reasoningEffort: null,
        concurrency: 1,
        requiresHumanGate: false,
        outputContract: "scope.v2",
      };
    case "map":
      return {
        ...common,
        title: "Source context",
        description: "Record the source inventory without ranking files or prescribing what workers must find.",
        inputMode: "scope",
        prompt: "Record in-scope files and declarations as navigation context only.",
        reasoningEffort: null,
        concurrency: 1,
        requiresHumanGate: false,
        outputContract: "source-context.v1",
      };
    case "investigate":
      return {
        ...common,
        title: "Independent general audit",
        description: "Give isolated workers the complete scope for independent evidence discovery.",
        inputMode: "scope",
        prompt: "",
        reasoningEffort: "high",
        concurrency: 4,
        requiresHumanGate: false,
        outputContract: "finding-candidate.v2",
      };
    case "focus":
      return {
        ...common,
        title: "Adaptive focus",
        description: "Insert narrow workers only when merged evidence or a reviewer asks for deeper work.",
        inputMode: "each",
        prompt: "Investigate only the assigned evidence-driven objective. Falsify it when unsupported.",
        reasoningEffort: "high",
        concurrency: 2,
        requiresHumanGate: false,
        outputContract: "focus-result.v1",
      };
    case "normalize":
      return {
        ...common,
        title: "Canonical candidates",
        description: "Consolidate overlapping findings and reconstruct useful source-supported signals.",
        inputMode: "all",
        prompt: "Normalize free-form audit reports into canonical findings while preserving plausible low-confidence signals.",
        reasoningEffort: "high",
        concurrency: 1,
        requiresHumanGate: false,
        outputContract: "canonical-finding.v2",
      };
    case "review":
      return {
        ...common,
        title: "Human review",
        description: "Require explicit reviewer decisions before findings enter formal delivery.",
        inputMode: "each",
        prompt: "",
        reasoningEffort: null,
        concurrency: 1,
        requiresHumanGate: true,
        outputContract: "review-decision.v2",
      };
    case "regression":
      return {
        ...common,
        title: "Regression baseline",
        description: "Compare stable root-cause fingerprints and evidence revisions across runs.",
        inputMode: "all",
        prompt: "",
        reasoningEffort: null,
        concurrency: 1,
        requiresHumanGate: false,
        outputContract: "regression-diff.v2",
      };
    case "report":
      return {
        ...common,
        title: "Delivery package",
        description: "Generate reviewer-approved reports, exports, evidence links, and remediation handoff.",
        inputMode: "all",
        prompt: "",
        reasoningEffort: null,
        concurrency: 1,
        requiresHumanGate: false,
        outputContract: "delivery-package.v2",
      };
  }
}

function dependsOnTransitively(workflow: WorkflowDefinition, nodeId: string, targetId: string) {
  const dependencies = new Map(workflow.nodes.map((node) => [node.id, node.dependsOn]));
  const visited = new Set<string>();
  const visit = (currentId: string): boolean => {
    if (currentId === targetId) {
      return true;
    }
    if (visited.has(currentId)) {
      return false;
    }
    visited.add(currentId);
    return (dependencies.get(currentId) ?? []).some(visit);
  };
  return visit(nodeId);
}

function layoutWorkflowNodes(nodes: WorkflowNodeDefinition[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memo = new Map<string, number>();
  const depth = (nodeId: string, visiting = new Set<string>()): number => {
    const cached = memo.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(nodeId)) {
      return byId.get(nodeId)?.position.column ?? 0;
    }
    const node = byId.get(nodeId);
    if (!node || node.dependsOn.length === 0) {
      memo.set(nodeId, 0);
      return 0;
    }
    const nextVisiting = new Set(visiting).add(nodeId);
    const value = Math.max(0, ...node.dependsOn.map((dependencyId) => depth(dependencyId, nextVisiting) + 1));
    memo.set(nodeId, value);
    return value;
  };

  const columns = new Map<number, WorkflowNodeDefinition[]>();
  for (const node of nodes) {
    const column = depth(node.id);
    columns.set(column, [...(columns.get(column) ?? []), node]);
  }
  const positions = new Map<string, WorkflowNodePosition>();
  for (const [column, columnNodes] of columns) {
    columnNodes
      .sort((left, right) => left.position.row - right.position.row || left.title.localeCompare(right.title))
      .forEach((node, row) => positions.set(node.id, { column, row }));
  }
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
