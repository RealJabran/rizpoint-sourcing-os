import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveColumnMappings = vi.fn();
const ensurePhaseZeroOrganization = vi.fn();

vi.mock("@rizpoint/database", () => ({
  ensurePhaseZeroOrganization,
  saveColumnMappings,
}));
vi.mock("@/src/phase-zero", () => ({
  phaseZeroDemoEnabled: () => true,
}));
vi.mock("@/src/phase-one", async () => import("../src/phase-one.js"));

const validBody = {
  uploadSheetId: "sheet-1",
  headerRow: 1,
  mappings: [
    {
      sourceIndex: 0,
      sourceColumn: "supplier_sku",
      target: "ITEM_NUMBER",
      required: false,
    },
    {
      sourceIndex: 1,
      sourceColumn: "title",
      target: "DESCRIPTION",
      required: true,
    },
  ],
};

async function request(body: unknown) {
  const { PUT } = await import("../app/api/scans/[scanId]/mapping/route.js");
  return PUT(
    new NextRequest("http://localhost/api/scans/scan-1/mapping", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ scanId: "scan-1" }) },
  );
}

describe("mapping confirmation route", () => {
  beforeEach(() => {
    vi.stubEnv("PHASE_ZERO_DEMO_MODE", "true");
    ensurePhaseZeroOrganization.mockResolvedValue({ id: "org-1" });
    saveColumnMappings.mockResolvedValue({ id: "scan-1", status: "READY" });
    vi.clearAllMocks();
  });

  it("returns the persisted READY scan for a valid confirmation", async () => {
    const response = await request(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "READY" });
    expect(saveColumnMappings).toHaveBeenCalledWith(
      "org-1",
      "scan-1",
      "sheet-1",
      1,
      validBody.mappings,
    );
  });

  it("returns visible validation codes for required and duplicate mappings", async () => {
    const missing = await request({
      ...validBody,
      mappings: [validBody.mappings[0]],
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "DESCRIPTION_REQUIRED" });

    const duplicate = await request({
      ...validBody,
      mappings: [
        validBody.mappings[0],
        { ...validBody.mappings[1], target: "ITEM_NUMBER" },
      ],
    });
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toEqual({ error: "DUPLICATE_MAPPING" });
  });

  it("returns a recoverable conflict for stale sheet/header state", async () => {
    saveColumnMappings.mockRejectedValueOnce(
      new Error("MAPPING_STALE_SELECTION"),
    );
    const response = await request(validBody);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "MAPPING_STALE_SELECTION",
    });
  });

  it("is safe to submit the same persisted mapping twice", async () => {
    const first = await request(validBody);
    const second = await request(validBody);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(saveColumnMappings).toHaveBeenCalledTimes(2);
    expect(await second.json()).toMatchObject({ status: "READY" });
  });
});
