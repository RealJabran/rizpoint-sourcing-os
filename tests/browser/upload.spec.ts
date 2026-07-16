import { expect, test } from "@playwright/test";

const syntheticCatalog = [
  "supplier_sku,upc,asin,title,brand,unit_cost,available_quantity,case_pack,currency",
  "DEMO-001,012345678905,B000000001,Acme Lemon Soda 12 oz Pack of 6,Acme,0.50,24,12,USD",
  "DEMO-002,123456789012,,Unknown Pet Bed Large,Unknown,18.50,6,1,USD",
  "DEMO-003,,,Acme Lemon Soda 12 oz Pack of 6,Acme,0.75,12,12,USD",
  "DEMO-004,,B000000001,Acme Lemon Soda 12 oz Pack of 6,Acme,0.50,10,10,USD",
  "",
].join("\n");

function captureUnexpectedBrowserFailures(
  page: import("@playwright/test").Page,
) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`,
      );
  });
  return { pageErrors, consoleErrors, failedResponses };
}

test.describe("catalog upload", () => {
  test("shows the guided private catalog workflow", async ({ page }) => {
    await page.goto("/uploads");
    await expect(
      page.getByRole("heading", { name: "New catalog scan" }),
    ).toBeVisible();
    await expect(page.getByText("Supplier").first()).toBeVisible();
    await expect(page.getByText("Upload").first()).toBeVisible();
    await expect(page.getByText(/private object storage/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose catalog file" }),
    ).toBeVisible();
  });

  test("completes upload through persisted analysis with clean browser runtime", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const failures = captureUnexpectedBrowserFailures(page);
    await page.goto("/uploads");
    await expect(page.getByLabel(/^Supplier/)).not.toHaveValue("");

    const csp = await page.request
      .head("/uploads")
      .then((response) => response.headers()["content-security-policy"]);
    expect(csp).toContain("connect-src 'self' http://localhost:9000");
    expect(csp).not.toContain("'unsafe-eval'");
    for (const attribute of [
      "bis_skin_checked",
      "bis_register",
      "cz-shortcut-listen",
    ]) {
      await expect(page.locator("body")).not.toHaveAttribute(attribute);
    }

    await page.locator('input[type="file"]').setInputFiles({
      name: "recovery-workflow.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCatalog),
    });
    const presign = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/uploads/presign") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    const created = (await (await presign).json()) as {
      uploadId: string;
      scanId: string;
    };

    await expect(page.getByText("Mapping required").first()).toBeVisible();
    await expect(page.getByText("012345678905")).toBeVisible();

    await page.getByRole("button", { name: "Apply suggestions" }).click();
    const mappingRequests: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        request.url().endsWith(`/api/scans/${created.scanId}/mapping`)
      )
        mappingRequests.push(request.url());
    });
    await page.getByRole("button", { name: "Confirm mapping" }).dblclick();
    await expect(page.getByText("Ready to start")).toBeVisible();
    expect(mappingRequests).toHaveLength(1);

    await page.getByRole("button", { name: "Start scan" }).click();
    await expect
      .poll(
        async () => {
          const scan = await page.request
            .get(`/api/scans/${created.scanId}`)
            .then((response) => response.json());
          return {
            status: scan.status,
            stages: scan.checkpoints.map(
              (checkpoint: { stage: string }) => checkpoint.stage,
            ),
          };
        },
        { timeout: 90_000 },
      )
      .toMatchObject({
        status: "PARTIAL_SUCCESS",
        stages: expect.arrayContaining([
          "UPLOAD_INSPECT",
          "MAPPING",
          "NORMALIZE",
          "MATCH",
          "ENRICH",
          "CALCULATE",
        ]),
      });
    await expect(
      page.getByRole("link", { name: "Open analysis" }),
    ).toBeVisible();

    const state = await page.request
      .get(`/api/uploads/${created.uploadId}`)
      .then((response) => response.json());
    expect(state.scan.supplierRows).toHaveLength(4);
    expect(state.scan.supplierRows[0].rawData["1"]).toBe("012345678905");

    await page.getByRole("link", { name: "Open analysis" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/scans/${created.scanId}/analysis$`),
    );
    await expect(page.getByText("4 supplier rows")).toBeVisible();
    const rows = page.locator(".analysis-grid-row");
    await expect(rows.filter({ hasText: "DEMO-001" })).toContainText("Buy");
    await expect(rows.filter({ hasText: "DEMO-002" })).toContainText(
      "Unmatched",
    );
    await expect(rows.filter({ hasText: "DEMO-003" })).toContainText(
      "Review required",
    );
    await expect(rows.filter({ hasText: "DEMO-004" })).toContainText(
      "Blocked pack contradiction",
    );
    await expect(page.getByText(/MOCK_AMAZON/).first()).toBeVisible();

    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(
        page.getByRole("heading", { name: "Analysis" }),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
    }

    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
    expect(failures.failedResponses).toEqual([]);
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

  test("shows a failed workbook job and recovers with a corrected catalog", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/uploads");
    await expect(page.getByLabel(/^Supplier/)).not.toHaveValue("");
    await page.locator('input[type="file"]').setInputFiles({
      name: "malformed.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("not a zip workbook"),
    });
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /contents do not match its extension/i }),
    ).toBeVisible({ timeout: 30_000 });

    await page.locator('input[type="file"]').setInputFiles({
      name: "corrected.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCatalog),
    });
    await page.getByRole("button", { name: "Upload and inspect" }).click();
    await expect(page.getByText("Mapping required").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("012345678905")).toBeVisible();
  });
});
