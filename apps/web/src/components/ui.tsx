"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "blocked";
type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

function classNames(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      className={classNames(
        "rp-button",
        `rp-button--${variant}`,
        `rp-button--${size}`,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="rp-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  children,
  href,
}: PropsWithChildren<{
  href: string;
  className?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
}>) {
  return (
    <Link
      href={href}
      className={classNames(
        "rp-button",
        `rp-button--${variant}`,
        `rp-button--${size}`,
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Card({
  className,
  children,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLElement>>) {
  return (
    <section {...props} className={classNames("rp-card", className)}>
      {children}
    </section>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: PropsWithChildren<
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>) {
  return (
    <button
      {...props}
      className={classNames("rp-icon-button", className)}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: PropsWithChildren<{ tone?: Tone }>) {
  return <span className={`rp-badge rp-badge--${tone}`}>{children}</span>;
}

export function Alert({
  tone = "info",
  title,
  children,
}: PropsWithChildren<{ tone?: Exclude<Tone, "neutral">; title: string }>) {
  return (
    <section
      className={`rp-alert rp-alert--${tone}`}
      role={tone === "danger" || tone === "blocked" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      <div>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <span className={classNames("rp-skeleton", className)} aria-hidden="true" />
  );
}

export function Progress({ value, label }: { value: number; label: string }) {
  const boundedValue = Math.min(100, Math.max(0, value));
  return (
    <div className="rp-progress-wrap">
      <div
        className="rp-progress"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={boundedValue}
      >
        <span style={{ width: `${boundedValue}%` }} />
      </div>
    </div>
  );
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={classNames("rp-input", className)} />;
}

export function SelectControl({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={classNames("rp-select", className)} />;
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: PropsWithChildren<{
  label: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
}>) {
  return (
    <label className={classNames("rp-field", className)} htmlFor={htmlFor}>
      <span className="rp-field__label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function EmptyState({
  eyebrow,
  title,
  description,
  icon,
  actions,
  compact = false,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      {icon ? <span className="empty-state__icon">{icon}</span> : null}
      {eyebrow ? <span className="empty-state__eyebrow">{eyebrow}</span> : null}
      <h3>{title}</h3>
      <p>{description}</p>
      {actions ? <div className="empty-state__actions">{actions}</div> : null}
    </div>
  );
}

export type TabOption<T extends string> = {
  id: T;
  label: string;
  count?: number;
  disabled?: boolean;
};

export function Tabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<TabOption<T>>;
  onChange(value: T): void;
  label: string;
}) {
  return (
    <div className="rp-tabs" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          disabled={option.disabled}
          onClick={() => onChange(option.id)}
        >
          {option.label}
          {option.count !== undefined ? <span>{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Tooltip({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  return (
    <span className="rp-tooltip" tabIndex={0} aria-label={label}>
      {children}
      <span role="tooltip">{label}</span>
    </span>
  );
}

export function FreshnessIndicator({
  state,
  observedAt,
}: {
  state: string;
  observedAt?: string | null;
}) {
  const normalized = state.toUpperCase();
  const tone =
    normalized === "FRESH"
      ? "success"
      : normalized === "STALE"
        ? "warning"
        : "neutral";
  return (
    <span className={`freshness-indicator freshness-indicator--${tone}`}>
      <i aria-hidden="true" />
      <span>
        {normalized === "FRESH"
          ? "Fresh"
          : normalized === "STALE"
            ? "Stale"
            : "Unknown"}
      </span>
      {observedAt ? (
        <time dateTime={observedAt}>
          {new Date(observedAt).toLocaleDateString()}
        </time>
      ) : null}
    </span>
  );
}

type Toast = { id: number; message: string; tone: Tone };
type ToastContextValue = { notify: (message: string, tone?: Tone) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((message: string, tone: Tone = "success") => {
    const id = Date.now();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((toast) => toast.id !== id)),
      5000,
    );
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="rp-toast-region" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`rp-toast rp-toast--${toast.tone}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
