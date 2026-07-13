import { describe, expect, it } from "vitest";
import {
  ANALYSIS_MAX_RENDERED_ROWS,
  ANALYSIS_PAGE_SIZE,
  requestedWindowOffsets,
} from "../src/analysis/window.js";

describe("50,000-row analysis workspace windowing", () => {
  it.each([5_000, 20_000, 50_000])(
    "loads one bounded window around a distant row in a %i-row fixture",
    (fixtureRows) => {
      const fixture = Array.from({ length: fixtureRows }, (_, index) => ({
        id: index,
      }));
      const visibleIndexes = fixture.slice(-40).map((row) => row.id);
      const offsets = requestedWindowOffsets(visibleIndexes);
      expect(offsets).toEqual([fixtureRows - 100]);
      expect(ANALYSIS_PAGE_SIZE).toBe(100);
      expect(visibleIndexes.length).toBeLessThan(ANALYSIS_MAX_RENDERED_ROWS);
      expect(fixture.length).toBe(fixtureRows);
    },
  );
});
