import React, { useEffect, useState } from "react";
import { LoaderCircle, Save, Server, ShieldCheck } from "lucide-react";

import type { SystemConfigPayload } from "../types";

interface SettingsProps {
  theme: "dark" | "light";
  setTheme: (t: "dark" | "light") => void;
  systemConfig: SystemConfigPayload | null;
  loading: boolean;
  saving: boolean;
  saveError: string | null;
  onSave: (config: SystemConfigPayload["config"]) => void;
}

type DraftDefaults = SystemConfigPayload["config"]["defaults"];

export const Settings = React.memo(function Settings({
  theme,
  setTheme,
  systemConfig,
  loading,
  saving,
  saveError,
  onSave,
}: SettingsProps) {
  const [draft, setDraft] = useState<DraftDefaults | null>(systemConfig?.config.defaults ?? null);

  useEffect(() => {
    setDraft(systemConfig?.config.defaults ?? null);
  }, [systemConfig?.config.updatedAt]);

  if (loading && !systemConfig) {
    return (
      <section className="panel hero">
        <div className="empty-block">
          <div className="empty-icon">
            <LoaderCircle size={18} />
          </div>
          <h4>Loading settings</h4>
          <p>Reading server-side defaults and provider availability.</p>
        </div>
      </section>
    );
  }

  if (!systemConfig || !draft) {
    return null;
  }

  const configuredProviderNames = [
    systemConfig.providers.openai && "OpenAI",
    systemConfig.providers.anthropic && "Anthropic",
    systemConfig.providers.deepseek && "DeepSeek",
    systemConfig.providers.google && "Google",
  ].filter(Boolean);
  const deepseekHealth = systemConfig.providerHealth?.deepseek;
  const readyProviderCount =
    Number(systemConfig.providers.openai)
    + Number(systemConfig.providers.anthropic)
    + Number(systemConfig.providers.google)
    + Number(deepseekHealth?.available ?? systemConfig.providers.deepseek);

  return (
    <div className="settings-view">
      <div className="settings-container">
        <section className="panel hero hero-split settings-hero">
          <div className="hero-copy">
            <div className="eyebrow">Platform settings</div>
            <div className="hero-title-row">
              <h2>Set the execution standard once, then let every queued audit inherit it.</h2>
            </div>
            <p>
              These defaults define model choice, queue behavior, upload constraints, and the operator posture of the product.
            </p>
            <div className="hero-meta-row">
              <span className="hero-meta-pill">{systemConfig.auth.enabled ? "Protected access" : "Local mode"}</span>
              <span className="hero-meta-pill">{readyProviderCount} providers ready</span>
              <span className="hero-meta-pill">{draft.executionMode === "worker" ? `Pool: ${draft.workerPool}` : "Studio execution"}</span>
              <span className="hero-meta-pill">{draft.languageProfile} profile</span>
            </div>
          </div>
          <div className="hero-sidecard">
            <div className="hero-sidecard-section">
              <div className="eyebrow">Current baseline</div>
              <strong>{draft.agent === "claude" ? "Claude Code" : draft.agent === "codex" ? "Codex" : draft.agent === "pi" ? "Pi" : "OpenCode"}</strong>
              <span>{draft.model || "Default model"}</span>
            </div>
            <div className="hero-sidecard-grid">
              <div className="hero-sidecard-stat">
                <span>Workers</span>
                <strong>{draft.workers}</strong>
              </div>
              <div className="hero-sidecard-stat">
                <span>Rounds</span>
                <strong>{draft.maxRounds}</strong>
              </div>
              <div className="hero-sidecard-stat">
                <span>Upload</span>
                <strong>{draft.uploadSizeMb} MB</strong>
              </div>
              <div className="hero-sidecard-stat">
                <span>Timeout</span>
                <strong>{draft.taskTimeoutMinutes} min</strong>
              </div>
            </div>
          </div>
        </section>

        <div className="settings-toolbar">
          <div className="settings-toolbar-copy">
            <h2>Operator controls</h2>
            <div className="dashboard-card-subtitle">
              Server defaults for queued jobs, provider availability, and operator access mode
            </div>
          </div>
          <button
            className="button primary"
            disabled={saving}
            onClick={() => onSave({ ...systemConfig.config, defaults: draft })}
            type="button"
          >
            {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
            <span>{saving ? "Saving…" : "Save Defaults"}</span>
          </button>
        </div>

        <div className="settings-summary-grid">
          <div className="settings-summary-card">
            <div className="eyebrow">Access</div>
            <strong>{systemConfig.auth.enabled ? "Protected" : "Open in local mode"}</strong>
            <span>{systemConfig.auth.enabled ? `Basic auth enabled for ${systemConfig.auth.username ?? "operator"}` : "Set AUDITHOUND_BASIC_AUTH_* to protect the app."}</span>
          </div>
          <div className="settings-summary-card">
            <div className="eyebrow">Providers</div>
            <strong>{configuredProviderNames.join(", ") || "None configured"}</strong>
            <span>
              {deepseekHealth && deepseekHealth.status !== "ready"
                ? `DeepSeek: ${deepseekHealth.message}`
                : "Secrets are read from server environment variables, not from the browser."}
            </span>
          </div>
          <div className="settings-summary-card">
            <div className="eyebrow">Paths</div>
            <strong>Output + state on disk</strong>
            <span>{systemConfig.paths.outputRoot}</span>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <Server size={15} />
            <span>Job Defaults</span>
          </div>
          <div className="settings-grid">
            <label className="field">
              <span className="field-label">Execution Target</span>
              <div className="field-input field-select">
                <select
                  value={draft.executionMode}
                  onChange={(event) => setDraft((current) => (current ? {
                    ...current,
                    executionMode: event.target.value as DraftDefaults["executionMode"],
                  } : current))}
                >
                  <option value="local">Studio host</option>
                  <option value="worker">Worker pool</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Worker Pool</span>
              <div className="field-input">
                <input
                  disabled={draft.executionMode !== "worker"}
                  value={draft.workerPool}
                  onChange={(event) => setDraft((current) => (current ? { ...current, workerPool: event.target.value } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Worker Retries</span>
              <div className="field-input">
                <input
                  disabled={draft.executionMode !== "worker"}
                  min="0"
                  max="5"
                  type="number"
                  value={draft.workerRetries}
                  onChange={(event) => setDraft((current) => (current ? { ...current, workerRetries: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Scan Profile</span>
              <div className="field-input field-select">
                <select
                  value={draft.scanProfile}
                  onChange={(event) => setDraft((current) => (current ? { ...current, scanProfile: event.target.value as DraftDefaults["scanProfile"] } : current))}
                >
                  <option value="preview">Rapid preview</option>
                  <option value="deep">Deep audit</option>
                  <option value="release">Release assurance</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Agent</span>
              <div className="field-input field-select">
                <select
                  value={draft.agent}
                  onChange={(event) => setDraft((current) => (current ? { ...current, agent: event.target.value as DraftDefaults["agent"] } : current))}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="pi">Pi</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Model</span>
              <div className="field-input">
                <input
                  value={draft.model}
                  onChange={(event) => setDraft((current) => (current ? { ...current, model: event.target.value } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Workers</span>
              <div className="field-input">
                <input
                  min="1"
                  max="8"
                  type="number"
                  value={draft.workers}
                  onChange={(event) => setDraft((current) => (current ? { ...current, workers: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Language Profile</span>
              <div className="field-input field-select">
                <select
                  value={draft.languageProfile}
                  onChange={(event) => setDraft((current) => (current ? { ...current, languageProfile: event.target.value as DraftDefaults["languageProfile"] } : current))}
                >
                  <option value="solidity">Solidity</option>
                  <option value="solana-rust">Solana Rust</option>
                  <option value="generic">Generic</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Max Rounds</span>
              <div className="field-input">
                <input
                  min="1"
                  max="12"
                  type="number"
                  value={draft.maxRounds}
                  onChange={(event) => setDraft((current) => (current ? { ...current, maxRounds: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Adaptive Focus</span>
              <div className="field-input field-select">
                <select
                  value={draft.focusPolicy}
                  onChange={(event) => setDraft((current) => (current ? {
                    ...current,
                    focusPolicy: event.target.value as DraftDefaults["focusPolicy"],
                  } : current))}
                >
                  <option value="suggest">Suggest, then ask</option>
                  <option value="auto">Insert automatically</option>
                  <option value="off">General only</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Focus Workers</span>
              <div className="field-input">
                <input
                  disabled={draft.focusPolicy === "off"}
                  min="1"
                  max="8"
                  type="number"
                  value={draft.focusWorkers}
                  onChange={(event) => setDraft((current) => (current ? { ...current, focusWorkers: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Focus Round Budget</span>
              <div className="field-input">
                <input
                  disabled={draft.focusPolicy === "off"}
                  min="0"
                  max="12"
                  type="number"
                  value={draft.maxFocusRounds}
                  onChange={(event) => setDraft((current) => (current ? { ...current, maxFocusRounds: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Converge After</span>
              <div className="field-input">
                <input
                  min="1"
                  max="6"
                  type="number"
                  value={draft.convergeAfter}
                  onChange={(event) => setDraft((current) => (current ? { ...current, convergeAfter: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Reasoning Effort</span>
              <div className="field-input field-select">
                <select
                  value={draft.reasoningEffort}
                  onChange={(event) => setDraft((current) => (current ? { ...current, reasoningEffort: event.target.value as DraftDefaults["reasoningEffort"] } : current))}
                >
                  <option value="minimal">Minimal</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="xhigh">XHigh</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Merge Agent</span>
              <div className="field-input field-select">
                <select
                  value={draft.mergeAgent}
                  onChange={(event) => setDraft((current) => (current ? { ...current, mergeAgent: event.target.value as DraftDefaults["mergeAgent"] } : current))}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="pi">Pi</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Merge Model</span>
              <div className="field-input">
                <input
                  value={draft.mergeModel}
                  onChange={(event) => setDraft((current) => (current ? { ...current, mergeModel: event.target.value } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Summary Agent</span>
              <div className="field-input field-select">
                <select
                  value={draft.summaryAgent}
                  onChange={(event) => setDraft((current) => (current ? { ...current, summaryAgent: event.target.value as DraftDefaults["summaryAgent"] } : current))}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                  <option value="pi">Pi</option>
                  <option value="opencode">OpenCode</option>
                </select>
              </div>
            </label>
            <label className="field">
              <span className="field-label">Summary Model</span>
              <div className="field-input">
                <input
                  value={draft.summaryModel}
                  onChange={(event) => setDraft((current) => (current ? { ...current, summaryModel: event.target.value } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Upload Limit (MB)</span>
              <div className="field-input">
                <input
                  min="10"
                  max="1024"
                  type="number"
                  value={draft.uploadSizeMb}
                  onChange={(event) => setDraft((current) => (current ? { ...current, uploadSizeMb: Number(event.target.value) } : current))}
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Timeout (min)</span>
              <div className="field-input">
                <input
                  min="10"
                  max="480"
                  type="number"
                  value={draft.taskTimeoutMinutes}
                  onChange={(event) => setDraft((current) => (current ? { ...current, taskTimeoutMinutes: Number(event.target.value) } : current))}
                />
              </div>
            </label>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-section-title">
            <ShieldCheck size={15} />
            <span>Operator Notes</span>
          </div>
          <div className="settings-note-card">
            <p>Keep theme preference local in the browser, but move execution defaults to the server so every submitted job uses the same baseline.</p>
            <label className="settings-toggle" style={{ marginTop: 12 }}>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={theme === "light"}
                  onChange={(event) => setTheme(event.target.checked ? "light" : "dark")}
                />
                <span className="slider"></span>
              </span>
              <span style={{ fontSize: 12, color: "var(--label-secondary)" }}>
                {theme === "light" ? "Light interface" : "Dark interface"}
              </span>
            </label>
          </div>
        </div>

        {saveError && <div className="banner error">{saveError}</div>}
      </div>
    </div>
  );
});
