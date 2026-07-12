import type { Prisma, ScanJobStatus } from "./generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { db } from "./client.js";

export const PHASE_ZERO_ORGANIZATION_SLUG = "rizpoint-demo";

export async function ensurePhaseZeroOrganization() {
  return db.organization.upsert({
    where: { slug: PHASE_ZERO_ORGANIZATION_SLUG },
    create: {
      slug: PHASE_ZERO_ORGANIZATION_SLUG,
      name: "RizPoint Demo Organization",
    },
    update: {},
  });
}

export async function createMockScanJob(
  organizationId: string,
  idempotencyKey: string,
) {
  return db.$transaction(async (transaction) => {
    const job = await transaction.scanJob.upsert({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      create: { organizationId, idempotencyKey },
      update: {},
    });

    await transaction.outboxEvent.upsert({
      where: {
        scanJobId_eventType: {
          scanJobId: job.id,
          eventType: "mock.scan.requested",
        },
      },
      create: {
        organizationId,
        scanJobId: job.id,
        eventType: "mock.scan.requested",
        payload: { scanJobId: job.id },
      },
      update: {},
    });

    return job;
  });
}

export async function getScanJobForOrganization(
  organizationId: string,
  scanJobId: string,
) {
  return db.scanJob.findFirst({
    where: { id: scanJobId, organizationId },
    include: { checkpoints: true, events: { orderBy: { createdAt: "asc" } } },
  });
}

const OUTBOX_CLAIM_LEASE_MS = 60_000;

export type ClaimedOutboxEvent = {
  id: string;
  payload: Prisma.JsonValue;
  claimToken: string;
};

export async function claimPendingOutboxEvents(
  limit: number,
): Promise<ClaimedOutboxEvent[]> {
  const staleBefore = new Date(Date.now() - OUTBOX_CLAIM_LEASE_MS);
  await db.outboxEvent.updateMany({
    where: {
      status: "PROCESSING",
      OR: [{ claimedAt: { lt: staleBefore } }, { claimedAt: null }],
    },
    data: { status: "PENDING", claimToken: null, claimedAt: null },
  });

  const events = await db.outboxEvent.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const claimed: ClaimedOutboxEvent[] = [];
  for (const event of events) {
    const claimToken = randomUUID();
    const result = await db.outboxEvent.updateMany({
      where: { id: event.id, status: "PENDING" },
      data: {
        status: "PROCESSING",
        claimToken,
        claimedAt: new Date(),
        deliveryAttempts: { increment: 1 },
        lastError: null,
      },
    });
    if (result.count === 1)
      claimed.push({ id: event.id, payload: event.payload, claimToken });
  }
  return claimed;
}

export async function markOutboxPublished(
  outboxEventId: string,
  claimToken: string,
): Promise<boolean> {
  const result = await db.outboxEvent.updateMany({
    where: { id: outboxEventId, status: "PROCESSING", claimToken },
    data: {
      status: "PUBLISHED",
      publishedAt: new Date(),
      claimToken: null,
      claimedAt: null,
    },
  });
  return result.count === 1;
}

export async function resetOutboxEvent(
  outboxEventId: string,
  claimToken: string,
  lastError: string,
): Promise<boolean> {
  const result = await db.outboxEvent.updateMany({
    where: { id: outboxEventId, status: "PROCESSING", claimToken },
    data: {
      status: "PENDING",
      claimToken: null,
      claimedAt: null,
      lastError,
    },
  });
  return result.count === 1;
}

export async function markScanJobRunning(scanJobId: string): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const updated = await transaction.scanJob.updateMany({
      where: {
        id: scanJobId,
        status: { in: ["QUEUED", "RUNNING", "FAILED_RETRYABLE"] },
      },
      data: { status: "RUNNING", attemptCount: { increment: 1 } },
    });
    if (updated.count === 0) return false;
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "RUNNING" },
    });
    return true;
  });
}

export async function completeMockScanJob(
  scanJobId: string,
  checksum: string,
  result: Prisma.InputJsonValue,
) {
  await db.$transaction(async (transaction) => {
    const completed = await transaction.scanJob.updateMany({
      where: { id: scanJobId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        mockResult: result,
        completedAt: new Date(),
      },
    });
    if (completed.count === 0) return;
    await transaction.scanCheckpoint.upsert({
      where: { scanJobId_stage: { scanJobId, stage: "MOCK_SCAN" } },
      create: { scanJobId, stage: "MOCK_SCAN", checksum, payload: result },
      update: { checksum, payload: result },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: "COMPLETED", payload: result },
    });
  });
}

export async function failScanJob(
  scanJobId: string,
  status: Extract<ScanJobStatus, "FAILED_RETRYABLE" | "FAILED_FINAL">,
  message: string,
) {
  await db.$transaction(async (transaction) => {
    await transaction.scanJob.update({
      where: { id: scanJobId },
      data: { status },
    });
    await transaction.scanEvent.create({
      data: { scanJobId, eventType: status, payload: { message } },
    });
  });
}
