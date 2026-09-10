import type { Confidence, CountMap, Severity } from "../types";

export const severityOrder: Severity[] = ["Critical", "High", "Medium", "Low", "Informational", "Unknown"];
export const confidenceOrder: Confidence[] = ["high", "medium", "low", "unknown"];

export function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }
  return date.toLocaleString();
}

export function formatAbsoluteDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function severityTone(value?: string) {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "critical") {
    return "critical";
  }
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "low") {
    return "low";
  }
  if (normalized === "informational" || normalized === "info") {
    return "info";
  }
  return "neutral";
}

export function confidenceTone(value?: string) {
  const normalized = (value ?? "").toLowerCase();
  if (normalized === "high") {
    return "high";
  }
  if (normalized === "medium") {
    return "medium";
  }
  if (normalized === "low") {
    return "low";
  }
  return "neutral";
}

export function statusTone(status: string) {
  if (status === "Confirmed" || status === "Retest Passed") {
    return "safe";
  }
  if (status === "False Positive" || status === "Duplicate") {
    return "neutral";
  }
  if (status === "Needs Evidence" || status === "Accepted Risk") {
    return "medium";
  }
  if (status === "Fixed") {
    return "low";
  }
  if (status === "Reviewing") {
    return "info";
  }
  return "neutral";
}

export function sumCounts(counts: CountMap) {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

export function toPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

export function shellQuote(value: string) {
  if (!value) {
    return "''";
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function humanizeKey(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
