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
});
