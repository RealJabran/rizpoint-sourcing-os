"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type PropsWithChildren } from "react";
import { MarketplaceSwitcher } from "@/src/marketplace-switcher";
import { CommandPalette } from "./command-palette";
import { NavigationMenu } from "./navigation-menu";
import { ButtonLink, ToastProvider } from "./ui";

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  if (pathname === "/login") return <>{children}</>;

  return (
    <ToastProvider>
      <div className="app-shell">
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
          <Link
            href="/"
            className="brand"
            onClick={() => setMobileNavigationOpen(false)}
            aria-label="RizPoint dashboard"
          >
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>RizPoint</strong>
              <small>Research OS</small>
            </span>
          </Link>
          <NavigationMenu
            pathname={pathname}
            onNavigate={() => setMobileNavigationOpen(false)}
          />
          <div className="sidebar-footer">
            <p>Evidence-first sourcing decisions.</p>
          </div>
        </aside>
        <div className="app-frame">
          <header className="app-topbar">
            <div className="topbar-leading">
              <button
                className="mobile-menu-button"
                type="button"
                aria-label="Open navigation"
                aria-expanded={mobileNavigationOpen}
                aria-controls="primary-navigation"
                onClick={() => setMobileNavigationOpen(true)}
              >
                <span />
                <span />
                <span />
              </button>
              <CommandPalette />
            </div>
            <div className="topbar-actions">
              <MarketplaceSwitcher />
              <span className="workspace-status">
                <span aria-hidden="true" /> Private workspace
              </span>
              <ButtonLink href="/uploads" size="sm">
                New scan
              </ButtonLink>
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
