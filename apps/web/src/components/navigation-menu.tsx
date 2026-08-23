"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NavGlyph } from "./nav-glyph";
import { navigationGroups, routeIsActive } from "./navigation";

const storageKey = "rizpoint.navigation.openGroups";

export function NavigationMenu({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate(): void;
}) {
  const activeGroup = navigationGroups.find((group) =>
    group.items.some((item) => routeIsActive(pathname, item.href)),
  )?.label;
  const [opened, setOpened] = useState<string[]>(
    activeGroup && activeGroup !== "Home" ? [activeGroup] : ["Sourcing"],
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) return;
    let nextOpened: string[] | null = null;
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed))
        nextOpened = parsed.filter(
          (value): value is string => typeof value === "string",
        );
    } catch {
      window.localStorage.removeItem(storageKey);
    }
    if (!nextOpened) return;
    const timeout = window.setTimeout(() => setOpened(nextOpened), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const updateOpened = (label: string) => {
    setOpened((current) => {
      const next = current.includes(label)
        ? current.filter((value) => value !== label)
        : [...current, label];
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  return (
    <nav
      id="primary-navigation"
      className="primary-nav"
      aria-label="Primary navigation"
    >
      <ul className="nav-groups">
        {navigationGroups.map((group) => {
          const active = group.items.some((item) =>
            routeIsActive(pathname, item.href),
          );
          if (group.label === "Home") {
            const item = group.items[0]!;
            return (
              <li className="nav-group nav-group--home" key={group.label}>
                <Link
                  href={item.href}
                  className={`nav-group__button nav-group__link ${active ? "nav-group__button--active" : ""}`}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  title={item.label}
                >
                  <NavGlyph name={item.icon} />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          }
          const expanded = opened.includes(group.label) || active;
          const panelId = `nav-${group.label.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
          return (
            <li className="nav-group" key={group.label}>
              <button
                type="button"
                className={`nav-group__button ${active ? "nav-group__button--active" : ""}`}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => updateOpened(group.label)}
                title={group.label}
              >
                <NavGlyph name={group.icon} />
                <span>{group.label}</span>
                <ChevronDown className="nav-chevron" aria-hidden="true" />
              </button>
              {expanded ? (
                <ul id={panelId} className="nav-group__items">
                  {group.items.map((item) => {
                    const itemActive = routeIsActive(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={`nav-item ${itemActive ? "nav-item--active" : ""}`}
                          aria-current={itemActive ? "page" : undefined}
                          onClick={onNavigate}
                          title={item.label}
                        >
                          <NavGlyph name={item.icon} />
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
