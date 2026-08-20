import { NextRequest, NextResponse } from "next/server";
import {
  ensurePhaseZeroOrganization,
  listProviderCapabilityStates,
  updateProviderDataRights,
} from "@rizpoint/database";
import { providerCapabilitySchema } from "@rizpoint/provider-contracts";
import { z } from "zod";
import { enforceApiRateLimit } from "@/src/api-rate-limit";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

const inputSchema = z.object({
  providerKey: z.string().trim().min(1).max(80),
  marketplaceId: z.string().trim().min(1).max(40),
  capability: providerCapabilitySchema,
  usageScope: z.enum(["INTERNAL_ONLY", "REDISTRIBUTABLE"]),
  exportPolicy: z.enum(["BLOCK", "ALLOW", "FIELD_ALLOWLIST"]),
  exportableFields: z
    .array(z.string().regex(/^[a-z][a-zA-Z0-9_.-]{0,119}$/))
    .max(100)
    .default([]),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  termsReference: z.string().trim().min(1).max(500).optional(),
  termsVersion: z.string().trim().min(1).max(120).optional(),
  termsReviewedAt: z.iso.datetime(),
  effectiveAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
});

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  return NextResponse.json({
    capabilities: await listProviderCapabilityStates({
      organizationId: organization.id,
    }),
  });
}

export async function PUT(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "INVALID_PROVIDER_DATA_RIGHTS" },
      { status: 400 },
    );
  const organization = await ensurePhaseZeroOrganization();
  const limited = await enforceApiRateLimit({
    request,
    organizationId: organization.id,
    scope: "provider.data-rights",
    limit: 30,
    windowSeconds: 300,
  });
  if (limited) return limited;
  try {
    const input = parsed.data;
    return NextResponse.json({
      capability: await updateProviderDataRights({
        organizationId: organization.id,
        providerKey: input.providerKey,
        marketplaceId: input.marketplaceId,
        capability: input.capability,
        dataRights: {
          usageScope: input.usageScope,
          exportPolicy: input.exportPolicy,
          exportableFields: input.exportableFields,
          ...(input.retentionDays
            ? { retentionDays: input.retentionDays }
            : {}),
          ...(input.termsReference
            ? { termsReference: input.termsReference }
            : {}),
          ...(input.termsVersion ? { termsVersion: input.termsVersion } : {}),
          termsReviewedAt: new Date(input.termsReviewedAt),
          effectiveAt: new Date(input.effectiveAt),
          ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
        },
      }),
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DATA_RIGHTS_FAILED";
    return NextResponse.json(
      { error: code },
      { status: code === "PROVIDER_ENTITLEMENT_NOT_FOUND" ? 404 : 409 },
    );
  }
}
