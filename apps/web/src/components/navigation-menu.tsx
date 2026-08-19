"use client";

import Link from "next/link";
import { useState } from "react";
import { NavGlyph } from "./nav-glyph";
import { navigationGroups, routeIsActive } from "./navigation";

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
    activeGroup ? [activeGroup] : ["Dashboard", "Wholesale"],
  );
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
          const expanded = opened.includes(group.label) || active;
          const panelId = `nav-${group.label.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
          return (
            <li className="nav-group" key={group.label}>
              <button
                type="button"
                className={`nav-group__button ${active ? "nav-group__button--active" : ""}`}
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() =>
                  setOpened((current) =>
                    current.includes(group.label)
                      ? current.filter((value) => value !== group.label)
                      : [...current, group.label],
                  )
                }
              >
                <NavGlyph name={group.icon} />
                <span>{group.label}</span>
                <span className="nav-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {expanded ? (
                <ul id={panelId} className="nav-group__items">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`nav-item ${routeIsActive(pathname, item.href) ? "nav-item--active" : ""}`}
                        aria-current={
                          routeIsActive(pathname, item.href)
                            ? "page"
                            : undefined
                        }
                        onClick={onNavigate}
                      >
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
