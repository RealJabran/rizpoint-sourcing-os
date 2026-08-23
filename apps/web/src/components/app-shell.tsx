"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type PropsWithChildren } from "react";
import { MarketplaceSwitcher } from "@/src/marketplace-switcher";
import { CommandPalette } from "./command-palette";
import { NavigationMenu } from "./navigation-menu";
import { navigationItemForPath } from "./navigation";
import {
  AmazonConnectionControl,
  ContextPrimaryAction,
  NotificationControl,
  SidebarConnectionSummary,
  ThemeControl,
  UserControl,
} from "./shell-controls";
import { ToastProvider } from "./ui";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(
      () =>
        setCollapsed(
          window.localStorage.getItem("rizpoint.sidebar.collapsed") === "true",
        ),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, []);
  if (pathname === "/login") return <>{children}</>;
  const context = navigationItemForPath(pathname);

  return (
    <ToastProvider>
      <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        {mobileNavigationOpen ? (
          <button
            className="nav-scrim"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavigationOpen(false)}
          />
        ) : null}
        <aside
          className={`app-sidebar ${mobileNavigationOpen ? "app-sidebar--open" : ""}`}
          aria-label="RizPoint workspace navigation"
        >
          <div className="sidebar-brand-row">
            <Link
              href="/"
              className="brand"
              onClick={() => setMobileNavigationOpen(false)}
              aria-label="RizPoint home"
            >
              <span className="brand-mark" aria-hidden="true">
                <span>R</span>
              </span>
              <span className="brand-copy">
                <strong>RizPoint</strong>
                <small>Sourcing intelligence</small>
              </span>
            </Link>
            <button
              className="sidebar-collapse-button"
              type="button"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => {
                const next = !collapsed;
                setCollapsed(next);
                window.localStorage.setItem(
                  "rizpoint.sidebar.collapsed",
                  String(next),
                );
              }}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden="true" />
              ) : (
                <PanelLeftClose aria-hidden="true" />
              )}
            </button>
          </div>
          <NavigationMenu
            pathname={pathname}
            onNavigate={() => setMobileNavigationOpen(false)}
          />
          <div className="sidebar-footer">
            <SidebarConnectionSummary />
          </div>
        </aside>
        <div className="app-frame">
          <header className="app-topbar">
            <div className="topbar-leading">
              <button
                className="mobile-menu-button shell-icon-button"
                type="button"
                aria-label="Open navigation"
                aria-expanded={mobileNavigationOpen}
                aria-controls="primary-navigation"
                onClick={() => setMobileNavigationOpen(true)}
              >
                <Menu aria-hidden="true" />
              </button>
              <div className="topbar-context" aria-label="Current workspace">
                <span>{context?.label ?? "RizPoint"}</span>
              </div>
              <CommandPalette />
            </div>
            <div className="topbar-actions">
              <MarketplaceSwitcher />
              <AmazonConnectionControl />
              <NotificationControl />
              <ThemeControl />
              <UserControl />
              <ContextPrimaryAction pathname={pathname} />
            </div>
          </header>
          <div id="main-content" className="app-content" tabIndex={-1}>
            {children}
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}
