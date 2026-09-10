import React, { type ReactNode } from "react";

// Panel Header
interface PanelHeaderProps {
  title: string;
  eyebrow: string;
  compact?: boolean;
}

export const PanelHeader = React.memo(function PanelHeader({
  title,
  eyebrow,
  compact = false,
}: PanelHeaderProps) {
  return (
    <div className={`panel-header ${compact ? "is-compact" : ""}`}>
      <div className="eyebrow">{eyebrow}</div>
      <h3>{title}</h3>
    </div>
  );
});

// Status Pill
interface StatusPillProps {
  tone?: string;
  label: string;
}

export const StatusPill = React.memo(function StatusPill({
  tone = "neutral",
  label,
}: StatusPillProps) {
  return (
    <span className={`status-pill tone-${tone.toLowerCase()}`}>
      <span className="status-pill-dot" />
      <span>{label}</span>
    </span>
  );
});

// Metric Inline
interface MetricInlineProps {
  label: string;
  value: string;
}

export const MetricInline = React.memo(function MetricInline({
  label,
  value,
}: MetricInlineProps) {
  return (
    <div className="metric-inline">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

// Meta Stat
interface MetaStatProps {
  label: string;
  value: string;
}

export const MetaStat = React.memo(function MetaStat({
  label,
  value,
}: MetaStatProps) {
  return (
    <div className="meta-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

// Metric Card
interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}

export const MetricCard = React.memo(function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
}: MetricCardProps) {
  return (
    <div className={`metric-card tone-${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-hint" title={hint}>
        {hint}
      </div>
    </div>
  );
});

// Empty Block
interface EmptyBlockProps {
  icon?: ReactNode;
  title: string;
  body: string;
  compact?: boolean;
}

export const EmptyBlock = React.memo(function EmptyBlock({
  icon,
  title,
  body,
  compact = false,
}: EmptyBlockProps) {
  return (
    <div className={`empty-block ${compact ? "is-compact" : ""}`} style={compact ? { padding: "16px 10px" } : undefined}>
      {icon && <div className="empty-icon">{icon}</div>}
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
});
