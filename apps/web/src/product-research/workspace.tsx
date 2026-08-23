"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/src/components/page-header";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  SelectControl,
  Skeleton,
  TextInput,
  useToast,
} from "@/src/components/ui";

type Marketplace = {
  id: string;
  label: string;
  currency: string;
  isDefault: boolean;
};
type Project = { id: string; name: string; marketplaceId: string };
export type ResearchItem = {
  id: string;
  status: string;
  product: {
    id: string;
    asin: string | null;
    title: string;
    brand: string | null;
    marketplaceId: string | null;
    identifiers: Array<{ type: string; value: string }>;
    identity: unknown;
  };
  evidence: Record<string, unknown>;
  source: string;
  dataOrigin: string;
  observedAt: string;
  freshUntil: string | null;
  freshnessState: string;
  completeness: string;
};
export type ResearchRun = {
  id: string;
  kind: "PRODUCT_LOOKUP" | "CATALOG_SEARCH";
  status: string;
  marketplaceId: string;
  providerMode: "LIVE" | "MOCK";
  queryType: string;
  queryText: string;
  resultCount: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
  items: ResearchItem[];
};

const terminal = new Set(["COMPLETED", "PARTIAL_SUCCESS", "FAILED_FINAL"]);
const humanErrors: Record<string, string> = {
  AMAZON_NOT_CONNECTED: "Connect Amazon before running live product research.",
  AMAZON_MARKETPLACE_NOT_CONNECTED:
    "The selected marketplace is not available to this Amazon connection.",
  UNAUTHORIZED: "Amazon authorization needs attention. Reconnect and retry.",
  THROTTLED: "Amazon is throttling requests. The job will retry safely.",
  PRODUCT_IDENTIFIER_INVALID:
    "Enter an ASIN, UPC/EAN/GTIN, or supported Amazon product URL.",
};

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function text(value: unknown) {
  return typeof value === "string" ? value : null;
}
export function number(value: unknown) {
  return typeof value === "number" ? value : null;
}
export function dateTime(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not available";
}
export function money(value: unknown, currency: unknown) {
  const amount = text(value);
  const code = text(currency);
  if (!amount || !code) return "Not available";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: code,
  }).format(Number(amount));
}
export function evidenceValue(item: ResearchItem, family: string) {
  const envelope = record(item.evidence[family]);
  return envelope?.status === "AVAILABLE" ? record(envelope.value) : null;
}
export function imageUrl(item: ResearchItem) {
  const identity = record(item.product.identity);
  const images = Array.isArray(identity?.images) ? identity.images : [];
  return (
    images
      .map(record)
      .map((image) => text(image?.url))
      .find(Boolean) ?? null
  );
}
export function dataOriginLabel(value: string) {
  return value === "LIVE_AMAZON"
    ? "Live Amazon"
    : value === "STORED_AMAZON"
      ? "Stored Amazon"
      : value === "MOCK"
        ? "Demo fixture"
        : value.replaceAll("_", " ").toLowerCase();
}

function EvidenceState({ item }: { item: ResearchItem }) {
  return (
    <div className="research-evidence-strip" aria-label="Evidence provenance">
      <Badge tone={item.dataOrigin === "MOCK" ? "warning" : "success"}>
        {dataOriginLabel(item.dataOrigin)}
      </Badge>
      <span>{item.source}</span>
      <span>{item.product.marketplaceId}</span>
      <span>Observed {dateTime(item.observedAt)}</span>
      <span>{item.freshnessState.toLowerCase()}</span>
      <span>{item.completeness.toLowerCase()}</span>
    </div>
  );
}

function ProductEvidence({
  item,
  runId,
}: {
  item: ResearchItem;
  runId: string;
}) {
  const pricing = evidenceValue(item, "pricing");
  const pricingValue = record(pricing?.value);
  const fees = evidenceValue(item, "fees");
  const feeValue = record(fees?.value);
  const restrictions = evidenceValue(item, "restrictions");
  const restrictionValue = record(restrictions?.value);
  const identity = record(item.product.identity);
  const ranks = Array.isArray(identity?.salesRanks) ? identity.salesRanks : [];
  const offers = Array.isArray(pricingValue?.offers) ? pricingValue.offers : [];
  const featuredOffer = record(pricingValue?.featuredOffer);
  const image = imageUrl(item);
  return (
    <Card
      className="product-research-result"
      data-testid="product-research-result"
    >
      <div className="product-research-identity">
        {image ? (
          // Amazon Catalog supplies this URL; it is rendered as evidence, never scraped.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="product-research-image" />
        ) : (
          <div
            className="product-research-image product-research-image--empty"
            aria-label="No catalog image"
          >
            No image
          </div>
        )}
        <div>
          <div className="badge-stack">
            <Badge tone="info">
              {item.product.asin ?? "Identifier result"}
            </Badge>
            <Badge tone={item.status === "COMPLETED" ? "success" : "warning"}>
              {item.status === "COMPLETED" ? "Complete" : "Partially available"}
            </Badge>
          </div>
          <h2>{item.product.title}</h2>
          <p>{item.product.brand ?? "Brand not supplied by Catalog Items"}</p>
          <div className="identifier-list">
            {item.product.identifiers.map((identifier) => (
              <span key={`${identifier.type}:${identifier.value}`}>
                {identifier.type} {identifier.value}
              </span>
            ))}
          </div>
        </div>
      </div>
      <EvidenceState item={item} />
      <div className="product-research-result__actions">
        <ButtonLink
          href={`/product-research/${runId}?product=${encodeURIComponent(item.product.id)}`}
          size="sm"
        >
          Open product workspace
        </ButtonLink>
        <ButtonLink
          href={`/differentiation?productId=${encodeURIComponent(item.product.id)}`}
          variant="quiet"
          size="sm"
        >
          Explore differentiation
        </ButtonLink>
      </div>
      <div className="metric-grid product-research-metrics">
        <div>
          <span>Featured offer</span>
          <strong>
            {money(featuredOffer?.landedPrice, featuredOffer?.currency)}
          </strong>
          <small>{text(pricingValue?.featuredOfferState) ?? "Unknown"}</small>
        </div>
        <div>
          <span>Visible offers</span>
          <strong>
            {number(pricingValue?.visibleOfferCount) ?? "Unknown"}
          </strong>
          <small>{text(pricingValue?.completeness) ?? "Unavailable"}</small>
        </div>
        <div>
          <span>Amazon Retail</span>
          <strong>
            {text(pricingValue?.amazonRetailPresence) ?? "Unknown"}
          </strong>
          <small>Only shown from competitive-offer evidence</small>
        </div>
        <div>
          <span>Estimated Amazon fees</span>
          <strong>{money(feeValue?.totalFee, feeValue?.currency)}</strong>
          <small>
            {text(feeValue?.scenarioSource)?.replaceAll("_", " ") ??
              text(record(item.evidence.fees)?.reason) ??
              "Unavailable"}
          </small>
        </div>
        <div>
          <span>Selling eligibility</span>
          <strong>{text(restrictionValue?.state) ?? "Unknown"}</strong>
          <small>
            {Array.isArray(restrictionValue?.reasons)
              ? `${restrictionValue.reasons.length} reason(s)`
              : (text(record(item.evidence.restrictions)?.reason) ??
                "Unavailable")}
          </small>
        </div>
        <div>
          <span>Catalog sales ranks</span>
          <strong>{ranks.length || "Unavailable"}</strong>
          <small>
            {ranks
              .slice(0, 2)
              .map(record)
              .map(
                (rank) =>
                  `${text(rank?.classificationId)} #${number(rank?.rank)}`,
              )
              .join(" · ") || "No rank returned"}
          </small>
        </div>
      </div>
      <details>
        <summary>Offer detail and data limitations</summary>
        <p>
          {offers.length
            ? `${offers.length} normalized competitive offer record(s) are available.`
            : "No offer rows were returned; missing data is not treated as zero."}
        </p>
        <p>
          Historical market series require a licensed history provider. Monthly
          sales are not estimated unless a licensed estimate or calibrated model
          exists.
        </p>
      </details>
    </Card>
  );
}

export function ProductResearchWorkspace() {
  const { notify } = useToast();
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceId, setMarketplaceId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [lookup, setLookup] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [keyword, setKeyword] = useState("");
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(0);

  const loadRun = useCallback(async (runId: string, nextPage = 0) => {
    const response = await fetch(
      `/api/product-research?runId=${encodeURIComponent(runId)}&offset=${nextPage * 10}&limit=10`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error("PRODUCT_RESEARCH_RUN_UNAVAILABLE");
    const next = (await response.json()) as ResearchRun;
    setRun(next);
    setPage(nextPage);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/marketplaces", { cache: "no-store" }).then((response) =>
        response.ok ? response.json() : { marketplaces: [] },
      ),
      fetch("/api/research-projects", { cache: "no-store" }).then((response) =>
        response.ok ? response.json() : [],
      ),
    ]).then(([marketplacePayload, projectPayload]) => {
      if (cancelled) return;
      const nextMarketplaces = marketplacePayload.marketplaces as Marketplace[];
      setMarketplaces(nextMarketplaces);
      setMarketplaceId(
        nextMarketplaces.find((item) => item.isDefault)?.id ??
          nextMarketplaces[0]?.id ??
          "",
      );
      setProjects(projectPayload as Project[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!run || terminal.has(run.status)) return;
    const timer = window.setInterval(() => {
      void loadRun(run.id, page).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [loadRun, page, run]);

  const selectedMarketplace = marketplaces.find(
    (marketplace) => marketplace.id === marketplaceId,
  );
  const selectedProducts = useMemo(
    () => run?.items.filter((item) => selected.includes(item.product.id)) ?? [],
    [run, selected],
  );

  async function queue(
    kind: "PRODUCT_LOOKUP" | "CATALOG_SEARCH",
    query: string,
    forceRefresh = false,
  ) {
    if (!marketplaceId) return notify("Choose a marketplace first.", "warning");
    setBusy(kind);
    try {
      const response = await fetch("/api/product-research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          query,
          marketplaceId,
          requestedLimit: kind === "CATALOG_SEARCH" ? 20 : 1,
          ...(kind === "PRODUCT_LOOKUP" && salePrice
            ? { salePrice, currency: selectedMarketplace?.currency ?? "USD" }
            : {}),
          forceRefresh,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
        detail?: string;
      } | null;
      if (!response.ok || !payload?.id)
        throw new Error(
          payload?.error ?? payload?.detail ?? "PRODUCT_RESEARCH_FAILED",
        );
      setSelected([]);
      setRun({
        id: payload.id,
        kind,
        status: "PENDING",
        marketplaceId,
        providerMode: "LIVE",
        queryType: kind === "CATALOG_SEARCH" ? "KEYWORD" : "IDENTIFIER",
        queryText: query,
        resultCount: 0,
        errorCode: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
        items: [],
      });
      await loadRun(payload.id);
      notify("Research job queued. Pages continue reading persisted state.");
    } catch (error) {
      const code =
        error instanceof Error ? error.message : "PRODUCT_RESEARCH_FAILED";
      notify(
        humanErrors[code] ?? code.replaceAll("_", " ").toLowerCase(),
        "danger",
      );
    } finally {
      setBusy(null);
    }
  }

  async function act(action: "SAVE_TO_PROJECT" | "WATCH") {
    if (!selected.length)
      return notify("Select at least one product.", "warning");
    if (action === "SAVE_TO_PROJECT" && !projectId)
      return notify("Choose or create a project first.", "warning");
    const response = await fetch("/api/product-explorer/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        productIds: selected,
        ...(projectId ? { projectId } : {}),
        ...(action === "WATCH" ? { marketplaceId } : {}),
      }),
    });
    const payload = await response.json().catch(() => null);
    notify(
      response.ok
        ? `${selected.length} product(s) updated.`
        : (payload?.error ?? "Action failed"),
      response.ok ? "success" : "danger",
    );
  }

  async function createProject() {
    if (!newProjectName.trim())
      return notify("Enter a project name.", "warning");
    const response = await fetch("/api/research-projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: newProjectName,
        marketplaceId,
        mode: "PRIVATE_LABEL",
      }),
    });
    const project = await response.json().catch(() => null);
    if (!response.ok)
      return notify(
        project?.error ?? "Project could not be created.",
        "danger",
      );
    setProjects((current) => [project, ...current]);
    setProjectId(project.id);
    setNewProjectName("");
    notify("Project created and selected.");
  }

  async function enrichSelected() {
    if (!selectedProducts.length)
      return notify("Select catalog results to research.", "warning");
    if (selectedProducts.length > 5)
      return notify("Enrich up to five products at a time.", "warning");
    setBusy("ENRICH_SELECTED");
    try {
      for (const item of selectedProducts) {
        if (item.product.asin) await queue("PRODUCT_LOOKUP", item.product.asin);
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="content-page product-research-page">
      <PageHeader
        title="Research product"
        description="Retrieve authorized Amazon evidence by identifier, or search a bounded Amazon catalog universe by keyword."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Product Research" },
          { label: "Research product" },
        ]}
        actions={
          <ButtonLink href="/settings/integrations/amazon" variant="secondary">
            Amazon connection
          </ButtonLink>
        }
      />

      <Alert tone="info" title="Working · explicit research only">
        Opening this page never calls Amazon. Research and refresh actions
        create resumable jobs; results below are persisted evidence.
      </Alert>

      <div className="research-entry-grid">
        <Card>
          <Badge tone="success">Manual product research</Badge>
          <h2>ASIN or product identifier</h2>
          <p>Enter an ASIN, UPC/EAN/GTIN, or an Amazon product URL.</p>
          <label>
            Product identifier or URL
            <TextInput
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              placeholder="B0… or https://amazon.com/dp/B0…"
            />
          </label>
          <label>
            Fee scenario sale price (optional)
            <TextInput
              inputMode="decimal"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              placeholder="Uses current featured offer when available"
            />
          </label>
          <Button
            onClick={() => void queue("PRODUCT_LOOKUP", lookup)}
            loading={busy === "PRODUCT_LOOKUP"}
            disabled={!lookup.trim()}
          >
            Research product
          </Button>
        </Card>

        <Card>
          <Badge tone="info">Amazon catalog search</Badge>
          <h2>Discover catalog products</h2>
          <p>Search up to 20 results in the connected marketplace.</p>
          <label>
            Seed phrase
            <TextInput
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="dog grooming brush"
            />
          </label>
          <Button
            onClick={() => void queue("CATALOG_SEARCH", keyword)}
            loading={busy === "CATALOG_SEARCH"}
            disabled={!keyword.trim()}
          >
            Search Amazon catalog
          </Button>
          <small>
            This is a bounded researched universe—not the entire Amazon
            database, market size, search volume, or demand.
          </small>
        </Card>
      </div>

      <Card className="research-toolbar">
        <label>
          Connected marketplace
          <SelectControl
            value={marketplaceId}
            onChange={(event) => setMarketplaceId(event.target.value)}
          >
            {marketplaces.map((marketplace) => (
              <option key={marketplace.id} value={marketplace.id}>
                {marketplace.label}
                {marketplace.isDefault ? " · default" : ""}
              </option>
            ))}
          </SelectControl>
        </label>
        <label>
          Research project
          <SelectControl
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose a project</option>
            {projects
              .filter((project) => project.marketplaceId === marketplaceId)
              .map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
          </SelectControl>
        </label>
        <label>
          New project
          <span className="inline-control">
            <TextInput
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Launch idea"
            />
            <Button variant="secondary" onClick={() => void createProject()}>
              Create
            </Button>
          </span>
        </label>
      </Card>

      {run ? (
        <section aria-live="polite" className="product-research-results">
          <div className="section-heading">
            <div>
              <h2>
                {run.kind === "CATALOG_SEARCH"
                  ? "Amazon catalog researched universe"
                  : "Product research evidence"}
              </h2>
              <p>
                {run.queryText} · {run.resultCount} persisted result(s) ·{" "}
                {run.marketplaceId}
              </p>
            </div>
            <div className="button-row">
              <Badge
                tone={
                  run.status === "COMPLETED"
                    ? "success"
                    : run.status === "FAILED_FINAL"
                      ? "danger"
                      : "warning"
                }
              >
                {run.status.replaceAll("_", " ").toLowerCase()}
              </Badge>
              {terminal.has(run.status) && run.kind === "PRODUCT_LOOKUP" ? (
                <Button
                  variant="secondary"
                  onClick={() =>
                    void queue("PRODUCT_LOOKUP", run.queryText, true)
                  }
                >
                  Refresh Amazon data
                </Button>
              ) : null}
            </div>
          </div>
          {!terminal.has(run.status) ? (
            <Card>
              <Skeleton className="research-job-skeleton" />
              <p>Research job is running in the background…</p>
            </Card>
          ) : run.errorCode ? (
            <Alert tone="danger" title="Research could not complete">
              {humanErrors[run.errorCode] ??
                run.errorCode.replaceAll("_", " ").toLowerCase()}
            </Alert>
          ) : !run.items.length ? (
            <Alert tone="warning" title="No catalog product returned">
              Amazon returned no item in this connected marketplace. Missing
              results are not replaced with mock data.
            </Alert>
          ) : (
            <>
              <div className="research-action-bar">
                <span>{selected.length} selected</span>
                <Button
                  variant="secondary"
                  onClick={() => void act("SAVE_TO_PROJECT")}
                >
                  Save to project
                </Button>
                <Button variant="secondary" onClick={() => void act("WATCH")}>
                  Watch
                </Button>
                {run.kind === "CATALOG_SEARCH" ? (
                  <Button
                    onClick={() => void enrichSelected()}
                    loading={busy === "ENRICH_SELECTED"}
                  >
                    Research selected
                  </Button>
                ) : null}
                <ButtonLink
                  href="/settings/integrations/history"
                  variant="quiet"
                >
                  Refresh history
                </ButtonLink>
              </div>
              {run.items.map((item) => (
                <div key={item.id} className="research-result-selectable">
                  <label className="research-result-checkbox">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.product.id)}
                      onChange={() =>
                        setSelected((current) =>
                          current.includes(item.product.id)
                            ? current.filter((id) => id !== item.product.id)
                            : [...current, item.product.id],
                        )
                      }
                    />
                    Select {item.product.asin ?? item.product.title}
                  </label>
                  <ProductEvidence item={item} runId={run.id} />
                </div>
              ))}
              {run.resultCount > 10 ? (
                <div
                  className="pagination-controls"
                  aria-label="Catalog result pages"
                >
                  <Button
                    variant="secondary"
                    disabled={page === 0}
                    onClick={() => void loadRun(run.id, page - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {Math.ceil(run.resultCount / 10)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={(page + 1) * 10 >= run.resultCount}
                    onClick={() => void loadRun(run.id, page + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        <Card className="research-empty-state">
          <Badge tone="neutral">Ready</Badge>
          <h2>Start with a product or seed phrase</h2>
          <p>
            Results will show exactly which source supplied each value, when it
            was observed, and whether it is fresh or partial.
          </p>
        </Card>
      )}
    </main>
  );
}
