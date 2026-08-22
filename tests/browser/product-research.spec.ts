import { expect, test } from "@playwright/test";
import {
  captureUnexpectedBrowserFailures,
  expectNoUnexpectedBrowserFailures,
} from "./runtime-failures.js";

const product = {
  id: "run-item",
  status: "COMPLETED",
  product: {
    id: "product-1",
    asin: "B000000001",
    title: "Verified catalog product",
    brand: "Evidence Brand",
    marketplaceId: "ATVPDKIKX0DER",
    identifiers: [{ type: "ASIN", value: "B000000001" }],
    identity: {
      images: [],
      salesRanks: [{ classificationId: "home", rank: 42 }],
    },
  },
  source: "Amazon Selling Partner API",
  dataOrigin: "LIVE_AMAZON",
  observedAt: "2026-08-22T10:00:00.000Z",
  freshUntil: "2026-08-23T10:00:00.000Z",
  freshnessState: "FRESH",
  completeness: "COMPLETE",
  evidence: {
    pricing: {
      status: "AVAILABLE",
      value: {
        value: {
          featuredOfferState: "PRESENT",
          featuredOffer: { landedPrice: "24.99", currency: "USD" },
          visibleOfferCount: 3,
          amazonRetailPresence: "ABSENT",
          completeness: "COMPLETE",
          offers: [],
        },
      },
    },
    fees: {
      status: "AVAILABLE",
      value: {
        value: {
          totalFee: "7.25",
          currency: "USD",
          scenarioSource: "CURRENT_FEATURED_OFFER",
        },
      },
    },
    restrictions: {
      status: "AVAILABLE",
      value: { value: { state: "ELIGIBLE", reasons: [] } },
    },
  },
};

test.describe("live product research vertical slice", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/marketplaces", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          source: "AMAZON_MARKETPLACE_PARTICIPATIONS",
          marketplaces: [
            {
              id: "ATVPDKIKX0DER",
              label: "United States · amazon.com",
              domain: "amazon.com",
              locale: "en-US",
              language: "en",
              currency: "USD",
              timeZone: "America/Los_Angeles",
              categoryMappingVersion: "us/v1",
              feeModelVersion: "us/v1",
              capabilities: ["CATALOG", "FEES"],
              isDefault: true,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/research-projects", async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            id: "project-1",
            name: "Launch idea",
            marketplaceId: "ATVPDKIKX0DER",
          }),
        });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "project-1",
            name: "Launch idea",
            marketplaceId: "ATVPDKIKX0DER",
          },
        ]),
      });
    });
    await page.route("**/api/product-explorer/actions", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ status: "OK", count: 1 }),
      }),
    );
  });

  test("runs manual identifier research and exposes honest live evidence", async ({
    page,
  }) => {
    const failures = captureUnexpectedBrowserFailures(page);
    await page.route("**/api/product-research*", async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ id: "run-1", status: "PENDING" }),
        });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "run-1",
          kind: "PRODUCT_LOOKUP",
          status: "COMPLETED",
          marketplaceId: "ATVPDKIKX0DER",
          providerMode: "LIVE",
          queryType: "ASIN",
          queryText: "B000000001",
          resultCount: 1,
          errorCode: null,
          createdAt: "2026-08-22T10:00:00.000Z",
          completedAt: "2026-08-22T10:00:02.000Z",
          items: [product],
        }),
      });
    });
    await page.goto("/product-research");
    await expect(
      page.getByRole("heading", { name: "Research product", level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel("Product identifier or URL")
      .fill("https://www.amazon.com/example/dp/B000000001");
    await page.getByRole("button", { name: "Research product" }).click();
    await expect(page.getByText("Verified catalog product")).toBeVisible();
    await expect(page.getByText("Live Amazon")).toBeVisible();
    await expect(page.getByText("Amazon Selling Partner API")).toBeVisible();
    await expect(page.getByText("$24.99")).toBeVisible();
    await expect(page.getByText("$7.25")).toBeVisible();
    await expect(page.getByText("ELIGIBLE")).toBeVisible();
    await page.getByLabel("Select B000000001").check();
    await page.getByLabel("Research project").selectOption("project-1");
    await page.getByRole("button", { name: "Save to project" }).click();
    await expect(page.getByText("1 product(s) updated.")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    expectNoUnexpectedBrowserFailures(failures);
  });

  test("labels keyword results as a bounded Amazon catalog universe", async ({
    page,
  }) => {
    await page.route("**/api/product-research*", async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ id: "catalog-run", status: "PENDING" }),
        });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "catalog-run",
          kind: "CATALOG_SEARCH",
          status: "COMPLETED",
          marketplaceId: "ATVPDKIKX0DER",
          providerMode: "LIVE",
          queryType: "KEYWORD",
          queryText: "dog grooming brush",
          resultCount: 1,
          errorCode: null,
          createdAt: "2026-08-22T10:00:00.000Z",
          completedAt: "2026-08-22T10:00:02.000Z",
          items: [product],
        }),
      });
    });
    await page.goto("/product-research");
    await page.getByLabel("Seed phrase").fill("dog grooming brush");
    await page.getByRole("button", { name: "Search Amazon catalog" }).click();
    await expect(
      page.getByRole("heading", { name: "Amazon catalog researched universe" }),
    ).toBeVisible();
    await expect(
      page.getByText(/not the entire Amazon database/i),
    ).toBeVisible();
  });

  test("shows a professional provider-required history state", async ({
    page,
  }) => {
    await page.route("**/api/providers/market-history", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          provider: "recorded-history",
          mode: "MOCK",
          status: "NOT_CONFIGURED",
          configured: false,
          checkedAt: "2026-08-22T10:00:00.000Z",
          dataOrigin: "RECORDED_FIXTURE",
          capabilities: [],
          message: "A licensed provider is required for live history.",
        }),
      }),
    );
    await page.goto("/settings/integrations/history");
    await expect(page.getByText("Provider required")).toBeVisible();
    await expect(
      page.getByText(/SP-API is never used as a substitute/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Secrets must never be pasted into this browser/i),
    ).toBeVisible();
  });
});
