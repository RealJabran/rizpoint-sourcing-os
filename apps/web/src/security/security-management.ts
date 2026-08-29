import {
  db,
  listSecurityOperationsStatus,
  type AccessReviewDecision,
  type CredentialRotationType,
  type OrganizationRole,
} from "@rizpoint/database";
import { permissionsForRole } from "./authorization";
import {
  isGenericAccountEmail,
  passwordCanChange,
  passwordExpiresAt,
  PASSWORD_HISTORY_DEPTH,
  validatePasswordPolicy,
} from "./password-policy";
import { createPasswordHash, verifyPassword } from "./password-hash";

const QUARTER_MS = 90 * 24 * 60 * 60 * 1_000;

async function ensureNotLastOwner(input: {
  organizationId: string;
  membershipId: string;
}) {
  const membership = await db.organizationMembership.findFirst({
    where: { id: input.membershipId, organizationId: input.organizationId },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  if (membership.role !== "OWNER" || !membership.active) return membership;
  const owners = await db.organizationMembership.count({
    where: {
      organizationId: input.organizationId,
      role: "OWNER",
      active: true,
      user: { active: true },
    },
  });
  if (owners <= 1) throw new Error("LAST_OWNER_PROTECTED");
  return membership;
}

export async function getSecurityDashboard(input: {
  organizationId: string;
  userId: string;
  includeOrganization: boolean;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const user = await db.user.findFirst({
    where: {
      id: input.userId,
      memberships: { some: { organizationId: input.organizationId } },
    },
    include: {
      memberships: {
        where: { organizationId: input.organizationId },
        take: 1,
      },
      mfaFactor: { include: { recoveryCodes: true } },
      sessions: {
        where: {
          organizationId: input.organizationId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        orderBy: { lastSeenAt: "desc" },
        take: 20,
      },
    },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  const connection = await db.providerConnection.findFirst({
    where: { organizationId: input.organizationId, provider: "AMAZON_SP_API" },
    orderBy: { updatedAt: "desc" },
    select: {
      status: true,
      encryptionKeyVersion: true,
      authorizedAt: true,
      updatedAt: true,
      revokedAt: true,
    },
  });
  const latestRotations = await db.credentialRotationRecord.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { rotatedAt: "desc" },
    distinct: ["credentialType"],
  });
  const own = {
    id: user.id,
    email: user.email,
    name: user.displayName ?? user.email,
    role: user.memberships[0]?.role ?? "VIEWER",
    passwordChangedAt: user.passwordChangedAt.toISOString(),
    passwordExpiresAt: user.passwordExpiresAt.toISOString(),
    passwordAgeDays: Math.max(
      0,
      Math.floor(
        (now.getTime() - user.passwordChangedAt.getTime()) / 86_400_000,
      ),
    ),
    passwordExpiresInDays: Math.max(
      0,
      Math.ceil(
        (user.passwordExpiresAt.getTime() - now.getTime()) / 86_400_000,
      ),
    ),
    mfaEnabled: Boolean(
      user.mfaFactor?.confirmedAt && !user.mfaFactor.disabledAt,
    ),
    recoveryCodesRemaining:
      user.mfaFactor?.recoveryCodes.filter((item) => !item.usedAt).length ?? 0,
    lastAuthenticatedAt: user.lastAuthenticatedAt?.toISOString() ?? null,
    activeSessions: user.sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    })),
  };
  if (!input.includeOrganization)
    return {
      own,
      organization: null,
      providerCredentialHealth: null,
      operations: null,
      audit: [],
    };

  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: input.organizationId },
    orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    include: {
      user: { include: { mfaFactor: true } },
      accessReviews: { orderBy: { reviewedAt: "desc" }, take: 1 },
    },
  });
  const [audit, operations] = await Promise.all([
    db.securityAuditEvent.findMany({
      where: { organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    listSecurityOperationsStatus(input.organizationId, now),
  ]);
  return {
    own,
    organization: {
      users: memberships.map((membership) => ({
        membershipId: membership.id,
        userId: membership.userId,
        email: membership.user.email,
        name: membership.user.displayName ?? membership.user.email,
        role: membership.role,
        permissions: permissionsForRole(membership.role),
        active: membership.active && membership.user.active,
        mfaEnabled: Boolean(
          membership.user.mfaFactor?.confirmedAt &&
          !membership.user.mfaFactor.disabledAt,
        ),
        lastLogin: membership.user.lastAuthenticatedAt?.toISOString() ?? null,
        accountCreatedAt: membership.user.createdAt.toISOString(),
        lastAccessReviewAt:
          membership.accessReviews[0]?.reviewedAt.toISOString() ?? null,
        accessReviewDue:
          !membership.accessReviews[0] ||
          membership.accessReviews[0].nextReviewDueAt <= now,
      })),
    },
    providerCredentialHealth: {
      state: connection?.status ?? "NOT_CONNECTED",
      keyVersion: connection?.encryptionKeyVersion ?? null,
      connectedAt: connection?.authorizedAt?.toISOString() ?? null,
      revokedAt: connection?.revokedAt?.toISOString() ?? null,
      rotations: latestRotations.map((record) => ({
        type: record.credentialType,
        rotatedAt: record.rotatedAt.toISOString(),
        nextDueAt: record.nextDueAt.toISOString(),
        overdue: record.nextDueAt <= now,
      })),
    },
    operations: {
      controls: operations.controls.map((control) => ({
        ...control,
        lastPerformedAt: control.lastPerformedAt?.toISOString() ?? null,
        nextDueAt: control.nextDueAt?.toISOString() ?? null,
      })),
      openAlerts: operations.alerts.map((alert) => ({
        id: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        observedAt: alert.observedAt.toISOString(),
      })),
      openIncidents: operations.incidents.map((incident) => ({
        id: incident.id,
        reference: incident.reference,
        severity: incident.severity,
        detectedAt: incident.detectedAt.toISOString(),
        amazonNotificationDueAt:
          incident.amazonNotificationDueAt?.toISOString() ?? null,
        amazonNotifiedAt: incident.amazonNotifiedAt?.toISOString() ?? null,
      })),
    },
    audit: audit.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      outcome: event.outcome,
      source: event.source,
      actorUserId: event.actorUserId,
      targetUserId: event.targetUserId,
      createdAt: event.createdAt.toISOString(),
      retentionUntil: event.retentionUntil.toISOString(),
      context: event.context,
    })),
  };
}

export async function createOrganizationUser(input: {
  organizationId: string;
  actorUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: OrganizationRole;
  temporaryPassword: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  if (isGenericAccountEmail(email))
    throw new Error("GENERIC_ACCOUNT_PROHIBITED");
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: input.organizationId },
  });
  const failures = validatePasswordPolicy(input.temporaryPassword, {
    firstName: input.firstName,
    lastName: input.lastName,
    email,
    organizationName: organization.name,
  });
  if (failures.length) throw new Error(failures[0]);
  const passwordHash = await createPasswordHash(input.temporaryPassword);
  return db.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data: {
        email,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        displayName: `${input.firstName.trim()} ${input.lastName.trim()}`,
        passwordHash,
        passwordChangedAt: now,
        passwordExpiresAt: passwordExpiresAt(now),
        mustChangePassword: true,
        passwordHistory: { create: { passwordHash, usedAt: now } },
        memberships: {
          create: { organizationId: input.organizationId, role: input.role },
        },
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetUserId: user.id,
        eventType: "USER_CREATED",
        context: { role: input.role },
      },
    });
    return { id: user.id, email: user.email };
  });
}

export async function deactivateOrganizationUser(input: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  reason: string;
  now?: Date;
}) {
  if (input.actorUserId === input.userId)
    throw new Error("SELF_DEACTIVATION_BLOCKED");
  const now = input.now ?? new Date();
  const membership = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  await ensureNotLastOwner({
    organizationId: input.organizationId,
    membershipId: membership.id,
  });
  await db.$transaction(async (transaction) => {
    await transaction.organizationMembership.update({
      where: { id: membership.id },
      data: { active: false, deactivatedAt: now },
    });
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        active: false,
        deactivatedAt: now,
        sessionEpoch: { increment: 1 },
        sessions: {
          updateMany: {
            where: { revokedAt: null },
            data: { revokedAt: now, revokedReason: "USER_DISABLED" },
          },
        },
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetUserId: input.userId,
        eventType: "USER_DISABLED",
        context: { reason: input.reason.slice(0, 500) },
      },
    });
  });
}

export async function recordAccessReview(input: {
  organizationId: string;
  reviewerUserId: string;
  subjectUserId: string;
  decision: AccessReviewDecision;
  requestedRole?: OrganizationRole;
  reason: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const membership = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.subjectUserId,
      },
    },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  if (input.decision !== "APPROVED")
    await ensureNotLastOwner({
      organizationId: input.organizationId,
      membershipId: membership.id,
    });
  if (input.decision === "CHANGE_ROLE" && !input.requestedRole)
    throw new Error("REQUESTED_ROLE_REQUIRED");
  await db.$transaction(async (transaction) => {
    if (input.decision === "CHANGE_ROLE") {
      await transaction.organizationMembership.update({
        where: { id: membership.id },
        data: { role: input.requestedRole! },
      });
      await transaction.securityAuditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.reviewerUserId,
          targetUserId: input.subjectUserId,
          eventType: "ROLE_CHANGED",
          context: { from: membership.role, to: input.requestedRole! },
        },
      });
    }
    if (input.decision === "REMOVE_ACCESS") {
      await transaction.organizationMembership.update({
        where: { id: membership.id },
        data: { active: false, deactivatedAt: now },
      });
      await transaction.user.update({
        where: { id: input.subjectUserId },
        data: {
          active: false,
          deactivatedAt: now,
          sessionEpoch: { increment: 1 },
          sessions: {
            updateMany: {
              where: { revokedAt: null },
              data: { revokedAt: now, revokedReason: "ACCESS_REVIEW_REMOVAL" },
            },
          },
        },
      });
      await transaction.securityAuditEvent.create({
        data: {
          organizationId: input.organizationId,
          actorUserId: input.reviewerUserId,
          targetUserId: input.subjectUserId,
          eventType: "USER_DISABLED",
          context: { reason: "ACCESS_REVIEW_REMOVAL" },
        },
      });
    }
    await transaction.organizationAccessReview.create({
      data: {
        organizationId: input.organizationId,
        membershipId: membership.id,
        subjectUserId: input.subjectUserId,
        reviewerUserId: input.reviewerUserId,
        decision: input.decision,
        reviewedRole: membership.role,
        requestedRole: input.requestedRole ?? null,
        reason: input.reason,
        reviewedAt: now,
        nextReviewDueAt: new Date(now.getTime() + QUARTER_MS),
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.reviewerUserId,
        targetUserId: input.subjectUserId,
        eventType: "ACCESS_REVIEW_COMPLETED",
        context: { decision: input.decision },
      },
    });
  });
}

export async function resetUserMfa(input: {
  organizationId: string;
  actorUserId: string;
  userId: string;
  reason: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const membership = await db.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    },
  });
  if (!membership) throw new Error("MEMBERSHIP_NOT_FOUND");
  await db.$transaction(async (transaction) => {
    await transaction.userMfaFactor.updateMany({
      where: { userId: input.userId, disabledAt: null },
      data: { disabledAt: now },
    });
    await transaction.userMfaRecoveryCode.deleteMany({
      where: { factor: { userId: input.userId } },
    });
    await transaction.user.update({
      where: { id: input.userId },
      data: {
        sessionEpoch: { increment: 1 },
        sessions: {
          updateMany: {
            where: { revokedAt: null },
            data: { revokedAt: now, revokedReason: "MFA_RESET" },
          },
        },
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        targetUserId: input.userId,
        eventType: "MFA_DISABLED",
        context: { reason: input.reason.slice(0, 500) },
      },
    });
  });
}

export async function changeOwnPassword(input: {
  organizationId: string;
  userId: string;
  currentPassword: string;
  newPassword: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const [user, organization] = await Promise.all([
    db.user.findFirst({
      where: {
        id: input.userId,
        memberships: {
          some: { organizationId: input.organizationId, active: true },
        },
      },
    }),
    db.organization.findUnique({ where: { id: input.organizationId } }),
  ]);
  if (!user || !organization) throw new Error("USER_NOT_FOUND");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash)))
    throw new Error("CURRENT_PASSWORD_INVALID");
  if (!passwordCanChange(user.passwordChangedAt, now))
    throw new Error("PASSWORD_MINIMUM_AGE");
  const failures = validatePasswordPolicy(input.newPassword, {
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName,
    email: user.email,
    organizationName: organization.name,
  });
  if (failures.length) throw new Error(failures[0]);
  const history = await db.userPasswordHistory.findMany({
    where: { userId: user.id },
    orderBy: { usedAt: "desc" },
    take: PASSWORD_HISTORY_DEPTH,
  });
  for (const previous of history)
    if (await verifyPassword(input.newPassword, previous.passwordHash))
      throw new Error("PASSWORD_REUSED");
  const passwordHash = await createPasswordHash(input.newPassword);
  await db.$transaction(async (transaction) => {
    await transaction.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordChangedAt: now,
        passwordExpiresAt: passwordExpiresAt(now),
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
        organizationId: input.organizationId,
        actorUserId: user.id,
        targetUserId: user.id,
        eventType: "PASSWORD_CHANGED",
        context: { expiredReset: false },
      },
    });
  });
}

export async function revokeSession(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const revoked = await db.userSession.updateMany({
    where: {
      id: input.sessionId,
      organizationId: input.organizationId,
      userId: input.userId,
      revokedAt: null,
    },
    data: { revokedAt: now, revokedReason: "USER_REVOKED_SESSION" },
  });
  if (revoked.count !== 1) throw new Error("SESSION_NOT_FOUND");
  await db.securityAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.userId,
      targetUserId: input.userId,
      eventType: "SESSION_REVOKED",
      context: { selfService: true },
    },
  });
}

export async function recordCredentialRotation(input: {
  organizationId: string;
  actorUserId: string;
  credentialType: CredentialRotationType;
  keyVersion?: number;
  notes?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await db.$transaction(async (transaction) => {
    await transaction.credentialRotationRecord.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        credentialType: input.credentialType,
        keyVersion: input.keyVersion ?? null,
        rotatedAt: now,
        nextDueAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1_000),
        notes: input.notes ?? null,
      },
    });
    await transaction.securityAuditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventType: "CREDENTIAL_ROTATED",
        context: {
          credentialType: input.credentialType,
          keyVersion: input.keyVersion ?? null,
        },
      },
    });
  });
}
