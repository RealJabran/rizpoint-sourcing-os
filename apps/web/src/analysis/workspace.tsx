"use client";

import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ANALYSIS_PAGE_SIZE, pageOffsetForIndex } from "./window";
import { observationFreshness, requiredNextActions } from "./evidence";

const PAGE_SIZE = ANALYSIS_PAGE_SIZE;
const GROUPS = ["identity", "decision", "economics", "risk"] as const;
type Group = (typeof GROUPS)[number];
type Row = {
  id: string;
  status: string;
  recommendation: string | null;
  currentNetProfit: { toString(): string } | null;
  conservativeNetProfit: { toString(): string } | null;
  stressNetProfit: { toString(): string } | null;
  effectiveCogs: { toString(): string } | null;
  roiPercent: { toString(): string } | null;
  marginPercent: { toString(): string } | null;
  breakEvenPrice: { toString(): string } | null;
  reasonCodes: string[];
  supplierRow: {
    sourceRowNumber: number;
    normalizedOffer: {
      asin: string | null;
      itemNumber: string | null;
      description: string | null;
      brand: string | null;
    } | null;
    warnings: Array<{ code: string }>;
    matchDecision: {
      status: string;
      confidence: number;
      selectedCandidate: {
        catalogProduct: {
          asin: string | null;
          title: string;
          brand: string | null;
        };
        packGuard: { status: string; reasonCode: string } | null;
      } | null;
    } | null;
    profitCostOverrides: Array<{
      revision: number;
      status: string;
      stressDiscountPercent: { toString(): string } | null;
      values: Array<{ field: string; value: { toString(): string } }>;
    }>;
  };
};
type Route = { id: string; name: string; currency: string };
type Detail = Record<string, unknown> & {
  id: string;
  engineVersion: string;
  reasonCodes: string[];
  inputSnapshot: unknown;
  evidence: unknown;
  supplierRow: Record<string, unknown>;
};

function decimal(value: { toString(): string } | null): string {
  return value?.toString() ?? "—";
}

export function AnalysisWorkspace({ scanId }: { scanId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(new Map<number, Row[]>());
  const [pages, setPages] = useState(new Map<number, Row[]>());
  const [total, setTotal] = useState(0);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeId, setRouteId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [status, setStatus] = useState("");
  const [minRoiPercent, setMinRoiPercent] = useState("");
  const [maxRoiPercent, setMaxRoiPercent] = useState("");
  const [sort, setSort] = useState("sourceRowNumber");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [groups, setGroups] = useState<Set<Group>>(new Set(GROUPS));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Detail | null>(null);
  const [accessibleMode, setAccessibleMode] = useState(false);
  const [viewName, setViewName] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [accessibleOffset, setAccessibleOffset] = useState(0);
  const queryKeyRef = useRef("");
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const [views, setViews] = useState<
    Array<{
      id: string;
      name: string;
      queryState: {
        routeId?: string;
        recommendation?: string;
        status?: string;
        search?: string;
        minRoiPercent?: string;
        maxRoiPercent?: string;
        sort?: string;
        direction?: "asc" | "desc";
        visibleGroups?: Group[];
      };
    }>
  >([]);
  const queryKey = `${routeId ?? ""}|${search}|${recommendation}|${status}|${minRoiPercent}|${maxRoiPercent}|${sort}|${direction}|${refreshNonce}`;
  queryKeyRef.current = queryKey;

  const requestPage = useCallback(
    async (offset: number, reset = false) => {
      if (!reset && pagesRef.current.has(offset)) return;
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(PAGE_SIZE),
        sort,
        direction,
      });
      if (routeId) params.set("routeId", routeId);
      if (search.trim().length >= 2) params.set("search", search.trim());
      if (recommendation) params.set("recommendation", recommendation);
      if (status) params.set("status", status);
      if (minRoiPercent.trim())
        params.set("minRoiPercent", minRoiPercent.trim());
      if (maxRoiPercent.trim())
        params.set("maxRoiPercent", maxRoiPercent.trim());
      const requestedQueryKey = queryKey;
      const response = await fetch(`/api/scans/${scanId}/results?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load analysis results.");
      const data = (await response.json()) as {
        total: number;
        rows: Row[];
        routes: Route[];
        shippingRouteId?: string;
      };
      if (queryKeyRef.current !== requestedQueryKey) return;
      if (reset) pagesRef.current = new Map();
      pagesRef.current.set(offset, data.rows);
      setPages(new Map(pagesRef.current));
      setTotal(data.total);
      setRoutes(data.routes);
      if (!routeId && data.shippingRouteId) setRouteId(data.shippingRouteId);
    },
    [
      direction,
      maxRoiPercent,
      minRoiPercent,
      queryKey,
      recommendation,
      routeId,
      scanId,
      search,
      sort,
      status,
    ],
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAccessibleOffset(0);
    pagesRef.current = new Map();
    setPages(new Map());
    void requestPage(0, true)
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load analysis results.",
        ),
      )
      .finally(() => setLoading(false));
  }, [queryKey, requestPage]);

  useEffect(() => {
    if (!accessibleMode) return;
    void requestPage(accessibleOffset).catch(() =>
      setError("Unable to load the requested accessible table page."),
    );
  }, [accessibleMode, accessibleOffset, requestPage]);

  const hasPendingRecalculation = useMemo(
    () =>
      [...pages.values()]
        .flat()
        .some((row) =>
          row.supplierRow.profitCostOverrides.some(
            (override) => override.status === "PENDING_RECALCULATION",
          ),
        ),
    [pages],
  );
  useEffect(() => {
    if (!hasPendingRecalculation) return;
    const timer = window.setTimeout(
      () => setRefreshNonce((current) => current + 1),
      1_500,
    );
    return () => window.clearTimeout(timer);
  }, [hasPendingRecalculation]);

  useEffect(() => {
    void fetch(`/api/analysis-views?scanId=${scanId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load saved views.");
        return (await response.json()) as typeof views;
      })
      .then(setViews)
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load saved views.",
        ),
      );
  }, [scanId]);

  // TanStack Virtual owns imperative scroll measurements; this hook is intentionally
  // outside React Compiler memoization.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
    useFlushSync: false,
  });
  const virtualRows = virtualizer.getVirtualItems();
  useEffect(() => {
    for (const item of virtualRows)
      void requestPage(pageOffsetForIndex(item.index)).catch(() =>
        setError("Unable to load more analysis results."),
      );
  }, [requestPage, virtualRows]);

  const visibleRows = useMemo(
    () =>
      virtualRows.map((item) => ({
        item,
        row: pages.get(pageOffsetForIndex(item.index))?.[
          item.index % PAGE_SIZE
        ],
      })),
    [pages, virtualRows],
  );
  const selectedRouteCurrency = routes.find(
    (route) => route.id === routeId,
  )?.currency;

  async function openDetail(resultId: string): Promise<void> {
    detailTriggerRef.current = document.activeElement as HTMLElement | null;
    const response = await fetch(`/api/results/${resultId}`, {
      cache: "no-store",
    });
    if (!response.ok) return setError("Unable to load product evidence.");
    setDetail((await response.json()) as Detail);
  }

  async function saveView(): Promise<void> {
    if (!viewName.trim()) return;
    const response = await fetch("/api/analysis-views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scanId,
        name: viewName,
        queryState: {
          schemaVersion: 1,
          routeId,
          recommendation: recommendation || undefined,
          status: status || undefined,
          search: search || undefined,
          minRoiPercent: minRoiPercent || undefined,
          maxRoiPercent: maxRoiPercent || undefined,
          sort,
          direction,
          visibleGroups: [...groups],
        },
      }),
    });
    if (!response.ok) return setError("Unable to save view.");
    const saved = (await response.json()) as (typeof views)[number];
    setViews((current) => [
      saved,
      ...current.filter((view) => view.name !== viewName),
    ]);
    setViewName("");
  }

  async function bulkAction(
    action: "RECALCULATE" | "CLEAR_COST_OVERRIDE",
  ): Promise<void> {
    if (selected.size === 0) return;
    if (
      action === "CLEAR_COST_OVERRIDE" &&
      !window.confirm(
        `Clear persisted cost overrides for ${selected.size} selected result(s)? This queues deterministic recalculation.`,
      )
    )
      return;
    const response = await fetch("/api/results/bulk-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        resultIds: [...selected],
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.ok) setError("Unable to queue the bulk action.");
    else {
      const body = (await response.json()) as {
        outcomes: Array<{ status: string }>;
      };
      const failures = body.outcomes.filter(
        (outcome) =>
          !["QUEUED", "DUPLICATE", "SKIPPED_NO_OVERRIDE"].includes(
            outcome.status,
          ),
      );
      if (failures.length)
        setError(`${failures.length} selected result(s) could not be queued.`);
      setSelected(new Set());
      setRefreshNonce((current) => current + 1);
    }
  }

  return (
    <main className="analysis-workspace">
      <a className="skip-link" href="#analysis-grid">
        Skip to results
      </a>
      <header className="analysis-header">
        <div>
          <h1>Analysis workspace</h1>
          <p>
            {total.toLocaleString()} current results · server-windowed for large
            scans
          </p>
        </div>
      </header>
      <section className="analysis-toolbar" aria-label="Result filters">
        <label>
          Route{" "}
          <select
            value={routeId ?? ""}
            onChange={(event) => setRouteId(event.target.value || undefined)}
          >
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} ({route.currency})
              </option>
            ))}
          </select>
        </label>
        <label>
          Search{" "}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ASIN, brand, title"
          />
        </label>
        <label>
          Recommendation{" "}
          <select
            value={recommendation}
            onChange={(event) => setRecommendation(event.target.value)}
          >
            <option value="">All</option>
            {[
              "BUY",
              "WATCH",
              "REVIEW_MATCH",
              "REVIEW_APPROVAL",
              "REVIEW_COST",
              "AVOID",
              "INSUFFICIENT_DATA",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Calculation status{" "}
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="PARTIAL_SUCCESS">PARTIAL_SUCCESS</option>
          </select>
        </label>
        <label>
          Min ROI %{" "}
          <input
            inputMode="decimal"
            value={minRoiPercent}
            onChange={(event) => setMinRoiPercent(event.target.value)}
          />
        </label>
        <label>
          Max ROI %{" "}
          <input
            inputMode="decimal"
            value={maxRoiPercent}
            onChange={(event) => setMaxRoiPercent(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Presets</legend>
          <button
            type="button"
            onClick={() => {
              setRecommendation("BUY");
              setStatus("COMPLETED");
            }}
          >
            Buy candidates
          </button>
          <button
            type="button"
            onClick={() => {
              setRecommendation("");
              setStatus("PARTIAL_SUCCESS");
            }}
          >
            Missing data
          </button>
          <button
            type="button"
            onClick={() => {
              setRecommendation("REVIEW_MATCH");
              setStatus("");
            }}
          >
            Review matches
          </button>
        </fieldset>
        <label>
          Sort{" "}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
          >
            {[
              "sourceRowNumber",
              "conservativeNetProfit",
              "roiPercent",
              "marginPercent",
              "breakEvenPrice",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            setDirection((value) => (value === "asc" ? "desc" : "asc"))
          }
        >
          Order: {direction}
        </button>
        <fieldset>
          <legend>Columns</legend>
          {GROUPS.filter((group) => group !== "identity").map((group) => (
            <label key={group}>
              <input
                type="checkbox"
                checked={groups.has(group)}
                onChange={() =>
                  setGroups((current) => {
                    const next = new Set(current);
                    if (next.has(group)) next.delete(group);
                    else next.add(group);
                    return next.size ? next : current;
                  })
                }
              />{" "}
              {group}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={accessibleMode}
            onChange={(event) => setAccessibleMode(event.target.checked)}
          />{" "}
          Accessible table mode
        </label>
        <label>
          View name{" "}
          <input
            value={viewName}
            onChange={(event) => setViewName(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void saveView()}>
          Save view
        </button>
        <label>
          Saved view{" "}
          <select
            defaultValue=""
            onChange={(event) => {
              const view = views.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (!view) return;
              setRouteId(view.queryState.routeId);
              setRecommendation(view.queryState.recommendation ?? "");
              setStatus(view.queryState.status ?? "");
              setSearch(view.queryState.search ?? "");
              setMinRoiPercent(view.queryState.minRoiPercent ?? "");
              setMaxRoiPercent(view.queryState.maxRoiPercent ?? "");
              setSort(view.queryState.sort ?? "sourceRowNumber");
              setDirection(view.queryState.direction ?? "asc");
              if (view.queryState.visibleGroups?.length)
                setGroups(new Set(view.queryState.visibleGroups));
            }}
          >
            <option value="">Select…</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {selected.size ? (
        <section className="bulk-bar" aria-live="polite">
          <span>{selected.size} selected</span>
          <button type="button" onClick={() => void bulkAction("RECALCULATE")}>
            Recalculate selected
          </button>
          <button
            type="button"
            onClick={() => void bulkAction("CLEAR_COST_OVERRIDE")}
          >
            Clear selected overrides
          </button>
          <button type="button" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Loading analysis results…</p> : null}
      {!loading && total === 0 ? (
        <p>
          No current results match these filters. Calculate a scan or adjust the
          filters.
        </p>
      ) : null}
      {accessibleMode ? (
        <AccessibleTable
          rows={pages.get(accessibleOffset) ?? []}
          groups={groups}
          onOpen={openDetail}
          offset={accessibleOffset}
          total={total}
          onPage={(offset) => setAccessibleOffset(offset)}
        />
      ) : (
        <div
          id="analysis-grid"
          ref={scrollRef}
          className="analysis-grid"
          role="grid"
          aria-rowcount={total}
          aria-label="Analysis results"
          tabIndex={0}
        >
          <div className="analysis-grid-header" role="row">
            <span className="pin select" role="columnheader" aria-colindex={1}>
              Select
            </span>
            <span
              className="pin identity"
              role="columnheader"
              aria-colindex={2}
            >
              Identity
            </span>
            {groups.has("decision") ? (
              <span role="columnheader">Decision</span>
            ) : null}
            {groups.has("economics") ? (
              <span role="columnheader">Economics</span>
            ) : null}
            {groups.has("risk") ? <span role="columnheader">Risk</span> : null}
            <span role="columnheader">Actions</span>
          </div>
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              position: "relative",
            }}
          >
            {visibleRows.map(({ item, row }) => (
              <GridRow
                key={item.key}
                row={row}
                index={item.index}
                groups={groups}
                selected={selected}
                setSelected={setSelected}
                onOpen={openDetail}
                currency={selectedRouteCurrency ?? ""}
                onQueued={() => setRefreshNonce((current) => current + 1)}
              />
            ))}
          </div>
        </div>
      )}
      {detail ? (
        <EvidenceDrawer
          detail={detail}
          onClose={() => {
            setDetail(null);
            detailTriggerRef.current?.focus();
          }}
        />
      ) : null}
    </main>
  );
}

function GridRow({
  row,
  index,
  groups,
  selected,
  setSelected,
  onOpen,
  currency,
  onQueued,
}: {
  row: Row | undefined;
  index: number;
  groups: Set<Group>;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  onOpen: (id: string) => Promise<void>;
  currency: string;
  onQueued: () => void;
}) {
  if (!row)
    return (
      <div
        className="analysis-grid-row loading-row"
        style={{ transform: `translateY(${index * 48}px)` }}
        role="row"
      >
        Loading row…
      </div>
    );
  const offer = row.supplierRow.normalizedOffer;
  const override = row.supplierRow.profitCostOverrides[0];
  return (
    <div
      className="analysis-grid-row"
      style={{ transform: `translateY(${index * 48}px)` }}
      role="row"
      aria-rowindex={index + 1}
    >
      <span className="pin select" role="gridcell" aria-colindex={1}>
        <input
          aria-label={`Select row ${row.supplierRow.sourceRowNumber}`}
          type="checkbox"
          checked={selected.has(row.id)}
          onChange={() => {
            const next = new Set(selected);
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
            setSelected(next);
          }}
        />
      </span>
      <span className="pin identity" role="gridcell" aria-colindex={2}>
        <button
          className="row-link"
          type="button"
          onClick={() => void onOpen(row.id)}
        >
          #{row.supplierRow.sourceRowNumber} ·{" "}
          {offer?.asin ?? offer?.itemNumber ?? "Unidentified"}
          <small>
            {offer?.brand ?? "Unknown brand"} ·{" "}
            {offer?.description ?? "No title"}
          </small>
        </button>
      </span>
      {groups.has("decision") ? (
        <span role="gridcell">
          <strong>
            {row.status} · {row.recommendation ?? "NO_RECOMMENDATION"}
          </strong>
          <small>
            {row.supplierRow.matchDecision?.status ?? "UNMATCHED"} ·{" "}
            {row.supplierRow.matchDecision?.confidence ?? 0}%
            {override
              ? ` · Override ${override.revision}: ${override.status}`
              : ""}
          </small>
        </span>
      ) : null}
      {groups.has("economics") ? (
        <span role="gridcell">
          Current net {currency} {decimal(row.currentNetProfit)} · Conservative
          net {currency} {decimal(row.conservativeNetProfit)} · Current ROI{" "}
          {decimal(row.roiPercent)}%
          <small>
            COGS {currency} {decimal(row.effectiveCogs)} · Break-even {currency}{" "}
            {decimal(row.breakEvenPrice)}
          </small>
        </span>
      ) : null}
      {groups.has("risk") ? (
        <span role="gridcell">
          {row.supplierRow.matchDecision?.selectedCandidate?.packGuard
            ?.status ?? "PACK UNKNOWN"}
          <small>
            {override
              ? `Override ${override.revision}: ${override.status}`
              : row.reasonCodes.join(", ") || "No warnings"}
          </small>
        </span>
      ) : null}
      <InlineEditor key={row.id} row={row} onQueued={onQueued} />
    </div>
  );
}

function InlineEditor({ row, onQueued }: { row: Row; onQueued: () => void }) {
  const override = row.supplierRow.profitCostOverrides[0];
  const existingCost =
    override?.values
      .find((value) => value.field === "SUPPLIER_COST_PER_SELLABLE_UNIT")
      ?.value.toString() ?? "";
  const existingStress = override?.stressDiscountPercent?.toString() ?? "";
  const [cost, setCost] = useState(existingCost);
  const [stress, setStress] = useState(existingStress);
  const [reason, setReason] = useState("");
  const [state, setState] = useState("");
  const costChanged = cost !== existingCost;
  const stressChanged = stress !== existingStress;
  async function save(): Promise<void> {
    const response = await fetch(`/api/results/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: override?.revision ?? 0,
        idempotencyKey: crypto.randomUUID(),
        reason,
        values: costChanged
          ? [
              {
                field: "SUPPLIER_COST_PER_SELLABLE_UNIT",
                value: cost || null,
              },
            ]
          : [],
        ...(stressChanged ? { stressDiscountPercent: stress || null } : {}),
      }),
    });
    if (response.ok) {
      setState("Recalculation queued; refreshing results…");
      onQueued();
    } else setState("Edit was rejected");
  }
  return (
    <span className="inline-editor">
      <label>
        Cost{" "}
        <input
          aria-label={`Supplier cost for row ${row.supplierRow.sourceRowNumber}`}
          inputMode="decimal"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
      </label>
      <label>
        Stress %{" "}
        <input
          aria-label={`Stress discount for row ${row.supplierRow.sourceRowNumber}`}
          inputMode="decimal"
          value={stress}
          onChange={(event) => setStress(event.target.value)}
        />
      </label>
      <label>
        Reason{" "}
        <input
          aria-label={`Reason for row ${row.supplierRow.sourceRowNumber}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!reason.trim() || (!costChanged && !stressChanged)}
        onClick={() => void save()}
      >
        Apply
      </button>
      {state ? <small role="status">{state}</small> : null}
    </span>
  );
}

function AccessibleTable({
  rows,
  groups,
  onOpen,
  offset,
  total,
  onPage,
}: {
  rows: Row[];
  groups: Set<Group>;
  onOpen: (id: string) => Promise<void>;
  offset: number;
  total: number;
  onPage: (offset: number) => void;
}) {
  return (
    <table id="analysis-grid">
      <caption>
        Results {Math.min(offset + 1, total)} to{" "}
        {Math.min(offset + PAGE_SIZE, total)} of {total}.
      </caption>
      <thead>
        <tr>
          <th>Identity</th>
          {groups.has("decision") ? <th>Decision</th> : null}
          {groups.has("economics") ? <th>Economics</th> : null}
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              #{row.supplierRow.sourceRowNumber}{" "}
              {row.supplierRow.normalizedOffer?.description}
            </td>
            {groups.has("decision") ? <td>{row.recommendation}</td> : null}
            {groups.has("economics") ? (
              <td>
                Current {decimal(row.currentNetProfit)} / Conservative{" "}
                {decimal(row.conservativeNetProfit)} / ROI{" "}
                {decimal(row.roiPercent)}%
              </td>
            ) : null}
            <td>
              <button type="button" onClick={() => void onOpen(row.id)}>
                Open evidence
              </button>
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={4}>
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous page
            </button>{" "}
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => onPage(offset + PAGE_SIZE)}
            >
              Next page
            </button>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function EvidenceList({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="evidence-list">
      {Object.entries(values).map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>
            {value === null || value === undefined || value === ""
              ? "Not available"
              : String(value)}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function EvidenceTree({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p>Not available.</p>;
  if (typeof value !== "object") return <p>{String(value)}</p>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <p>None recorded.</p>;
    return (
      <ul className="evidence-list">
        {value.map((item, index) => (
          <li key={index}>
            <EvidenceTree value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="evidence-list">
      {Object.entries(value as Record<string, unknown>).map(([key, child]) => (
        <Fragment key={key}>
          <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
          <dd>
            {child !== null && typeof child === "object" ? (
              <EvidenceTree value={child} />
            ) : (
              String(child ?? "Not available")
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function EvidenceDrawer({
  detail,
  onClose,
}: {
  detail: Detail;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const supplier = detail.supplierRow as {
    normalizedOffer?: Record<string, unknown>;
    warnings?: unknown[];
    matchDecision?: {
      id?: string;
      reasonCodes?: unknown;
      selectedCandidate?: {
        id?: string;
        packGuard?: unknown;
        evidence?: unknown[];
      };
    };
    listingCandidates?: Array<{
      id: string;
      confidence: number;
      catalogProduct?: Record<string, unknown>;
      evidence?: Array<Record<string, unknown>>;
      packGuard?: Record<string, unknown> | null;
    }>;
    enrichmentItems?: Array<{ observations?: Array<Record<string, unknown>> }>;
    profitResults?: unknown[];
    profitCostOverrides?: Array<Record<string, unknown>>;
    rawData?: unknown;
  };
  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  function trapFocus(event: ReactKeyboardEvent<HTMLElement>): void {
    if (event.key !== "Tab") return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable.item(0);
    const last = focusable.item(focusable.length - 1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  const packGuard = supplier.matchDecision?.selectedCandidate?.packGuard as
    { status?: string; reasonCode?: string } | undefined;
  const observations =
    supplier.enrichmentItems?.flatMap((item) => item.observations ?? []) ?? [];
  const actions = requiredNextActions(detail.reasonCodes);
  const auditEvents = Array.isArray(detail.auditEvents)
    ? detail.auditEvents
    : [];
  return (
    <div className="evidence-backdrop" role="presentation">
      <section
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        ref={drawerRef}
        onKeyDown={trapFocus}
      >
        <button
          ref={closeRef}
          className="drawer-close"
          type="button"
          onClick={onClose}
        >
          Close
        </button>
        <h2 id="evidence-title">Product evidence and decision replay</h2>
        <h3>Supplier row, match, and pack interpretation</h3>
        <EvidenceList
          values={{
            "Supplier item": supplier.normalizedOffer?.itemNumber,
            "Supplied ASIN": supplier.normalizedOffer?.asin,
            Title: supplier.normalizedOffer?.description,
            Brand: supplier.normalizedOffer?.brand,
            PackGuard: packGuard?.status,
            "PackGuard reason": packGuard?.reasonCode,
            "Supplier warnings": Array.isArray(supplier.warnings)
              ? supplier.warnings.length
              : 0,
          }}
        />
        <h4>Supplier source values and normalization warnings</h4>
        <EvidenceTree value={supplier.rawData} />
        {Array.isArray(supplier.warnings) && supplier.warnings.length ? (
          <EvidenceTree value={supplier.warnings} />
        ) : (
          <p>No normalization warnings are recorded.</p>
        )}
        <h4>Candidate comparison and match features</h4>
        {supplier.listingCandidates?.length ? (
          <ul className="evidence-list">
            {supplier.listingCandidates.map((candidate) => (
              <li key={candidate.id}>
                <strong>
                  {candidate.id ===
                  supplier.matchDecision?.selectedCandidate?.id
                    ? "Selected candidate"
                    : "Rejected alternative"}
                </strong>
                <EvidenceList
                  values={{
                    ASIN: candidate.catalogProduct?.asin,
                    Title: candidate.catalogProduct?.title,
                    Brand: candidate.catalogProduct?.brand,
                    Confidence: candidate.confidence,
                    PackGuard: candidate.packGuard?.status,
                    "PackGuard reason": candidate.packGuard?.reasonCode,
                  }}
                />
                <EvidenceTree value={candidate.evidence} />
              </li>
            ))}
          </ul>
        ) : (
          <p>No catalog candidates are stored for this row.</p>
        )}
        <h3>Sources, timestamps, and freshness</h3>
        {observations.length ? (
          <ul className="evidence-list">
            {observations.slice(0, 20).map((observation, index) => (
              <li key={index}>
                {String(observation.provider ?? "Provider")} · observed{" "}
                {String(
                  observation.observedAt ??
                    observation.observed_at ??
                    "unknown",
                )}{" "}
                · freshness {observationFreshness(observation)} · fresh until{" "}
                {String(
                  observation.freshUntil ??
                    observation.fresh_until ??
                    "unknown",
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>No provider observation is stored for this result.</p>
        )}
        <h3>Costs, formulas, decision evidence, and required next actions</h3>
        <EvidenceList
          values={{
            "Current net profit": detail.currentNetProfit,
            "Conservative net profit": detail.conservativeNetProfit,
            "Stress net profit": detail.stressNetProfit,
            "ROI %": detail.roiPercent,
            "Margin %": detail.marginPercent,
            "Break-even price": detail.breakEvenPrice,
            "Formula engine": detail.engineVersion,
            "Rounding basis": "HALF_UP to display cents; break-even rounds up.",
          }}
        />
        <h4>Deterministic inputs and formula evidence</h4>
        <EvidenceTree value={detail.inputSnapshot} />
        <EvidenceTree value={detail.evidence} />
        <h4>Required next actions</h4>
        <ul className="evidence-list">
          {actions.length ? (
            actions.map((action) => <li key={action}>{action}</li>)
          ) : (
            <li>No required action is recorded.</li>
          )}
        </ul>
        <h3>Overrides and route comparison</h3>
        <EvidenceTree value={supplier.profitCostOverrides} />
        <h4>Current route comparison</h4>
        <EvidenceTree value={supplier.profitResults} />
        <h4>Audit history</h4>
        <EvidenceTree value={auditEvents} />
      </section>
    </div>
  );
}
