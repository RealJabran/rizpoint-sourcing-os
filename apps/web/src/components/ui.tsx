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
