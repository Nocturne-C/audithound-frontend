import React, { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Braces,
  ChevronDown,
  Cpu,
  FileArchive,
  Gauge,
  Github,
  LoaderCircle,
  PackageCheck,
  Radar,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  Sparkles,
} from "lucide-react";

import type { GithubJobRequest, JobDefaults, SystemConfigPayload, WorkflowCatalogItem } from "../types";
import { fetchWorkflows } from "../lib/api";
import { EmptyBlock } from "./Common";

interface SubmitRunViewProps {
  configPayload: SystemConfigPayload | null;
  loading: boolean;
  submitting: boolean;
  onSubmitGithub: (payload: GithubJobRequest) => Promise<void>;
  onSubmitUpload: (payload: FormData) => Promise<void>;
}

type SourceMode = "github" | "upload";

type DraftState = {
  sourceMode: SourceMode;
  executionMode: JobDefaults["executionMode"];
  workerPool: string;
  workerRetries: number;
  name: string;
  projectId: string;
  engagementId: string;
  repoUrl: string;
  ref: string;
  archive: File | null;
  workflowId: string;
  focusPolicy: JobDefaults["focusPolicy"];
  focusWorkers: number;
  maxFocusRounds: number;
  scanProfile: JobDefaults["scanProfile"];
  model: string;
  mergeModel: string;
  summaryModel: string;
  agent: JobDefaults["agent"];
  mergeAgent: JobDefaults["mergeAgent"];
  summaryAgent: JobDefaults["summaryAgent"];
  workers: number;
  maxRounds: number;
  convergeAfter: number;
  reasoningEffort: JobDefaults["reasoningEffort"];
  mergeMode: JobDefaults["mergeMode"];
  languageProfile: JobDefaults["languageProfile"];
  include: string;
  exclude: string;
  extensions: string;
  taskTimeoutMinutes: number;
};

export const SubmitRunView = React.memo(function SubmitRunView({
  configPayload,
  loading,
  submitting,
  onSubmitGithub,
  onSubmitUpload,
}: SubmitRunViewProps) {
  const [draft, setDraft] = useState<DraftState>(() => createDraft(null));
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowCatalogItem[]>([]);

  useEffect(() => {
    setDraft(createDraft(configPayload));
  }, [configPayload?.config.updatedAt]);

  useEffect(() => {
    void fetchWorkflows()
      .then(setWorkflows)
      .catch(() => setWorkflows([]));
  }, []);

  const selectableWorkflows = useMemo(
    () => workflows.filter((workflow) => !workflow.tags.includes("legacy")),
    [workflows],
  );
  const deepseekRequired = draft.executionMode === "local" && requiresDeepSeek(draft);
  const deepseekStatus = configPayload?.providerHealth?.deepseek.status
    ?? (configPayload?.providers.deepseek ? "unreachable" : "unconfigured");
  const deepseekBlocker = deepseekRequired ? getDeepSeekBlocker(deepseekStatus) : null;
  const deepseekNotice = deepseekRequired ? getDeepSeekNotice(deepseekStatus) : null;
  const deepseekSummary = configPayload ? summarizeDeepSeekProvider(configPayload) : null;
  const selectedProviderReady = deepseekRequired ? Boolean(deepseekSummary?.ready) : true;
  const selectedWorkflow = selectableWorkflows.find((workflow) => workflow.id === draft.workflowId);
  const sourceReady = draft.sourceMode === "github" ? Boolean(draft.repoUrl.trim()) : Boolean(draft.archive);
  const focusSummary = draft.focusPolicy === "off"
    ? "General loop only"
    : draft.focusPolicy === "auto"
      ? `Auto-insert · ${draft.focusWorkers} workers`
      : `Reviewer gate · ${draft.focusWorkers} workers`;

  const selectAgent = (agent: JobDefaults["agent"]) => {
    const model = defaultModelForAgent(agent);
    setDraft((current) => ({
      ...current,
      agent,
      model,
      mergeAgent: agent,
      mergeModel: model,
      summaryAgent: agent,
      summaryModel: model,
      reasoningEffort: "xhigh",
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (deepseekBlocker) {
        throw new Error(deepseekBlocker);
      }
      if (draft.sourceMode === "github") {
        if (!draft.repoUrl.trim()) {
          throw new Error("GitHub repository URL is required.");
        }
        await onSubmitGithub({
          sourceType: "github",
          name: draft.name.trim() || undefined,
          projectId: draft.projectId.trim() || undefined,
          engagementId: draft.engagementId.trim() || undefined,
          repoUrl: draft.repoUrl.trim(),
          ref: draft.ref.trim() || null,
          settings: buildSettings(draft),
        });
        return;
      }

      if (!draft.archive) {
        throw new Error("Choose a zip/tar archive before submitting.");
      }

      const formData = new FormData();
      formData.set("archive", draft.archive);
      formData.set("name", draft.name.trim());
      formData.set("projectId", draft.projectId.trim());
      formData.set("engagementId", draft.engagementId.trim());
      formData.set("executionMode", draft.executionMode);
      formData.set("workerPool", draft.workerPool.trim());
      formData.set("workerRetries", String(draft.workerRetries));
      formData.set("workflowId", draft.workflowId);
      formData.set("focusPolicy", draft.focusPolicy);
      formData.set("focusWorkers", String(draft.focusWorkers));
      formData.set("maxFocusRounds", String(draft.maxFocusRounds));
      formData.set("scanProfile", draft.scanProfile);
      formData.set("agent", draft.agent);
      formData.set("model", draft.model.trim());
      formData.set("mergeAgent", draft.mergeAgent);
      formData.set("mergeModel", draft.mergeModel.trim());
      formData.set("summaryAgent", draft.summaryAgent);
      formData.set("summaryModel", draft.summaryModel.trim());
      formData.set("workers", String(draft.workers));
      formData.set("maxRounds", String(draft.maxRounds));
      formData.set("convergeAfter", String(draft.convergeAfter));
      formData.set("reasoningEffort", draft.reasoningEffort);
      formData.set("mergeMode", draft.mergeMode);
      formData.set("languageProfile", draft.languageProfile);
      formData.set("include", draft.include);
      formData.set("exclude", draft.exclude);
      formData.set("extensions", draft.extensions);
      formData.set("taskTimeoutMinutes", String(draft.taskTimeoutMinutes));
      await onSubmitUpload(formData);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit job");
    }
  };

  if (loading && !configPayload) {
    return (
      <section className="panel hero">
        <EmptyBlock
          icon={<LoaderCircle size={18} />}
          title="Loading submission controls"
          body="Reading server defaults and provider availability."
        />
      </section>
    );
  }

  return (
    <div className="submit-view new-scan-view">
      <header className="new-scan-header">
        <div>
          <div className="eyebrow">New security review</div>
          <h2>Start with the source. Keep the audit plan legible.</h2>
          <p>Choose one Code Agent and an assurance level. Everything else already has a safe project default.</p>
        </div>
        <div className="new-scan-status-row">
          <span className={`new-scan-status ${selectedProviderReady ? "is-ready" : ""}`}>
            <span className="new-scan-status-dot" />
            {deepseekRequired ? `DeepSeek ${deepseekSummary?.value ?? "Checking"}` : agentLabel(draft.agent)}
          </span>
          <span className="new-scan-status">{displayModelName(draft.model)}</span>
          <span className="new-scan-status">{reasoningLabel(draft.reasoningEffort)} reasoning</span>
        </div>
      </header>

      <form className="new-scan-layout" onSubmit={handleSubmit}>
        <div className="new-scan-content">
          <section className="panel new-scan-section">
            <div className="new-scan-section-heading">
              <span className="new-scan-step">01</span>
              <div>
                <div className="eyebrow">Source</div>
                <h3>What should AuditHound review?</h3>
              </div>
            </div>

            <div className="source-segmented-control">
              <button
                className={draft.sourceMode === "github" ? "is-active" : ""}
                onClick={() => setDraft((current) => ({ ...current, sourceMode: "github" }))}
                type="button"
              >
                <Github size={16} />
                <span><strong>GitHub repository</strong><small>Clone over HTTPS</small></span>
              </button>
              <button
                className={draft.sourceMode === "upload" ? "is-active" : ""}
                onClick={() => setDraft((current) => ({ ...current, sourceMode: "upload" }))}
                type="button"
              >
                <FileArchive size={16} />
                <span><strong>Source archive</strong><small>ZIP, TAR, or TGZ</small></span>
              </button>
            </div>

            <div className="new-scan-fields">
              {draft.sourceMode === "github" ? (
                <>
                  <label className="field field-span-2">
                    <span className="field-label">Repository URL</span>
                    <div className="field-input field-input-prominent">
                      <Github size={15} />
                      <input
                        value={draft.repoUrl}
                        onChange={(event) => setDraft((current) => ({ ...current, repoUrl: event.target.value }))}
                        placeholder="https://github.com/org/repository"
                      />
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Branch, tag, or commit</span>
                    <div className="field-input">
                      <input
                        value={draft.ref}
                        onChange={(event) => setDraft((current) => ({ ...current, ref: event.target.value }))}
                        placeholder="Default branch"
                      />
                    </div>
                  </label>
                </>
              ) : (
                <label className="field field-span-2">
                  <span className="field-label">Archive</span>
                  <div className="upload-dropzone upload-dropzone-compact">
                    <input
                      accept=".zip,.tar,.tar.gz,.tgz"
                      onChange={(event) => setDraft((current) => ({ ...current, archive: event.target.files?.[0] ?? null }))}
                      type="file"
                    />
                    <div>
                      <strong>{draft.archive?.name ?? "Choose a source archive"}</strong>
                      <p>Up to {configPayload?.config.defaults.uploadSizeMb ?? 150} MB.</p>
                    </div>
                  </div>
                </label>
              )}
              <label className="field">
                <span className="field-label">Project key</span>
                <div className="field-input">
                  <input
                    value={draft.projectId}
                    onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
                    placeholder="Auto-detect from source"
                  />
                </div>
              </label>
              <label className="field">
                <span className="field-label">Scan label</span>
                <div className="field-input">
                  <input
                    value={draft.name}
                    onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Optional"
                  />
                </div>
              </label>
            </div>
          </section>

          <section className="panel new-scan-section">
            <div className="new-scan-section-heading">
              <span className="new-scan-step">02</span>
              <div>
                <div className="eyebrow">Code Agent</div>
                <h3>Choose the execution engine</h3>
                <p>The selected agent is used for investigation, canonical merge, and summary by default.</p>
              </div>
            </div>

            <div className="code-agent-grid">
              {CODE_AGENTS.map((agent) => {
                const Icon = agent.icon;
                const selected = draft.agent === agent.id;
                const available = configPayload?.agents[agent.id] ?? true;
                return (
                  <button
                    className={`code-agent-card ${selected ? "is-active" : ""}`}
                    disabled={!available}
                    key={agent.id}
                    onClick={() => selectAgent(agent.id)}
                    type="button"
                  >
                    <span className="code-agent-card-topline">
                      <span className="code-agent-icon"><Icon size={18} /></span>
                      <span className={`code-agent-state ${selected ? "is-selected" : ""}`}>
                        {selected ? "Selected" : available ? agent.badge : "Unavailable"}
                      </span>
                    </span>
                    <span className="code-agent-copy">
                      <strong>{agent.title}</strong>
                      <small>{agent.description}</small>
                    </span>
                    <span className="code-agent-model">{selected ? draft.model : agent.model}</span>
                  </button>
                );
              })}
            </div>

            <div className="agent-selection-strip">
              <span><Cpu size={14} /> {agentLabel(draft.agent)}</span>
              <span>{draft.model}</span>
              <span>{reasoningLabel(draft.reasoningEffort)} reasoning</span>
              <span>All stages</span>
            </div>
            {deepseekNotice && (
              <div className="provider-callout">
                <Radar size={15} />
                <span>{deepseekNotice}</span>
              </div>
            )}
          </section>

          <section className="panel new-scan-section">
            <div className="new-scan-section-heading">
              <span className="new-scan-step">03</span>
              <div>
                <div className="eyebrow">Audit depth</div>
                <h3>How much independent coverage?</h3>
              </div>
            </div>
            <div className="scan-profile-grid scan-profile-grid-horizontal">
              {SCAN_PROFILES.map((profile) => {
                const Icon = profile.icon;
                return (
                  <button
                    className={`scan-profile-card ${scanProfileMatchesDraft(draft, profile.id) ? "is-active" : ""}`}
                    key={profile.id}
                    onClick={() => setDraft((current) => applyScanProfile(current, profile.id))}
                    type="button"
                  >
                    <span className="scan-profile-icon"><Icon size={16} /></span>
                    <span className="scan-profile-copy">
                      <strong>{profile.title}</strong>
                      <small>{profile.description}</small>
                    </span>
                    <span className="scan-profile-meta">{profile.meta}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <details className="panel new-scan-advanced">
            <summary>
              <span className="new-scan-advanced-icon"><SlidersHorizontal size={16} /></span>
              <span>
                <strong>Advanced setup</strong>
                <small>Workflow, stage routing, focus, execution host, and scope overrides</small>
              </span>
              <ChevronDown className="new-scan-chevron" size={16} />
            </summary>
            <div className="new-scan-advanced-body">
              <section className="advanced-setup-block">
                <div className="advanced-setup-heading">
                  <strong>Workflow and execution</strong>
                  <span>Defaults are ready for a local Solidity audit.</span>
                </div>
                <div className="new-scan-fields">
                  <label className="field field-span-2">
                    <span className="field-label">Workflow</span>
                    <div className="field-input field-select">
                      <select
                        value={draft.workflowId}
                        onChange={(event) => setDraft((current) => ({ ...current, workflowId: event.target.value }))}
                      >
                        {(selectableWorkflows.length > 0 ? selectableWorkflows : [{
                          id: draft.workflowId,
                          name: "General Convergence",
                          executable: true,
                        }]).map((workflow) => (
                          <option disabled={!workflow.executable} key={workflow.id} value={workflow.id}>
                            {workflow.name}{workflow.executable ? "" : " · draft"}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <div className="field field-span-2">
                    <span className="field-label">Execution target</span>
                    <div className="execution-target-options">
                      <button
                        className={draft.executionMode === "local" ? "is-active" : ""}
                        onClick={() => setDraft((current) => ({ ...current, executionMode: "local" }))}
                        type="button"
                      >
                        <span className="execution-target-mark" />
                        <span><strong>Studio host</strong><small>Use local credentials</small></span>
                      </button>
                      <button
                        className={draft.executionMode === "worker" ? "is-active" : ""}
                        onClick={() => setDraft((current) => ({ ...current, executionMode: "worker" }))}
                        type="button"
                      >
                        <span className="execution-target-mark" />
                        <span><strong>Worker pool</strong><small>Lease the complete audit</small></span>
                      </button>
                    </div>
                  </div>
                  {draft.executionMode === "worker" && (
                    <>
                      <label className="field">
                        <span className="field-label">Worker pool</span>
                        <div className="field-input"><input value={draft.workerPool} onChange={(event) => setDraft((current) => ({ ...current, workerPool: event.target.value }))} /></div>
                      </label>
                      <label className="field">
                        <span className="field-label">Remote retries</span>
                        <div className="field-input"><input max={5} min={0} type="number" value={draft.workerRetries} onChange={(event) => setDraft((current) => ({ ...current, workerRetries: Number(event.target.value) }))} /></div>
                      </label>
                    </>
                  )}
                  <label className="field">
                    <span className="field-label">Language</span>
                    <div className="field-input field-select">
                      <select value={draft.languageProfile} onChange={(event) => setDraft((current) => ({ ...current, languageProfile: event.target.value as JobDefaults["languageProfile"] }))}>
                        <option value="solidity">Solidity</option>
                        <option value="solana-rust">Solana Rust</option>
                        <option value="generic">Generic</option>
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Reasoning</span>
                    <div className="field-input field-select">
                      <select value={draft.reasoningEffort} onChange={(event) => setDraft((current) => ({ ...current, reasoningEffort: event.target.value as JobDefaults["reasoningEffort"] }))}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="xhigh">Max</option>
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Workers</span>
                    <div className="field-input"><input max={8} min={1} type="number" value={draft.workers} onChange={(event) => setDraft((current) => ({ ...current, workers: Number(event.target.value) }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Max rounds</span>
                    <div className="field-input"><input max={12} min={1} type="number" value={draft.maxRounds} onChange={(event) => setDraft((current) => ({ ...current, maxRounds: Number(event.target.value) }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Stop after empty rounds</span>
                    <div className="field-input"><input max={6} min={1} type="number" value={draft.convergeAfter} onChange={(event) => setDraft((current) => ({ ...current, convergeAfter: Number(event.target.value) }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Task timeout</span>
                    <div className="field-input"><input max={480} min={10} type="number" value={draft.taskTimeoutMinutes} onChange={(event) => setDraft((current) => ({ ...current, taskTimeoutMinutes: Number(event.target.value) }))} /></div>
                  </label>
                </div>
              </section>

              <section className="advanced-setup-block">
                <div className="advanced-setup-heading">
                  <strong>Adaptive focus</strong>
                  <span>Optional insertion after general audit evidence exists.</span>
                </div>
                <div className="new-scan-fields">
                  <label className="field field-span-2">
                    <span className="field-label">Policy</span>
                    <div className="field-input field-select">
                      <select value={draft.focusPolicy} onChange={(event) => setDraft((current) => ({ ...current, focusPolicy: event.target.value as JobDefaults["focusPolicy"] }))}>
                        <option value="suggest">Suggest, then ask me</option>
                        <option value="auto">Insert automatically</option>
                        <option value="off">General loop only</option>
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Focus workers</span>
                    <div className="field-input"><input disabled={draft.focusPolicy === "off"} max={8} min={1} type="number" value={draft.focusWorkers} onChange={(event) => setDraft((current) => ({ ...current, focusWorkers: Number(event.target.value) }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Focus round budget</span>
                    <div className="field-input"><input disabled={draft.focusPolicy === "off"} max={12} min={0} type="number" value={draft.maxFocusRounds} onChange={(event) => setDraft((current) => ({ ...current, maxFocusRounds: Number(event.target.value) }))} /></div>
                  </label>
                </div>
              </section>

              <section className="advanced-setup-block">
                <div className="advanced-setup-heading">
                  <strong>Stage routing</strong>
                  <span>Override only when merge or summary needs a different agent.</span>
                </div>
                <div className="new-scan-fields">
                  <label className="field">
                    <span className="field-label">Primary model</span>
                    <div className="field-input"><input value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Merge agent</span>
                    <div className="field-input field-select">
                      <select value={draft.mergeAgent} onChange={(event) => setDraft((current) => ({ ...current, mergeAgent: event.target.value as JobDefaults["mergeAgent"] }))}>
                        {CODE_AGENTS.map((agent) => <option key={agent.id} value={agent.id}>{agent.title}</option>)}
                      </select>
                    </div>
                  </label>
                  <label className="field">
                    <span className="field-label">Merge model</span>
                    <div className="field-input"><input value={draft.mergeModel} onChange={(event) => setDraft((current) => ({ ...current, mergeModel: event.target.value }))} /></div>
                  </label>
                  <label className="field">
                    <span className="field-label">Summary agent</span>
                    <div className="field-input field-select">
                      <select value={draft.summaryAgent} onChange={(event) => setDraft((current) => ({ ...current, summaryAgent: event.target.value as JobDefaults["summaryAgent"] }))}>
                        {CODE_AGENTS.map((agent) => <option key={agent.id} value={agent.id}>{agent.title}</option>)}
                      </select>
                    </div>
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">Summary model</span>
                    <div className="field-input"><input value={draft.summaryModel} onChange={(event) => setDraft((current) => ({ ...current, summaryModel: event.target.value }))} /></div>
                  </label>
                </div>
              </section>

              <section className="advanced-setup-block">
                <div className="advanced-setup-heading">
                  <strong>Scope and lineage</strong>
                  <span>Leave blank to audit the detected source tree.</span>
                </div>
                <div className="new-scan-fields">
                  <label className="field field-span-2">
                    <span className="field-label">Engagement ID</span>
                    <div className="field-input"><input value={draft.engagementId} onChange={(event) => setDraft((current) => ({ ...current, engagementId: event.target.value }))} placeholder="Optional review cycle" /></div>
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">Include globs</span>
                    <div className="field-textarea"><textarea rows={2} value={draft.include} onChange={(event) => setDraft((current) => ({ ...current, include: event.target.value }))} placeholder="One relative glob per line" /></div>
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">Exclude globs</span>
                    <div className="field-textarea"><textarea rows={2} value={draft.exclude} onChange={(event) => setDraft((current) => ({ ...current, exclude: event.target.value }))} placeholder="One relative glob per line" /></div>
                  </label>
                  <label className="field field-span-2">
                    <span className="field-label">Extensions</span>
                    <div className="field-input"><input value={draft.extensions} onChange={(event) => setDraft((current) => ({ ...current, extensions: event.target.value }))} placeholder=".sol,.rs,.ts" /></div>
                  </label>
                </div>
              </section>
            </div>
          </details>
        </div>

        <aside className="panel new-scan-launch-card">
          <div className="new-scan-launch-heading">
            <div className="eyebrow">Review and launch</div>
            <h3>{draft.name.trim() || draft.projectId.trim() || "Untitled audit"}</h3>
            <span className={`dispatch-readiness ${sourceReady ? "is-ready" : ""}`}>
              <span />{sourceReady ? "Source ready" : "Add source"}
            </span>
          </div>

          <div className="launch-agent-summary">
            <span className="launch-agent-icon"><SquareTerminal size={18} /></span>
            <span>
              <small>Code Agent</small>
              <strong>{agentLabel(draft.agent)}</strong>
            </span>
            <em>{reasoningLabel(draft.reasoningEffort)}</em>
          </div>

          <dl className="launch-summary-list">
            <div><dt>Model</dt><dd>{draft.model}</dd></div>
            <div><dt>Coverage</dt><dd>{draft.workers} workers · {draft.maxRounds} rounds</dd></div>
            <div><dt>Convergence</dt><dd>After {draft.convergeAfter} empty rounds</dd></div>
            <div><dt>Focus</dt><dd>{focusSummary}</dd></div>
            <div><dt>Workflow</dt><dd>{selectedWorkflow?.name ?? "General Convergence"}</dd></div>
            <div><dt>Execution</dt><dd>{draft.executionMode === "worker" ? `Pool · ${draft.workerPool || "default"}` : "Studio host"}</dd></div>
          </dl>

          <div className={`launch-provider-state ${selectedProviderReady ? "is-ready" : ""}`}>
            <ShieldCheck size={15} />
            <span>
              <strong>{deepseekRequired ? `DeepSeek ${deepseekSummary?.value ?? "Checking"}` : `${agentLabel(draft.agent)} selected`}</strong>
              <small>{deepseekRequired ? deepseekSummary?.hint ?? "Checking provider availability." : "This agent uses its configured native provider."}</small>
            </span>
          </div>

          {error && <div className="banner error">{error}</div>}
          <button className="button primary new-scan-submit" disabled={submitting || Boolean(deepseekBlocker)} type="submit">
            {submitting ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />}
            <span>{submitting ? "Starting audit…" : deepseekBlocker ? "Resolve provider first" : "Start audit"}</span>
          </button>
          <p className="new-scan-private-note">Private to this Studio. Credentials never enter the browser or run artifacts.</p>
        </aside>
      </form>
    </div>
  );
});

type ProviderSummary = {
  label: string;
  value: string;
  hint: string;
  tone: "safe" | "medium" | "high";
  ready: boolean;
};

type DeepSeekStatus = SystemConfigPayload["providerHealth"]["deepseek"]["status"];

const CODE_AGENTS = [
  {
    id: "pi",
    title: "Pi",
    badge: "Recommended",
    description: "Long-running terminal agent for evidence-driven investigation.",
    model: "deepseek/deepseek-v4-flash",
    icon: Sparkles,
  },
  {
    id: "opencode",
    title: "OpenCode",
    badge: "Compatible",
    description: "Alternative terminal agent for existing OpenCode workflows.",
    model: "deepseek/deepseek-v4-flash",
    icon: SquareTerminal,
  },
  {
    id: "claude",
    title: "Claude Code",
    badge: "Compatible",
    description: "Anthropic-compatible coding agent for existing Claude workflows.",
    model: "deepseek-v4-flash",
    icon: Braces,
  },
  {
    id: "codex",
    title: "Codex",
    badge: "OpenAI",
    description: "OpenAI coding agent with native repository tooling.",
    model: "gpt-5.4",
    icon: Bot,
  },
] as const;

function defaultModelForAgent(agent: JobDefaults["agent"]) {
  return CODE_AGENTS.find((item) => item.id === agent)?.model ?? "deepseek/deepseek-v4-flash";
}

function displayModelName(model: string) {
  if (model.includes("deepseek-v4-flash")) {
    return "V4 Flash";
  }
  if (model.includes("deepseek-v4-pro")) {
    return "V4 Pro";
  }
  return model || "Default model";
}

function reasoningLabel(effort: JobDefaults["reasoningEffort"]) {
  return effort === "xhigh" ? "Max" : `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

function summarizeDeepSeekProvider(configPayload: SystemConfigPayload): ProviderSummary {
  const health = configPayload.providerHealth?.deepseek;
  const status = health?.status ?? (configPayload.providers.deepseek ? "unreachable" : "unconfigured");
  const summaries: Record<DeepSeekStatus, Omit<ProviderSummary, "label">> = {
    ready: {
      value: "Ready",
      hint: health?.message ?? "Credential and API balance are ready.",
      tone: "safe",
      ready: true,
    },
    insufficient_balance: {
      value: "No balance",
      hint: health?.message ?? "The API account has no available balance.",
      tone: "high",
      ready: false,
    },
    invalid_key: {
      value: "Invalid key",
      hint: health?.message ?? "DeepSeek rejected the configured credential.",
      tone: "high",
      ready: false,
    },
    unreachable: {
      value: "Check failed",
      hint: health?.message ?? "Availability could not be checked.",
      tone: "medium",
      ready: false,
    },
    unconfigured: {
      value: "Missing",
      hint: health?.message ?? "No server credential is configured.",
      tone: "medium",
      ready: false,
    },
  };
  return { label: "DeepSeek", ...summaries[status] };
}

function requiresDeepSeek(draft: DraftState) {
  return [
    [draft.agent, draft.model],
    [draft.mergeAgent, draft.mergeModel],
    [draft.summaryAgent, draft.summaryModel],
  ].some(([agent, model]) => (
    (agent === "claude" && model.startsWith("deepseek-"))
    || ((agent === "opencode" || agent === "pi") && model.startsWith("deepseek/"))
  ));
}

function getDeepSeekBlocker(status: DeepSeekStatus) {
  if (status === "unconfigured") {
    return "Add DEEPSEEK_API_KEY on the server before queuing this profile.";
  }
  if (status === "invalid_key") {
    return "DeepSeek rejected the configured API key. Replace it before queuing this profile.";
  }
  if (status === "insufficient_balance") {
    return "DeepSeek has no available API balance. Top up the account before queuing this profile.";
  }
  return null;
}

function getDeepSeekNotice(status: DeepSeekStatus) {
  return getDeepSeekBlocker(status)
    ?? (status === "unreachable" ? "DeepSeek availability could not be checked. You may queue the job, but the provider could still fail." : null);
}

function createDraft(configPayload: SystemConfigPayload | null): DraftState {
  const defaults = configPayload?.config.defaults;
  return {
    sourceMode: "github",
    executionMode: defaults?.executionMode ?? "local",
    workerPool: defaults?.workerPool ?? "default",
    workerRetries: defaults?.workerRetries ?? 2,
    name: "",
    projectId: "",
    engagementId: "",
    repoUrl: "",
    ref: "",
    archive: null,
    workflowId: defaults?.workflowId && defaults.workflowId !== "evidence-convergence"
      ? defaults.workflowId
      : "general-convergence",
    focusPolicy: defaults?.focusPolicy ?? "suggest",
    focusWorkers: defaults?.focusWorkers ?? 2,
    maxFocusRounds: defaults?.maxFocusRounds ?? 2,
    scanProfile: defaults?.scanProfile ?? "deep",
    agent: defaults?.agent ?? "pi",
    model: defaults?.model ?? "deepseek/deepseek-v4-flash",
    mergeAgent: defaults?.mergeAgent ?? defaults?.agent ?? "pi",
    mergeModel: defaults?.mergeModel ?? defaults?.model ?? "deepseek/deepseek-v4-flash",
    summaryAgent: defaults?.summaryAgent ?? defaults?.agent ?? "pi",
    summaryModel: defaults?.summaryModel ?? defaults?.model ?? "deepseek/deepseek-v4-flash",
    workers: defaults?.workers ?? 1,
    maxRounds: defaults?.maxRounds ?? 6,
    convergeAfter: defaults?.convergeAfter ?? 2,
    reasoningEffort: defaults?.reasoningEffort ?? "xhigh",
    mergeMode: defaults?.mergeMode ?? "codex",
    languageProfile: defaults?.languageProfile ?? "solidity",
    include: (defaults?.include ?? []).join("\n"),
    exclude: (defaults?.exclude ?? []).join("\n"),
    extensions: (defaults?.extensions ?? []).join(","),
    taskTimeoutMinutes: defaults?.taskTimeoutMinutes ?? 90,
  };
}

function buildSettings(draft: DraftState): Partial<JobDefaults> {
  return {
    executionMode: draft.executionMode,
    workerPool: draft.workerPool.trim() || "default",
    workerRetries: draft.workerRetries,
    workflowId: draft.workflowId,
    focusPolicy: draft.focusPolicy,
    focusWorkers: draft.focusWorkers,
    maxFocusRounds: draft.maxFocusRounds,
    scanProfile: draft.scanProfile,
    agent: draft.agent,
    model: draft.model.trim(),
    mergeAgent: draft.mergeAgent,
    mergeModel: draft.mergeModel.trim(),
    summaryAgent: draft.summaryAgent,
    summaryModel: draft.summaryModel.trim(),
    workers: draft.workers,
    maxRounds: draft.maxRounds,
    convergeAfter: draft.convergeAfter,
    reasoningEffort: draft.reasoningEffort,
    mergeMode: draft.mergeMode,
    languageProfile: draft.languageProfile,
    include: splitLines(draft.include),
    exclude: splitLines(draft.exclude),
    extensions: draft.extensions
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    taskTimeoutMinutes: draft.taskTimeoutMinutes,
  };
}

const SCAN_PROFILES = [
  {
    id: "preview",
    title: "Rapid preview",
    description: "Fast independent full-scope review for early feedback.",
    meta: "2 rounds · 1 worker · Max",
    icon: Gauge,
  },
  {
    id: "deep",
    title: "Deep audit",
    description: "Independent auditors converge findings across the complete scope.",
    meta: "6 rounds · 2 workers · Max",
    icon: Radar,
  },
  {
    id: "release",
    title: "Release assurance",
    description: "Highest scrutiny before deployment or client delivery.",
    meta: "8 rounds · 4 workers · Max",
    icon: PackageCheck,
  },
] as const;

function applyScanProfile(draft: DraftState, profile: JobDefaults["scanProfile"]): DraftState {
  if (profile === "preview") {
    return {
      ...draft,
      scanProfile: profile,
      workers: 1,
      maxRounds: 2,
      convergeAfter: 1,
      reasoningEffort: "xhigh",
      focusPolicy: "suggest",
      focusWorkers: 1,
      maxFocusRounds: 1,
    };
  }
  if (profile === "release") {
    return {
      ...draft,
      scanProfile: profile,
      workers: 4,
      maxRounds: 8,
      convergeAfter: 2,
      reasoningEffort: "xhigh",
      focusPolicy: "auto",
      focusWorkers: 3,
      maxFocusRounds: 3,
    };
  }
  return {
    ...draft,
    scanProfile: profile,
    workers: 2,
    maxRounds: 6,
    convergeAfter: 2,
    reasoningEffort: "xhigh",
    focusPolicy: "suggest",
    focusWorkers: 2,
    maxFocusRounds: 2,
  };
}

function scanProfileMatchesDraft(draft: DraftState, profile: JobDefaults["scanProfile"]) {
  const profileDraft = applyScanProfile(draft, profile);
  return draft.workers === profileDraft.workers
    && draft.maxRounds === profileDraft.maxRounds
    && draft.convergeAfter === profileDraft.convergeAfter
    && draft.reasoningEffort === profileDraft.reasoningEffort
    && draft.focusPolicy === profileDraft.focusPolicy
    && draft.focusWorkers === profileDraft.focusWorkers
    && draft.maxFocusRounds === profileDraft.maxFocusRounds;
}

function agentLabel(agent: JobDefaults["agent"]) {
  if (agent === "claude") {
    return "Claude Code";
  }
  if (agent === "codex") {
    return "Codex";
  }
  return agent === "pi" ? "Pi" : "OpenCode";
}

function splitLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
