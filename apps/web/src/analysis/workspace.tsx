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
import Image from "next/image";
import { ANALYSIS_PAGE_SIZE, pageOffsetForIndex } from "./window";
import { observationFreshness, requiredNextActions } from "./evidence";
import {
  ANALYSIS_PRESETS,
  LOW_VISIBLE_COMPETITION_LABEL,
} from "./presets";
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
  useToast,
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
      upc: string | null;
      ean: string | null;
      gtin: string | null;
      itemNumber: string | null;
      mpn: string | null;
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
          model: string | null;
          mpn: string | null;
          sizeText: string | null;
          variation: string | null;
          provider: string;
          observedAt: string;
          freshnessState: string;
          packCount?: number | null;
          identity: {
            manufacturer: string | null;
            color: string | null;
            productTypes: string[];
            variationTheme: string | null;
            images: Array<{ url: string; variant: string | null }>;
          };
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
  feeScenarios: Array<{
    scenarioSource: string | null;
    scenarioPrice: string | null;
    completeness: string | null;
    freshnessState: string;
  }>;
  offerIntelligence: {
    provider: string;
    observedAt: string;
    expiresAt: string;
    freshnessState: string;
    completeness: string | null;
    featuredOffer: {
      state: string | null;
      price: string | null;
      currency: string | null;
      fulfillmentChannel: string | null;
    };
    amazonRetailPresence: string | null;
    counts: {
      total: { value: number | null; completeness: string | null };
      fba: { value: number | null; completeness: string | null };
      fbm: { value: number | null; completeness: string | null };
    };
    lowestFbaPrice: string | null;
    lowestFbmPrice: string | null;
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
  const { notify } = useToast();
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
  const [minNetProfit, setMinNetProfit] = useState("");
  const [maxNetProfit, setMaxNetProfit] = useState("");
  const [minMarginPercent, setMinMarginPercent] = useState("");
  const [maxMarginPercent, setMaxMarginPercent] = useState("");
  const [matchStatus, setMatchStatus] = useState("");
  const [minMatchConfidence, setMinMatchConfidence] = useState("");
  const [packGuardStatus, setPackGuardStatus] = useState("");
  const [featuredOfferState, setFeaturedOfferState] = useState("");
  const [amazonRetailPresence, setAmazonRetailPresence] = useState("");
  const [pricingCompleteness, setPricingCompleteness] = useState("");
  const [pricingFreshness, setPricingFreshness] = useState("");
  const [minVisibleOfferCount, setMinVisibleOfferCount] = useState("");
  const [maxVisibleOfferCount, setMaxVisibleOfferCount] = useState("");
  const [minFbaOfferCount, setMinFbaOfferCount] = useState("");
  const [minFbmOfferCount, setMinFbmOfferCount] = useState("");
  const [partialData, setPartialData] = useState(false);
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
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
  const [refreshState, setRefreshState] = useState("");
  const [exportState, setExportState] = useState("");
  const [exportJob, setExportJob] = useState<{
    id: string;
    status: string;
    downloadState?: "READY" | "EXPIRED" | "PENDING" | "FAILED";
    filename?: string | null;
  } | null>(null);
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
        minNetProfit?: string;
        maxNetProfit?: string;
        minMarginPercent?: string;
        maxMarginPercent?: string;
        matchStatus?: string;
        minMatchConfidence?: number;
        packGuardStatus?: string;
        featuredOfferState?: string;
        amazonRetailPresence?: string;
        pricingCompleteness?: string;
        pricingFreshness?: string;
        feeCompleteness?: string;
        restrictionState?: string;
        restrictionReasonCode?: string;
        minVisibleOfferCount?: number;
        maxVisibleOfferCount?: number;
        minFbaOfferCount?: number;
        minFbmOfferCount?: number;
        partialData?: boolean;
        brand?: string;
        category?: string;
        sort?: string;
        direction?: "asc" | "desc";
        visibleGroups?: Group[];
      };
    }>
  >([]);
  const queryKey = `${routeId ?? ""}|${search}|${recommendation}|${status}|${minRoiPercent}|${maxRoiPercent}|${minNetProfit}|${maxNetProfit}|${minMarginPercent}|${maxMarginPercent}|${matchStatus}|${minMatchConfidence}|${packGuardStatus}|${featuredOfferState}|${amazonRetailPresence}|${pricingCompleteness}|${pricingFreshness}|${minVisibleOfferCount}|${maxVisibleOfferCount}|${minFbaOfferCount}|${minFbmOfferCount}|${partialData}|${brand}|${category}|${feeCompleteness}|${restrictionState}|${restrictionReasonCode}|${sort}|${direction}|${refreshNonce}`;
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
      if (minNetProfit.trim()) params.set("minNetProfit", minNetProfit.trim());
      if (maxNetProfit.trim()) params.set("maxNetProfit", maxNetProfit.trim());
      if (minMarginPercent.trim())
        params.set("minMarginPercent", minMarginPercent.trim());
      if (maxMarginPercent.trim())
        params.set("maxMarginPercent", maxMarginPercent.trim());
      if (matchStatus) params.set("matchStatus", matchStatus);
      if (minMatchConfidence.trim())
        params.set("minMatchConfidence", minMatchConfidence.trim());
      if (packGuardStatus) params.set("packGuardStatus", packGuardStatus);
      if (featuredOfferState)
        params.set("featuredOfferState", featuredOfferState);
      if (amazonRetailPresence)
        params.set("amazonRetailPresence", amazonRetailPresence);
      if (pricingCompleteness)
        params.set("pricingCompleteness", pricingCompleteness);
      if (pricingFreshness) params.set("pricingFreshness", pricingFreshness);
      if (minVisibleOfferCount.trim())
        params.set("minVisibleOfferCount", minVisibleOfferCount.trim());
      if (maxVisibleOfferCount.trim())
        params.set("maxVisibleOfferCount", maxVisibleOfferCount.trim());
      if (minFbaOfferCount.trim())
        params.set("minFbaOfferCount", minFbaOfferCount.trim());
      if (minFbmOfferCount.trim())
        params.set("minFbmOfferCount", minFbmOfferCount.trim());
      if (partialData) params.set("partialData", "true");
      if (brand.trim()) params.set("brand", brand.trim());
      if (category.trim()) params.set("category", category.trim());
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
      featuredOfferState,
      amazonRetailPresence,
      pricingCompleteness,
      pricingFreshness,
      minFbaOfferCount,
      minFbmOfferCount,
      minMarginPercent,
      minMatchConfidence,
      minNetProfit,
      maxRoiPercent,
      maxMarginPercent,
      maxNetProfit,
      minVisibleOfferCount,
      maxVisibleOfferCount,
      matchStatus,
      packGuardStatus,
      partialData,
      brand,
      category,
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
    minNetProfit.trim() ||
    maxNetProfit.trim() ||
    minMarginPercent.trim() ||
    maxMarginPercent.trim() ||
    matchStatus ||
    minMatchConfidence.trim() ||
    packGuardStatus ||
    featuredOfferState ||
    amazonRetailPresence ||
    pricingCompleteness ||
    pricingFreshness ||
    minVisibleOfferCount.trim() ||
    maxVisibleOfferCount.trim() ||
    minFbaOfferCount.trim() ||
    minFbmOfferCount.trim() ||
    partialData ||
    brand.trim() ||
    category.trim() ||
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
        queryState: activeViewState(),
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

  function clearFilters(): void {
    setSearch("");
    setRecommendation("");
    setStatus("");
    setMinRoiPercent("");
    setMaxRoiPercent("");
    setMinNetProfit("");
    setMaxNetProfit("");
    setMinMarginPercent("");
    setMaxMarginPercent("");
    setMatchStatus("");
    setMinMatchConfidence("");
    setPackGuardStatus("");
    setFeaturedOfferState("");
    setAmazonRetailPresence("");
    setPricingCompleteness("");
    setPricingFreshness("");
    setMinVisibleOfferCount("");
    setMaxVisibleOfferCount("");
    setMinFbaOfferCount("");
    setMinFbmOfferCount("");
    setPartialData(false);
    setBrand("");
    setCategory("");
    setFeeCompleteness("");
    setRestrictionState("");
    setRestrictionReasonCode("");
  }

  function applyPreset(id: (typeof ANALYSIS_PRESETS)[number]["id"]): void {
    clearFilters();
    const preset = ANALYSIS_PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    const state = preset.state;
    if ("recommendation" in state) setRecommendation(state.recommendation);
    if ("restrictionState" in state)
      setRestrictionState(state.restrictionState);
    if ("status" in state) setStatus(state.status);
    if ("featuredOfferState" in state)
      setFeaturedOfferState(state.featuredOfferState);
    if ("amazonRetailPresence" in state)
      setAmazonRetailPresence(state.amazonRetailPresence);
    if ("maxVisibleOfferCount" in state)
      setMaxVisibleOfferCount(state.maxVisibleOfferCount);
    if ("minFbaOfferCount" in state)
      setMinFbaOfferCount(state.minFbaOfferCount);
    if ("partialData" in state) setPartialData(state.partialData);
    if ("matchStatus" in state) setMatchStatus(state.matchStatus);
  }

  async function refreshEvidence(): Promise<void> {
    setRefreshState("queued");
    const response = await fetch(`/api/scans/${scanId}/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.ok) {
      setRefreshState("failed");
      setError("Evidence refresh could not be queued. Check the scan status.");
      return;
    }
    const result = (await response.json()) as { status: string; duplicate?: boolean };
    setRefreshState(
      result.status === "PARTIAL_SUCCESS"
        ? "partial"
        : result.status.startsWith("FAILED")
          ? "failed"
          : "queued",
    );
    notify(
      result.duplicate
        ? "An equivalent refresh is already queued."
        : "Evidence refresh queued. Provider rate limits and persisted checkpoints are honored.",
      "info",
    );
    window.setTimeout(() => setRefreshNonce((current) => current + 1), 1_500);
  }

  function activeViewState() {
    return {
      schemaVersion: 1 as const,
      routeId,
      recommendation: recommendation || undefined,
      status: status || undefined,
      search: search || undefined,
      minRoiPercent: minRoiPercent || undefined,
      maxRoiPercent: maxRoiPercent || undefined,
      minNetProfit: minNetProfit || undefined,
      maxNetProfit: maxNetProfit || undefined,
      minMarginPercent: minMarginPercent || undefined,
      maxMarginPercent: maxMarginPercent || undefined,
      matchStatus: matchStatus || undefined,
      minMatchConfidence: minMatchConfidence
        ? Number(minMatchConfidence)
        : undefined,
      packGuardStatus: packGuardStatus || undefined,
      featuredOfferState: featuredOfferState || undefined,
      amazonRetailPresence: amazonRetailPresence || undefined,
      pricingCompleteness: pricingCompleteness || undefined,
      pricingFreshness: pricingFreshness || undefined,
      feeCompleteness: feeCompleteness || undefined,
      restrictionState: restrictionState || undefined,
      restrictionReasonCode: restrictionReasonCode || undefined,
      minVisibleOfferCount: minVisibleOfferCount
        ? Number(minVisibleOfferCount)
        : undefined,
      maxVisibleOfferCount: maxVisibleOfferCount
        ? Number(maxVisibleOfferCount)
        : undefined,
      minFbaOfferCount: minFbaOfferCount ? Number(minFbaOfferCount) : undefined,
      minFbmOfferCount: minFbmOfferCount ? Number(minFbmOfferCount) : undefined,
      partialData: partialData || undefined,
      brand: brand || undefined,
      category: category || undefined,
      sort,
      direction,
      visibleGroups: [...groups],
    };
  }

  async function queueActiveViewExport(format: "CSV" | "XLSX"): Promise<void> {
    setExportState("queued");
    const response = await fetch(`/api/scans/${scanId}/analysis-exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        format,
        idempotencyKey: crypto.randomUUID(),
        queryState: activeViewState(),
      }),
    });
    if (!response.ok) {
      setExportState("failed");
      setError("The active view export could not be queued. No file was created.");
      return;
    }
    const job = (await response.json()) as { id: string; status: string };
    setExportJob({ id: job.id, status: job.status });
    setExportState("queued");
    notify("Private active-view export queued. Identifiers remain text and unsafe spreadsheet formulas are escaped.", "info");
  }

  useEffect(() => {
    if (!exportJob || !["PENDING", "RUNNING", "FAILED_RETRYABLE"].includes(exportJob.status))
      return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/exports/${exportJob.id}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Export status is unavailable.");
        const next = (await response.json()) as typeof exportJob;
        if (cancelled) return;
        setExportJob(next);
        setExportState(next.status.toLowerCase());
        if (["PENDING", "RUNNING", "FAILED_RETRYABLE"].includes(next.status))
          timer = window.setTimeout(() => void poll(), 1_500);
      } catch {
        if (!cancelled) setExportState("failed");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [exportJob?.id, exportJob?.status]);

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
          <>
            <Button
              type="button"
              variant="secondary"
              loading={refreshState === "queued" || refreshState === "running"}
              onClick={() => void refreshEvidence()}
            >
              Refresh evidence
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={exportState === "queued" || exportState === "running"}
              onClick={() => void queueActiveViewExport("CSV")}
            >
              Export CSV
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={exportState === "queued" || exportState === "running"}
              onClick={() => void queueActiveViewExport("XLSX")}
            >
              Export XLSX
            </Button>
            <ButtonLink href="/scans" variant="secondary">
              Scan list
            </ButtonLink>
          </>
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
      {refreshState ? (
        <Alert
          tone={refreshState === "failed" ? "danger" : "info"}
          title="Evidence refresh status"
        >
          {refreshState === "queued"
            ? "Refresh queued. The worker will reuse fresh observations and wait for provider limits when needed."
            : refreshState === "partial"
              ? "Refresh completed with partial provider data. Unknown values remain visible."
              : refreshState === "failed"
                ? "Refresh could not be queued. Existing persisted evidence remains unchanged."
                : "Refresh is running from persisted checkpoints."}
        </Alert>
      ) : null}
      {exportState ? (
        <Alert
          tone={exportState === "failed" || exportJob?.status === "FAILED_FINAL" ? "danger" : "info"}
          title="Active-view export"
        >
          {exportJob?.downloadState === "READY" ? (
            <a href={`/api/exports/${exportJob.id}?download=1`}>
              Download {exportJob.filename ?? "private export"}
            </a>
          ) : exportJob?.downloadState === "EXPIRED" ? (
            "This private export expired. Queue a new export from the current view."
          ) : exportState === "failed" || exportJob?.status === "FAILED_FINAL" ? (
            "The export did not complete. Existing private objects were not exposed; queue a new export to retry."
          ) : (
            "The worker is building a private snapshot of the active server-side view."
          )}
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
              onClick={() => applyPreset("profitable-eligible")}
            >
              Profitable & eligible
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset("no-featured-offer")}
            >
              No featured offer
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset("amazon-absent")}
            >
              Amazon Retail absent
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset("low-competition")}
              title={LOW_VISIBLE_COMPETITION_LABEL}
            >
              Low competition
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset("partial-stale")}
            >
              Missing / stale
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => applyPreset("pack-review")}
            >
              Pack / match review
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
                  "currentNetProfit",
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
            <label>
              Min / max profit
              <span className="analysis-range">
                <TextInput
                  aria-label="Minimum profit"
                  inputMode="decimal"
                  value={minNetProfit}
                  onChange={(event) => setMinNetProfit(event.target.value)}
                  placeholder="Min"
                />
                <TextInput
                  aria-label="Maximum profit"
                  inputMode="decimal"
                  value={maxNetProfit}
                  onChange={(event) => setMaxNetProfit(event.target.value)}
                  placeholder="Max"
                />
              </span>
            </label>
            <label>
              Min / max margin %
              <span className="analysis-range">
                <TextInput
                  aria-label="Minimum margin"
                  inputMode="decimal"
                  value={minMarginPercent}
                  onChange={(event) => setMinMarginPercent(event.target.value)}
                  placeholder="Min"
                />
                <TextInput
                  aria-label="Maximum margin"
                  inputMode="decimal"
                  value={maxMarginPercent}
                  onChange={(event) => setMaxMarginPercent(event.target.value)}
                  placeholder="Max"
                />
              </span>
            </label>
            <label>
              Match state
              <SelectControl
                value={matchStatus}
                onChange={(event) => setMatchStatus(event.target.value)}
              >
                <option value="">All matches</option>
                <option value="AUTO_ACCEPTED">Auto accepted</option>
                <option value="USER_ACCEPTED">Human accepted</option>
                <option value="REVIEW_REQUIRED">Manual review</option>
                <option value="UNMATCHED">Unmatched</option>
              </SelectControl>
            </label>
            <label>
              Minimum confidence
              <TextInput
                inputMode="numeric"
                value={minMatchConfidence}
                onChange={(event) => setMinMatchConfidence(event.target.value)}
              />
            </label>
            <label>
              PackGuard
              <SelectControl
                value={packGuardStatus}
                onChange={(event) => setPackGuardStatus(event.target.value)}
              >
                <option value="">All pack states</option>
                <option value="VERIFIED">Verified</option>
                <option value="BLOCKED_PACK_UNCERTAIN">Blocked: uncertain</option>
                <option value="BLOCKED_PACK_CONTRADICTION">Blocked: contradiction</option>
              </SelectControl>
            </label>
            <label>
              Featured offer
              <SelectControl
                value={featuredOfferState}
                onChange={(event) => setFeaturedOfferState(event.target.value)}
              >
                <option value="">All states</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">No featured offer</option>
                <option value="UNKNOWN">Unknown</option>
              </SelectControl>
            </label>
            <label>
              Amazon Retail
              <SelectControl
                value={amazonRetailPresence}
                onChange={(event) => setAmazonRetailPresence(event.target.value)}
              >
                <option value="">All states</option>
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
                <option value="UNKNOWN">Unknown</option>
              </SelectControl>
            </label>
            <label>
              Offer freshness
              <SelectControl
                value={pricingFreshness}
                onChange={(event) => setPricingFreshness(event.target.value)}
              >
                <option value="">All freshness</option>
                <option value="FRESH">Fresh</option>
                <option value="STALE">Stale</option>
                <option value="EXPIRED">Expired</option>
                <option value="UNKNOWN">Unknown</option>
              </SelectControl>
            </label>
            <label>
              Max visible sellers
              <TextInput
                inputMode="numeric"
                value={maxVisibleOfferCount}
                onChange={(event) => setMaxVisibleOfferCount(event.target.value)}
                aria-describedby="competition-threshold"
              />
            </label>
            <small id="competition-threshold">
              {LOW_VISIBLE_COMPETITION_LABEL}
            </small>
            <label>
              Minimum FBA sellers
              <TextInput
                inputMode="numeric"
                value={minFbaOfferCount}
                onChange={(event) => setMinFbaOfferCount(event.target.value)}
              />
            </label>
            <label>
              Minimum FBM sellers
              <TextInput
                inputMode="numeric"
                value={minFbmOfferCount}
                onChange={(event) => setMinFbmOfferCount(event.target.value)}
              />
            </label>
            <label>
              Brand
              <TextInput value={brand} onChange={(event) => setBrand(event.target.value)} />
            </label>
            <label>
              Category / product type
              <TextInput value={category} onChange={(event) => setCategory(event.target.value)} />
            </label>
            <label>
              <input
                type="checkbox"
                checked={partialData}
                onChange={(event) => setPartialData(event.target.checked)}
              />{" "}
              Missing, partial, or stale data
            </label>
            <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
            <span className="analysis-history-unavailable" role="status">
              Historical stability unavailable — no licensed history provider is connected.
            </span>
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
                  setMinNetProfit(view.queryState.minNetProfit ?? "");
                  setMaxNetProfit(view.queryState.maxNetProfit ?? "");
                  setMinMarginPercent(view.queryState.minMarginPercent ?? "");
                  setMaxMarginPercent(view.queryState.maxMarginPercent ?? "");
                  setMatchStatus(view.queryState.matchStatus ?? "");
                  setMinMatchConfidence(
                    String(view.queryState.minMatchConfidence ?? ""),
                  );
                  setPackGuardStatus(view.queryState.packGuardStatus ?? "");
                  setFeaturedOfferState(
                    view.queryState.featuredOfferState ?? "",
                  );
                  setAmazonRetailPresence(
                    view.queryState.amazonRetailPresence ?? "",
                  );
                  setPricingCompleteness(
                    view.queryState.pricingCompleteness ?? "",
                  );
                  setPricingFreshness(view.queryState.pricingFreshness ?? "");
                  setFeeCompleteness(view.queryState.feeCompleteness ?? "");
                  setRestrictionState(view.queryState.restrictionState ?? "");
                  setRestrictionReasonCode(
                    view.queryState.restrictionReasonCode ?? "",
                  );
                  setMinVisibleOfferCount(
                    String(view.queryState.minVisibleOfferCount ?? ""),
                  );
                  setMaxVisibleOfferCount(
                    String(view.queryState.maxVisibleOfferCount ?? ""),
                  );
                  setMinFbaOfferCount(
                    String(view.queryState.minFbaOfferCount ?? ""),
                  );
                  setMinFbmOfferCount(
                    String(view.queryState.minFbmOfferCount ?? ""),
                  );
                  setPartialData(view.queryState.partialData ?? false);
                  setBrand(view.queryState.brand ?? "");
                  setCategory(view.queryState.category ?? "");
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
              onClick={clearFilters}
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
  const offerIntelligence = row.offerIntelligence;
  const image = catalog?.identity.images[0]?.url;
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
          {image ? (
            <Image
              className="analysis-product-image"
              src={image}
              alt=""
              width={44}
              height={44}
              unoptimized
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <span
              className="analysis-product-image analysis-product-image--empty"
              aria-hidden="true"
            >
              ·
            </span>
          )}
          #{row.supplierRow.sourceRowNumber} ·{" "}
          {offer?.itemNumber ?? offer?.asin ?? "Unidentified supplier row"}
          <small>
            {offer?.brand ?? "Unknown brand"} ·{" "}
            {offer?.description ?? "No title"}
          </small>
          <small>
            {catalog?.asin
              ? `Amazon ${catalog.asin} · ${catalog.title}`
              : "No accepted catalog match"}
          </small>
          <small>
            {[offer?.upc, offer?.ean, offer?.gtin, offer?.mpn]
              .filter(Boolean)
              .join(" · ") || "No supplier identifier"}
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
          <small>
            {catalog?.variation
              ? `Variation: ${catalog.variation}`
              : "Variation not returned"}
            {catalog?.identity.productTypes.length
              ? ` · ${catalog.identity.productTypes.join(", ")}`
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
            {offerIntelligence?.featuredOffer.currency ?? pricing?.currency ?? currency}{" "}
            {offerIntelligence?.featuredOffer.price ?? pricing?.value ?? "—"} · fees{" "}
            {fees?.currency ?? currency} {decimal(row.amazonFees)}
          </small>
          <small>
            Fee estimate: {humanize(row.feeEstimate?.completeness)} · scenario{" "}
            {humanize(row.feeEstimate?.scenarioSource)} ·{" "}
            {row.feeEstimate?.components.length ?? 0} components ·{" "}
            {row.feeScenarios?.length ?? 0} exact-price quote
            {row.feeScenarios?.length === 1 ? "" : "s"}
          </small>
          <small>
            Landed COGS {currency} {decimal(row.effectiveCogs)} · conservative
            net {currency} {decimal(row.conservativeNetProfit)} · break-even{" "}
            {currency} {decimal(row.breakEvenPrice)}
          </small>
          <small>
            Featured offer: {humanize(offerIntelligence?.featuredOffer.state)} ·
            scenario {humanize(row.feeEstimate?.scenarioSource)} · formula gates{" "}
            {row.reasonCodes.length
              ? row.reasonCodes.map(humanize).join(", ")
              : "clear"}
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
          <small>
            Amazon Retail: {humanize(offerIntelligence?.amazonRetailPresence)} ·
            visible sellers {offerIntelligence?.counts.total.value ?? "unknown"} ({humanize(offerIntelligence?.counts.total.completeness)}) ·
            FBA {offerIntelligence?.counts.fba.value ?? "unknown"} · FBM{" "}
            {offerIntelligence?.counts.fbm.value ?? "unknown"}
          </small>
          <small>
            Lowest FBA {currency} {offerIntelligence?.lowestFbaPrice ?? "—"} ·
            lowest FBM {currency} {offerIntelligence?.lowestFbmPrice ?? "—"}
          </small>
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
                  <Image
                    className="catalog-evidence-image"
                    src={catalogImage(candidate.catalogProduct)!}
                    alt={`Provider image for ${String(candidate.catalogProduct?.title ?? "catalog candidate")}`}
                    width={96}
                    height={96}
                    unoptimized
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
