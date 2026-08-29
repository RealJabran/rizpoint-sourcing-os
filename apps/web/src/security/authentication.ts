import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  consumeApiRateLimit,
  db,
  ensurePhaseZeroOrganization,
  Prisma,
  recordSecurityAuditEvent,
  type AuthenticationChallengePurpose,
} from "@rizpoint/database";
import {
  PASSWORD_HISTORY_DEPTH,
  passwordCanChange,
  passwordExpiresAt,
  passwordIsExpired,
  validatePasswordPolicy,
} from "./password-policy";
import { createPasswordHash, verifyPassword } from "./password-hash";
import { mfaVaultFromEnvironment } from "./security-vault";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode } from "./totp";

export const AUTHENTICATION_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const ACCOUNT_LOCK_THRESHOLD = 10;
export const ACCOUNT_LOCK_MS = 30 * 60 * 1_000;
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1_000;
export const SESSION_IDLE_TIMEOUT_MS = 15 * 60 * 1_000;
const RECOVERY_CODE_COUNT = 10;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeNetworkPrincipal(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `network:${candidate.slice(0, 128)}`;
}

async function authenticationOrganization() {
  if (process.env.RIZPOINT_PRIVATE_MODE === "true") {
    const slug = process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG;
    if (!slug) throw new Error("PRIVATE_ORGANIZATION_NOT_CONFIGURED");
    const organization = await db.organization.findUnique({ where: { slug } });
    if (!organization) throw new Error("PRIVATE_ORGANIZATION_NOT_FOUND");
    return organization;
  }
  return ensurePhaseZeroOrganization();
}

async function createChallenge(input: {
  organizationId: string;
  userId: string;
  purpose: AuthenticationChallengePurpose;
  now: Date;
}) {
  const token = randomBytes(32).toString("base64url");
  await db.authenticationChallenge.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      tokenHash: tokenHash(token),
      purpose: input.purpose,
      expiresAt: new Date(
        input.now.getTime() + AUTHENTICATION_CHALLENGE_TTL_MS,
      ),
    },
  });
  return token;
}

async function audit(input: {
  organizationId: string;
  eventType:
    | "LOGIN_SUCCESS"
    | "LOGIN_FAILURE"
    | "ACCOUNT_LOCKED"
    | "ACCOUNT_UNLOCKED"
    | "PASSWORD_CHANGED"
    | "PASSWORD_EXPIRED"
    | "MFA_ENROLLED"
    | "MFA_CHALLENGE_FAILED"
    | "RECOVERY_CODE_USED";
  actorUserId?: string | null;
  targetUserId?: string | null;
  context?: Record<string, string | number | boolean | null>;
  requestCorrelationId?: string;
  sourcePrincipal?: string;
}) {
  const failed = new Set([
    "LOGIN_FAILURE",
    "MFA_CHALLENGE_FAILED",
    "PASSWORD_EXPIRED",
  ]).has(input.eventType);
  await recordSecurityAuditEvent({
    organizationId: input.organizationId,
    eventType: input.eventType,
    outcome: failed ? "FAILURE" : "SUCCESS",
    source: "AUTHENTICATION",
    ...(input.actorUserId !== undefined
      ? { actorUserId: input.actorUserId }
      : {}),
    ...(input.targetUserId !== undefined
      ? { targetUserId: input.targetUserId }
      : {}),
    ...(input.requestCorrelationId
      ? { requestCorrelationId: input.requestCorrelationId }
      : {}),
    ...(input.sourcePrincipal
      ? { sourcePrincipal: input.sourcePrincipal }
      : {}),
    ...(input.context ? { context: input.context } : {}),
  });
}

export type AuthenticationStartResult =
  | { status: "INVALID_CREDENTIALS" }
  | { status: "LOCKED"; retryAt: string }
  | {
      status:
        "MFA_REQUIRED" | "MFA_ENROLLMENT_REQUIRED" | "PASSWORD_RESET_REQUIRED";
      challengeToken: string;
    };

async function recordFailedPassword(input: {
  organizationId: string;
  userId: string;
  now: Date;
  networkPrincipal?: string;
}) {
  const rows = await db.$queryRaw<
    Array<{ failedLoginAttempts: number; lockedUntil: Date | null }>
  >(Prisma.sql`
    UPDATE users
    SET
      failed_login_attempts = failed_login_attempts + 1,
      last_failed_login_at = ${input.now},
      locked_until = CASE
        WHEN failed_login_attempts + 1 >= ${ACCOUNT_LOCK_THRESHOLD}
          THEN COALESCE(locked_until, ${new Date(input.now.getTime() + ACCOUNT_LOCK_MS)})
        ELSE locked_until
      END,
      updated_at = ${input.now}
    WHERE id = ${input.userId}
    RETURNING
      failed_login_attempts AS "failedLoginAttempts",
      locked_until AS "lockedUntil"
  `);
  const state = rows[0];
  await audit({
    organizationId: input.organizationId,
    eventType: "LOGIN_FAILURE",
    targetUserId: input.userId,
    context: { reason: "PASSWORD_INVALID" },
    ...(input.networkPrincipal
      ? { sourcePrincipal: input.networkPrincipal }
      : {}),
  });
  if (state?.failedLoginAttempts === ACCOUNT_LOCK_THRESHOLD)
    await audit({
      organizationId: input.organizationId,
      eventType: "ACCOUNT_LOCKED",
      targetUserId: input.userId,
      context: {
        failedAttempts: state.failedLoginAttempts,
        lockMinutes: ACCOUNT_LOCK_MS / 60_000,
      },
      ...(input.networkPrincipal
        ? { sourcePrincipal: input.networkPrincipal }
        : {}),
    });
  return state;
}

export async function startAuthentication(input: {
  email: string;
  password: string;
  networkPrincipal: string;
  now?: Date;
}): Promise<AuthenticationStartResult> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const organization = await authenticationOrganization();
  const [networkLimit, accountLimit] = await Promise.all([
    consumeApiRateLimit({
      organizationId: organization.id,
      scope: "auth.login.network",
      principal: input.networkPrincipal,
      limit: 30,
      windowSeconds: 15 * 60,
      now,
    }),
    consumeApiRateLimit({
      organizationId: organization.id,
      scope: "auth.login.principal",
      principal: `email:${email}`,
      limit: 15,
      windowSeconds: 15 * 60,
      now,
    }),
  ]);
  if (!networkLimit.allowed || !accountLimit.allowed) {
    await audit({
      organizationId: organization.id,
      eventType: "LOGIN_FAILURE",
      context: { reason: "RATE_LIMITED" },
      sourcePrincipal: input.networkPrincipal,
    });
    return { status: "INVALID_CREDENTIALS" };
  }

  const user = await db.user.findUnique({
    where: { email },
    include: {
      memberships: {
        where: { organizationId: organization.id, active: true },
        take: 1,
      },
      mfaFactor: true,
    },
  });
  if (!user || !user.active || user.memberships.length !== 1) {
    // Equalize the expensive password path without revealing account existence.
    await createPasswordHash(input.password);
    await audit({
      organizationId: organization.id,
      eventType: "LOGIN_FAILURE",
      context: { reason: "INVALID_PRINCIPAL_OR_INACTIVE" },
      sourcePrincipal: input.networkPrincipal,
    });
    return { status: "INVALID_CREDENTIALS" };
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    await recordFailedPassword({
      organizationId: organization.id,
      userId: user.id,
      now,
      networkPrincipal: input.networkPrincipal,
    });
    return { status: "INVALID_CREDENTIALS" };
  }

  if (user.lockedUntil && user.lockedUntil > now)
    return { status: "LOCKED", retryAt: user.lockedUntil.toISOString() };
  if (user.lockedUntil) {
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      },
    });
    await audit({
      organizationId: organization.id,
      eventType: "ACCOUNT_UNLOCKED",
      targetUserId: user.id,
      context: { reason: "LOCKOUT_EXPIRED" },
    });
  }

  if (
    user.mustChangePassword ||
    passwordIsExpired(user.passwordExpiresAt, now)
  ) {
    const challengeToken = await createChallenge({
      organizationId: organization.id,
      userId: user.id,
      purpose: "PASSWORD_RESET",
      now,
    });
    await audit({
      organizationId: organization.id,
      eventType: "PASSWORD_EXPIRED",
      targetUserId: user.id,
      context: { forcedChange: user.mustChangePassword },
    });
    return { status: "PASSWORD_RESET_REQUIRED", challengeToken };
  }

  const mfaActive = Boolean(
    user.mfaFactor?.confirmedAt && !user.mfaFactor.disabledAt,
  );
  const purpose: AuthenticationChallengePurpose = mfaActive
    ? "MFA_LOGIN"
    : "MFA_ENROLLMENT";
  const challengeToken = await createChallenge({
    organizationId: organization.id,
    userId: user.id,
    purpose,
    now,
  });
  return {
    status: mfaActive ? "MFA_REQUIRED" : "MFA_ENROLLMENT_REQUIRED",
    challengeToken,
  };
}

async function activeChallenge(
  token: string,
  purpose?: AuthenticationChallengePurpose,
) {
  const now = new Date();
  return db.authenticationChallenge.findFirst({
    where: {
      tokenHash: tokenHash(token),
      ...(purpose ? { purpose } : {}),
      consumedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      organization: { select: { id: true, name: true, slug: true } },
      user: { include: { mfaFactor: { include: { recoveryCodes: true } } } },
    },
  });
}

export async function startMfaEnrollment(challengeToken: string) {
  const challenge = await activeChallenge(challengeToken, "MFA_ENROLLMENT");
  if (!challenge || !challenge.user.active)
    throw new Error("MFA_ENROLLMENT_CHALLENGE_INVALID");
  const secret = generateTotpSecret();
  const encrypted = mfaVaultFromEnvironment().encrypt(
    secret,
    `${challenge.organizationId}:${challenge.userId}:mfa:totp`,
  );
  await db.userMfaFactor.upsert({
    where: { userId: challenge.userId },
    create: {
      userId: challenge.userId,
      encryptedSecret: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
    },
    update: {
      encryptedSecret: encrypted.ciphertext,
      encryptionNonce: encrypted.nonce,
      encryptionTag: encrypted.tag,
      encryptionKeyVersion: encrypted.keyVersion,
      confirmedAt: null,
      disabledAt: null,
      recoveryCodes: { deleteMany: {} },
    },
  });
  return {
    secret,
    enrollmentUri: totpEnrollmentUri({
      secret,
      email: challenge.user.email,
      issuer: "RizPoint",
    }),
  };
}

function recoveryCode(): string {
  const value = randomBytes(9).toString("base64url").toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function decryptMfaSecret(input: {
  organizationId: string;
  userId: string;
  encryptedSecret: string;
  encryptionNonce: string;
  encryptionTag: string;
  encryptionKeyVersion: number;
}): string {
  return mfaVaultFromEnvironment().decrypt(
    {
      ciphertext: input.encryptedSecret,
      nonce: input.encryptionNonce,
      tag: input.encryptionTag,
      keyVersion: input.encryptionKeyVersion,
    },
    `${input.organizationId}:${input.userId}:mfa:totp`,
  );
}

export async function confirmMfaEnrollment(input: {
  challengeToken: string;
  code: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const challenge = await activeChallenge(
    input.challengeToken,
    "MFA_ENROLLMENT",
  );
  const factor = challenge?.user.mfaFactor;
  if (!challenge || !factor || factor.confirmedAt)
    throw new Error("MFA_ENROLLMENT_CHALLENGE_INVALID");
  const secret = decryptMfaSecret({
    organizationId: challenge.organizationId,
    userId: challenge.userId,
    encryptedSecret: factor.encryptedSecret,
    encryptionNonce: factor.encryptionNonce,
    encryptionTag: factor.encryptionTag,
    encryptionKeyVersion: factor.encryptionKeyVersion,
  });
  if (!verifyTotpCode(secret, input.code, now)) {
    await audit({
      organizationId: challenge.organizationId,
      eventType: "MFA_CHALLENGE_FAILED",
      targetUserId: challenge.userId,
      context: { stage: "ENROLLMENT" },
    });
    throw new Error("MFA_CODE_INVALID");
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, recoveryCode);
  const hashes = await Promise.all(codes.map(createPasswordHash));
  const consumed = await db.$transaction(async (transaction) => {
    const challengeResult =
      await transaction.authenticationChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
    if (challengeResult.count !== 1) return false;
    await transaction.userMfaFactor.update({
      where: { id: factor.id },
      data: {
        confirmedAt: now,
        disabledAt: null,
        recoveryCodes: {
          deleteMany: {},
          create: hashes.map((codeHash) => ({ codeHash })),
        },
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: challenge.organizationId,
        actorUserId: challenge.userId,
        targetUserId: challenge.userId,
        eventType: "MFA_ENROLLED",
        context: { recoveryCodeCount: RECOVERY_CODE_COUNT },
      },
    });
    return true;
  });
  if (!consumed) throw new Error("MFA_ENROLLMENT_CHALLENGE_REPLAYED");
  return { recoveryCodes: codes };
}

async function consumeRecoveryCode(
  factor: NonNullable<
    Awaited<ReturnType<typeof activeChallenge>>
  >["user"]["mfaFactor"],
  supplied: string,
  now: Date,
): Promise<string | null> {
  if (!factor) return null;
  for (const record of factor.recoveryCodes.filter((item) => !item.usedAt)) {
    if (await verifyPassword(supplied.toUpperCase(), record.codeHash)) {
      const used = await db.userMfaRecoveryCode.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: now },
      });
      if (used.count === 1) return record.id;
    }
  }
  return null;
}

export async function completeMfaAuthentication(input: {
  challengeToken: string;
  code?: string;
  recoveryCode?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const challenge = await activeChallenge(input.challengeToken, "MFA_LOGIN");
  const factor = challenge?.user.mfaFactor;
  if (
    !challenge ||
    !challenge.user.active ||
    !factor?.confirmedAt ||
    factor.disabledAt
  )
    return null;
  const limiter = await consumeApiRateLimit({
    organizationId: challenge.organizationId,
    scope: "auth.mfa.verify",
    principal: `user:${challenge.userId}`,
    limit: 10,
    windowSeconds: 5 * 60,
    now,
  });
  if (!limiter.allowed) return null;

  let recoveryCodeId: string | null = null;
  let valid = false;
  if (input.code) {
    const secret = decryptMfaSecret({
      organizationId: challenge.organizationId,
      userId: challenge.userId,
      encryptedSecret: factor.encryptedSecret,
      encryptionNonce: factor.encryptionNonce,
      encryptionTag: factor.encryptionTag,
      encryptionKeyVersion: factor.encryptionKeyVersion,
    });
    valid = verifyTotpCode(secret, input.code, now);
  } else if (input.recoveryCode) {
    recoveryCodeId = await consumeRecoveryCode(factor, input.recoveryCode, now);
    valid = Boolean(recoveryCodeId);
  }
  if (!valid) {
    await db.authenticationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { failedAttempts: { increment: 1 } },
    });
    await audit({
      organizationId: challenge.organizationId,
      eventType: "MFA_CHALLENGE_FAILED",
      targetUserId: challenge.userId,
      context: { stage: "LOGIN" },
    });
    return null;
  }

  const sessionId = randomUUID();
  const completed = await db.$transaction(async (transaction) => {
    const consumed = await transaction.authenticationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return false;
    await transaction.userMfaFactor.update({
      where: { id: factor.id },
      data: { lastUsedAt: now },
    });
    await transaction.user.update({
      where: { id: challenge.userId },
      data: {
        failedLoginAttempts: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        lastAuthenticatedAt: now,
      },
    });
    await transaction.userSession.create({
      data: {
        id: sessionId,
        organizationId: challenge.organizationId,
        userId: challenge.userId,
        sessionEpoch: challenge.user.sessionEpoch,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      },
    });
    await transaction.securityAuditEvent.createMany({
      data: [
        {
          organizationId: challenge.organizationId,
          actorUserId: challenge.userId,
          targetUserId: challenge.userId,
          eventType: "LOGIN_SUCCESS",
          context: { factor: recoveryCodeId ? "RECOVERY_CODE" : "TOTP" },
        },
        ...(recoveryCodeId
          ? [
              {
                organizationId: challenge.organizationId,
                actorUserId: challenge.userId,
                targetUserId: challenge.userId,
                eventType: "RECOVERY_CODE_USED" as const,
                context: { remainingCodesRequireRefresh: true },
              },
            ]
          : []),
      ],
    });
    return true;
  });
  if (!completed) return null;
  const membership = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: challenge.organizationId,
        userId: challenge.userId,
      },
    },
  });
  if (!membership?.active) return null;
  return {
    id: challenge.userId,
    email: challenge.user.email,
    name: challenge.user.displayName ?? challenge.user.email,
    organizationId: challenge.organizationId,
    role: membership.role,
    sessionEpoch: challenge.user.sessionEpoch,
    securitySessionId: sessionId,
  };
}

export async function resetExpiredPassword(input: {
  challengeToken: string;
  password: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const challenge = await activeChallenge(
    input.challengeToken,
    "PASSWORD_RESET",
  );
  if (!challenge) throw new Error("PASSWORD_RESET_CHALLENGE_INVALID");
  const failures = validatePasswordPolicy(input.password, {
    firstName: challenge.user.firstName,
    lastName: challenge.user.lastName,
    displayName: challenge.user.displayName,
    email: challenge.user.email,
    organizationName: challenge.organization.name,
  });
  if (failures.length) throw new Error(failures[0]);
  if (
    !challenge.user.mustChangePassword &&
    !passwordCanChange(challenge.user.passwordChangedAt, now)
  )
    throw new Error("PASSWORD_MINIMUM_AGE");
  const history = await db.userPasswordHistory.findMany({
    where: { userId: challenge.userId },
    orderBy: { usedAt: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
  });
  for (const previous of history)
    if (await verifyPassword(input.password, previous.passwordHash))
      throw new Error("PASSWORD_REUSED");
  const passwordHash = await createPasswordHash(input.password);
  const changed = await db.$transaction(async (transaction) => {
    const consumed = await transaction.authenticationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return false;
    await transaction.user.update({
      where: { id: challenge.userId },
      data: {
        passwordHash,
        passwordChangedAt: now,
        passwordExpiresAt: passwordExpiresAt(now),
        mustChangePassword: false,
        sessionEpoch: { increment: 1 },
        sessions: {
          updateMany: {
            where: { revokedAt: null },
            data: { revokedAt: now, revokedReason: "PASSWORD_CHANGED" },
          },
        },
        passwordHistory: { create: { passwordHash, usedAt: now } },
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: challenge.organizationId,
        actorUserId: challenge.userId,
        targetUserId: challenge.userId,
        eventType: "PASSWORD_CHANGED",
        context: { expiredReset: true },
      },
    });
    return true;
  });
  if (!changed) throw new Error("PASSWORD_RESET_CHALLENGE_REPLAYED");
  return { status: "PASSWORD_CHANGED" as const };
}
