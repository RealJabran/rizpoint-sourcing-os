import type { ProviderCapability } from "@rizpoint/provider-contracts";
import { db } from "../client.js";

const fieldNamePattern = /^[a-z][a-zA-Z0-9_.-]{0,119}$/;

export type ProviderExportFieldRequest = {
  providerKey: string;
  marketplaceId: string;
  capability: ProviderCapability;
  fields: readonly string[];
};

export type ProviderExportDecision = ProviderExportFieldRequest & {
  allowedFields: string[];
  deniedFields: string[];
  decision:
    | "ALLOWED"
    | "PARTIALLY_ALLOWED"
    | "BLOCKED"
    | "RIGHTS_NOT_CONFIGURED"
    | "RIGHTS_NOT_EFFECTIVE"
    | "RIGHTS_EXPIRED";
  termsReference?: string;
  termsVersion?: string;
};

type PersistedRights = {
  dataUsageScope: "INTERNAL_ONLY" | "REDISTRIBUTABLE";
  exportPolicy: "BLOCK" | "ALLOW" | "FIELD_ALLOWLIST";
  exportableFields: string[];
  termsReference: string | null;
  termsVersion: string | null;
  rightsEffectiveAt: Date | null;
  rightsExpiresAt: Date | null;
};

function normalizedFields(fields: readonly string[]): string[] {
  if (fields.length < 1 || fields.length > 100)
    throw new Error("PROVIDER_EXPORT_FIELD_COUNT_INVALID");
  const values = [...new Set(fields)];
  if (values.some((field) => !fieldNamePattern.test(field)))
    throw new Error("PROVIDER_EXPORT_FIELD_INVALID");
  return values;
}

export function evaluateProviderExportRights(input: {
  request: ProviderExportFieldRequest;
  rights: PersistedRights | null;
  now?: Date;
}): ProviderExportDecision {
  const fields = normalizedFields(input.request.fields);
  const base = { ...input.request, fields };
  const blocked = (
    decision: ProviderExportDecision["decision"],
    rights?: PersistedRights,
  ): ProviderExportDecision => ({
    ...base,
    allowedFields: [],
    deniedFields: fields,
    decision,
    ...(rights?.termsReference
      ? { termsReference: rights.termsReference }
      : {}),
    ...(rights?.termsVersion ? { termsVersion: rights.termsVersion } : {}),
  });
  if (!input.rights) return blocked("RIGHTS_NOT_CONFIGURED");
  const now = input.now ?? new Date();
  if (!input.rights.rightsEffectiveAt || input.rights.rightsEffectiveAt > now)
    return blocked("RIGHTS_NOT_EFFECTIVE", input.rights);
  if (input.rights.rightsExpiresAt && input.rights.rightsExpiresAt <= now)
    return blocked("RIGHTS_EXPIRED", input.rights);
  if (
    input.rights.dataUsageScope !== "REDISTRIBUTABLE" ||
    input.rights.exportPolicy === "BLOCK"
  )
    return blocked("BLOCKED", input.rights);
  const allowedFields =
    input.rights.exportPolicy === "ALLOW"
      ? fields
      : fields.filter((field) =>
          input.rights!.exportableFields.includes(field),
        );
  const deniedFields = fields.filter((field) => !allowedFields.includes(field));
  return {
    ...base,
    allowedFields,
    deniedFields,
    decision:
      deniedFields.length === 0
        ? "ALLOWED"
        : allowedFields.length
          ? "PARTIALLY_ALLOWED"
          : "BLOCKED",
    ...(input.rights.termsReference
      ? { termsReference: input.rights.termsReference }
      : {}),
    ...(input.rights.termsVersion
      ? { termsVersion: input.rights.termsVersion }
      : {}),
  };
}

/** Tenant-scoped and fail-closed. Missing or expired rights never imply that a
 * provider field may be redistributed. */
export async function resolveProviderExportRights(input: {
  organizationId: string;
  requests: readonly ProviderExportFieldRequest[];
  now?: Date;
}): Promise<ProviderExportDecision[]> {
  if (input.requests.length < 1 || input.requests.length > 300)
    throw new Error("PROVIDER_EXPORT_REQUEST_COUNT_INVALID");
  const requests = input.requests.map((request) => ({
    ...request,
    providerKey: request.providerKey.trim(),
    marketplaceId: request.marketplaceId.trim(),
    fields: normalizedFields(request.fields),
  }));
  if (
    requests.some((request) => !request.providerKey || !request.marketplaceId)
  )
    throw new Error("PROVIDER_EXPORT_IDENTITY_REQUIRED");
  const rows = await db.providerEntitlement.findMany({
    where: {
      organizationId: input.organizationId,
      OR: requests.map((request) => ({
        providerKey: request.providerKey,
        marketplaceId: request.marketplaceId,
        capability: request.capability,
      })),
    },
    select: {
      providerKey: true,
      marketplaceId: true,
      capability: true,
      dataUsageScope: true,
      exportPolicy: true,
      exportableFields: true,
      termsReference: true,
      termsVersion: true,
      rightsEffectiveAt: true,
      rightsExpiresAt: true,
    },
  });
  const rowByKey = new Map(
    rows.map((row) => [
      `${row.providerKey}\u0000${row.marketplaceId}\u0000${row.capability}`,
      row,
    ]),
  );
  return requests.map((request) =>
    evaluateProviderExportRights({
      request,
      rights:
        rowByKey.get(
          `${request.providerKey}\u0000${request.marketplaceId}\u0000${request.capability}`,
        ) ?? null,
      ...(input.now ? { now: input.now } : {}),
    }),
  );
}

export function syntheticFixtureDataRights(observedAt: Date): {
  usageScope: "REDISTRIBUTABLE";
  exportPolicy: "ALLOW";
  exportableFields: string[];
  retentionDays: number;
  termsReference: string;
  termsVersion: string;
  termsReviewedAt: Date;
  effectiveAt: Date;
} {
  return {
    usageScope: "REDISTRIBUTABLE",
    exportPolicy: "ALLOW",
    exportableFields: [],
    retentionDays: 730,
    termsReference: "rizpoint:synthetic-fixtures",
    termsVersion: "2026-08-19",
    termsReviewedAt: observedAt,
    effectiveAt: observedAt,
  };
}
