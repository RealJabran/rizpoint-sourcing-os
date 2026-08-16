import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  captureUnexpectedBrowserFailures,
  expectNoUnexpectedBrowserFailures,
} from "./runtime-failures.js";

type ScaleFixture = {
  scans: Array<{
    rowCount: number;
    scanJobId: string;
  }>;
};

const fixturePath = process.env.RIZPOINT_BROWSER_SCALE_FIXTURE_PATH;

async function loadFixture(): Promise<ScaleFixture> {
  if (!fixturePath) throw new Error("browser_scale_fixture_missing");
  return JSON.parse(await readFile(fixturePath, "utf8")) as ScaleFixture;
}

test.describe("analysis workspace release-scale evidence", () => {
  // This fixture is provisioned only by `pnpm test:scale:browser`. Keep the
  // normal browser suite hermetic rather than attempting to manufacture 50k
  // rows implicitly.
  test.skip(
    !fixturePath,
    "requires the isolated browser-scale fixture created by test:scale:browser",
  );

  test("uses bounded server windows for filtering, evidence, and active-view export", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fixture = await loadFixture();
    const resultRequests: string[] = [];
    const failures = captureUnexpectedBrowserFailures(page);
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname.includes("/results")
      )
        resultRequests.push(request.url());
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    let peakJsHeapBytes = 0;

    for (const scan of fixture.scans) {
      const startedAt = performance.now();
      const priorRequestCount = resultRequests.length;
      await page.goto(`/scans/${scan.scanJobId}/analysis`);
      await expect(
        page.getByText(
          `${scan.rowCount.toLocaleString("en-US")} supplier rows`,
        ),
      ).toBeVisible();

      const filtered = page.waitForResponse((response) => {
        if (!response.url().includes(`/api/scans/${scan.scanJobId}/results?`))
          return false;
        return (
          new URL(response.url()).searchParams.get("minRoiPercent") === "30"
        );
      });
      await page.getByLabel("Min ROI %").fill("30");
      await filtered;

      await page.locator(".analysis-grid-row .row-link").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const queued = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/scans/${scan.scanJobId}/analysis-exports`) &&
          response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Export CSV" }).click();
      const exportResponse = await queued;
      expect(exportResponse.status()).toBe(202);
      const exportJob = (await exportResponse.json()) as { id: string };
      await expect
        .poll(
          async () =>
            page.request
              .get(`/api/exports/${exportJob.id}`)
              .then(async (response) => ({
                status: response.status(),
                body: (await response.json()) as { status: string },
              })),
          { timeout: 120_000 },
        )
        .toMatchObject({ status: 200, body: { status: "COMPLETED" } });

      const metrics = (await cdp.send("Performance.getMetrics")) as {
        metrics: Array<{ name: string; value: number }>;
      };
      peakJsHeapBytes = Math.max(
        peakJsHeapBytes,
        metrics.metrics.find((metric) => metric.name === "JSHeapUsedSize")
          ?.value ?? 0,
      );
      const elapsedMs = Math.round(performance.now() - startedAt);
      const queryCount = resultRequests.length - priorRequestCount;
      // One initial page plus one filtered window is expected. A small bound
      // allows React's virtualizer to request an adjacent page, but forbids a
      // full-catalog fan-out at each tested size.
      expect(queryCount).toBeLessThanOrEqual(4);
      console.log(
        `browser analysis scale ${scan.rowCount} rows: ${elapsedMs}ms; result windows ${queryCount}`,
      );
    }

    expectNoUnexpectedBrowserFailures(failures);
    expect(peakJsHeapBytes).toBeGreaterThan(0);
    console.log(
      `browser analysis scale peak JS heap: ${peakJsHeapBytes} bytes`,
    );
  });
});
