import { expect, test } from "@playwright/test";
import {
  captureUnexpectedBrowserFailures,
  expectNoUnexpectedBrowserFailures,
} from "./runtime-failures.js";

test("owner sees Amazon retention policy without raw provider data", async ({
  page,
}) => {
  const failures = captureUnexpectedBrowserFailures(page);
  await page.route("**/api/providers/usage", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        since: "2026-07-29T00:00:00.000Z",
        liveProviderCalls: 2,
        cacheHits: 8,
        cacheMisses: 2,
        staleHits: 1,
        refreshes: 1,
        throttles: 0,
        estimatedUsage: [],
        estimatedCost: [],
        providers: ["amazon-sp-api"],
      }),
    }),
  );
  await page.route("**/api/providers/retention", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        policy: {
          rizpointMaximumCalendarMonths: 18,
          amazonEventDeletionDeadlineDays: 30,
          legalHoldsSupported: false,
          shorterContractualRetentionWins: true,
        },
        oldestObservationAt: "2026-01-10T00:00:00.000Z",
        nearingExpiryCount: 4,
        deletedRecords: 12,
        lastRun: {
          status: "COMPLETED",
          startedAt: "2026-08-29T00:00:00.000Z",
          completedAt: "2026-08-29T00:00:02.000Z",
          failureCode: null,
        },
        nextScheduledRunAt: "2026-08-30T00:00:00.000Z",
        failedDeletionJobs: 0,
      }),
    }),
  );
  await page.goto("/settings/data-providers");
  await expect(
    page.getByRole("heading", { name: "Amazon Information retention" }),
  ).toBeVisible();
  await expect(page.getByText("18 calendar months")).toBeVisible();
  await expect(page.getByText("No failed deletion jobs")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Revoke and queue deletion" }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(
    /refresh token|raw payload/i,
  );
  expectNoUnexpectedBrowserFailures(failures);
});
