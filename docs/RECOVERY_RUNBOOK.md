# Recovery runbook

1. Declare the incident and stop web mutations plus worker consumption. Preserve the release SHA, timestamps, scan IDs, and sanitized logs.
2. For a dependency outage, restore the dependency and restart worker; checkpoints and deterministic job IDs make retries safe.
3. For Redis loss, do not restore Redis as canonical state. Start Redis and worker after PostgreSQL is available. The worker automatically returns stale `PUBLISHED` outbox events with unfinished scan/export targets to `PENDING`; verify the `published_event_reconciled` event count and that deterministic job IDs resume from checkpoints before declaring recovery complete.
4. For PostgreSQL corruption, select a recovery point, restore PostgreSQL and matching object-storage versions into an isolated environment, run restore verification, then promote only after row/checksum and authenticated smoke checks pass.
5. Roll back application images before considering destructive migration rollback. Never run a rollback SQL file in production without a verified backup and change approval.
6. For a suspected calculation defect, stop purchase-order exports, preserve calculation inputs/evidence, replay the affected results, classify severity, and require a manually audited fix before resuming `BUY` decisions.
7. Record root cause, data scope, recovery time, customer/operator impact, and follow-up controls. An unresolved Sev-1 resets the two-week private-pilot clock.

## Quarterly recovery-test evidence

At least quarterly, restore an encrypted backup into an isolated non-production
target. Never restore over production and never expose the target publicly.
Record a `BACKUP_RESTORE_TEST` security control containing:

- test date;
- backup source and its encryption/version reference;
- isolated restore target;
- result (`PASS`, `FAIL`, or `FINDINGS`);
- RPO observed and RTO observed;
- named reviewer;
- issues found, actions, owners and deadlines; and
- private evidence reference.

A failed backup or failed restore exercise creates a security alert and is
triaged through the incident response plan. Documentation alone is not recovery
evidence.

### Amazon deletion tombstones

Every completed organization-scoped Amazon deletion request creates a payload-free tombstone with provider scope and cutoff timestamp. After restoring a database or object-storage backup in an isolated recovery environment:

1. keep provider egress and user traffic disabled;
2. deploy current migrations and start the retention worker with Amazon deletion enabled;
3. replay every `amazon_deletion_tombstones` scope until no eligible Amazon record or object reference remains;
4. verify the retention dashboard and record deleted counts, never source payloads;
5. verify Amazon provider credentials remain revoked for the restored organization;
6. only then permit the recovered environment to become active.

Immutable backups may complete their encrypted rotation, but tombstoned Amazon Information may never return to active use. A quarterly exercise must seed a tombstoned record in the isolated target and prove it is removed. Tombstones must be restored from a newer trusted control record/control plane when restoring an older backup that predates the deletion.
