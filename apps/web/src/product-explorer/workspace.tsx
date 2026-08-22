"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  ButtonLink,
  SelectControl,
  TextInput,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";
import { CompareTray, FilterBar } from "@/src/components/research-ui";
import { PRODUCT_EXPLORER_PRESETS } from "./contracts";
import { explorerQuery } from "./query";
import { ExplorerResultsTable } from "./results-table";
import type { ExplorerRow, ExplorerView, Filters, Project } from "./types";

export function ProductExplorerWorkspace() {
  const { notify } = useToast();
  const [filters, setFilters] = useState<Filters>({});
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [views, setViews] = useState<ExplorerView[]>([]);
  const [viewName, setViewName] = useState("");

  const load = useCallback(
    async (nextFilters = filters) => {
      // Let the mount effect complete before changing UI state. Fetches from
      // user actions still update immediately on the following microtask.
      await Promise.resolve();
      setLoading(true);
      const response = await fetch(
        `/api/product-explorer?${explorerQuery(nextFilters)}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => null);
      setLoading(false);
      if (!response.ok)
        return notify(
          payload?.error ?? "Could not load Product Explorer",
          "danger",
        );
      setRows(payload.rows);
      setTotal(payload.total);
      setSelected([]);
      setCompare([]);
    },
    [filters, notify],
  );
  const loadViews = useCallback(async () => {
    const response = await fetch("/api/product-explorer/views", {
      cache: "no-store",
    });
    if (response.ok) setViews(await response.json());
  }, []);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/product-explorer?${explorerQuery({})}`, {
      cache: "no-store",
    })
      .then(async (response) => ({
        response,
        payload: await response.json().catch(() => null),
      }))
      .then(({ response, payload }) => {
        if (cancelled) return;
        setLoading(false);
        if (!response.ok)
          return notify(
            payload?.error ?? "Could not load Product Explorer",
            "danger",
          );
        setRows(payload.rows);
        setTotal(payload.total);
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          notify("Could not load Product Explorer", "danger");
        }
      });
    void fetch("/api/research-projects", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setProjects(payload);
      });
    void fetch("/api/product-explorer/views", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then((payload) => {
        if (!cancelled) setViews(payload);
      });
    return () => {
      cancelled = true;
    };
  }, [notify]);

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.includes(row.id)),
    [rows, selected],
  );
  const marketplace = selectedRows[0]?.marketplaceId ?? filters.marketplaceId;
  const applyPreset = (state: Record<string, string | number>) => {
    const next = Object.fromEntries(
      Object.entries(state).map(([key, value]) => [key, String(value)]),
    );
    setFilters(next);
    void load(next);
  };
  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  const toggleCompare = (id: string) =>
    setCompare((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= 4
          ? current
          : [...current, id],
    );
  const act = async (action: "SAVE_TO_PROJECT" | "WATCH") => {
    if (!selected.length)
      return notify("Select at least one product first.", "warning");
    if (action === "SAVE_TO_PROJECT" && !projectId)
      return notify("Choose a research project first.", "warning");
    if (action === "WATCH" && !marketplace)
      return notify(
        "A marketplace is required before watching products.",
        "warning",
      );
    const response = await fetch("/api/product-explorer/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        productIds: selected,
        ...(action === "SAVE_TO_PROJECT"
          ? { projectId }
          : {
              marketplaceId: marketplace,
              ...(projectId ? { projectId } : {}),
            }),
      }),
    });
    const payload = await response.json().catch(() => null);
    notify(
      response.ok
        ? `${payload.count} product${payload.count === 1 ? "" : "s"} updated.`
        : (payload?.error ?? "Action failed"),
      response.ok ? "success" : "danger",
    );
    if (response.ok) void load();
  };
  const createProject = async () => {
    if (!newProjectName.trim() || !marketplace)
      return notify("Provide a project name and marketplace.", "warning");
    const response = await fetch("/api/research-projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newProjectName,
        marketplaceId: marketplace,
        mode: "PRIVATE_LABEL",
      }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      return notify(payload?.error ?? "Could not create project", "danger");
    setProjects((current) => [payload, ...current]);
    setProjectId(payload.id);
    setNewProjectName("");
    notify("Research project created.");
  };
  const saveView = async () => {
    if (!viewName.trim())
      return notify("Give this view a name first.", "warning");
    const response = await fetch("/api/product-explorer/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: viewName, queryState: filters }),
    });
    if (!response.ok)
      return notify("Could not save this Explorer view.", "danger");
    setViewName("");
    void loadViews();
    notify("Explorer view saved.");
  };

  return (
    <main className="content-page product-explorer">
      <PageHeader
        title="Product Explorer"
        description="Discover only products already present in your private, organization-scoped evidence universe."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Product Explorer" },
        ]}
      />
      <Alert tone="info" title="Honest source universe">
        Results include imported accepted matches, saved project products,
        active watches, market members, and refreshed-history products. This is
        not a global Amazon catalog; unavailable metrics remain blank.
      </Alert>
      <FilterBar
        label="Explore the private product universe"
        actions={
          <span className="filter-count">
            {total.toLocaleString()} matching products
          </span>
        }
      >
        <div className="explorer-controls">
          <div className="explorer-filter-grid">
            <TextInput
              aria-label="Search ASIN title or brand"
              placeholder="ASIN, title, or brand"
              value={filters.search ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  search: event.target.value,
                }))
              }
            />
            <TextInput
              aria-label="Marketplace"
              placeholder="Marketplace ID"
              value={filters.marketplaceId ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  marketplaceId: event.target.value,
                }))
              }
            />
            <TextInput
              aria-label="Brand"
              placeholder="Brand"
              value={filters.brand ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  brand: event.target.value,
                }))
              }
            />
            <TextInput
              aria-label="Maximum review count"
              type="number"
              min="0"
              placeholder="Max reviews"
              value={filters.maxReviewCount ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  maxReviewCount: event.target.value,
                }))
              }
            />
            <TextInput
              aria-label="Maximum 90 day price volatility"
              inputMode="decimal"
              placeholder="Max 90d volatility %"
              value={filters.maxPriceVolatilityPercent ?? ""}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  maxPriceVolatilityPercent: event.target.value,
                }))
              }
            />
            <Button type="button" onClick={() => void load()}>
              Apply filters
            </Button>
          </div>
          <div className="explorer-presets" aria-label="Explorer presets">
            {PRODUCT_EXPLORER_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant="secondary"
                size="sm"
                title={preset.explanation}
                onClick={() => applyPreset(preset.state)}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => {
                setFilters({});
                void load({});
              }}
            >
              Clear
            </Button>
          </div>
          <div className="explorer-saved-views">
            <SelectControl
              aria-label="Saved Product Explorer view"
              defaultValue=""
              onChange={(event) => {
                const view = views.find(
                  (item) => item.id === event.target.value,
                );
                if (view) {
                  setFilters(view.queryState);
                  void load(view.queryState);
                }
              }}
            >
              <option value="">Saved views</option>
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </SelectControl>
            <TextInput
              aria-label="Save current Explorer view as"
              placeholder="Save current view as"
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => void saveView()}
            >
              Save view
            </Button>
          </div>
        </div>
      </FilterBar>
      <section
        className="explorer-actions"
        aria-label="Product Explorer actions"
      >
        <strong>
          {total.toLocaleString()} products in this exact filtered organization
          universe
        </strong>
        <div>
          <SelectControl
            aria-label="Research project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose research project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </SelectControl>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void act("SAVE_TO_PROJECT")}
          >
            Save to project
          </Button>
          {projectId ? (
            <ButtonLink
              href={`/research-projects?projectId=${encodeURIComponent(projectId)}`}
              size="sm"
              variant="quiet"
            >
              Open project
            </ButtonLink>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void act("WATCH")}
          >
            Watch
          </Button>
          <a
            className="rp-button rp-button--quiet rp-button--sm"
            href={`/api/product-explorer/export?${explorerQuery(filters)}`}
          >
            Export visible CSV
          </a>
        </div>
        <div className="explorer-create-project">
          <TextInput
            aria-label="New research project name"
            placeholder="New project name"
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="quiet"
            onClick={() => void createProject()}
          >
            Create project
          </Button>
        </div>
      </section>
      <CompareTray
        count={compare.length}
        maximum={4}
        onClear={() => setCompare([])}
      >
        {rows
          .filter((row) => compare.includes(row.id))
          .map((row) => (
            <span key={row.id}>{row.asin ?? row.title}</span>
          ))}
      </CompareTray>
      <ExplorerResultsTable
        rows={rows}
        loading={loading}
        selected={selected}
        compare={compare}
        onSelect={toggleSelected}
        onCompare={toggleCompare}
      />
      <p className="explorer-footnote">
        Only filters with stored, typed evidence are active. Monthly
        units/revenue, seller or brand concentration, variation counts,
        opportunity scores, and private-label profit assumptions require later
        licensed providers or deterministic research modules.
      </p>
    </main>
  );
}
