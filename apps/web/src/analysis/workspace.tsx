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
import { PageHeader } from "@/src/components/page-header";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  Progress,
  SelectControl,
  Skeleton,
  TextInput,
} from "@/src/components/ui";
import { scanStatusPresentation } from "@/src/components/dashboard-state";

const PAGE_SIZE = ANALYSIS_PAGE_SIZE;
const ROW_HEIGHT = 120;
const GROUPS = ["identity", "decision", "economics", "risk"] as const;
type Group = (typeof GROUPS)[number];
type DecimalValue = string | { toString(): string };
type ExternalEvidence = {
  provider: string;
  observedAt: string;
  freshUntil: string;
  freshnessState: string;
  value: string | null;
  currency: string | null;
  restrictionStatus: string | null;
} | null;
type Row = {
  id: string;
  status: string;
  recommendation: string | null;
  currentNetProfit: DecimalValue | null;
  conservativeNetProfit: DecimalValue | null;
  stressNetProfit: DecimalValue | null;
  userEnteredNetProfit: DecimalValue | null;
  effectiveCogs: DecimalValue | null;
  amazonFees: DecimalValue | null;
  roiPercent: DecimalValue | null;
  marginPercent: DecimalValue | null;
  breakEvenPrice: DecimalValue | null;
  reasonCodes: string[];
  supplierRow: {
    sourceRowNumber: number;
    normalizedOffer: {
      asin: string | null;
      itemNumber: string | null;
      description: string | null;
      brand: string | null;
      unitCost: DecimalValue | null;
      currency: string | null;
      quantity: number | null;
      caseCount: number | null;
      packCount: number | null;
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
          provider: string;
          observedAt: string;
          freshnessState: string;
          packCount?: number | null;
        };
        packGuard: { status: string; reasonCode: string } | null;
      } | null;
    } | null;
    profitCostOverrides: Array<{
      revision: number;
      status: string;
      stressDiscountPercent: { toString(): string } | null;
      userEnteredSalePrice: { toString(): string } | null;
      values: Array<{ field: string; value: { toString(): string } }>;
    }>;
  };
  externalEvidence: {
    pricing: ExternalEvidence;
    fees: ExternalEvidence;
    restrictions: ExternalEvidence;
  };
  feeEstimate: {
    completeness: string | null;
    scenarioSource: string | null;
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
    components: Array<{ type: string; finalFee: string; currency: string }>;
  } | null;
  listingRestriction: {
    state: string;
    completeness: string | null;
    reasonCodes: string[];
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
  } | null;
};
type Route = { id: string; name: string; currency: string };
type ScanContext = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  supplier: { code: string; name: string } | null;
  upload: { originalFilename: string; status: string } | null;
  rowCount: number;
  checkpoints: Array<{ stage: string; updatedAt: string }>;
  recoverableErrors: Array<{ status: string; observedAt: string }>;
};
type Detail = Record<string, unknown> & {
  id: string;
  engineVersion: string;
  reasonCodes: string[];
  inputSnapshot: unknown;
  evidence: unknown;
  supplierRow: Record<string, unknown>;
};

function decimal(value: DecimalValue | null): string {
  return value?.toString() ?? "—";
}

function humanize(value: string | null | undefined): string {
  if (!value) return "Not available";
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function sourceLine(evidence: ExternalEvidence): string {
  if (!evidence) return "Source not available";
  const effectiveFreshness =
    Date.parse(evidence.freshUntil) < Date.now()
      ? "STALE"
      : evidence.freshnessState;
  return `${evidence.provider} · ${evidence.observedAt.replace("T", " ").slice(0, 19)} · ${humanize(effectiveFreshness)}`;
}

export function AnalysisWorkspace({ scanId }: { scanId: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef(new Map<number, Row[]>());
  const [pages, setPages] = useState(new Map<number, Row[]>());
  const [total, setTotal] = useState(0);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [scanContext, setScanContext] = useState<ScanContext | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routeId, setRouteId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [status, setStatus] = useState("");
  const [minRoiPercent, setMinRoiPercent] = useState("");
  const [maxRoiPercent, setMaxRoiPercent] = useState("");
  const [feeCompleteness, setFeeCompleteness] = useState("");
  const [restrictionState, setRestrictionState] = useState("");
  const [restrictionReasonCode, setRestrictionReasonCode] = useState("");
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
        feeCompleteness?: string;
        restrictionState?: string;
        restrictionReasonCode?: string;
        sort?: string;
        direction?: "asc" | "desc";
        visibleGroups?: Group[];
      };
    }>
  >([]);
  const queryKey = `${routeId ?? ""}|${search}|${recommendation}|${status}|${minRoiPercent}|${maxRoiPercent}|${feeCompleteness}|${restrictionState}|${restrictionReasonCode}|${sort}|${direction}|${refreshNonce}`;
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
      if (feeCompleteness) params.set("feeCompleteness", feeCompleteness);
      if (restrictionState) params.set("restrictionState", restrictionState);
      if (restrictionReasonCode)
        params.set("restrictionReasonCode", restrictionReasonCode);
      const requestedQueryKey = queryKey;
      const response = await fetch(`/api/scans/${scanId}/results?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load analysis results.");
      const data = (await response.json()) as {
        total: number;
        unfilteredTotal: number;
        rows: Row[];
        routes: Route[];
        shippingRouteId?: string;
        context: ScanContext;
      };
      if (queryKeyRef.current !== requestedQueryKey) return;
      if (reset) pagesRef.current = new Map();
      pagesRef.current.set(offset, data.rows);
      setPages(new Map(pagesRef.current));
      setTotal(data.total);
      setUnfilteredTotal(data.unfilteredTotal);
      setScanContext(data.context);
      setRoutes(data.routes);
      if (!routeId && data.shippingRouteId) setRouteId(data.shippingRouteId);
    },
    [
      direction,
      feeCompleteness,
      maxRoiPercent,
      minRoiPercent,
      queryKey,
      recommendation,
      restrictionReasonCode,
      restrictionState,
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
    estimateSize: () => ROW_HEIGHT,
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
  const scanPresentation = scanStatusPresentation(scanContext?.status ?? "");
  const checkpointStages = new Set(
    scanContext?.checkpoints.map(({ stage }) => stage) ?? [],
  );
  const hasFilters = Boolean(
    search.trim() ||
    recommendation ||
    status ||
    minRoiPercent.trim() ||
    maxRoiPercent.trim() ||
    feeCompleteness ||
    restrictionState ||
    restrictionReasonCode,
  );

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
          feeCompleteness: feeCompleteness || undefined,
          restrictionState: restrictionState || undefined,
          restrictionReasonCode: restrictionReasonCode || undefined,
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
      <PageHeader
        title="Analysis workspace"
        description={
          scanContext
            ? `${scanContext.supplier?.name ?? "Unknown supplier"} · ${scanContext.upload?.originalFilename ?? "Catalog scan"}`
            : "Persisted matching, provider evidence, and deterministic calculations."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Catalog scans", href: "/scans" },
          { label: "Analysis" },
        ]}
        actions={
          <ButtonLink href="/scans" variant="secondary">
            Scan list
          </ButtonLink>
        }
      />
      {scanContext ? (
        <Card className="analysis-scan-card" aria-label="Scan status">
          <div className="analysis-scan-summary">
            <div>
              <Badge
                tone={
                  scanContext.status === "PARTIAL_SUCCESS"
                    ? "warning"
                    : scanContext.status === "COMPLETED"
                      ? "success"
                      : scanContext.status.startsWith("FAILED")
                        ? "danger"
                        : "info"
                }
              >
                {scanPresentation.label}
              </Badge>
              <strong>
                {scanContext.rowCount.toLocaleString()} supplier rows
              </strong>
              <span>
                Started {scanContext.createdAt.replace("T", " ").slice(0, 19)}
                {scanContext.completedAt
                  ? ` · Last completed ${scanContext.completedAt.replace("T", " ").slice(0, 19)}`
                  : " · Processing has not completed"}
              </span>
            </div>
            <Progress
              value={scanPresentation.progress}
              label={`${scanPresentation.label} progress`}
            />
          </div>
          <ol className="analysis-stage-list" aria-label="Processing stages">
            {[
              ["UPLOAD_INSPECT", "Parse"],
              ["NORMALIZE", "Normalize"],
              ["MATCH", "Match"],
              ["ENRICH", "Enrich & restrict"],
              ["CALCULATE", "Calculate"],
            ].map(([stage, label]) => (
              <li
                key={stage}
                className={checkpointStages.has(stage!) ? "is-complete" : ""}
              >
                <span aria-hidden="true">
                  {checkpointStages.has(stage!) ? "✓" : "·"}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      {scanContext?.status === "PARTIAL_SUCCESS" ? (
        <Alert tone="warning" title="Analysis contains partial data">
          Missing provider evidence or blocked inputs remain visible. No row is
          presented as complete unless its persisted calculation is complete.
        </Alert>
      ) : null}
      {scanContext?.recoverableErrors.length ? (
        <Alert tone="warning" title="This scan recovered from a failed attempt">
          The audit trail retains {scanContext.recoverableErrors.length} failed
          attempt(s). Current results come from the latest persisted
          checkpoints.
        </Alert>
      ) : null}
      <section className="analysis-toolbar" aria-label="Result filters">
        <div className="analysis-filter-group">
          <strong>Scope</strong>
          <label>
            Route
            <SelectControl
              value={routeId ?? ""}
              onChange={(event) => setRouteId(event.target.value || undefined)}
            >
              {routes.map((route) => (
                <option key={route.id} value={route.id}>
                  {route.name} ({route.currency})
                </option>
              ))}
            </SelectControl>
          </label>
        </div>
        <div className="analysis-filter-group analysis-filter-group--wide">
          <strong>Find and decide</strong>
          <label>
            Search
            <TextInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ASIN, brand, title"
            />
          </label>
          <label>
            Recommendation
            <SelectControl
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
            </SelectControl>
          </label>
          <label>
            Calculation status
            <SelectControl
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All</option>
              <option value="COMPLETED">COMPLETED</option>
              <option value="PARTIAL_SUCCESS">PARTIAL_SUCCESS</option>
            </SelectControl>
          </label>
        </div>
        <div className="analysis-filter-group">
          <strong>Economics</strong>
          <label>
            Min ROI %
            <TextInput
              inputMode="decimal"
              value={minRoiPercent}
              onChange={(event) => setMinRoiPercent(event.target.value)}
            />
          </label>
          <label>
            Max ROI %
            <TextInput
              inputMode="decimal"
              value={maxRoiPercent}
              onChange={(event) => setMaxRoiPercent(event.target.value)}
            />
          </label>
        </div>
        <div className="analysis-filter-group analysis-filter-group--wide">
          <strong>Fees and eligibility</strong>
          <label>
            Fee data
            <SelectControl
              value={feeCompleteness}
              onChange={(event) => setFeeCompleteness(event.target.value)}
            >
              <option value="">All completeness states</option>
              <option value="COMPLETE">Complete</option>
              <option value="PARTIAL">Partial</option>
              <option value="UNKNOWN">Unknown</option>
            </SelectControl>
          </label>
          <label>
            Seller eligibility
            <SelectControl
              value={restrictionState}
              onChange={(event) => setRestrictionState(event.target.value)}
            >
              <option value="">All eligibility states</option>
              {[
                "ELIGIBLE",
                "RESTRICTED",
                "APPROVAL_REQUIRED",
                "INCOMPLETE",
                "UNAUTHORIZED",
                "THROTTLED",
                "UNKNOWN",
              ].map((value) => (
                <option key={value} value={value}>
                  {humanize(value)}
                </option>
              ))}
            </SelectControl>
          </label>
          <label>
            Restriction reason
            <SelectControl
              value={restrictionReasonCode}
              onChange={(event) => setRestrictionReasonCode(event.target.value)}
            >
              <option value="">All reasons</option>
              <option value="APPROVAL_REQUIRED">Approval required</option>
              <option value="NOT_ELIGIBLE">Not eligible</option>
              <option value="ASIN_NOT_FOUND">ASIN not found</option>
            </SelectControl>
          </label>
        </div>
        <div className="analysis-filter-group analysis-filter-presets">
          <strong>Quick filters</strong>
          <fieldset>
            <legend>Presets</legend>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRecommendation("BUY");
                setStatus("COMPLETED");
              }}
            >
              Buy candidates
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRecommendation("");
                setStatus("PARTIAL_SUCCESS");
              }}
            >
              Missing data
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setRecommendation("REVIEW_MATCH");
                setStatus("");
              }}
            >
              Review matches
            </Button>
          </fieldset>
        </div>
        <details className="analysis-more-filters">
          <summary>Columns, sorting, and saved views</summary>
          <div>
            <label>
              Sort
              <SelectControl
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
              </SelectControl>
            </label>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setDirection((value) => (value === "asc" ? "desc" : "asc"))
              }
            >
              Order: {direction}
            </Button>
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
              View name
              <TextInput
                value={viewName}
                onChange={(event) => setViewName(event.target.value)}
              />
            </label>
            <Button type="button" size="sm" onClick={() => void saveView()}>
              Save view
            </Button>
            <label>
              Saved view
              <SelectControl
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
                  setFeeCompleteness(view.queryState.feeCompleteness ?? "");
                  setRestrictionState(view.queryState.restrictionState ?? "");
                  setRestrictionReasonCode(
                    view.queryState.restrictionReasonCode ?? "",
                  );
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
              </SelectControl>
            </label>
          </div>
        </details>
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
      {error ? (
        <Alert tone="danger" title="Analysis results could not be loaded">
          {error} Refresh this scan to retry; persisted data is unchanged.
        </Alert>
      ) : null}
      {loading ? (
        <Card
          className="analysis-loading"
          aria-label="Loading analysis results"
        >
          <Skeleton className="table-skeleton" />
        </Card>
      ) : null}
      {!loading && total === 0 ? (
        <Card className="empty-state analysis-empty-state">
          <span className="empty-state__eyebrow">No visible results</span>
          <h2>
            {scanContext?.rowCount === 0
              ? "This scan contains no normalized supplier rows."
              : unfilteredTotal > 0 && hasFilters
                ? "The current filters exclude every result."
                : !checkpointStages.has("CALCULATE")
                  ? "Processing has not reached persisted calculations yet."
                  : "Calculation completed without a current result projection."}
          </h2>
          <p>
            {unfilteredTotal > 0 && hasFilters
              ? "Clear or broaden the filters to restore the persisted rows."
              : !checkpointStages.has("CALCULATE")
                ? "Return to the scan list or New Scan workflow to monitor or resume the saved checkpoint."
                : "This is not reported as a successful zero-result scan. Review the scan audit state before retrying."}
          </p>
          {unfilteredTotal > 0 && hasFilters ? (
            <Button
              type="button"
              onClick={() => {
                setSearch("");
                setRecommendation("");
                setStatus("");
                setMinRoiPercent("");
                setMaxRoiPercent("");
                setFeeCompleteness("");
                setRestrictionState("");
                setRestrictionReasonCode("");
              }}
            >
              Clear filters
            </Button>
          ) : (
            <ButtonLink href="/scans" variant="secondary">
              View scan status
            </ButtonLink>
          )}
        </Card>
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
        style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
        role="row"
      >
        Loading row…
      </div>
    );
  const offer = row.supplierRow.normalizedOffer;
  const override = row.supplierRow.profitCostOverrides[0];
  const match = row.supplierRow.matchDecision;
  const catalog = match?.selectedCandidate?.catalogProduct;
  const packGuard = match?.selectedCandidate?.packGuard;
  const pricing = row.externalEvidence.pricing;
  const fees = row.externalEvidence.fees;
  const restrictions = row.externalEvidence.restrictions;
  return (
    <div
      className="analysis-grid-row"
      style={{ transform: `translateY(${index * ROW_HEIGHT}px)` }}
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
          {offer?.itemNumber ?? offer?.asin ?? "Unidentified supplier row"}
          <small>
            {offer?.brand ?? "Unknown brand"} ·{" "}
            {offer?.description ?? "No title"}
          </small>
          <small>
            {catalog?.asin
              ? `Matched ${catalog.asin} · ${catalog.title}`
              : "No accepted catalog match"}
          </small>
        </button>
      </span>
      {groups.has("decision") ? (
        <span role="gridcell">
          <strong>{humanize(row.recommendation ?? row.status)}</strong>
          <small>
            Match: {humanize(match?.status ?? "UNMATCHED")} · confidence{" "}
            {match?.confidence ?? 0}%
            {override
              ? ` · Override ${override.revision}: ${override.status}`
              : ""}
          </small>
          <small>
            Eligibility: {humanize(row.listingRestriction?.state)}
            {row.listingRestriction?.reasonCodes.length
              ? ` · ${row.listingRestriction.reasonCodes.map(humanize).join(", ")}`
              : ""}
          </small>
        </span>
      ) : null}
      {groups.has("economics") ? (
        <span role="gridcell">
          <strong>
            Net {currency} {decimal(row.currentNetProfit)} · ROI{" "}
            {decimal(row.roiPercent)}% · margin {decimal(row.marginPercent)}%
          </strong>
          <small>
            Supplier unit cost {offer?.currency ?? currency}{" "}
            {decimal(offer?.unitCost ?? null)} · market price{" "}
            {pricing?.currency ?? currency} {pricing?.value ?? "—"} · fees{" "}
            {fees?.currency ?? currency} {decimal(row.amazonFees)}
          </small>
          <small>
            Fee estimate: {humanize(row.feeEstimate?.completeness)} · scenario{" "}
            {humanize(row.feeEstimate?.scenarioSource)} ·{" "}
            {row.feeEstimate?.components.length ?? 0} components
          </small>
          <small>
            Landed COGS {currency} {decimal(row.effectiveCogs)} · conservative
            net {currency} {decimal(row.conservativeNetProfit)} · break-even{" "}
            {currency} {decimal(row.breakEvenPrice)}
          </small>
        </span>
      ) : null}
      {groups.has("risk") ? (
        <span role="gridcell">
          <strong>{humanize(packGuard?.status ?? "PACK_UNKNOWN")}</strong>
          <small>
            Case {offer?.caseCount ?? "?"} · consumer pack{" "}
            {offer?.packCount ?? catalog?.packCount ?? "?"} · available{" "}
            {offer?.quantity ?? "?"}
          </small>
          <small>
            {row.reasonCodes.map(humanize).join(" · ") || "No stored warning"}
          </small>
          <small>{sourceLine(pricing)}</small>
          <small>{sourceLine(restrictions)}</small>
          {catalog ? (
            <small>
              {catalog.provider} ·{" "}
              {String(catalog.observedAt).replace("T", " ").slice(0, 19)} ·{" "}
              {humanize(catalog.freshnessState)}
            </small>
          ) : null}
          {!pricing || !fees || !restrictions ? (
            <small className="missing-evidence">
              Missing provider evidence
            </small>
          ) : null}
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
  const existingSalePrice = override?.userEnteredSalePrice?.toString() ?? "";
  const [cost, setCost] = useState(existingCost);
  const [stress, setStress] = useState(existingStress);
  const [salePrice, setSalePrice] = useState(existingSalePrice);
  const [reason, setReason] = useState("");
  const [state, setState] = useState("");
  const costChanged = cost !== existingCost;
  const stressChanged = stress !== existingStress;
  const salePriceChanged = salePrice !== existingSalePrice;
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
        ...(salePriceChanged
          ? { userEnteredSalePrice: salePrice || null }
          : {}),
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
        Sale price{" "}
        <input
          aria-label={`User-entered sale price for row ${row.supplierRow.sourceRowNumber}`}
          inputMode="decimal"
          value={salePrice}
          onChange={(event) => setSalePrice(event.target.value)}
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
        disabled={
          !reason.trim() ||
          (!costChanged && !stressChanged && !salePriceChanged)
        }
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
  const catalogImage = (catalog: Record<string, unknown> | undefined) => {
    const projection = catalog?.identityProjection;
    const images =
      projection && typeof projection === "object"
        ? (projection as { images?: unknown }).images
        : undefined;
    const first = Array.isArray(images) ? images[0] : undefined;
    return first &&
      typeof first === "object" &&
      typeof (first as { url?: unknown }).url === "string"
      ? (first as { url: string }).url
      : null;
  };
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
                    Manufacturer: (
                      candidate.catalogProduct?.identityProjection as
                        { manufacturer?: unknown } | undefined
                    )?.manufacturer,
                    Variation: candidate.catalogProduct?.variation,
                    "Variation theme": (
                      candidate.catalogProduct?.identityProjection as
                        { variationTheme?: unknown } | undefined
                    )?.variationTheme,
                    "Package hierarchy": (
                      candidate.catalogProduct?.identityProjection as
                        { packageHierarchy?: unknown } | undefined
                    )?.packageHierarchy,
                    Source: candidate.catalogProduct?.provider,
                    "Observed at": candidate.catalogProduct?.observedAt,
                    Freshness: candidate.catalogProduct?.freshnessState,
                    Confidence: candidate.confidence,
                    PackGuard: candidate.packGuard?.status,
                    "PackGuard reason": candidate.packGuard?.reasonCode,
                  }}
                />
                {catalogImage(candidate.catalogProduct) ? (
                  <img
                    className="catalog-evidence-image"
                    src={catalogImage(candidate.catalogProduct)!}
                    alt={`Provider image for ${String(candidate.catalogProduct?.title ?? "catalog candidate")}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
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
