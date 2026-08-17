"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  SelectControl,
  useToast,
} from "@/src/components/ui";
import { PageHeader } from "@/src/components/page-header";

type Project = { id: string; name: string; marketplaceId: string };
type Detail = {
  categoryReference: string;
  categoryName: string;
  total: number;
  generatedAt: string;
  universe: string;
  analysisWindowCount: number;
  unavailableMetrics: string[];
  aggregate: {
    medianPrice: string | null;
    medianReviews: string | null;
    medianPriceVolatilityPercent: string | null;
    medianOpportunityScore: string | null;
    timeWindowComparison: {
      days30: {
        medianPriceVolatilityPercent: string | null;
        observedPriceVolatilityCount: number;
        medianReviewGrowth: string | null;
        observedReviewGrowthCount: number;
      };
      days90: {
        medianPriceVolatilityPercent: string | null;
        observedPriceVolatilityCount: number;
        medianReviewGrowth: string | null;
        observedReviewGrowthCount: number;
      };
    };
    reviewBarrier: { lowReviewCount: number; observedCount: number };
    brandConcentration: {
      hhi: string | null;
      topBrands: Array<{
        name: string;
        count: number;
        sharePercent: string | null;
      }>;
    };
    amazonRetail: { presentCount: number; knownCount: number };
    newProductEntry: { recentCount: number; observedCount: number };
    seasonality: { stableCount: number; observedCount: number };
    priceStability: { stableCount: number; observedCount: number };
    topReviewGrowthProducts: Array<{
      id: string;
      asin: string | null;
      title: string;
      brand: string | null;
      reviewGrowth: string | null;
    }>;
    decliningReviewGrowthProducts: Array<{
      id: string;
      asin: string | null;
      title: string;
      brand: string | null;
      reviewGrowth: string | null;
    }>;
    topReviewGrowthBrands: Array<{
      name: string;
      reviewGrowth: string;
      observedProductCount: number;
    }>;
    decliningReviewGrowthBrands: Array<{
      name: string;
      reviewGrowth: string;
      observedProductCount: number;
    }>;
  };
  products: Array<{
    id: string;
    asin: string | null;
    title: string;
    brand: string | null;
    price: string | null;
    reviewCount: string | null;
    priceVolatilityPercent: string | null;
    reviewGrowth: string | null;
    historyStatus: string | null;
    sources: string[];
  }>;
};
function value(text: string | number | null, suffix = "") {
  return text === null ? "Not observed" : `${text}${suffix}`;
}
function Metric({ label, detail }: { label: string; detail: string }) {
  return (
    <span
      className="metric-help"
      title={detail}
      aria-label={`${label}: ${detail}`}
    >
      ⓘ
    </span>
  );
}

export function CategoryDetail() {
  const params = useParams<{ categoryReference: string }>();
  const searchParams = useSearchParams();
  const { notify } = useToast();
  const categoryReference = decodeURIComponent(params.categoryReference);
  const marketplaceId = searchParams.get("marketplaceId") ?? "";
  const [data, setData] = useState<Detail | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const query = marketplaceId
      ? `?marketplaceId=${encodeURIComponent(marketplaceId)}`
      : "";
    const response = await fetch(
      `/api/category-intelligence/${encodeURIComponent(categoryReference)}${query}`,
      { cache: "no-store" },
    );
    const payload = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok)
      return notify(payload?.error ?? "Could not load category", "danger");
    setData(payload);
  }, [categoryReference, marketplaceId, notify]);
  useEffect(() => {
    void Promise.resolve().then(load);
    void fetch("/api/research-projects", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : []))
      .then(setProjects);
  }, [load]);
  const act = async (action: "SAVE_TO_PROJECT" | "WATCH") => {
    if (!data) return;
    if (action === "SAVE_TO_PROJECT" && !projectId)
      return notify("Choose a research project first.", "warning");
    if (!marketplaceId)
      return notify(
        "Choose a marketplace from the category browser before saving or watching this category.",
        "warning",
      );
    const response = await fetch("/api/category-intelligence/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        categoryReference: data.categoryReference,
        categoryName: data.categoryName,
        ...(projectId ? { projectId } : {}),
        marketplaceId,
      }),
    });
    const payload = await response.json().catch(() => null);
    notify(
      response.ok
        ? action === "WATCH"
          ? "Tracked-universe category watch saved."
          : "Category saved to research project."
        : (payload?.error ?? "Action failed"),
      response.ok ? "success" : "danger",
    );
  };
  if (loading)
    return (
      <main className="content-page">
        <Card>Loading category intelligence…</Card>
      </main>
    );
  if (!data)
    return (
      <main className="content-page">
        <Alert tone="danger" title="Category unavailable">
          The category could not be loaded from the tracked universe.
        </Alert>
      </main>
    );
  const a = data.aggregate;
  return (
    <main className="content-page category-intelligence">
      <PageHeader
        title={data.categoryName}
        description={`Tracked-universe category analysis generated ${new Date(data.generatedAt).toLocaleString()}.`}
        breadcrumbs={[
          { label: "Category Intelligence", href: "/category-intelligence" },
          { label: data.categoryName },
        ]}
      />
      <Alert tone="info" title="Member universe and date">
        {data.universe}. {data.total} matching products; aggregate analysis uses
        the first {data.analysisWindowCount} products in a deterministic
        title/id window. This is not an Amazon-wide market size.
      </Alert>
      <Card className="category-actions">
        <SelectControl
          aria-label="Research project"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <option value="">Choose project (optional)</option>
          {projects
            .filter(
              (project) =>
                !marketplaceId || project.marketplaceId === marketplaceId,
            )
            .map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
        </SelectControl>
        <Button variant="secondary" onClick={() => void act("SAVE_TO_PROJECT")}>
          Save to project
        </Button>
        <Button variant="secondary" onClick={() => void act("WATCH")}>
          Watch category
        </Button>
      </Card>
      <section
        className="category-metrics"
        aria-label="Category aggregate metrics"
      >
        <Card>
          <small>
            Median price{" "}
            <Metric
              label="Median price"
              detail="Median of observed featured prices in the analysis window."
            />
          </small>
          <strong>{value(a.medianPrice)}</strong>
        </Card>
        <Card>
          <small>
            Median reviews{" "}
            <Metric
              label="Median reviews"
              detail="Median of stored review-count observations; missing values are excluded."
            />
          </small>
          <strong>{value(a.medianReviews)}</strong>
        </Card>
        <Card>
          <small>
            Stable-price products{" "}
            <Metric
              label="Stable price"
              detail="90-day price volatility at or below 15%; it does not measure demand stability."
            />
          </small>
          <strong>
            {a.priceStability.stableCount} / {a.priceStability.observedCount}
          </strong>
        </Card>
        <Card>
          <small>
            Low-review products{" "}
            <Metric
              label="Review barrier"
              detail="Products with 100 or fewer observed reviews."
            />
          </small>
          <strong>
            {a.reviewBarrier.lowReviewCount} / {a.reviewBarrier.observedCount}
          </strong>
        </Card>
        <Card>
          <small>
            Brand HHI{" "}
            <Metric
              label="Brand concentration"
              detail="Herfindahl index from product counts in this tracked universe only; it is not category-wide share."
            />
          </small>
          <strong>{value(a.brandConcentration.hhi)}</strong>
        </Card>
        <Card>
          <small>
            Amazon Retail present{" "}
            <Metric
              label="Amazon Retail"
              detail="Latest observed offer presence; unknown observations are excluded from the denominator."
            />
          </small>
          <strong>
            {a.amazonRetail.presentCount} / {a.amazonRetail.knownCount}
          </strong>
        </Card>
      </section>
      <section className="category-grid">
        <Card>
          <h2>Signals with evidence</h2>
          <dl>
            <dt>Recent listing entry</dt>
            <dd>
              {a.newProductEntry.recentCount} of{" "}
              {a.newProductEntry.observedCount} observed listing ages are ≤90
              days
            </dd>
            <dt>Seasonality coverage</dt>
            <dd>
              {a.seasonality.stableCount} complete assessments of{" "}
              {a.seasonality.observedCount} observed
            </dd>
            <dt>Median opportunity score</dt>
            <dd>{value(a.medianOpportunityScore)}</dd>
            <dt>Median 90-day volatility</dt>
            <dd>{value(a.medianPriceVolatilityPercent, "%")}</dd>
          </dl>
        </Card>
        <Card>
          <h2>Tracked-universe brands</h2>
          {a.brandConcentration.topBrands.length ? (
            <ul>
              {a.brandConcentration.topBrands.map((brand) => (
                <li key={brand.name}>
                  {brand.name}: {brand.count} products ({brand.sharePercent}%)
                </li>
              ))}
            </ul>
          ) : (
            <p>No brand values were observed.</p>
          )}
        </Card>
        <Card>
          <h2>Unavailable or bounded metrics</h2>
          <ul>
            {data.unavailableMetrics.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </section>
      <Card>
        <h2>Products in this category window</h2>
        {data.products.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Brand</th>
                  <th>Price</th>
                  <th>Reviews</th>
                  <th>90d volatility</th>
                  <th>90d review growth</th>
                  <th>History</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.title}</strong>
                      <small>{product.asin ?? "ASIN unavailable"}</small>
                    </td>
                    <td>{product.brand ?? "—"}</td>
                    <td>{value(product.price)}</td>
                    <td>{value(product.reviewCount)}</td>
                    <td>{value(product.priceVolatilityPercent, "%")}</td>
                    <td>{value(product.reviewGrowth)}</td>
                    <td>
                      <Badge
                        tone={
                          product.historyStatus === "COMPLETE"
                            ? "success"
                            : "warning"
                        }
                      >
                        {product.historyStatus ?? "Not assessed"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No products currently match this category and marketplace.</p>
        )}
      </Card>
      <Card>
        <h2>30 / 90-day comparison</h2>
        <dl>
          <dt>Median price volatility</dt>
          <dd>
            30d:{" "}
            {value(
              a.timeWindowComparison.days30.medianPriceVolatilityPercent,
              "%",
            )}{" "}
            ({a.timeWindowComparison.days30.observedPriceVolatilityCount}{" "}
            observed)
          </dd>
          <dd>
            90d:{" "}
            {value(
              a.timeWindowComparison.days90.medianPriceVolatilityPercent,
              "%",
            )}{" "}
            ({a.timeWindowComparison.days90.observedPriceVolatilityCount}{" "}
            observed)
          </dd>
          <dt>Median review-count growth</dt>
          <dd>
            30d: {value(a.timeWindowComparison.days30.medianReviewGrowth)} (
            {a.timeWindowComparison.days30.observedReviewGrowthCount} observed)
          </dd>
          <dd>
            90d: {value(a.timeWindowComparison.days90.medianReviewGrowth)} (
            {a.timeWindowComparison.days90.observedReviewGrowthCount} observed)
          </dd>
        </dl>
      </Card>
      <Card className="category-growth">
        <h2>Review-count change (90 days, not demand)</h2>
        <div>
          <h3>Highest observed growth</h3>
          {a.topReviewGrowthProducts.length ? (
            a.topReviewGrowthProducts.map((product) => (
              <p key={product.id}>
                {product.title}: {product.reviewGrowth}
              </p>
            ))
          ) : (
            <p>Unavailable: no stored 90-day review-growth values.</p>
          )}
        </div>
        <div>
          <h3>Brands with highest observed review growth</h3>
          {a.topReviewGrowthBrands.length ? (
            a.topReviewGrowthBrands.map((brand) => (
              <p key={brand.name}>
                {brand.name}: {brand.reviewGrowth} across{" "}
                {brand.observedProductCount} products
              </p>
            ))
          ) : (
            <p>Unavailable: no stored 90-day review-growth values.</p>
          )}
        </div>
        <div>
          <h3>Brands with lowest observed review growth</h3>
          {a.decliningReviewGrowthBrands.length ? (
            a.decliningReviewGrowthBrands.map((brand) => (
              <p key={brand.name}>
                {brand.name}: {brand.reviewGrowth} across{" "}
                {brand.observedProductCount} products
              </p>
            ))
          ) : (
            <p>Unavailable: no stored 90-day review-growth values.</p>
          )}
        </div>
        <div>
          <h3>Lowest observed growth</h3>
          {a.decliningReviewGrowthProducts.length ? (
            a.decliningReviewGrowthProducts.map((product) => (
              <p key={product.id}>
                {product.title}: {product.reviewGrowth}
              </p>
            ))
          ) : (
            <p>Unavailable: no stored 90-day review-growth values.</p>
          )}
        </div>
      </Card>
      <Link
        className="rp-button rp-button--quiet rp-button--md"
        href="/category-intelligence"
      >
        Back to categories
      </Link>
    </main>
  );
}
