import { describe, expect, it } from "vitest";
import { evaluateProviderExportRights } from "../src/repositories/provider-data-rights.js";

const request = {
  providerKey: "licensed-fixture",
  marketplaceId: "ATVPDKIKX0DER",
  capability: "MARKET_HISTORY" as const,
  fields: ["history.rating", "history.salesRank"],
};
const effectiveAt = new Date("2026-08-01T00:00:00.000Z");
const now = new Date("2026-08-19T00:00:00.000Z");

describe("provider export rights", () => {
  it("fails closed when rights are absent or internal-only", () => {
    expect(
      evaluateProviderExportRights({ request, rights: null, now }),
    ).toMatchObject({
      decision: "RIGHTS_NOT_CONFIGURED",
      allowedFields: [],
      deniedFields: request.fields,
    });
    expect(
      evaluateProviderExportRights({
        request,
        now,
        rights: {
          dataUsageScope: "INTERNAL_ONLY",
          exportPolicy: "BLOCK",
          exportableFields: [],
          termsReference: "contract:1",
          termsVersion: "1",
          rightsEffectiveAt: effectiveAt,
          rightsExpiresAt: null,
        },
      }).decision,
    ).toBe("BLOCKED");
  });

  it("applies field allowlists and expiry deterministically", () => {
    const rights = {
      dataUsageScope: "REDISTRIBUTABLE" as const,
      exportPolicy: "FIELD_ALLOWLIST" as const,
      exportableFields: ["history.rating"],
      termsReference: "contract:1",
      termsVersion: "1",
      rightsEffectiveAt: effectiveAt,
      rightsExpiresAt: new Date("2026-09-01T00:00:00.000Z"),
    };
    expect(
      evaluateProviderExportRights({ request, rights, now }),
    ).toMatchObject({
      decision: "PARTIALLY_ALLOWED",
      allowedFields: ["history.rating"],
      deniedFields: ["history.salesRank"],
    });
    expect(
      evaluateProviderExportRights({
        request,
        rights,
        now: new Date("2026-09-01T00:00:00.000Z"),
      }).decision,
    ).toBe("RIGHTS_EXPIRED");
  });
});
