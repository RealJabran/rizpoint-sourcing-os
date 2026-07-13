import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  saveBrandPolicy,
} from "@rizpoint/database";
import { z } from "zod";
import { phaseZeroDemoEnabled } from "@/src/phase-zero";

const schema = z.object({
  brand: z.string().trim().min(1).max(160),
  status: z.enum([
    "PROHIBITED",
    "APPROVAL_REQUIRED",
    "APPROVED",
    "UNRESTRICTED",
  ]),
  approvalReference: z.string().trim().min(1).max(500).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  if (!phaseZeroDemoEnabled())
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_BRAND_POLICY" },
      { status: 400 },
    );
  if (parsed.data.status === "APPROVED" && !parsed.data.approvalReference) {
    return NextResponse.json(
      { error: "APPROVAL_EVIDENCE_REQUIRED" },
      { status: 400 },
    );
  }
  const organization = await ensurePhaseZeroOrganization();
  const policy = await saveBrandPolicy({
    organizationId: organization.id,
    brand: parsed.data.brand,
    status: parsed.data.status,
    ...(parsed.data.approvalReference
      ? { approvalReference: parsed.data.approvalReference }
      : {}),
    ...(parsed.data.expiresAt
      ? { expiresAt: new Date(parsed.data.expiresAt) }
      : {}),
  });
  return NextResponse.json(policy);
}
