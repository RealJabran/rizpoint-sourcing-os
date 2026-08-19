import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { navigationGroups } from "../src/components/navigation";
import {
  metricContext,
  statePresentation,
} from "../src/components/research-ui-policy";

describe("next-level research UI architecture", () => {
  it("keeps the requested information architecture and wholesale routes", () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      "Dashboard",
      "Wholesale",
      "Product Research",
      "Niches",
      "Keywords",
      "Markets",
      "Brands & Sellers",
      "Projects",
      "Monitoring",
      "Launch",
      "Settings",
    ]);
    expect(
      navigationGroups
        .find((group) => group.label === "Wholesale")
        ?.items.map((item) => item.href),
    ).toEqual([
      "/uploads",
      "/scans",
      "/analysis",
      "/shortlists",
      "/purchase-orders",
    ]);
  });

  it("formats metric state and context without color-only meaning", () => {
    expect(statePresentation.STALE).toEqual({
      symbol: "△",
      label: "Stale",
      tone: "warning",
    });
    expect(
      metricContext({
        source: "Keepa",
        window: "90 days",
        observedAt: "2026-08-18T12:00:00.000Z",
      }),
    ).toEqual(["Keepa", "90 days", "Observed 2026-08-18T12:00:00.000Z"]);
  });

  it("keeps keyboard, drawer, responsive, and view-toggle affordances in source", async () => {
    const [researchUi, palette, styles] = await Promise.all([
      readFile(
        new URL("../src/components/research-ui.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/components/command-palette.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/styles.css", import.meta.url), "utf8"),
    ]);
    expect(researchUi).toContain('role="dialog"');
    expect(researchUi).toContain('event.key === "Escape"');
    expect(researchUi).toContain('aria-pressed={value === "table"}');
    expect(palette).toContain("event.metaKey || event.ctrlKey");
    expect(palette).toContain('aria-modal="true"');
    expect(styles).toContain("@media (max-width: 840px)");
    expect(styles).toContain("@media (max-width: 620px)");
    expect(styles).toContain("prefers-reduced-motion");
  });
});
