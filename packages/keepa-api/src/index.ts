import {
  type MarketHistory,
  type MarketHistoryBatch,
  type MarketHistoryPoint,
  type MarketHistoryProduct,
  type MarketHistoryRequest,
  type MarketHistorySeries,
  type MarketplaceContext,
  ProviderError,
  type ProviderCapabilityState,
  type ProviderHealth,
  type ProviderCapabilityDiscovery,
  type MarketHistoryProvider,
} from "@rizpoint/provider-contracts";

/** The documented Keepa product request is bounded to 100 ASINs. */
export const KEEPA_MAX_ASINS_PER_PRODUCT_REQUEST = 100;
const KEEPA_EPOCH_MS = Date.UTC(2011, 0, 1, 0, 0, 0);

export type KeepaConfig = {
  apiKey: string;
  endpoint?: string;
};

type KeepaFetch = (
  input: string,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
}>;

type KeepaProduct = Record<string, unknown>;

const MARKETPLACE_DOMAINS: Readonly<Record<string, number>> = {
  ATVPDKIKX0DER: 1,
  A1F83G8C2ARO7P: 2,
  A1PA6795UKMFR9: 3,
  A13V1IB3VIYZZH: 4,
  A1VC38T7YXB528: 5,
  A2EUQ1WTGCTBG2: 6,
  APJ6JRA9NG5V4: 8,
  A1RKKUPIHCS9HS: 9,
  A39IBJ37TRP1C6: 11,
};

const CSV = {
  AMAZON: 0,
  NEW: 1,
  SALES: 3,
  COUNT_NEW: 11,
} as const;

function keepaTimeToIso(value: unknown): string | null {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0)
    return null;
  return new Date(KEEPA_EPOCH_MS + value * 60_000).toISOString();
}

function pairs(value: unknown): Array<readonly [string, number]> {
  if (!Array.isArray(value)) return [];
  const result: Array<readonly [string, number]> = [];
  for (let index = 0; index + 1 < value.length; index += 2) {
    const at = keepaTimeToIso(value[index]);
    const amount = value[index + 1];
    if (at && typeof amount === "number" && Number.isSafeInteger(amount))
      result.push([at, amount]);
  }
  return result;
}

function cents(value: number): string {
  // Keepa reports integer minor units. Keep the conversion outside binary
  // floating-point arithmetic so normalized money remains an exact decimal.
  const amount = BigInt(value);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}

function priceSeries(
  metricKey: "AMAZON_PRICE" | "NEW_OFFER_PRICE",
  values: unknown,
): MarketHistorySeries | undefined {
  const points: MarketHistoryPoint[] = pairs(values)
    .filter(([, amount]) => amount >= 0)
    .map(([observedAt, amount]) => ({
      observedAt,
      decimalValue: cents(amount),
    }));
  if (!points.length) return undefined;
  return { metricKey, unit: "currency", currency: "USD", points };
}

function amazonAvailabilitySeries(
  values: unknown,
): MarketHistorySeries | undefined {
  const points: MarketHistoryPoint[] = pairs(values).map(
    ([observedAt, amount]) => ({
      observedAt,
      booleanValue: amount >= 0,
    }),
  );
  if (!points.length) return undefined;
  return { metricKey: "AMAZON_RETAIL_PRESENT", unit: "boolean", points };
}

function integerSeries(
  metricKey: "SALES_RANK" | "OFFER_COUNT" | "REVIEW_COUNT",
  values: unknown,
): MarketHistorySeries | undefined {
  const points: MarketHistoryPoint[] = pairs(values)
    .filter(([, amount]) => amount >= 0)
    .map(([observedAt, amount]) => ({
      observedAt,
      integerValue: String(amount),
    }));
  if (!points.length) return undefined;
  return {
    metricKey,
    unit: metricKey === "SALES_RANK" ? "rank" : "count",
    points,
  };
}

function singletonDecimal(
  metricKey: "RATING",
  value: unknown,
  observedAt: string,
): MarketHistorySeries | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return undefined;
  // Keepa ratings are commonly returned as integer hundredths.
  const normalized = value > 5 ? (value / 100).toFixed(2) : String(value);
  return {
    metricKey,
    unit: "rating",
    points: [{ observedAt, decimalValue: normalized }],
  };
}

function categoryContext(
  product: KeepaProduct,
): MarketHistoryProduct["categoryContext"] {
  const categories = product.categoryTree;
  if (!Array.isArray(categories)) return [];
  return categories.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const categoryId = record.catId ?? record.categoryId;
    if (typeof categoryId !== "number" && typeof categoryId !== "string")
      return [];
    return [
      {
        categoryId: String(categoryId),
        ...(typeof record.name === "string" ? { name: record.name } : {}),
      },
    ];
  });
}

function normalizeProduct(
  product: KeepaProduct,
  marketplaceId: string,
  observedAt: string,
): MarketHistoryProduct | null {
  const asin = product.asin;
  if (typeof asin !== "string" || !/^B[A-Z0-9]{9}$/.test(asin)) return null;
  const csv = Array.isArray(product.csv) ? product.csv : [];
  const series = [
    priceSeries("AMAZON_PRICE", csv[CSV.AMAZON]),
    priceSeries("NEW_OFFER_PRICE", csv[CSV.NEW]),
    amazonAvailabilitySeries(csv[CSV.AMAZON]),
    integerSeries("SALES_RANK", csv[CSV.SALES]),
    integerSeries("OFFER_COUNT", csv[CSV.COUNT_NEW]),
    singletonDecimal("RATING", product.rating, observedAt),
    typeof product.reviewCount === "number"
      ? {
          metricKey: "REVIEW_COUNT" as const,
          unit: "count",
          points: [{ observedAt, integerValue: String(product.reviewCount) }],
        }
      : undefined,
  ].filter((value): value is MarketHistorySeries => value !== undefined);
  const firstObservedAt = keepaTimeToIso(product.trackingSince);
  if (firstObservedAt)
    series.push({
      metricKey: "PRODUCT_FIRST_OBSERVED_AT",
      unit: "iso_datetime",
      points: [{ observedAt, textValue: firstObservedAt }],
    });
  const categories = categoryContext(product);
  if (categories.length)
    series.push({
      metricKey: "CATEGORY_CONTEXT",
      unit: "category",
      points: [
        {
          observedAt,
          textValue: categories
            .map(
              (category) =>
                `${category.categoryId}${category.name ? `:${category.name}` : ""}`,
            )
            .join(" | "),
        },
      ],
    });
  return {
    asin,
    marketplaceId,
    ...(firstObservedAt ? { firstObservedAt } : {}),
    categoryContext: categories,
    series,
    completeness: series.length ? "COMPLETE" : "PARTIAL",
    rawProviderObservation: product,
  };
}

/**
 * Keepa's Product endpoint uses an API key query parameter.  This transport
 * never logs the request URL; all caller telemetry uses a request hash.
 */
export class KeepaMarketHistoryProvider
  implements MarketHistoryProvider, ProviderCapabilityDiscovery
{
  readonly providerKey = "keepa";
  private readonly endpoint: string;

  constructor(
    private readonly config: KeepaConfig,
    private readonly fetcher: KeepaFetch = fetch as unknown as KeepaFetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.endpoint = config.endpoint ?? "https://api.keepa.com";
  }

  async getProductHistory(
    request: MarketHistoryRequest,
    marketplace: MarketplaceContext,
  ): Promise<MarketHistoryBatch> {
    if (
      !request.asins.length ||
      request.asins.length > KEEPA_MAX_ASINS_PER_PRODUCT_REQUEST
    )
      throw new ProviderError("INVALID_REQUEST");
    const domain = MARKETPLACE_DOMAINS[marketplace.marketplaceId];
    if (!domain) throw new ProviderError("INVALID_REQUEST");
    const url = new URL("/product", this.endpoint);
    url.searchParams.set("key", this.config.apiKey);
    url.searchParams.set("domain", String(domain));
    url.searchParams.set("asin", request.asins.join(","));
    url.searchParams.set("history", "1");
    url.searchParams.set("stats", String(request.historyDays));
    if (request.includeRatingAndReviews) url.searchParams.set("rating", "1");
    let response: Awaited<ReturnType<KeepaFetch>>;
    try {
      response = await this.fetcher(url.toString(), { method: "GET" });
    } catch {
      throw new ProviderError("PROVIDER_OUTAGE");
    }
    if (response.status === 429) {
      const retryAfterMs = retryAfter(response.headers);
      throw new ProviderError("THROTTLED", {
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    if (response.status === 401 || response.status === 403)
      throw new ProviderError("UNAUTHORIZED", { httpStatus: response.status });
    if (response.status === 402)
      throw new ProviderError("THROTTLED", { httpStatus: response.status });
    if (!response.ok)
      throw new ProviderError("PROVIDER_OUTAGE", {
        httpStatus: response.status,
      });
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object")
      throw new ProviderError("INVALID_RESPONSE");
    const products = Array.isArray((body as { products?: unknown }).products)
      ? (body as { products: unknown[] }).products
          .flatMap((value) =>
            value && typeof value === "object"
              ? [
                  normalizeProduct(
                    value as KeepaProduct,
                    marketplace.marketplaceId,
                    this.now().toISOString(),
                  ),
                ]
              : [],
          )
          .filter((value): value is MarketHistoryProduct => value !== null)
      : [];
    const completeness =
      products.length === request.asins.length
        ? "COMPLETE"
        : products.length
          ? "PARTIAL"
          : "UNKNOWN";
    const observedAt = this.now().toISOString();
    return {
      value: {
        operation: "getProductHistory",
        marketplaceId: marketplace.marketplaceId,
        products,
      },
      provenance: {
        provider: this.providerKey,
        dataOrigin: "LICENSED_PROVIDER",
        observedAt,
        freshnessState: "FRESH",
        marketplaceId: marketplace.marketplaceId,
        responseCompleteness:
          completeness === "COMPLETE" ? "COMPLETE" : "PARTIAL",
      },
      rawProviderObservation: body,
    };
  }

  async getHistory(
    asin: string,
    marketplace: MarketplaceContext,
  ): Promise<MarketHistory> {
    const result = await this.getProductHistory(
      { asins: [asin], historyDays: 365, includeRatingAndReviews: false },
      marketplace,
    );
    const product = result.value.products[0];
    const amazon = product?.series.find(
      (series) => series.metricKey === "AMAZON_PRICE",
    );
    return {
      value: (amazon?.points ?? []).flatMap((point) =>
        point.decimalValue
          ? [
              {
                observedAt: point.observedAt,
                price: point.decimalValue,
                currency: amazon?.currency ?? "USD",
              },
            ]
          : [],
      ),
      provenance: result.provenance,
    };
  }

  async capabilities(
    marketplace: MarketplaceContext,
  ): Promise<readonly ProviderCapabilityState[]> {
    const checkedAt = this.now().toISOString();
    return [
      {
        providerKey: this.providerKey,
        marketplaceId: marketplace.marketplaceId,
        capability: "MARKET_HISTORY",
        mode: "LIVE",
        state: "AUTHORIZED",
        checkedAt,
        completeness: "UNKNOWN",
      },
    ];
  }

  async health(marketplace: MarketplaceContext): Promise<ProviderHealth> {
    return {
      provider: this.providerKey,
      mode: "LIVE",
      status: "AUTHORIZED",
      checkedAt: this.now().toISOString(),
      capabilities: [...(await this.capabilities(marketplace))],
    };
  }
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}
