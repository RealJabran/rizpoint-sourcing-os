import { expect, test } from "@playwright/test";

test.describe("product differentiation experience", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/product-explorer*", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          total: 1,
          rows: [
            {
              id: "product-1",
              title: "Verified grooming brush",
              asin: "B000000001",
              brand: "Evidence Brand",
            },
          ],
        }),
      }),
    );
    await page.route("**/api/research-projects", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{ id: "project-1", name: "Pet care launch" }]),
      }),
    );
    await page.route("**/api/differentiation*", (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ noteId: "private-note-id" }),
        });
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          evidence: [
            {
              themeId: "theme-1",
              label: "Handle comfort",
              reviewCount: 18,
              averageRating: "2.8",
              evidenceReviewIds: ["review-example-1", "review-example-2"],
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
      });
    });
  });

  test("uses named product and project choices with distinct evidence and hypotheses", async ({
    page,
  }) => {
    await page.goto("/differentiation");
    await expect(page.getByText("Catalog product ID")).toHaveCount(0);
    await expect(page.getByText("Research project ID")).toHaveCount(0);
    await page.getByLabel("Select product").selectOption("product-1");
    await page
      .getByRole("button", { name: /Build differentiation brief/ })
      .click();
    await expect(
      page.getByRole("heading", { name: "Customer and competitor signals" }),
    ).toBeVisible();
    await expect(page.getByText("Handle comfort")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Differentiation hypotheses" }),
    ).toBeVisible();
    await expect(page.getByText("medium confidence")).toBeVisible();
    await expect(page.getByText("18 handle-comfort complaints")).toBeVisible();
    await page.getByLabel("Save brief to project").selectOption("project-1");
    await page.getByRole("button", { name: "Save brief" }).click();
    await expect(
      page.getByText("Differentiation brief saved to the selected project."),
    ).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  });
});
