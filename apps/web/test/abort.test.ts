import { describe, expect, it } from "vitest";
import { requestWasAborted } from "../src/abort.js";

describe("client request cleanup", () => {
  it("recognizes an aborted request even when the browser uses a non-DOM error", () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      requestWasAborted(new Error("fetch failed"), controller.signal),
    ).toBe(true);
  });

  it("does not hide a real request failure", () => {
    const controller = new AbortController();
    expect(
      requestWasAborted(new Error("fetch failed"), controller.signal),
    ).toBe(false);
  });
});
