import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

const scopePattern = /^[a-z][a-z0-9_.-]{1,63}$/;

export function apiRateLimitWindow(input: {
  now: Date;
  windowSeconds: number;
}) {
  if (input.windowSeconds < 1 || input.windowSeconds > 3_600)
    throw new Error("API_RATE_LIMIT_WINDOW_INVALID");
  const windowMs = input.windowSeconds * 1_000;
  const windowStart = new Date(
    Math.floor(input.now.getTime() / windowMs) * windowMs,
  );
  return {
    windowStart,
    expiresAt: new Date(windowStart.getTime() + windowMs),
  };
}

export function apiRateLimitPrincipalHash(principal: string): string {
  if (!principal) throw new Error("API_RATE_LIMIT_PRINCIPAL_REQUIRED");
  return createHash("sha256").update(principal).digest("hex");
}

/** Durable fixed-window limiter. Only a one-way principal hash is persisted;
 * bearer/session material never enters the database or logs. */
export async function consumeApiRateLimit(input: {
  organizationId: string;
  scope: string;
  principal: string;
  limit: number;
  windowSeconds: number;
  now?: Date;
}) {
  if (!scopePattern.test(input.scope))
    throw new Error("API_RATE_LIMIT_SCOPE_INVALID");
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 10_000)
    throw new Error("API_RATE_LIMIT_VALUE_INVALID");
  const now = input.now ?? new Date();
  const { windowStart, expiresAt } = apiRateLimitWindow({
    now,
    windowSeconds: input.windowSeconds,
  });
  const principalHash = apiRateLimitPrincipalHash(input.principal);
  const rows = await db.$queryRaw<Array<{ requestCount: number }>>(Prisma.sql`
    INSERT INTO api_rate_limit_buckets (
      id, organization_id, scope, principal_hash, window_start,
      request_count, expires_at, created_at, updated_at
    ) VALUES (
      ${randomUUID()}, ${input.organizationId}, ${input.scope}, ${principalHash},
      ${windowStart}, 1, ${expiresAt}, ${now}, ${now}
    )
    ON CONFLICT (organization_id, scope, principal_hash, window_start)
    DO UPDATE SET
      request_count = api_rate_limit_buckets.request_count + 1,
      expires_at = EXCLUDED.expires_at,
      updated_at = EXCLUDED.updated_at
    RETURNING request_count AS "requestCount"
  `);
  const requestCount = rows[0]?.requestCount ?? input.limit + 1;
  return {
    allowed: requestCount <= input.limit,
    requestCount,
    limit: input.limit,
    remaining: Math.max(0, input.limit - requestCount),
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000),
    ),
    windowStart,
    expiresAt,
  };
}

export async function deleteExpiredApiRateLimitBuckets(
  now = new Date(),
  limit = 1_000,
): Promise<number> {
  const boundedLimit = Math.min(Math.max(limit, 1), 1_000);
  return db.$transaction(async (transaction) => {
    const expired = await transaction.apiRateLimitBucket.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: boundedLimit,
      select: { id: true },
    });
    if (!expired.length) return 0;
    return (
      await transaction.apiRateLimitBucket.deleteMany({
        where: { id: { in: expired.map((bucket) => bucket.id) } },
      })
    ).count;
  });
}
