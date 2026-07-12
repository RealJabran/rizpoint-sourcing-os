# ADR 0002: BullMQ orchestration and transactional outbox

## Decision

The Node worker owns BullMQ orchestration. Web requests persist a `ScanJob` and `OutboxEvent` in one PostgreSQL transaction. A dispatcher claims the event with a lease/token and publishes an idempotent, colon-free BullMQ job ID.

## Rationale

BullMQ provides retry, backoff, global rate limiting, stalled-job recovery, and shared TypeScript payloads. The outbox avoids an unsafe database-plus-Redis dual write.

## Consequences

Handlers must tolerate at-least-once delivery. Stale outbox claims are reclaimed, and terminal job writes are conditional. Redis is not an authority for user-visible job state.
