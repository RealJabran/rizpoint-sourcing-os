# Recovery runbook

1. Declare the incident and stop web mutations plus worker consumption. Preserve the release SHA, timestamps, scan IDs, and sanitized logs.
2. For a dependency outage, restore the dependency and restart worker; checkpoints and deterministic job IDs make retries safe.
3. For Redis loss, do not restore Redis as canonical state. Start Redis and worker after PostgreSQL is available. The worker automatically returns stale `PUBLISHED` outbox events with unfinished scan/export targets to `PENDING`; verify the `published_event_reconciled` event count and that deterministic job IDs resume from checkpoints before declaring recovery complete.
4. For PostgreSQL corruption, select a recovery point, restore PostgreSQL and matching object-storage versions into an isolated environment, run restore verification, then promote only after row/checksum and authenticated smoke checks pass.
5. Roll back application images before considering destructive migration rollback. Never run a rollback SQL file in production without a verified backup and change approval.
6. For a suspected calculation defect, stop purchase-order exports, preserve calculation inputs/evidence, replay the affected results, classify severity, and require a manually audited fix before resuming `BUY` decisions.
7. Record root cause, data scope, recovery time, customer/operator impact, and follow-up controls. An unresolved Sev-1 resets the two-week private-pilot clock.
