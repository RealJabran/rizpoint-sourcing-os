import { describe, expect, it } from "vitest";
import {
  passwordCanChange,
  passwordExpiresAt,
  passwordIsExpired,
  validatePasswordPolicy,
} from "../src/security/password-policy.js";
import {
  permissionsForRole,
  requiredPermissionForRequest,
  roleHasPermission,
} from "../src/security/authorization.js";
import {
  generateTotpSecret,
  totpCode,
  verifyTotpCode,
} from "../src/security/totp.js";

describe("Amazon-aligned password policy", () => {
  const identity = {
    firstName: "Jabran",
    lastName: "Rizvi",
    email: "jabran.rizvi@rizpoint.com",
    organizationName: "RizPoint LLC",
  };

  it("requires the complete 14-character mixed-character policy", () => {
    expect(validatePasswordPolicy("short", identity)).toEqual(
      expect.arrayContaining([
        "PASSWORD_TOO_SHORT",
        "PASSWORD_UPPERCASE_REQUIRED",
        "PASSWORD_NUMBER_REQUIRED",
        "PASSWORD_SPECIAL_REQUIRED",
      ]),
    );
    expect(validatePasswordPolicy("S7rong!Harbor#92", identity)).toEqual([]);
  });

  it("rejects significant user, email, and organization identity terms", () => {
    expect(validatePasswordPolicy("Jabran!Secure942", identity)).toContain(
      "PASSWORD_CONTAINS_IDENTITY",
    );
    expect(validatePasswordPolicy("RizPoint!Secure942", identity)).toContain(
      "PASSWORD_CONTAINS_IDENTITY",
    );
  });

  it("enforces one-day minimum age and 365-day expiration", () => {
    const changed = new Date("2026-01-01T00:00:00.000Z");
    expect(
      passwordCanChange(changed, new Date("2026-01-01T23:59:59.000Z")),
    ).toBe(false);
    expect(
      passwordCanChange(changed, new Date("2026-01-02T00:00:00.000Z")),
    ).toBe(true);
    const expires = passwordExpiresAt(changed);
    expect(expires.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(passwordIsExpired(expires, expires)).toBe(true);
  });
});

describe("TOTP", () => {
  it("matches the RFC 6238 SHA-1 vector and rejects invalid windows", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const at = new Date(59_000);
    expect(totpCode(secret, at)).toBe("287082");
    expect(verifyTotpCode(secret, "287082", at)).toBe(true);
    expect(verifyTotpCode(secret, "000000", at)).toBe(false);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/u);
  });
});

describe("least privilege", () => {
  it("assigns explicit permissions by role", () => {
    expect(roleHasPermission("OWNER", "MANAGE_SECURITY")).toBe(true);
    expect(roleHasPermission("ADMIN", "MANAGE_ORGANIZATION")).toBe(false);
    expect(roleHasPermission("RESEARCHER", "RUN_RESEARCH")).toBe(true);
    expect(roleHasPermission("VIEWER", "RUN_RESEARCH")).toBe(false);
    expect(permissionsForRole("VIEWER")).toEqual(["VIEW_RESEARCH"]);
  });

  it("classifies protected routes with financial, export, provider, and workflow permissions", () => {
    expect(
      requiredPermissionForRequest("/api/providers/amazon", "DELETE"),
    ).toBe("MANAGE_PROVIDER_CONNECTIONS");
    expect(requiredPermissionForRequest("/api/exports/job", "GET")).toBe(
      "EXPORT_DATA",
    );
    expect(requiredPermissionForRequest("/api/scans", "POST")).toBe(
      "RUN_WHOLESALE_SCAN",
    );
    expect(
      requiredPermissionForRequest("/api/security/password/change", "POST"),
    ).toBe("VIEW_RESEARCH");
    expect(requiredPermissionForRequest("/api/purchase-orders", "GET")).toBe(
      "VIEW_FINANCIALS",
    );
    expect(
      requiredPermissionForRequest("/api/security/amazon-compliance", "POST"),
    ).toBe("MANAGE_SECURITY");
    expect(requiredPermissionForRequest("/api/product-explorer", "GET")).toBe(
      "VIEW_RESEARCH",
    );
  });
});
