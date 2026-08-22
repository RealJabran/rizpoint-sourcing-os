import { expect, test } from "@playwright/test";
import {
  captureUnexpectedBrowserFailures,
  expectNoUnexpectedBrowserFailures,
} from "./runtime-failures.js";

test.describe("Amazon integration workspace", () => {
  test("shows an honest connection state and guided private-owner setup", async ({
    page,
  }) => {
    const failures = captureUnexpectedBrowserFailures(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/settings/integrations/amazon");
    await expect(
      page.getByRole("heading", { name: "Amazon integration" }),
    ).toBeVisible();
    await expect(page.getByText("No live Amazon data")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Secure self-authorization" }),
    ).toBeVisible();
    await expect(page.getByText("pnpm sp-api:connect")).toBeVisible();
    expectNoUnexpectedBrowserFailures(failures);
  });

  test("remains usable at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/integrations/amazon");
    await expect(
      page.getByRole("heading", { name: "Amazon integration" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });

  test("explains proven and provider-required capability families", async ({
    page,
  }) => {
    await page.route("**/api/providers/amazon", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          providerName: "Amazon Selling Partner API",
          connectionState: "CONNECTED",
          dataOrigin: "LIVE_AMAZON",
          localDemo: false,
          oauthAvailable: false,
          selfAuthorizedReady: true,
          latestAction: null,
          connection: {
            mode: "SELF_AUTHORIZED",
            sellerIdentity: "Seller account ••••1234",
            region: "NA",
            connectedAt: "2026-08-22T00:00:00.000Z",
            lastValidatedAt: "2026-08-22T01:00:00.000Z",
            lastSuccessfulValidation: "2026-08-22T01:00:00.000Z",
            lastErrorCode: null,
            revokedAt: null,
            marketplaces: [
              {
                marketplaceId: "ATVPDKIKX0DER",
                name: "Amazon.com",
                countryCode: "US",
                defaultCurrencyCode: "USD",
                defaultLanguageCode: "en_US",
                isParticipating: true,
                hasSuspendedListings: false,
                isDefault: true,
                observedAt: "2026-08-22T01:00:00.000Z",
              },
            ],
            capabilities: [
              {
                marketplaceId: "ATVPDKIKX0DER",
                capability: "CATALOG",
                source: "Amazon Selling Partner API",
                dataOrigin: "LIVE_AMAZON",
                mode: "LIVE",
                state: "HEALTHY",
                reasonCode: null,
                completeness: "COMPLETE",
                freshness: "FRESH",
                checkedAt: "2026-08-22T01:00:00.000Z",
                expiresAt: null,
                retryAt: null,
                lastSuccessAt: "2026-08-22T01:00:00.000Z",
              },
            ],
          },
        }),
      }),
    );
    await page.goto("/settings/integrations/amazon");
    await expect(
      page.getByText("LIVE AMAZON · tenant connection"),
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Catalog lookup & search" }),
    ).toBeVisible();
    await expect(page.getByText("complete · fresh")).toBeVisible();
    await expect(page.getByText("Historical market data")).toBeVisible();
    await expect(page.getByText("Keyword volume")).toBeVisible();
    await expect(page.getByText("Reverse-ASIN ranks")).toBeVisible();
    await expect(page.getByText("Provider required")).toHaveCount(3);
  });
});
