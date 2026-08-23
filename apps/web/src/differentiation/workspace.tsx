"use client";

import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileDown,
  Lightbulb,
  MessageSquareText,
  PackageSearch,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  SelectControl,
  Skeleton,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type ProductOption = {
  id: string;
  title: string;
  asin: string | null;
  brand: string | null;
};
type ProjectOption = { id: string; name: string };
type Brief = {
  evidence: Array<{
    themeId: string;
    label: string;
    reviewCount: number;
    averageRating: string | null;
    evidenceReviewIds: string[];
  }>;
  hypotheses: Array<{
    label: string;
    recommendation: string;
    validationQuestion: string;
    confidence: "LOW" | "MEDIUM";
    supportingSignals: string[];
    evidenceReviewIds: string[];
  }>;
  missingInputs: string[];
};

function confidenceTone(confidence: "LOW" | "MEDIUM") {
  return confidence === "MEDIUM" ? ("warning" as const) : ("neutral" as const);
}

export function DifferentiationWorkspace() {
  const { notify } = useToast();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [productId, setProductId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [brief, setBrief] = useState<Brief | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBrief = useCallback(async (selectedProductId: string) => {
    if (!selectedProductId) return;
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/differentiation?productId=${encodeURIComponent(selectedProductId)}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "BRIEF_UNAVAILABLE");
      setBrief(body);
    } catch {
      setBrief(null);
      setError(
        "RizPoint could not build an evidence-grounded brief for this product.",
      );
    } finally {
      setBuilding(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const linkedProduct =
      new URLSearchParams(window.location.search).get("productId") ?? "";
    void Promise.all([
      fetch("/api/product-explorer?limit=50", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => (response.ok ? response.json() : { rows: [] })),
      fetch("/api/research-projects", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => (response.ok ? response.json() : [])),
    ])
      .then(([productPayload, projectPayload]) => {
        const nextProducts = productPayload.rows as ProductOption[];
        setProducts(nextProducts);
        setProjects(projectPayload as ProjectOption[]);
        const selected = nextProducts.some((item) => item.id === linkedProduct)
          ? linkedProduct
          : "";
        setProductId(selected);
        setLoadingOptions(false);
        if (selected) void loadBrief(selected);
      })
      .catch((cause) => {
        if (cause?.name !== "AbortError") {
          setLoadingOptions(false);
          setError("Product choices are temporarily unavailable.");
        }
      });
    return () => controller.abort();
  }, [loadBrief]);

  const selectedProduct = products.find((product) => product.id === productId);
  const evidenceCount = useMemo(
    () => brief?.evidence.reduce((sum, item) => sum + item.reviewCount, 0) ?? 0,
    [brief],
  );
  const questionCount = new Set(
    brief?.hypotheses.map((item) => item.validationQuestion) ?? [],
  ).size;

  async function exportBrief() {
    if (!productId || !projectId) return;
    const response = await fetch("/api/differentiation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ catalogProductId: productId, projectId }),
    });
    notify(
      response.ok
        ? "Differentiation brief saved to the selected project."
        : "The brief could not be saved.",
      response.ok ? "success" : "danger",
    );
  }

  return (
    <main className="content-page differentiation-page">
      <PageHeader
        kicker="Evidence-led product strategy"
        title="Product differentiation"
        description="Turn authorized customer signals into supplier questions and clearly labeled hypotheses—not unsupported product claims."
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Research", href: "/product-research" },
          { label: "Differentiation" },
        ]}
        actions={
          <ButtonLink href="/review-intelligence" variant="secondary">
            <MessageSquareText aria-hidden="true" /> Review intelligence
          </ButtonLink>
        }
      />

      <Card className="differentiation-selector">
        <div className="differentiation-selector__intro">
          <span className="differentiation-icon">
            <Lightbulb aria-hidden="true" />
          </span>
          <div>
            <span className="eyebrow">Start with stored evidence</span>
            <h2>Select a product to investigate</h2>
            <p>
              Choose from products already researched, watched, imported, or
              saved to a project.
            </p>
          </div>
        </div>
        {loadingOptions ? (
          <Skeleton className="differentiation-selector__skeleton" />
        ) : products.length ? (
          <div className="differentiation-selector__controls">
            <label>
              <span>Product</span>
              <SelectControl
                aria-label="Select product"
                value={productId}
                onChange={(event) => {
                  setProductId(event.target.value);
                  setBrief(null);
                }}
              >
                <option value="">Choose a researched product</option>
                {products.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.title}
                    {product.asin ? ` · ${product.asin}` : ""}
                  </option>
                ))}
              </SelectControl>
            </label>
            <Button
              disabled={!productId}
              loading={building}
              onClick={() => void loadBrief(productId)}
            >
              Build differentiation brief <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <EmptyState
            compact
            title="No researched products yet"
            description="Research or import a product first. RizPoint will never ask you to paste a database identifier."
            actions={
              <ButtonLink href="/product-research">
                <PackageSearch aria-hidden="true" /> Research product
              </ButtonLink>
            }
          />
        )}
      </Card>

      {error ? (
        <Alert tone="danger" title="Brief unavailable">
          {error}
        </Alert>
      ) : null}
      {building ? (
        <div className="differentiation-loading">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : null}
      {!brief && !building ? (
        <Card className="differentiation-empty">
          <EmptyState
            eyebrow="Ready when your evidence is"
            title="A brief begins with signals—not a blank AI prompt"
            description="RizPoint will surface review themes, competitor weaknesses, validation hypotheses, and supplier questions only when supporting records exist."
            icon={<Sparkles aria-hidden="true" />}
          />
          <div className="differentiation-boundaries">
            <span>
              <CheckCircle2 aria-hidden="true" /> Evidence remains inspectable
            </span>
            <span>
              <ShieldCheck aria-hidden="true" /> Hypotheses remain labeled
            </span>
            <span>
              <TriangleAlert aria-hidden="true" /> Missing inputs stay missing
            </span>
          </div>
        </Card>
      ) : null}

      {brief ? (
        <>
          <section
            className="differentiation-summary"
            aria-label="Brief coverage"
          >
            <div>
              <span>Selected product</span>
              <strong>{selectedProduct?.title ?? "Researched product"}</strong>
              <small>
                {selectedProduct?.brand ?? "Brand unavailable"}{" "}
                {selectedProduct?.asin ? `· ${selectedProduct.asin}` : ""}
              </small>
            </div>
            <div>
              <span>Evidence examples</span>
              <strong>{evidenceCount}</strong>
              <small>Authorized review records</small>
            </div>
            <div>
              <span>Recurring themes</span>
              <strong>{brief.evidence.length}</strong>
              <small>Evidence-linked clusters</small>
            </div>
            <div>
              <span>Supplier questions</span>
              <strong>{questionCount}</strong>
              <small>Validation prompts</small>
            </div>
          </section>

          <div className="differentiation-grid">
            <Card className="differentiation-evidence">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Observed evidence</span>
                  <h2>Customer and competitor signals</h2>
                </div>
                <Badge tone={brief.evidence.length ? "success" : "neutral"}>
                  {brief.evidence.length ? "Evidence available" : "No themes"}
                </Badge>
              </div>
              {brief.evidence.length ? (
                <div className="theme-list">
                  {brief.evidence.map((item) => (
                    <article key={item.themeId}>
                      <span className="theme-icon">
                        <MessageSquareText aria-hidden="true" />
                      </span>
                      <div>
                        <h3>{item.label}</h3>
                        <p>
                          {item.reviewCount} linked review
                          {item.reviewCount === 1 ? "" : "s"} · average rating{" "}
                          {item.averageRating ?? "unavailable"}
                        </p>
                        <details>
                          <summary>Inspect supporting references</summary>
                          <ul>
                            {item.evidenceReviewIds.map((reference) => (
                              <li key={reference}>{reference}</li>
                            ))}
                          </ul>
                        </details>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState
                  compact
                  title="No review themes available"
                  description="Connect a licensed review provider or import an authorized review export. RizPoint does not scrape Amazon review pages."
                  actions={
                    <ButtonLink
                      href="/review-intelligence"
                      variant="secondary"
                      size="sm"
                    >
                      Add review evidence
                    </ButtonLink>
                  }
                />
              )}
            </Card>

            <Card className="differentiation-questions">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Supplier validation</span>
                  <h2>Questions to resolve</h2>
                </div>
                <ClipboardList aria-hidden="true" />
              </div>
              {brief.hypotheses.length ? (
                <ol>
                  {brief.hypotheses.map((item) => (
                    <li key={`${item.label}-${item.validationQuestion}`}>
                      <span>{item.validationQuestion}</span>
                      <small>Supports: {item.label}</small>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState
                  compact
                  title="No questions without evidence"
                  description="Supplier questions are derived only from evidence-backed hypotheses."
                />
              )}
            </Card>
          </div>

          <Card className="differentiation-hypotheses">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Ideas to validate</span>
                <h2>Differentiation hypotheses</h2>
                <p>
                  These are validation directions, not verified product claims.
                </p>
              </div>
              <Badge tone="warning">Hypotheses</Badge>
            </div>
            {brief.hypotheses.length ? (
              <div className="hypothesis-grid">
                {brief.hypotheses.map((item) => (
                  <article key={item.label}>
                    <div>
                      <Badge tone={confidenceTone(item.confidence)}>
                        {item.confidence.toLowerCase()} confidence
                      </Badge>
                      <span className="hypothesis-label">{item.label}</span>
                    </div>
                    <h3>{item.recommendation}</h3>
                    <div className="signal-list">
                      <strong>Supporting signals</strong>
                      {item.supportingSignals.map((signal) => (
                        <span key={signal}>
                          <CheckCircle2 aria-hidden="true" /> {signal}
                        </span>
                      ))}
                    </div>
                    <p>
                      <strong>Validate with supplier</strong>
                      {item.validationQuestion}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="No defensible hypotheses yet"
                description="More authorized evidence is required before RizPoint can propose a supported validation direction."
              />
            )}
          </Card>

          {brief.missingInputs.length ? (
            <Card className="differentiation-missing">
              <div>
                <TriangleAlert aria-hidden="true" />
                <span>
                  <strong>Evidence gaps</strong>
                  <p>These inputs were not available and were not inferred.</p>
                </span>
              </div>
              <ul>
                {brief.missingInputs.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card className="differentiation-export">
            <div>
              <span className="eyebrow">Decision workflow</span>
              <h2>Save this brief to a research project</h2>
              <p>
                The project keeps the brief alongside its evidence, economics,
                risks, and decision record.
              </p>
            </div>
            <div>
              <SelectControl
                aria-label="Save brief to project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                <option value="">Choose a project</option>
                {projects.map((project) => (
                  <option value={project.id} key={project.id}>
                    {project.name}
                  </option>
                ))}
              </SelectControl>
              <Button disabled={!projectId} onClick={() => void exportBrief()}>
                <FileDown aria-hidden="true" /> Save brief
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </main>
  );
}
