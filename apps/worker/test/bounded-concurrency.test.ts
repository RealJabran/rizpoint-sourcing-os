import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../src/bounded-concurrency.js";
import {
  HISTORY_PROVIDER_BATCH_LIMIT,
  planHistoryProviderBatch,
} from "../src/market-history.js";

describe("bounded research work", () => {
  it("never exceeds the configured persistence concurrency", async () => {
    let active = 0;
    let maximumActive = 0;
    const result = await mapWithConcurrency(
      Array.from({ length: 25 }, (_, index) => index),
      4,
      async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active -= 1;
        return value * 2;
      },
    );
    expect(maximumActive).toBeLessThanOrEqual(4);
    expect(result).toEqual(Array.from({ length: 25 }, (_, index) => index * 2));
  });

  it("plans one deduplicated provider request and rejects an N+1-sized run", () => {
    const asins = Array.from(
      { length: HISTORY_PROVIDER_BATCH_LIMIT },
      (_, index) => `B${String(index).padStart(9, "0")}`,
    );
    expect(planHistoryProviderBatch([...asins, asins[0]!])).toHaveLength(100);
    expect(() =>
      planHistoryProviderBatch([
        ...asins,
        `B${String(HISTORY_PROVIDER_BATCH_LIMIT).padStart(9, "0")}`,
      ]),
    ).toThrow("HISTORY_PROVIDER_BATCH_LIMIT");
  });
});
