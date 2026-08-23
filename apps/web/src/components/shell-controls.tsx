"use client";

import {
  Bell,
  ChevronDown,
  CircleUserRound,
  Moon,
  PlugZap,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, ButtonLink } from "./ui";

type AmazonStatus = {
  connectionState?: string;
  dataOrigin?: string;
  localDemo?: boolean;
};

const connectedStates = new Set(["CONNECTED", "PARTIAL", "THROTTLED"]);

export function AmazonConnectionControl() {
  const [status, setStatus] = useState<AmazonStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/providers/amazon", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setStatus(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const live = status?.dataOrigin === "LIVE_AMAZON";
  const connected = live && connectedStates.has(status?.connectionState ?? "");
  const label = connected
    ? "Amazon connected"
    : status?.localDemo
      ? "Demo data"
      : status?.connectionState === "CONNECTING"
        ? "Amazon connecting"
        : "Connect Amazon";
  return (
    <Link
      href="/settings/integrations/amazon"
      className={`amazon-status-control ${connected ? "amazon-status-control--connected" : ""}`}
      aria-label={`${label}. Open Amazon integration settings.`}
    >
      <span className="amazon-status-control__mark" aria-hidden="true">
        a
      </span>
      <span>{label}</span>
      <i aria-hidden="true" />
    </Link>
  );
}

export function NotificationControl() {
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/alerts", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : []))
      .then((items: Array<{ status?: string }>) =>
        setOpenCount(items.filter((item) => item.status === "OPEN").length),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return (
    <Link
      className="shell-icon-button"
      href="/alerts"
      aria-label="Notifications"
    >
      <Bell aria-hidden="true" />
      {openCount ? <span>{Math.min(openCount, 9)}</span> : null}
    </Link>
  );
}

export function ThemeControl() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const stored = window.localStorage.getItem("rizpoint.theme");
    const next =
      stored === "dark" ||
      (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    const timeout = window.setTimeout(() => setDark(next), 0);
    return () => window.clearTimeout(timeout);
  }, []);
  return (
    <button
      className="shell-icon-button"
      type="button"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? "dark" : "light";
        window.localStorage.setItem("rizpoint.theme", next ? "dark" : "light");
      }}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}

export function UserControl() {
  return (
    <details className="user-control">
      <summary aria-label="Open user menu">
        <span className="user-avatar" aria-hidden="true">
          RP
        </span>
        <span className="user-control__name">Workspace owner</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="user-menu">
        <div>
          <CircleUserRound aria-hidden="true" />
          <span>
            <strong>Workspace owner</strong>
            <small>Authenticated session</small>
          </span>
        </div>
        <Link href="/settings/integrations">
          <PlugZap aria-hidden="true" /> Integrations
        </Link>
        <Link href="/learning">Help & documentation</Link>
      </div>
    </details>
  );
}

export function ContextPrimaryAction({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/settings")) return null;
  if (pathname.startsWith("/product-research"))
    return (
      <ButtonLink href="/product-research" size="sm">
        Research product
      </ButtonLink>
    );
  if (pathname.startsWith("/research-projects"))
    return (
      <ButtonLink href="/research-projects?create=1" size="sm">
        New project
      </ButtonLink>
    );
  if (pathname.startsWith("/product-explorer"))
    return (
      <ButtonLink href="/product-research" size="sm">
        Add product
      </ButtonLink>
    );
  return (
    <ButtonLink href="/uploads" size="sm">
      New scan
    </ButtonLink>
  );
}

export function SidebarConnectionSummary() {
  const [status, setStatus] = useState<AmazonStatus | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/providers/amazon", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => setStatus(value))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const connected =
    status?.dataOrigin === "LIVE_AMAZON" &&
    connectedStates.has(status.connectionState ?? "");
  const label = connected ? "Connected" : status?.localDemo ? "Demo" : "Setup";
  return (
    <Link href="/settings/integrations/amazon" className="sidebar-connection">
      <span className="sidebar-connection__icon" aria-hidden="true">
        <PlugZap />
      </span>
      <span>
        <strong>Amazon connection</strong>
        <small>View provider health</small>
      </span>
      <Badge tone={connected ? "success" : "neutral"}>{label}</Badge>
    </Link>
  );
}
