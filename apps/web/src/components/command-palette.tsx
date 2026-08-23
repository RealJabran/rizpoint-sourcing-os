"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NavGlyph } from "./nav-glyph";
import { navigationGroups, navigationItems } from "./navigation";

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    if (open) {
      document.body.classList.add("dialog-open");
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else document.body.classList.remove("dialog-open");
    return () => document.body.classList.remove("dialog-open");
  }, [open]);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-US");
    return navigationItems
      .filter(
        (item) =>
          !needle ||
          `${item.label} ${item.keywords?.join(" ") ?? ""}`
            .toLocaleLowerCase("en-US")
            .includes(needle),
      )
      .slice(0, 10);
  }, [query]);
  const navigate = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };
  return (
    <>
      <button
        className="command-trigger"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
        <span>Search RizPoint</span>
        <kbd>⌘ K</kbd>
      </button>
      {open ? (
        <div
          className="command-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-title"
          >
            <h2 id="command-title" className="sr-only">
              Navigate RizPoint
            </h2>
            <div className="command-input-wrap">
              <Search aria-hidden="true" />
              <input
                ref={inputRef}
                className="command-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search products, projects, and workflows…"
                aria-label="Search RizPoint workflows"
              />
              <kbd>ESC</kbd>
            </div>
            <p className="command-section-label">Navigate</p>
            <ul role="list" aria-label="Matching workflows">
              {matches.map((item) => {
                const group = navigationGroups.find((candidate) =>
                  candidate.items.some(
                    (groupItem) => groupItem.href === item.href,
                  ),
                );
                return (
                  <li key={item.href}>
                    <button type="button" onClick={() => navigate(item.href)}>
                      <NavGlyph name={item.icon} />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{group?.label ?? "Workspace"}</small>
                      </span>
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {!matches.length ? (
              <p className="command-empty">No matching workflow.</p>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  );
}
