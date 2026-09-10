import React, { useMemo, useState } from "react";
import {
  Activity,
  Boxes,
  Check,
  Copy,
  Cpu,
  Network,
  RefreshCcw,
  ServerCog,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";

import { formatRelativeDate } from "../lib/format";
import type { WorkerControlPayload, WorkerRecord } from "../types";
import { EmptyBlock, MetricCard, StatusPill } from "./Common";

type WorkersViewProps = {
  payload: WorkerControlPayload | null;
  loading: boolean;
  onRefresh: () => void;
  onForget: (workerId: string) => void;
};

export const WorkersView = React.memo(function WorkersView({
  payload,
  loading,
  onRefresh,
  onForget,
}: WorkersViewProps) {
  const [copied, setCopied] = useState(false);
  const workers = payload?.workers ?? [];
  const busy = workers.filter((worker) => worker.status === "busy").length;
  const online = workers.filter((worker) => worker.status === "online").length;
  const offline = workers.filter((worker) => worker.status === "offline").length;
  const capacity = workers
    .filter((worker) => worker.status !== "offline")
    .reduce((sum, worker) => sum + worker.maxConcurrency, 0);
  const pools = useMemo(() => {
    const grouped = new Map<string, WorkerRecord[]>();
    for (const worker of workers) {
      grouped.set(worker.pool, [...(grouped.get(worker.pool) ?? []), worker]);
    }
    return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [workers]);
  const command = `AUDITHOUND_WORKER_TOKEN=<token> python3 scripts/audithound.py worker --server ${window.location.origin} --pool default`;

  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="workers-view product-view">
      <header className="product-header">
        <div>
          <div className="eyebrow">Execution fabric</div>
          <h2>Scale complete audits without fragmenting their reasoning.</h2>
          <p>
            Each machine leases one durable AuditHound job, runs the same audit workflow in isolation, then returns the
            review-ready output to this control plane.
          </p>
        </div>
        <div className="product-actions">
          <button className="button secondary" onClick={onRefresh} type="button">
            <RefreshCcw size={14} />
            Refresh
          </button>
        </div>
      </header>

      <section className="worker-metrics metric-strip">
        <MetricCard label="Busy" value={String(busy)} hint="Workers holding active leases" tone={busy > 0 ? "info" : "neutral"} />
        <MetricCard label="Available" value={String(online)} hint="Ready to accept a complete scan" tone={online > 0 ? "safe" : "neutral"} />
        <MetricCard label="Capacity" value={String(capacity)} hint="Online execution slots" tone="neutral" />
        <MetricCard label="Offline" value={String(offline)} hint="No heartbeat inside the grace window" tone={offline > 0 ? "medium" : "neutral"} />
      </section>

      <section className="worker-routing-strip">
        <div className="worker-routing-node">
          <span><ServerCog size={15} /></span>
          <div><strong>Control plane</strong><small>Persists queue and leases</small></div>
        </div>
        <div className="worker-routing-line"><span>pool route</span></div>
        <div className="worker-routing-node">
          <span><Boxes size={15} /></span>
          <div><strong>Worker pool</strong><small>Matches `workerPool` exactly</small></div>
        </div>
        <div className="worker-routing-line"><span>exclusive lease</span></div>
        <div className="worker-routing-node">
          <span><Cpu size={15} /></span>
          <div><strong>Independent audit</strong><small>Full scope, local credentials</small></div>
        </div>
        <div className="worker-routing-line"><span>artifact return</span></div>
        <div className="worker-routing-node">
          <span><Network size={15} /></span>
          <div><strong>Review workspace</strong><small>One canonical evidence record</small></div>
        </div>
      </section>

      <div className="workers-layout">
        <section className="panel worker-pools-panel">
          <div className="panel-header">
            <div className="eyebrow">Registered machines</div>
            <h3>Worker pools</h3>
          </div>
          {loading && workers.length === 0 ? (
            <EmptyBlock icon={<Activity className="spin" size={18} />} title="Reading heartbeats" body="Loading the worker registry." />
          ) : pools.length === 0 ? (
            <EmptyBlock
              icon={<Cpu size={18} />}
              title="No workers registered"
              body="Start the command shown on the right from any AuditHound installation."
            />
          ) : (
            <div className="worker-pool-list">
              {pools.map(([pool, poolWorkers]) => (
                <div className="worker-pool-group" key={pool}>
                  <div className="worker-pool-heading">
                    <div>
                      <span className="worker-pool-mark" />
                      <strong>{pool}</strong>
                    </div>
                    <small>{poolWorkers.filter((worker) => worker.status !== "offline").length}/{poolWorkers.length} reachable</small>
                  </div>
                  <div className="worker-card-list">
                    {poolWorkers.map((worker) => (
                      <article className={`worker-card is-${worker.status}`} key={worker.id}>
                        <div className="worker-card-status">
                          <span className="worker-machine-icon">
                            {worker.status === "offline" ? <WifiOff size={15} /> : <Wifi size={15} />}
                          </span>
                          <div>
                            <strong>{worker.name}</strong>
                            <code>{worker.id}</code>
                          </div>
                        </div>
                        <StatusPill label={workerStatusLabel(worker.status)} tone={workerStatusTone(worker.status)} />
                        <div className="worker-card-meta">
                          <span><strong>{worker.hostname}</strong><small>{worker.platform}</small></span>
                          <span><strong>{worker.maxConcurrency} slot</strong><small>v{worker.version}</small></span>
                          <span>
                            <strong>{formatRelativeDate(worker.lastHeartbeat)}</strong>
                            <small>{worker.activeJobIds.length > 0 ? worker.activeJobIds.join(", ") : "No active lease"}</small>
                          </span>
                        </div>
                        {worker.status === "offline" && (
                          <button className="icon-button danger worker-forget" onClick={() => onForget(worker.id)} title="Forget worker" type="button">
                            <Trash2 size={13} />
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <aside className="panel worker-setup-panel">
          <div className="panel-header">
            <div className="eyebrow">Connect a machine</div>
            <h3>Worker bootstrap</h3>
          </div>
          <div className="worker-setup-body">
            <div className="worker-setup-step">
              <span>01</span>
              <div>
                <strong>Install the same AuditHound revision</strong>
                <p>The worker runs your native CLI and workflow contracts; no separate runtime is introduced.</p>
              </div>
            </div>
            <div className="worker-setup-step">
              <span>02</span>
              <div>
                <strong>Keep provider credentials local</strong>
                <p>Claude Code, Codex, DeepSeek, RPC, and repository credentials stay on the execution machine.</p>
              </div>
            </div>
            <div className="worker-setup-step">
              <span>03</span>
              <div>
                <strong>Start the durable poller</strong>
                <p>Pool names route jobs; heartbeats renew a 45-second exclusive lease.</p>
              </div>
            </div>

            <div className="worker-command">
              <div>
                <span>Run from the repository root</span>
                <button onClick={() => void copyCommand()} type="button">
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <code>{command}</code>
            </div>

            <div className={`worker-token-state ${payload?.control.tokenConfigured ? "is-ready" : ""}`}>
              <span />
              <div>
                <strong>{payload?.control.tokenConfigured ? "Remote token configured" : "Local workers only"}</strong>
                <small>
                  {payload?.control.tokenConfigured
                    ? "Bearer-token registration is enabled for remote machines."
                    : "Set AUDITHOUND_WORKER_TOKEN on the Studio server before connecting over the network."}
                </small>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
});

function workerStatusLabel(status: WorkerRecord["status"]) {
  return status === "busy" ? "Busy" : status === "online" ? "Available" : "Offline";
}

function workerStatusTone(status: WorkerRecord["status"]) {
  return status === "busy" ? "info" : status === "online" ? "safe" : "medium";
}
