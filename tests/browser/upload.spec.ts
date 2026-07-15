import { expect, test } from "@playwright/test";

const syntheticCatalog = [
  "supplier_sku,upc,title,price,available_quantity",
  "DEMO-001,012345678905,Demo Pet Treats 5 oz,4.99,24",
  "DEMO-002,123456789012,Demo Pet Bed Large,18.50,6",
  "",
].join("\n");

test.describe("catalog upload", () => {
  test("shows the guided private catalog workflow", async ({ page }) => {
    await page.goto("/uploads");
    await expect(page.getByRole("heading", { name: "New catalog scan" })).toBeVisible();
    await expect(page.getByText("Supplier").first()).toBeVisible();
    await expect(page.getByText("Upload").first()).toBeVisible();
    await expect(page.getByText(/private object storage/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose catalog file" })).toBeVisible();
  });

  test("uploads, maps, normalizes, and preserves a zero-padded UPC", async ({
    page,
  }) => {
    await page.goto("/uploads");
    await expect(page.getByLabel(/^Supplier/)).not.toHaveValue("");

    const csp = await page.request
      .head("/uploads")
      .then((response) => response.headers()["content-security-policy"]);
    expect(csp).toContain("connect-src 'self' http://localhost:9000");

    await page.locator('input[type="file"]').setInputFiles({
      name: "two-row-catalog.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCatalog),
    });
    const presign = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/uploads/presign") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    const created = (await (await presign).json()) as { uploadId: string };

    await expect(
      page.getByText("Upload status: MAPPING_REQUIRED"),
    ).toBeVisible();
    await expect(page.getByText("012345678905")).toBeVisible();

    const mappingSelects = page.locator("thead select");
    await mappingSelects.nth(0).selectOption("ITEM_NUMBER");
    await mappingSelects.nth(1).selectOption("UPC");
    await mappingSelects.nth(2).selectOption("DESCRIPTION");
    await mappingSelects.nth(3).selectOption("UNIT_COST");
    await mappingSelects.nth(4).selectOption("QUANTITY");
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(page.getByText("Upload status: READY")).toBeVisible();

    await page.getByRole("button", { name: "Normalize rows" }).click();
    await expect(page.getByText("Upload status: COMPLETED")).toBeVisible();

    const state = await page.request
      .get(`/api/uploads/${created.uploadId}`)
      .then((response) => response.json());
    expect(state.scan.supplierRows).toHaveLength(2);
    expect(state.scan.supplierRows[0].rawData["1"]).toBe("012345678905");
  });

  test("rejects an unsupported browser-selected file with an actionable error", async ({
    page,
  }) => {
    await page.goto("/uploads");
    await expect(page.getByLabel(/^Supplier/)).not.toHaveValue("");
    await page.locator('input[type="file"]').setInputFiles({
      name: "not-a-catalog.exe",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("not a catalog"),
    });
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /choose a csv, xlsx, or xls catalog file/i }),
    ).toBeVisible();
  });
});
