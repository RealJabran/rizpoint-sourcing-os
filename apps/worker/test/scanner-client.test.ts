import { describe, expect, it, vi } from "vitest";
import { requestMockScan } from "../src/scanner-client.js";

describe("scanner client", () => {
  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ scanner: "mock" }), { status: 200 }),
        ),
    );
    await expect(requestMockScan("scan_123")).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
