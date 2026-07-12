import { describe, expect, it, vi } from "vitest";
import {
  inspectWorkbook,
  requestMockScan,
  ScannerRequestError,
} from "../src/scanner-client.js";

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

  it("preserves scanner error codes for terminal-state handling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: { code: "MALWARE_DETECTED" } }), {
          status: 400,
        }),
      ),
    );
    await expect(
      inspectWorkbook("catalog.csv", new Uint8Array([1])),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ScannerRequestError>>({
        code: "MALWARE_DETECTED",
      }),
    );
    vi.unstubAllGlobals();
  });
});
