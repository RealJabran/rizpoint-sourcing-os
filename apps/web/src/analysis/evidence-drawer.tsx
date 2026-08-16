"use client";

import Image from "next/image";
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { observationFreshness, requiredNextActions } from "./evidence";
import { HistoryPanel } from "./history-panel";
import type { AnalysisDetail } from "./workspace-types";

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

export function EvidenceDrawer({
  detail,
  onClose,
}: {
  detail: AnalysisDetail;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<"decision" | "history">("decision");
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
        <div
          className="evidence-tabs"
          role="tablist"
          aria-label="Product evidence sections"
        >
          <button
            id="decision-evidence-tab"
            type="button"
            role="tab"
            aria-selected={tab === "decision"}
            aria-controls="decision-evidence-panel"
            onClick={() => setTab("decision")}
          >
            Decision evidence
          </button>
          <button
            id="history-evidence-tab"
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            aria-controls="history-evidence-panel"
            onClick={() => setTab("history")}
          >
            History
          </button>
        </div>
        {tab === "history" ? (
          <HistoryPanel
            historyEvidence={detail.historyEvidence}
            historyAnalytics={detail.historyAnalytics}
          />
        ) : (
          <div
            role="tabpanel"
            id="decision-evidence-panel"
            aria-labelledby="decision-evidence-tab"
          >
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
                    · freshness {observationFreshness(observation)} · fresh
                    until{" "}
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
            <h3>
              Costs, formulas, decision evidence, and required next actions
            </h3>
            <EvidenceList
              values={{
                "Current net profit": detail.currentNetProfit,
                "Conservative net profit": detail.conservativeNetProfit,
                "Stress net profit": detail.stressNetProfit,
                "ROI %": detail.roiPercent,
                "Margin %": detail.marginPercent,
                "Break-even price": detail.breakEvenPrice,
                "Formula engine": detail.engineVersion,
                "Rounding basis":
                  "HALF_UP to display cents; break-even rounds up.",
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
          </div>
        )}
      </section>
    </div>
  );
}
