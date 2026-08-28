import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../packages/database/src/index.js";
import {
  completeMfaAuthentication,
  confirmMfaEnrollment,
  startAuthentication,
  startMfaEnrollment,
} from "../../apps/web/src/security/authentication.js";
import { createPasswordHash } from "../../apps/web/src/security/password-hash.js";
import { passwordExpiresAt } from "../../apps/web/src/security/password-policy.js";
import { totpCode } from "../../apps/web/src/security/totp.js";
import {
  changeOwnPassword,
  deactivateOrganizationUser,
  getSecurityDashboard,
  resetUserMfa,
} from "../../apps/web/src/security/security-management.js";

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const slug = `security-${suffix}`;
const email = `person-${suffix}@security.test`;
const password = "S7rong!Harbor#92";
const wrongPassword = "W8rong!Harbor#92";
const now = new Date();
const passwordChangedAt = new Date(now.getTime() - 2 * 86_400_000);

process.env.RIZPOINT_PRIVATE_MODE = "true";
process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG = slug;
process.env.MFA_CREDENTIAL_KEY_V1 = Buffer.alloc(32, 7).toString("base64");

const organization = await db.organization.create({
  data: { slug, name: `Security Fixture ${suffix}` },
});
const passwordHash = await createPasswordHash(password);
const user = await db.user.create({
  data: {
    email,
    firstName: "Security",
    lastName: "Person",
    displayName: "Security Person",
    passwordHash,
    passwordChangedAt,
    passwordExpiresAt: passwordExpiresAt(passwordChangedAt),
    memberships: {
      create: { organizationId: organization.id, role: "OWNER" },
    },
    passwordHistory: { create: { passwordHash, usedAt: passwordChangedAt } },
  },
});

try {
  const failures = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      startAuthentication({
        email,
        password: wrongPassword,
        networkPrincipal: `network:concurrent-${index}`,
        now,
      }),
    ),
  );
  assert(failures.every((result) => result.status === "INVALID_CREDENTIALS"));
  const locked = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(locked.failedLoginAttempts, 10);
  assert(locked.lockedUntil);
  assert.equal(locked.lockedUntil.getTime(), now.getTime() + 30 * 60_000);
  assert.equal(
    await db.securityAuditEvent.count({
      where: { organizationId: organization.id, eventType: "ACCOUNT_LOCKED" },
    }),
    1,
  );

  const lockedAttempt = await startAuthentication({
    email,
    password,
    networkPrincipal: "network:locked-correct",
    now: new Date(now.getTime() + 60_000),
  });
  assert.equal(lockedAttempt.status, "LOCKED");

  const afterLockout = new Date(now.getTime() + 31 * 60_000);
  const enrollmentChallenge = await startAuthentication({
    email,
    password,
    networkPrincipal: "network:after-lockout",
    now: afterLockout,
  });
  assert.equal(enrollmentChallenge.status, "MFA_ENROLLMENT_REQUIRED");
  assert("challengeToken" in enrollmentChallenge);
  const enrollment = await startMfaEnrollment(
    enrollmentChallenge.challengeToken,
  );
  const enrollmentResult = await confirmMfaEnrollment({
    challengeToken: enrollmentChallenge.challengeToken,
    code: totpCode(enrollment.secret, afterLockout),
    now: afterLockout,
  });
  assert.equal(enrollmentResult.recoveryCodes.length, 10);

  const mfaStart = await startAuthentication({
    email,
    password,
    networkPrincipal: "network:mfa-login",
    now: new Date(afterLockout.getTime() + 60_000),
  });
  assert.equal(mfaStart.status, "MFA_REQUIRED");
  assert("challengeToken" in mfaStart);
  assert.equal(
    await completeMfaAuthentication({
      challengeToken: mfaStart.challengeToken,
      code: "000000",
      now: new Date(afterLockout.getTime() + 60_000),
    }),
    null,
  );
  const principal = await completeMfaAuthentication({
    challengeToken: mfaStart.challengeToken,
    code: totpCode(
      enrollment.secret,
      new Date(afterLockout.getTime() + 60_000),
    ),
    now: new Date(afterLockout.getTime() + 60_000),
  });
  assert(principal);
  assert.equal(principal.role, "OWNER");

  const recoveryStart = await startAuthentication({
    email,
    password,
    networkPrincipal: "network:recovery-login",
    now: new Date(afterLockout.getTime() + 120_000),
  });
  assert.equal(recoveryStart.status, "MFA_REQUIRED");
  assert("challengeToken" in recoveryStart);
  const recovered = await completeMfaAuthentication({
    challengeToken: recoveryStart.challengeToken,
    recoveryCode: enrollmentResult.recoveryCodes[0],
    now: new Date(afterLockout.getTime() + 120_000),
  });
  assert(recovered);

  await assert.rejects(
    changeOwnPassword({
      organizationId: organization.id,
      userId: user.id,
      currentPassword: password,
      newPassword: password,
      now: new Date(afterLockout.getTime() + 2 * 86_400_000),
    }),
    /PASSWORD_REUSED/u,
  );

  const replayStart = await startAuthentication({
    email,
    password,
    networkPrincipal: "network:recovery-replay",
    now: new Date(afterLockout.getTime() + 180_000),
  });
  assert.equal(replayStart.status, "MFA_REQUIRED");
  assert("challengeToken" in replayStart);
  assert.equal(
    await completeMfaAuthentication({
      challengeToken: replayStart.challengeToken,
      recoveryCode: enrollmentResult.recoveryCodes[0],
      now: new Date(afterLockout.getTime() + 180_000),
    }),
    null,
  );

  const otherOrganization = await db.organization.create({
    data: { slug: `${slug}-other`, name: "Other Security Tenant" },
  });
  await assert.rejects(
    getSecurityDashboard({
      organizationId: otherOrganization.id,
      userId: user.id,
      includeOrganization: true,
    }),
    /USER_NOT_FOUND/u,
  );
  await db.organization.delete({ where: { id: otherOrganization.id } });

  const secondPasswordHash = await createPasswordHash("V9lid!Anchor#73");
  const second = await db.user.create({
    data: {
      email: `second-${suffix}@security.test`,
      firstName: "Second",
      lastName: "Person",
      displayName: "Second Person",
      passwordHash: secondPasswordHash,
      passwordChangedAt,
      passwordExpiresAt: passwordExpiresAt(passwordChangedAt),
      memberships: {
        create: { organizationId: organization.id, role: "VIEWER" },
      },
      passwordHistory: {
        create: { passwordHash: secondPasswordHash, usedAt: passwordChangedAt },
      },
    },
  });
  await db.userSession.create({
    data: {
      organizationId: organization.id,
      userId: second.id,
      sessionEpoch: second.sessionEpoch,
      expiresAt: new Date(now.getTime() + 3_600_000),
    },
  });
  await deactivateOrganizationUser({
    organizationId: organization.id,
    actorUserId: user.id,
    userId: second.id,
    reason: "Integration test termination",
    now,
  });
  const disabled = await db.user.findUniqueOrThrow({
    where: { id: second.id },
  });
  assert.equal(disabled.active, false);
  assert.equal(disabled.sessionEpoch, 1);
  assert.equal(
    await db.userSession.count({
      where: { userId: second.id, revokedAt: null },
    }),
    0,
  );
  assert.equal(
    (
      await startAuthentication({
        email: second.email,
        password: "V9lid!Anchor#73",
        networkPrincipal: "network:inactive",
        now,
      })
    ).status,
    "INVALID_CREDENTIALS",
  );

  await resetUserMfa({
    organizationId: organization.id,
    actorUserId: user.id,
    userId: user.id,
    reason: "Integration test privileged reset",
    now: new Date(afterLockout.getTime() + 240_000),
  });
  assert.equal(
    await db.userMfaFactor.count({
      where: { userId: user.id, disabledAt: null },
    }),
    0,
  );
  assert.equal(
    await db.securityAuditEvent.count({
      where: {
        organizationId: organization.id,
        eventType: "MFA_DISABLED",
        targetUserId: user.id,
      },
    }),
    1,
  );

  console.log(
    JSON.stringify({
      status: "ok",
      lockoutAttempts: locked.failedLoginAttempts,
      lockoutMinutes: 30,
      mfa: "TOTP",
      recoveryCodeSingleUse: true,
      invalidMfaDenied: true,
      passwordHistoryEnforced: true,
      inactiveUserDenied: true,
      privilegedMfaResetAudited: true,
      crossTenantDenied: true,
      sessionRevocation: true,
    }),
  );
} finally {
  await db.securityAuditEvent.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.organizationAccessReview.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.credentialRotationRecord.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.authenticationChallenge.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.userSession.deleteMany({
    where: { organizationId: organization.id },
  });
  const users = await db.organizationMembership.findMany({
    where: { organizationId: organization.id },
    select: { userId: true },
  });
  await db.organizationMembership.deleteMany({
    where: { organizationId: organization.id },
  });
  await db.userMfaRecoveryCode.deleteMany({
    where: { factor: { userId: { in: users.map((item) => item.userId) } } },
  });
  await db.userMfaFactor.deleteMany({
    where: { userId: { in: users.map((item) => item.userId) } },
  });
  await db.userPasswordHistory.deleteMany({
    where: { userId: { in: users.map((item) => item.userId) } },
  });
  await db.user.deleteMany({
    where: { id: { in: users.map((item) => item.userId) } },
  });
  await db.organization.delete({ where: { id: organization.id } });
  await db.$disconnect();
}
