import { Prisma } from "./generated/prisma/client.js";
import { db } from "./client.js";

export const INTERACTIVE_RESEARCH_QUERY_TIMEOUT_MS = 8_000;
export const INTERACTIVE_RESEARCH_TRANSACTION_GRACE_MS = 2_000;
export const HISTORY_POINT_WRITE_BATCH_SIZE = 1_000;
export const RETENTION_BATCH_SIZE = 1_000;

export type ScaleProfile = {
  products: number;
  observations: number;
  productKeywordObservations: number;
};

export const RESEARCH_SCALE_PROFILES = {
  scaled: {
    products: 10_000,
    observations: 100_000,
    productKeywordObservations: 500_000,
  },
  full: {
    products: 100_000,
    observations: 1_000_000,
    productKeywordObservations: 5_000_000,
  },
} as const satisfies Record<string, ScaleProfile>;

export function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  code: string,
) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(code);
  return value;
}

/** Yields bounded windows without constructing a row-sized in-memory array. */
export function* batchWindows(total: number, batchSize: number) {
  boundedInteger(total, 0, Number.MAX_SAFE_INTEGER, "BATCH_TOTAL_INVALID");
  boundedInteger(batchSize, 1, 100_000, "BATCH_SIZE_INVALID");
  for (let offset = 0; offset < total; offset += batchSize)
    yield { offset, limit: Math.min(batchSize, total - offset) };
}

/** Applies a PostgreSQL statement timeout on the same connection as the
 * interactive query. Worker exports and background analytics use their own
 * bounded windows instead of inheriting this user-request budget. */
export async function withInteractiveResearchQuery<T>(
  query: (transaction: Prisma.TransactionClient) => Promise<T>,
  timeoutMs = INTERACTIVE_RESEARCH_QUERY_TIMEOUT_MS,
) {
  const boundedTimeout = boundedInteger(
    timeoutMs,
    250,
    30_000,
    "RESEARCH_QUERY_TIMEOUT_INVALID",
  );
  return db.$transaction(
    async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT set_config('statement_timeout', ${`${boundedTimeout}ms`}, true)`,
      );
      return query(transaction);
    },
    {
      timeout: boundedTimeout + INTERACTIVE_RESEARCH_TRANSACTION_GRACE_MS,
    },
  );
}
