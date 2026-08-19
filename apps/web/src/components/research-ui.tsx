"use client";

import {
  useEffect,
  useRef,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { Badge, Button, Card, SelectControl } from "./ui";
import {
  metricContext,
  statePresentation,
  type DataState,
} from "./research-ui-policy";

export function DataStateBadge({ state }: { state: DataState }) {
  const presentation = statePresentation[state];
  return (
    <Badge tone={presentation.tone}>
      <span aria-hidden="true">{presentation.symbol}</span>
      {presentation.label}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string | null | undefined }) {
  return (
    <Badge tone="neutral">
      <span aria-hidden="true">◇</span>
      {source?.trim() || "Source unavailable"}
    </Badge>
  );
}

export function MetricValue({
  label,
  value,
  unit,
  source,
  window,
  observedAt,
  state = value === null ? "MISSING" : "CURRENT",
  help,
}: {
  label: string;
  value: ReactNode | null;
  unit?: string;
  source?: string | null;
  window?: string | null;
  observedAt?: string | null;
  state?: DataState;
  help?: string;
}) {
  const context = metricContext({
    source,
    window,
    observedAt: observedAt ? new Date(observedAt).toLocaleString() : null,
  });
  return (
    <div className="research-metric">
      <div className="research-metric__heading">
        <span>{label}</span>
        <DataStateBadge state={state} />
      </div>
      <strong title={help}>
        {value === null ? (
          "Unavailable"
        ) : (
          <>
            {value}
            {unit ? <small>{unit}</small> : null}
          </>
        )}
      </strong>
      <div className="research-metric__context">
        {context.length ? (
          context.map((item, index) => (
            <span key={`${index}-${item}`}>{item}</span>
          ))
        ) : (
          <span>No source/window context</span>
        )}
      </div>
    </div>
  );
}

export function FilterBar({
  children,
  label = "Research filters",
  actions,
}: PropsWithChildren<{ label?: string; actions?: ReactNode }>) {
  return (
    <Card className="research-filter-bar">
      <div className="research-filter-bar__heading">
        <strong>{label}</strong>
        {actions}
      </div>
      <div className="research-filter-bar__fields">{children}</div>
    </Card>
  );
}

export function DateWindowControl({
  value,
  onChange,
  options = ["30d", "90d", "180d", "365d"],
}: {
  value: string;
  onChange(value: string): void;
  options?: string[];
}) {
  return (
    <label className="compact-field">
      <span>Date window</span>
      <SelectControl
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </SelectControl>
    </label>
  );
}

export function ViewToggle({
  value,
  onChange,
  chartAvailable = true,
}: {
  value: "table" | "chart";
  onChange(value: "table" | "chart"): void;
  chartAvailable?: boolean;
}) {
  return (
    <div className="view-toggle" role="group" aria-label="Result view">
      <Button
        type="button"
        size="sm"
        variant={value === "table" ? "primary" : "quiet"}
        aria-pressed={value === "table"}
        onClick={() => onChange("table")}
      >
        Table
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "chart" ? "primary" : "quiet"}
        aria-pressed={value === "chart"}
        disabled={!chartAvailable}
        title={
          chartAvailable ? undefined : "Chart unavailable for this dataset"
        }
        onClick={() => onChange("chart")}
      >
        Chart
      </Button>
    </div>
  );
}

export function CompareTray({
  count,
  maximum,
  children,
  onClear,
  action,
}: PropsWithChildren<{
  count: number;
  maximum: number;
  onClear(): void;
  action?: ReactNode;
}>) {
  if (!count) return null;
  return (
    <aside
      className="compare-tray"
      aria-label={`${count} items selected for comparison`}
    >
      <div>
        <strong>Compare tray</strong>
        <span>
          {count}/{maximum} selected
        </span>
      </div>
      <div className="compare-tray__items">{children}</div>
      <div className="compare-tray__actions">
        {action}
        <Button type="button" size="sm" variant="quiet" onClick={onClear}>
          Clear
        </Button>
      </div>
    </aside>
  );
}

export function EvidenceDrawer({
  open,
  title,
  onClose,
  children,
}: PropsWithChildren<{ open: boolean; title: string; onClose(): void }>) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div
      className="research-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <aside
        className="research-evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="research-evidence-title"
      >
        <header>
          <div>
            <span className="eyebrow">Evidence</span>
            <h2 id="research-evidence-title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            className="rp-button rp-button--quiet rp-button--sm"
            type="button"
            onClick={onClose}
            aria-label="Close evidence drawer"
          >
            Close
          </button>
        </header>
        <div className="research-evidence-drawer__body">{children}</div>
      </aside>
    </div>
  );
}
