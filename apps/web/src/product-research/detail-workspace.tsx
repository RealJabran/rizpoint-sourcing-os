"use client";

import {
  ArrowLeft,
  BadgeDollarSign,
  Box,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  History,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Store,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import { marketplaceLabel } from "@/src/marketplace-presentation";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  FreshnessIndicator,
  SelectControl,
  Skeleton,
  Tabs,
  useToast,
  type TabOption,
} from "@/src/components/ui";
import {
  dataOriginLabel,
  dateTime,
  evidenceValue,
  imageUrl,
  money,
  number,
  record,
  text,
  type ResearchItem,
  type ResearchRun,
} from "./workspace";

type ProductTab =
  | "overview"
  | "offers"
  | "economics"
  | "competition"
  | "eligibility"
  | "evidence";
type Project = { id: string; name: string; marketplaceId: string };

function available(item: ResearchItem, family: string) {
  return record(item.evidence[family])?.status === "AVAILABLE";
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="product-detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function ProviderRequired({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="provider-required-row">
      <span>
        <History aria-hidden="true" />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <ButtonLink href={href} variant="quiet" size="sm">
        Configure <ExternalLink aria-hidden="true" />
      </ButtonLink>
    </div>
  );
}

export function ProductDetailWorkspace({
  runId,
  initialProductId,
}: {
  runId: string;
  initialProductId?: string;
}) {
  const { notify } = useToast();
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [tab, setTab] = useState<ProductTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      fetch(
        `/api/product-research?runId=${encodeURIComponent(runId)}&offset=0&limit=20`,
        { cache: "no-store", signal: controller.signal },
      ).then(async (response) => {
        if (!response.ok) throw new Error("PRODUCT_RESEARCH_NOT_FOUND");
        return response.json();
      }),
      fetch("/api/research-projects", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([nextRun, nextProjects]) => {
        setRun(nextRun);
        setProjects(nextProjects);
        setLoading(false);
      })
      .catch((cause) => {
        if (cause?.name !== "AbortError") {
          setError("This product workspace could not be loaded.");
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [runId]);
  const item = useMemo(
    () =>
      run?.items.find(
        (candidate) => candidate.product.id === initialProductId,
      ) ??
      run?.items[0] ??
      null,
    [initialProductId, run],
  );
  const pricingEnvelope = item ? evidenceValue(item, "pricing") : null;
  const pricing = record(pricingEnvelope?.value);
  const feesEnvelope = item ? evidenceValue(item, "fees") : null;
  const fees = record(feesEnvelope?.value);
  const restrictionEnvelope = item ? evidenceValue(item, "restrictions") : null;
  const restrictions = record(restrictionEnvelope?.value);
  const featuredOffer = record(pricing?.featuredOffer);
  const offers = Array.isArray(pricing?.offers)
    ? pricing.offers.map(record).filter(Boolean)
    : [];
  const identity = item ? record(item.product.identity) : null;
  const ranks = Array.isArray(identity?.salesRanks)
    ? identity.salesRanks.map(record).filter(Boolean)
    : [];
  const tabs: Array<TabOption<ProductTab>> = item
    ? [
        { id: "overview" as const, label: "Overview" },
        ...(available(item, "pricing")
          ? [{ id: "offers" as const, label: "Offers", count: offers.length }]
          : []),
        ...(available(item, "fees")
          ? [{ id: "economics" as const, label: "Economics" }]
          : []),
        ...(available(item, "pricing")
          ? [{ id: "competition" as const, label: "Competition" }]
          : []),
        ...(available(item, "restrictions")
          ? [{ id: "eligibility" as const, label: "Eligibility" }]
          : []),
        { id: "evidence" as const, label: "Evidence" },
      ]
    : [];

  async function productAction(action: "SAVE_TO_PROJECT" | "WATCH") {
    if (!item) return;
    if (action === "SAVE_TO_PROJECT" && !projectId)
      return notify("Choose a project first.", "warning");
    const response = await fetch("/api/product-explorer/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        productIds: [item.product.id],
        ...(projectId ? { projectId } : {}),
        ...(action === "WATCH" ? { marketplaceId: run?.marketplaceId } : {}),
      }),
    });
    notify(
      response.ok
        ? action === "WATCH"
          ? "Product added to monitoring."
          : "Product saved to project."
        : "The product action could not be completed.",
      response.ok ? "success" : "danger",
    );
  }

  async function refresh() {
    if (!run) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/product-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "PRODUCT_LOOKUP",
          query: run.queryText,
          marketplaceId: run.marketplaceId,
          requestedLimit: 1,
          forceRefresh: true,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.id) throw new Error("REFRESH_FAILED");
      window.location.assign(`/product-research/${body.id}`);
    } catch {
      notify(
        "Refresh could not be queued. Existing evidence was preserved.",
        "danger",
      );
      setRefreshing(false);
    }
  }

  if (loading)
    return (
      <main className="content-page product-detail-page">
        <Skeleton className="product-detail-hero-skeleton" />
        <Skeleton className="product-detail-body-skeleton" />
      </main>
    );
  if (error || !run || !item)
    return (
      <main className="content-page">
        <PageHeader
          title="Product workspace"
          breadcrumbs={[
            { label: "Home", href: "/" },
            { label: "Research", href: "/product-research" },
            { label: "Product" },
          ]}
        />
        <EmptyState
          title="Product evidence is unavailable"
          description={error ?? "This research run did not return a product."}
          actions={
            <ButtonLink href="/product-research">Research a product</ButtonLink>
          }
        />
      </main>
    );

  const image = imageUrl(item);
  return (
    <main className="content-page product-detail-page">
      <PageHeader
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Product research", href: "/product-research" },
          { label: item.product.asin ?? "Product" },
        ]}
        kicker="Product workspace"
        title={item.product.title}
        description={`${item.product.brand ?? "Brand unavailable"} · ${item.product.asin ?? "ASIN unavailable"}`}
        meta={
          <>
            <Badge tone={item.dataOrigin === "MOCK" ? "warning" : "success"}>
              {dataOriginLabel(item.dataOrigin)}
            </Badge>
            <FreshnessIndicator
              state={item.freshnessState}
              observedAt={item.observedAt}
            />
            <span>{marketplaceLabel(run.marketplaceId)}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="secondary"
              loading={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw aria-hidden="true" /> Refresh data
            </Button>
            <ButtonLink
              href={`/differentiation?productId=${encodeURIComponent(item.product.id)}`}
            >
              <BadgeDollarSign aria-hidden="true" /> Differentiate
            </ButtonLink>
          </>
        }
      />
      <Card className="product-detail-hero">
        {image ? (
          <Image src={image} alt="" width={160} height={160} unoptimized />
        ) : (
          <div className="product-detail-image-empty">
            <Box aria-hidden="true" />
            <span>No catalog image</span>
          </div>
        )}
        <div className="product-detail-identity">
          <span className="eyebrow">Verified catalog identity</span>
          <div className="product-detail-identifiers">
            {item.product.identifiers.map((identifier) => (
              <span key={`${identifier.type}:${identifier.value}`}>
                <small>{identifier.type}</small>
                <strong>{identifier.value}</strong>
              </span>
            ))}
          </div>
        </div>
        <div className="product-detail-actions">
          <SelectControl
            aria-label="Research project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a project</option>
            {projects
              .filter((project) => project.marketplaceId === run.marketplaceId)
              .map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
          </SelectControl>
          <Button
            size="sm"
            disabled={!projectId}
            onClick={() => void productAction("SAVE_TO_PROJECT")}
          >
            Save to project
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void productAction("WATCH")}
          >
            Watch product
          </Button>
        </div>
      </Card>
      <Tabs<ProductTab>
        value={tab}
        options={tabs}
        onChange={setTab}
        label="Product evidence sections"
      />

      <section className="product-detail-tab" role="tabpanel">
        {tab === "overview" ? (
          <>
            <div className="product-detail-metrics">
              <Metric
                label="Featured offer"
                value={money(
                  featuredOffer?.landedPrice,
                  featuredOffer?.currency,
                )}
                detail={
                  text(pricing?.featuredOfferState) ?? "Offer state unknown"
                }
              />
              <Metric
                label="Visible offers"
                value={number(pricing?.visibleOfferCount) ?? "Unknown"}
                detail={
                  text(pricing?.completeness) ?? "No complete offer sample"
                }
              />
              <Metric
                label="Estimated Amazon fees"
                value={money(fees?.totalFee, fees?.currency)}
                detail={
                  text(fees?.scenarioSource)
                    ?.replaceAll("_", " ")
                    .toLowerCase() ?? "No fee scenario"
                }
              />
              <Metric
                label="Selling eligibility"
                value={text(restrictions?.state) ?? "Unknown"}
                detail="Connected seller · New condition"
              />
              <Metric
                label="Catalog ranks"
                value={ranks.length || "Unavailable"}
                detail={
                  ranks
                    .slice(0, 1)
                    .map(
                      (rank) =>
                        `${text(rank?.classificationId)} #${number(rank?.rank)}`,
                    )
                    .join("") || "No rank returned"
                }
              />
              <Metric
                label="Amazon Retail"
                value={text(pricing?.amazonRetailPresence) ?? "Unknown"}
                detail="Only from valid offer evidence"
              />
            </div>
            <Card className="product-detail-coverage">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Coverage</span>
                  <h2>Available evidence</h2>
                </div>
                <Badge
                  tone={
                    item.completeness === "COMPLETE" ? "success" : "warning"
                  }
                >
                  {item.completeness.toLowerCase()}
                </Badge>
              </div>
              <div className="coverage-grid">
                <span
                  className={available(item, "pricing") ? "is-available" : ""}
                >
                  <Store aria-hidden="true" /> Offers
                </span>
                <span className={available(item, "fees") ? "is-available" : ""}>
                  <BadgeDollarSign aria-hidden="true" /> Fees
                </span>
                <span
                  className={
                    available(item, "restrictions") ? "is-available" : ""
                  }
                >
                  <ShieldCheck aria-hidden="true" /> Eligibility
                </span>
                <span className={ranks.length ? "is-available" : ""}>
                  <PackageCheck aria-hidden="true" /> Rank
                </span>
              </div>
            </Card>
            {!available(item, "history") ? (
              <ProviderRequired
                title="Historical price and rank"
                description="SP-API does not provide market history. Connect a licensed history provider to unlock this evidence family."
                href="/settings/integrations/history"
              />
            ) : null}
            {!available(item, "keywords") ? (
              <ProviderRequired
                title="Keyword demand and reverse-ASIN ranks"
                description="A licensed keyword provider is required. Catalog search is not search-volume evidence."
                href="/settings/data-providers"
              />
            ) : null}
          </>
        ) : null}
        {tab === "offers" ? (
          <Card className="product-detail-table">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Current observation</span>
                <h2>Competitive offers</h2>
              </div>
              <FreshnessIndicator
                state={item.freshnessState}
                observedAt={item.observedAt}
              />
            </div>
            {offers.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Seller</th>
                      <th>Fulfillment</th>
                      <th>Listing price</th>
                      <th>Landed price</th>
                      <th>Condition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {offers.map((offer, index) => (
                      <tr key={index}>
                        <td>
                          {text(offer?.sellerId) ?? "Seller not disclosed"}
                        </td>
                        <td>{text(offer?.fulfillmentChannel) ?? "Unknown"}</td>
                        <td>{money(offer?.listingPrice, offer?.currency)}</td>
                        <td>{money(offer?.landedPrice, offer?.currency)}</td>
                        <td>{text(offer?.condition) ?? "New"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                compact
                title="No normalized offer rows"
                description="A featured offer may be available without a complete seller-level offer sample. Missing offers are never counted as zero."
              />
            )}
          </Card>
        ) : null}
        {tab === "economics" ? (
          <Card className="product-economics-panel">
            <span className="eyebrow">Amazon fee scenario</span>
            <h2>{money(fees?.totalFee, fees?.currency)} estimated fees</h2>
            <p>
              This is a dated Amazon estimate for the explicit price
              scenario—not a guaranteed future charge or a profitability
              conclusion.
            </p>
            <div className="product-detail-metrics">
              <Metric
                label="Scenario price"
                value={money(
                  fees?.price ?? featuredOffer?.landedPrice,
                  fees?.currency ?? featuredOffer?.currency,
                )}
                detail={
                  text(fees?.scenarioSource)
                    ?.replaceAll("_", " ")
                    .toLowerCase() ?? "Explicit scenario"
                }
              />
              <Metric
                label="Completeness"
                value={text(fees?.completeness) ?? item.completeness}
                detail={`Observed ${dateTime(item.observedAt)}`}
              />
            </div>
            <ButtonLink href="/private-label-profitability" variant="secondary">
              Open profitability scenarios
            </ButtonLink>
          </Card>
        ) : null}
        {tab === "competition" ? (
          <Card>
            <span className="eyebrow">Observed offer competition</span>
            <h2>Competitive context</h2>
            <div className="product-detail-metrics">
              <Metric
                label="Visible offer sample"
                value={number(pricing?.visibleOfferCount) ?? "Unknown"}
                detail="Not a whole-market seller count"
              />
              <Metric
                label="Amazon Retail"
                value={text(pricing?.amazonRetailPresence) ?? "Unknown"}
                detail="Marketplace-specific verified identity policy"
              />
              <Metric
                label="Featured offer"
                value={text(pricing?.featuredOfferState) ?? "Unknown"}
                detail={money(
                  featuredOffer?.landedPrice,
                  featuredOffer?.currency,
                )}
              />
            </div>
            <Alert tone="info" title="Bounded evidence">
              Competitive offers are a point-in-time provider sample. RizPoint
              does not infer seller concentration or total market competition
              from missing rows.
            </Alert>
          </Card>
        ) : null}
        {tab === "eligibility" ? (
          <Card>
            <span className="eyebrow">Connected seller</span>
            <h2>Selling eligibility</h2>
            <div className="eligibility-state">
              <CheckCircle2 aria-hidden="true" />
              <strong>{text(restrictions?.state) ?? "Unknown"}</strong>
              <span>New condition · {marketplaceLabel(run.marketplaceId)}</span>
            </div>
            <p>
              Eligibility is account-specific Amazon evidence. It is not legal
              or product-compliance clearance.
            </p>
            <ButtonLink href="/compliance-risk" variant="secondary">
              <ShieldCheck aria-hidden="true" /> Open compliance screen
            </ButtonLink>
          </Card>
        ) : null}
        {tab === "evidence" ? (
          <Card className="product-evidence-ledger">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Audit trail</span>
                <h2>Evidence ledger</h2>
              </div>
              <FreshnessIndicator
                state={item.freshnessState}
                observedAt={item.observedAt}
              />
            </div>
            <dl>
              <div>
                <dt>Source</dt>
                <dd>{item.source}</dd>
              </div>
              <div>
                <dt>Origin</dt>
                <dd>{dataOriginLabel(item.dataOrigin)}</dd>
              </div>
              <div>
                <dt>Marketplace</dt>
                <dd>{marketplaceLabel(run.marketplaceId)}</dd>
              </div>
              <div>
                <dt>Observed</dt>
                <dd>{dateTime(item.observedAt)}</dd>
              </div>
              <div>
                <dt>Completeness</dt>
                <dd>{item.completeness.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Research run</dt>
                <dd>
                  {run.kind === "PRODUCT_LOOKUP"
                    ? "Manual product lookup"
                    : "Bounded catalog search"}
                </dd>
              </div>
            </dl>
            <div className="evidence-family-list">
              {Object.entries(item.evidence).map(([family, value]) => {
                const envelope = record(value);
                return (
                  <div key={family}>
                    <Database aria-hidden="true" />
                    <span>
                      <strong>{family.replaceAll("_", " ")}</strong>
                      <small>
                        {text(envelope?.reason) ??
                          "Normalized provider evidence"}
                      </small>
                    </span>
                    <Badge
                      tone={
                        envelope?.status === "AVAILABLE" ? "success" : "neutral"
                      }
                    >
                      {text(envelope?.status)
                        ?.replaceAll("_", " ")
                        .toLowerCase() ?? "unknown"}
                    </Badge>
                  </div>
                );
              })}
            </div>
            <p className="muted-copy">
              <Clock3 aria-hidden="true" /> Raw provider payloads and
              credentials remain server-only.
            </p>
          </Card>
        ) : null}
      </section>
      <ButtonLink href="/product-research" variant="quiet" size="sm">
        <ArrowLeft aria-hidden="true" /> Back to product research
      </ButtonLink>
    </main>
  );
}
