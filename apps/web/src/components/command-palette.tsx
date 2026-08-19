"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { navigationItems } from "./navigation";

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
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
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
        <span>Jump to…</span>
        <kbd>⌘K</kbd>
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
            <input
              ref={inputRef}
              className="rp-input command-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workflows"
              aria-label="Search RizPoint workflows"
            />
            <ul role="list" aria-label="Matching workflows">
              {matches.map((item) => (
                <li key={item.href}>
                  <button type="button" onClick={() => navigate(item.href)}>
                    <span>{item.label}</span>
                    <small>{item.href}</small>
                  </button>
                </li>
              ))}
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
