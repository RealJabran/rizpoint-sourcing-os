import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  safeNetworkPrincipal,
  startAuthentication,
} from "@/src/security/authentication";

export const runtime = "nodejs";

const inputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1_024),
});

export async function POST(request: NextRequest) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json(
      { status: "INVALID_CREDENTIALS" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  const result = await startAuthentication({
    ...input.data,
    networkPrincipal: safeNetworkPrincipal(request),
  });
  const status = result.status === "INVALID_CREDENTIALS" ? 401 : 200;
  return NextResponse.json(result, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
