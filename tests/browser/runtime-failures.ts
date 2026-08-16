import type { Page } from "@playwright/test";

export type BrowserFailureCapture = {
  pageErrors: string[];
  consoleErrors: string[];
  failedResponses: string[];
  failedRequests: string[];
  expectedAbortRequests: string[];
};

/**
 * Capture every browser-runtime failure class that can invalidate a happy-path
 * assertion. A failed transport has no HTTP response, so it must be observed
 * separately from response status checks.
 */
export function captureUnexpectedBrowserFailures(
  page: Page,
): BrowserFailureCapture {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const failedRequests: string[] = [];
  const expectedAbortRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      consoleErrors.push(
        location ? `${message.text()} (${location})` : message.text(),
      );
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push(
        `${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`,
      );
  });
  page.on("requestfailed", (request) => {
    const errorText =
      request.failure()?.errorText ?? "unknown transport failure";
    const detail = `${request.method()} ${new URL(request.url()).pathname} ${errorText}`;
    // Chromium reports a client-side AbortController/navigation cancellation as
    // ERR_ABORTED. It has no response and must not be promoted into a product
    // failure, while every other transport failure remains a hard assertion.
    if (errorText === "net::ERR_ABORTED") expectedAbortRequests.push(detail);
    else failedRequests.push(detail);
  });
  return {
    pageErrors,
    consoleErrors,
    failedResponses,
    failedRequests,
    expectedAbortRequests,
  };
}

export function expectNoUnexpectedBrowserFailures(
  capture: BrowserFailureCapture,
): void {
  if (
    capture.pageErrors.length ||
    capture.consoleErrors.length ||
    capture.failedResponses.length ||
    capture.failedRequests.length
  )
    throw new Error(
      JSON.stringify({
        pageErrors: capture.pageErrors,
        consoleErrors: capture.consoleErrors,
        failedResponses: capture.failedResponses,
        failedRequests: capture.failedRequests,
        expectedAbortRequests: capture.expectedAbortRequests,
      }),
    );
}
