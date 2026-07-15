import { describe, expect, it, vi } from "vitest";
import {
  relativeTimestamp,
  scanDisplayName,
  scanStatusPresentation,
  type ScanSummary,
} from "../src/components/dashboard-state.js";

const scan: ScanSummary = {
  id: "scan_12345678",
  jobType: "UPLOAD",
  status: "MAPPING_REQUIRED",
  attemptCount: 0,
  createdAt: "2026-07-15T08:00:00.000Z",
  updatedAt: "2026-07-15T08:00:00.000Z",
  completedAt: null,
  supplier: { code: "VSI", name: "VSI" },
  upload: {
    originalFilename: "vsi-catalog.csv",
    status: "MAPPING_REQUIRED",
    malwareStatus: "CLEAN",
  },
  _count: { supplierRows: 0 },
};

describe("dashboard presentation state", () => {
  it("maps persisted scan states to explicit, non-financial labels", () => {
    expect(scanStatusPresentation("COMPLETED")).toMatchObject({
      label: "Completed",
      tone: "success",
      progress: 100,
    });
    expect(scanStatusPresentation("PARTIAL_SUCCESS")).toMatchObject({
      label: "Partial data",
      tone: "warning",
    });
    expect(scanStatusPresentation("FAILED_FINAL")).toMatchObject({
      label: "Failed",
      tone: "danger",
      progress: 0,
    });
    expect(scanStatusPresentation("UNRECOGNIZED")).toMatchObject({
      label: "Unknown status",
      tone: "neutral",
    });
  });

  it("uses persisted filenames and safe local diagnostic labels", () => {
    expect(scanDisplayName(scan)).toBe("vsi-catalog.csv");
    expect(scanDisplayName({ ...scan, upload: null, jobType: "MOCK" })).toBe(
      "Local mock scan",
    );
  });

  it("renders relative timestamps without pretending future timestamps are historical", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T09:00:00.000Z"));
    expect(relativeTimestamp("2026-07-15T08:55:00.000Z")).toBe(
      "Updated 5m ago",
    );
    expect(relativeTimestamp("2026-07-15T10:00:00.000Z")).toBe(
      "Updated recently",
    );
    vi.useRealTimers();
  });
});
