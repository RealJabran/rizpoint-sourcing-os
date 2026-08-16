import { expect, test } from "@playwright/test";
import {
  captureUnexpectedBrowserFailures,
  expectNoUnexpectedBrowserFailures,
} from "./runtime-failures.js";

test("browser failure capture records transport failures", async ({ page }) => {
  const failures = captureUnexpectedBrowserFailures(page);
  await page.route("**/runtime-failure-probe", (route) =>
    route.abort("failed"),
  );
  await page.goto("/");
  await page.evaluate(() =>
    fetch("/runtime-failure-probe").catch(() => undefined),
  );
  await expect.poll(() => failures.failedRequests).toHaveLength(1);
  expect(failures.failedRequests[0]).toContain("GET /runtime-failure-probe");
  expect(() => expectNoUnexpectedBrowserFailures(failures)).toThrow(
    "runtime-failure-probe",
  );
});

test("browser failure capture accepts only explicit browser aborts", async ({
  page,
}) => {
  const failures = captureUnexpectedBrowserFailures(page);
  await page.route("**/runtime-abort-probe", (route) => route.abort("aborted"));
  await page.goto("/");
  await page.evaluate(() =>
    fetch("/runtime-abort-probe").catch(() => undefined),
  );
  await expect.poll(() => failures.expectedAbortRequests).toHaveLength(1);
  expect(failures.failedRequests).toEqual([]);
  expectNoUnexpectedBrowserFailures(failures);
});
