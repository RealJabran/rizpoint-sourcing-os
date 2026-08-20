import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { consumeApiRateLimit } from "@rizpoint/database";

function requestPrincipal(request: NextRequest, fallback: string): string {
  const authorization = request.headers.get("authorization");
  if (authorization)
    return `authorization:${createHash("sha256").update(authorization).digest("hex")}`;
  return fallback;
}

export async function enforceApiRateLimit(input: {
  request: NextRequest;
  organizationId: string;
  scope: string;
  limit: number;
  windowSeconds: number;
  principalFallback?: string;
}): Promise<NextResponse | null> {
  const result = await consumeApiRateLimit({
    organizationId: input.organizationId,
    scope: input.scope,
    principal: requestPrincipal(
      input.request,
      input.principalFallback ?? `organization:${input.organizationId}`,
    ),
    limit: input.limit,
    windowSeconds: input.windowSeconds,
  });
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        "retry-after": String(result.retryAfterSeconds),
        "cache-control": "no-store, private",
      },
    },
  );
}
