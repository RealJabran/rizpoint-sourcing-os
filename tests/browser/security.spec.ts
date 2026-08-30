import { expect, test } from "@playwright/test";

const statusFixture = {
  own: {
    id: "user-owner",
    email: "owner@rizpoint.test",
    name: "Workspace Owner",
    role: "OWNER",
    passwordChangedAt: "2026-08-01T00:00:00.000Z",
    passwordExpiresAt: "2027-08-01T00:00:00.000Z",
    passwordAgeDays: 27,
    passwordExpiresInDays: 338,
    mfaEnabled: true,
    recoveryCodesRemaining: 8,
    lastAuthenticatedAt: "2026-08-28T07:00:00.000Z",
    activeSessions: [
      {
        id: "session-1",
        createdAt: "2026-08-28T07:00:00.000Z",
        lastSeenAt: "2026-08-28T07:10:00.000Z",
        expiresAt: "2026-08-28T15:00:00.000Z",
      },
    ],
  },
  organization: {
    users: [
      {
        membershipId: "membership-owner",
        userId: "user-owner",
        email: "owner@rizpoint.test",
        name: "Workspace Owner",
        role: "OWNER",
        permissions: ["MANAGE_SECURITY", "VIEW_RESEARCH"],
        active: true,
        mfaEnabled: true,
        lastLogin: "2026-08-28T07:00:00.000Z",
        accountCreatedAt: "2026-01-01T00:00:00.000Z",
        lastAccessReviewAt: null,
        accessReviewDue: true,
      },
    ],
  },
  providerCredentialHealth: {
    state: "ACTIVE",
    keyVersion: 1,
    connectedAt: "2026-08-20T00:00:00.000Z",
    revokedAt: null,
    rotations: [],
  },
  audit: [
    {
      id: "audit-1",
      eventType: "LOGIN_SUCCESS",
      actorUserId: "user-owner",
      targetUserId: "user-owner",
      createdAt: "2026-08-28T07:00:00.000Z",
    },
  ],
};

test.describe("security controls", () => {
  test("shows tenant-scoped signed Amazon deployment evidence without infrastructure secrets", async ({
    page,
  }) => {
    await page.route("**/api/security/amazon-compliance", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          deployment: {
            deploymentId: "private-production",
            observedAt: "2026-08-30T10:00:00.000Z",
            overallStatus: "VERIFIED",
            releaseDigest: "abc123def456",
            signerFingerprint: "fed654cba321",
          },
          controls: [
            {
              id: "firewall",
              label: "Firewall",
              status: "VERIFIED",
              detail:
                "Host and cloud rules verified by the signed deployment report.",
            },
            {
              id: "tls-internal",
              label: "TLS internal",
              status: "VERIFIED",
              detail: "Mutual TLS path verified.",
            },
          ],
          governance: [
            {
              label: "Last vulnerability scan",
              status: "CURRENT",
              lastPerformedAt: "2026-08-29T10:00:00.000Z",
              nextDueAt: "2026-09-28T10:00:00.000Z",
            },
          ],
        }),
      }),
    );
    await page.goto("/settings/security/amazon-compliance");
    await expect(
      page.getByRole("heading", { name: "Amazon Compliance" }),
    ).toBeVisible();
    await expect(page.getByText("Signed evidence verified")).toBeVisible();
    await expect(page.getByText("TLS internal")).toBeVisible();
    const content = await page.content();
    expect(content).not.toMatch(
      /refresh.?token|private.?key|database.?password/i,
    );
  });

  test("shows account, least-privilege, review, and credential evidence", async ({
    page,
  }) => {
    await page.route("**/api/security/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(statusFixture),
      }),
    );
    await page.goto("/settings/security");
    await expect(
      page.getByRole("heading", { name: "Security", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("TOTP active")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Organization users" }),
    ).toBeVisible();
    await expect(page.getByText("AES-256-GCM · key v1")).toBeVisible();
    await expect(page.getByText("LOGIN SUCCESS")).toBeVisible();
    expect(await page.content()).not.toContain("encryptedRefreshToken");
    expect(await page.content()).not.toContain("ciphertext");
  });

  test("enrolls TOTP and displays recovery codes exactly once without browser storage", async ({
    page,
  }) => {
    await page.route("**/api/security/login/start", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "MFA_ENROLLMENT_REQUIRED",
          challengeToken: "challenge-token-with-sufficient-length-123456",
        }),
      }),
    );
    await page.route("**/api/security/mfa/enrollment/start", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          manualKey: "JBSWY3DPEHPK3PXP",
          qrDataUrl:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Crect width='220' height='220' fill='white'/%3E%3C/svg%3E",
        }),
      }),
    );
    await page.route("**/api/security/mfa/enrollment/confirm", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          recoveryCodes: ["ABCD-EFGH-IJKL", "MNOP-QRST-UVWX"],
        }),
      }),
    );
    await page.goto("/login");
    await page.getByLabel("Work email").fill("person@rizpoint.test");
    await page.getByLabel("Password").fill("S7rong!Harbor#92");
    await page.getByRole("button", { name: "Continue securely" }).click();
    await expect(
      page.getByRole("heading", { name: "Protect your account with MFA" }),
    ).toBeVisible();
    await expect(page.getByText("JBSWY3DPEHPK3PXP")).not.toBeVisible();
    await page.getByText("Cannot scan? Enter the key manually").click();
    await expect(page.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
    await page.getByLabel("Six-digit authenticator code").fill("123456");
    await page.getByRole("button", { name: "Activate MFA" }).click();
    await expect(
      page.getByRole("heading", { name: "Save your recovery codes now" }),
    ).toBeVisible();
    await expect(page.getByText("ABCD-EFGH-IJKL")).toBeVisible();
    expect(
      await page.evaluate(() => ({
        local: Object.values(localStorage),
        session: Object.values(sessionStorage),
      })),
    ).toEqual({ local: [], session: [] });
    await page.getByRole("button", { name: /I saved these codes/i }).click();
    await expect(page.getByText("ABCD-EFGH-IJKL")).toHaveCount(0);
  });

  test("is intentional at mobile width", async ({ page }) => {
    await page.route("**/api/security/status", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(statusFixture),
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/security");
    await expect(
      page.getByRole("heading", { name: "Security", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
});
