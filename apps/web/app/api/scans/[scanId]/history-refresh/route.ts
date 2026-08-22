import { NextRequest, NextResponse } from "next/server";
import { queueHistoryRefresh } from "@rizpoint/database";
import { z } from "zod";
import { requirePrivateAccess } from "@/src/private-access";
import { organizationForRequest } from "@/src/request-organization";

export const runtime = "nodejs";

const requestSchema = z.object({
  idempotencyKey: z.string().uuid(),
  asins: z
    .array(z.string().regex(/^B[A-Z0-9]{9}$/))
    .min(1)
    .max(100)
    .optional(),
  historyDays: z.number().int().min(1).max(730).optional(),
  forceRefresh: z.boolean().optional(),
});

/** Optional, scan-owned history refresh. It never changes matching or profit
 * outcomes and only accepts ASINs already accepted for this organization. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "A valid idempotency key and up to 100 ASINs are required." },
      { status: 400 },
    );
  try {
    const organization = await organizationForRequest(request);
    const run = await queueHistoryRefresh({
      organizationId: organization.id,
      scanJobId: (await params).scanId,
      idempotencyKey: parsed.data.idempotencyKey,
      ...(parsed.data.asins ? { asins: parsed.data.asins } : {}),
      ...(parsed.data.historyDays
        ? { historyDays: parsed.data.historyDays }
        : {}),
      ...(parsed.data.forceRefresh === undefined
        ? {}
        : { forceRefresh: parsed.data.forceRefresh }),
    });
    if (!run)
      return NextResponse.json(
        {
          error:
            "No accepted Amazon products are available for history refresh.",
        },
        { status: 409 },
      );
    return NextResponse.json(
      {
        id: run.id,
        status: run.status,
        duplicate: run.duplicate,
        itemCount: run.items.length,
      },
      { status: 202 },
    );
  } catch (error) {
    const code =
      error instanceof Error ? error.message : "HISTORY_REFRESH_FAILED";
    const messages: Record<string, string> = {
      HISTORY_ASIN_NOT_IN_SCAN:
        "Every requested ASIN must be an accepted match in this scan.",
      HISTORY_MARKETPLACE_MISMATCH:
        "History refresh supports one marketplace per request.",
      HISTORY_BATCH_LIMIT:
        "History refresh is limited to 100 products at a time.",
      HISTORY_REFRESH_IDEMPOTENCY_CONFLICT:
        "This retry key was already used for a different history request.",
    };
    return NextResponse.json(
      { error: messages[code] ?? "History refresh could not be queued." },
      { status: code === "HISTORY_REFRESH_IDEMPOTENCY_CONFLICT" ? 409 : 400 },
    );
  }
}
