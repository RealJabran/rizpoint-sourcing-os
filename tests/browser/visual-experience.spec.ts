import { expect, test, type Page, type TestInfo } from "@playwright/test";

const observedAt = "2026-08-23T08:00:00.000Z";
const explorerProduct = {
  id: "product-1",
  asin: "B000000001",
  title: "Premium evidence-backed grooming brush",
  brand: "North Pine",
  marketplaceId: "ATVPDKIKX0DER",
  category: "Pet Supplies",
  catalogProviderKey: "amazon-sp-api",
  catalogCompleteness: "COMPLETE",
  sources: ["RESEARCH_PROJECT", "PRODUCT_RESEARCH"],
  price: "24.99",
  currency: "USD",
  rating: "4.4",
  reviewCount: "186",
  salesRank: "42",
  offerCount: 3,
  fbaOfferCount: 2,
  fbmOfferCount: 1,
  amazonRetailPresence: "ABSENT",
  priceVolatilityPercent: "3.2",
  reviewGrowth: "8",
  listingAgeDays: "420",
  seasonalityStatus: "STABLE",
  historyStatus: "AVAILABLE",
  historyCoveragePercent: "92",
  freshnessState: "FRESH",
  observedAt,
  pricingProviderKey: "amazon-sp-api",
  pricingCompleteness: "COMPLETE",
  historyProviderKey: "licensed-history",
};
const researchItem = {
  id: "run-item-1",
  status: "COMPLETED",
  product: {
    id: "product-1",
    asin: "B000000001",
    title: explorerProduct.title,
    brand: explorerProduct.brand,
    marketplaceId: explorerProduct.marketplaceId,
    identifiers: [
      { type: "ASIN", value: "B000000001" },
      { type: "UPC", value: "012345678905" },
    ],
    identity: {
      images: [],
      salesRanks: [{ classificationId: "Pet Supplies", rank: 42 }],
    },
  },
  source: "Amazon Selling Partner API",
  dataOrigin: "LIVE_AMAZON",
  observedAt,
  freshUntil: "2026-08-24T08:00:00.000Z",
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
          offers: [
            {
              sellerId: "Verified seller",
              fulfillmentChannel: "FBA",
              listingPrice: "24.49",
              landedPrice: "24.99",
              currency: "USD",
              condition: "New",
            },
          ],
        },
      },
    },
    fees: {
      status: "AVAILABLE",
      value: {
        value: {
          totalFee: "7.25",
          currency: "USD",
          price: "24.99",
          scenarioSource: "CURRENT_FEATURED_OFFER",
          completeness: "COMPLETE",
        },
      },
    },
    restrictions: {
      status: "AVAILABLE",
      value: { value: { state: "ELIGIBLE", reasons: [] } },
    },
    history: {
      status: "PROVIDER_REQUIRED",
      reason: "Licensed provider required",
    },
    salesEstimate: { status: "UNAVAILABLE", reason: "No calibrated model" },
  },
};
const researchRun = {
  id: "run-1",
  kind: "PRODUCT_LOOKUP",
  status: "COMPLETED",
  marketplaceId: "ATVPDKIKX0DER",
  providerMode: "LIVE",
  queryType: "ASIN",
  queryText: "B000000001",
  resultCount: 1,
  errorCode: null,
  createdAt: observedAt,
  completedAt: "2026-08-23T08:00:02.000Z",
  items: [researchItem],
};

async function captureBreakpoints(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  for (const viewport of [
    { label: "desktop", width: 1440, height: 900 },
    { label: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate((viewportWidth) => {
      const documentWidth = document.documentElement.scrollWidth;
      const offenders = Array.from(document.querySelectorAll("body *"))
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          const htmlElement = element as HTMLElement;
          return {
            element: `${element.tagName.toLowerCase()}.${typeof element.className === "string" ? element.className.split(" ").filter(Boolean).join(".") : ""}`,
            right: Math.round(bounds.right),
            width: Math.round(bounds.width),
            scrollWidth: htmlElement.scrollWidth,
            clientWidth: htmlElement.clientWidth,
          };
        })
        .filter(
          (item) =>
            item.right > viewportWidth + 1 ||
            item.scrollWidth > item.clientWidth + 3,
        )
        .sort(
          (left, right) =>
            Math.max(right.right, right.scrollWidth) -
            Math.max(left.right, left.scrollWidth),
        )
        .slice(0, 8);
      return { documentWidth, offenders };
    }, viewport.width);
    expect(
      overflow.documentWidth,
      `Document overflow at ${viewport.label}: ${JSON.stringify(overflow.offenders)}`,
    ).toBeLessThanOrEqual(viewport.width);
    const screenshotPath = testInfo.outputPath(
      `${name}-${viewport.width}x${viewport.height}.png`,
    );
    await page.screenshot({
      path: screenshotPath,
      animations: "disabled",
    });
    await testInfo.attach(`${name}-${viewport.label}`, {
      path: screenshotPath,
      contentType: "image/png",
    });
  }
}

test.describe("RizPoint premium visual acceptance", () => {
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
              capabilities: ["CATALOG", "FEES", "RESTRICTIONS"],
              isDefault: true,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/alerts", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
    await page.route("**/api/providers/market-history", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          provider: "licensed-history",
          mode: "LIVE",
          status: "NOT_CONFIGURED",
          configured: false,
          checkedAt: observedAt,
        }),
      }),
    );
    await page.route("**/api/providers/amazon", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          providerName: "Amazon Selling Partner API",
          connectionState: "CONNECTED",
          dataOrigin: "LIVE_AMAZON",
          localDemo: false,
          oauthAvailable: true,
          selfAuthorizedReady: true,
          connection: {
            mode: "SELF_AUTHORIZED",
            sellerIdentity: "Seller •••• 4821",
            region: "NA",
            connectedAt: observedAt,
            lastValidatedAt: observedAt,
            lastSuccessfulValidation: observedAt,
            lastErrorCode: null,
            revokedAt: null,
            marketplaces: [
              {
                marketplaceId: "ATVPDKIKX0DER",
                name: "United States",
                countryCode: "US",
                defaultCurrencyCode: "USD",
                defaultLanguageCode: "en-US",
                isParticipating: true,
                hasSuspendedListings: false,
                isDefault: true,
                observedAt,
              },
            ],
            capabilities: [
              "CATALOG",
              "COMPETITIVE_OFFERS",
              "FEES",
              "RESTRICTIONS",
            ].map((capability) => ({
              marketplaceId: "ATVPDKIKX0DER",
              capability,
              source: "Amazon Selling Partner API",
              dataOrigin: "LIVE_AMAZON",
              mode: "LIVE",
              state: "HEALTHY",
              reasonCode: null,
              completeness: "COMPLETE",
              freshness: "FRESH",
              checkedAt: observedAt,
              expiresAt: null,
              retryAt: null,
              lastSuccessAt: observedAt,
            })),
          },
          latestAction: null,
        }),
      }),
    );
    await page.route("**/api/dashboard/summary", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          totalScans: 12,
          processingScans: 1,
          attentionScans: 2,
          activeProjects: 4,
          activeWatches: 18,
          openAlerts: 1,
          staleEvidence: 3,
          recentScans: [],
          recentResearch: [
            {
              ...researchRun,
              items: [
                {
                  catalogProduct: {
                    title: explorerProduct.title,
                    asin: explorerProduct.asin,
                  },
                  freshnessState: "FRESH",
                },
              ],
            },
          ],
          recentAlerts: [
            {
              id: "alert-1",
              status: "OPEN",
              severity: "WARNING",
              observedAt,
              triggeredAt: observedAt,
              alertRule: {
                metricKey: "PRICE_CHANGE",
                subjectType: "PRODUCT",
                marketplaceId: "ATVPDKIKX0DER",
              },
            },
          ],
        }),
      }),
    );
    await page.route("**/api/product-explorer/views", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
    await page.route("**/api/product-explorer?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ total: 1, rows: [explorerProduct] }),
      }),
    );
    await page.route("**/api/product-research*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(researchRun),
      }),
    );
    await page.route("**/api/research-projects", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "project-1",
            name: "Pet care launch",
            marketplaceId: "ATVPDKIKX0DER",
            status: "ACTIVE",
          },
        ]),
      }),
    );
    await page.route("**/api/project-hub?*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "project-1",
          name: "Pet care launch",
          marketplaceId: "ATVPDKIKX0DER",
          status: "ACTIVE",
          version: 3,
          updatedAt: observedAt,
          projectTags: [{ tag: { id: "tag-1", label: "Validated niche" } }],
          items: [
            {
              id: "item-1",
              kind: "PRODUCT",
              displayLabel: null,
              catalogProductId: "product-1",
              marketDefinitionId: null,
              catalogProduct: {
                id: "product-1",
                title: explorerProduct.title,
                asin: explorerProduct.asin,
                brand: explorerProduct.brand,
                productResearchItems: [
                  {
                    observedAt,
                    freshnessState: "FRESH",
                    completeness: "COMPLETE",
                    source: "Amazon Selling Partner API",
                    run: {
                      id: "run-1",
                      status: "COMPLETED",
                      completedAt: observedAt,
                      createdAt: observedAt,
                    },
                  },
                ],
              },
              marketDefinition: null,
              keyword: null,
            },
          ],
          notes: [
            {
              id: "note-1",
              body: "Confirm supplier handle samples.",
              updatedAt: observedAt,
            },
          ],
          evidenceReferences: [
            {
              id: "evidence-1",
              label: "Live catalog evidence",
              evidenceType: "provider observation",
              sourceReference: "Amazon SP-API",
              observedAt,
            },
          ],
          assumptions: [
            {
              id: "assumption-1",
              label: "Target price",
              value: "$24.99",
              assumedAt: observedAt,
            },
          ],
          decisionMemos: [],
          productFacts: [],
          listingDrafts: [],
          launchPlans: [],
          privateLabelQuoteScenarios: [],
          productWatches: [{}],
          marketDefinitions: [],
          assessments: [],
          complianceRiskAssessments: [],
          portfolioOptimizationRuns: [],
        }),
      }),
    );
    await page.route("**/api/differentiation*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          evidence: [
            {
              themeId: "theme-1",
              label: "Handle comfort",
              reviewCount: 18,
              averageRating: "2.8",
              evidenceReviewIds: ["review-example-1"],
            },
          ],
          hypotheses: [
            {
              label: "Ergonomic grip",
              recommendation:
                "Explore a wider, textured handle as a validation hypothesis.",
              validationQuestion:
                "Can the supplier provide grip samples for a controlled comfort test?",
              confidence: "MEDIUM",
              supportingSignals: ["18 handle-comfort complaints"],
              evidenceReviewIds: ["review-example-1"],
            },
          ],
          missingInputs: ["Licensed return-reason evidence"],
        }),
      }),
    );
  });

  const routes = [
    { name: "dashboard", path: "/", heading: "Research with confidence" },
    {
      name: "amazon-integrations",
      path: "/settings/integrations/amazon",
      heading: "Amazon integration",
    },
    {
      name: "wholesale-analysis",
      path: "/analysis",
      heading: "Analysis workspace",
    },
    {
      name: "product-explorer",
      path: "/product-explorer",
      heading: "Product Explorer",
    },
    {
      name: "product-detail",
      path: "/product-research/run-1?product=product-1",
      heading: explorerProduct.title,
    },
    {
      name: "research-project",
      path: "/research-projects?projectId=project-1",
      heading: "Research Projects",
    },
    {
      name: "differentiation",
      path: "/differentiation?productId=product-1",
      heading: "Product differentiation",
    },
  ] as const;

  for (const route of routes) {
    test(`${route.name} is intentional at desktop and mobile widths`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(route.path);
      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 }),
      ).toBeVisible();
      if (route.name === "differentiation")
        await expect(
          page.getByText("Ergonomic grip", { exact: true }),
        ).toBeVisible();
      if (route.name === "research-project")
        await expect(
          page.getByRole("heading", { name: "Pet care launch" }),
        ).toBeVisible();
      await captureBreakpoints(page, testInfo, route.name);
    });
  }

  test("mobile navigation is a deliberate drawer", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Research" })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    const screenshotPath = testInfo.outputPath("mobile-navigation-390x844.png");
    await page.screenshot({
      path: screenshotPath,
      animations: "disabled",
    });
    await testInfo.attach("mobile-navigation-390x844", {
      path: screenshotPath,
      contentType: "image/png",
    });
  });
});
