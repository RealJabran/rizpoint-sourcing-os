import { expect, test } from "@playwright/test";

test.describe("RizPoint application shell", () => {
  test("shows the evidence-first dashboard at desktop width", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Research with confidence" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "New scan" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recently researched" }),
    ).toBeVisible();
    await expect(page.locator(".dashboard-connection")).toContainText("Mock");
    await expect(page.locator(".app-sidebar")).toHaveCSS("width", "252px");
  });

  test("opens accessible navigation at mobile width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const sourcing = page.getByRole("button", { name: "Sourcing" });
    await expect(sourcing).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "Shortlists" })).toBeVisible();
    const settings = page.getByRole("button", { name: "Settings" });
    await settings.click();
    await expect(settings).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("link", { name: "Learning & help" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Integrations" }),
    ).toBeVisible();
  });

  test("redirects legacy diagnostic pages to product workflows", async ({
    page,
  }) => {
    await page.goto("/mock-scans");
    await expect(page).toHaveURL(/\/scans$/);
    await page.goto("/scans/legacy-scan/profit");
    await expect(page).toHaveURL(/\/scans\/legacy-scan\/analysis$/);
  });
});
