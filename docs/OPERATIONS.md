# Private production operations

## Deployment

Use immutable image digests built by CI. Supply secrets through the deployment secret manager, not an environment file in Git. Set `RIZPOINT_PRIVATE_MODE=true`, `PHASE_ZERO_DEMO_MODE=false`, a unique `NEXTAUTH_SECRET`, and a private organization slug. Run migrations once with the migrator identity before releasing worker and web containers. Only the web service is public behind TLS; PostgreSQL, Redis, scanner, ClamAV, worker metrics, and object storage remain private.

Bootstrap the owner in a controlled maintenance session: pass the password through protected standard input to `node scripts/create-password-hash.mjs` (never as an argument or environment variable), create the organization and `users`/`organization_memberships` rows through the approved database administration channel, then discard the plaintext input. The hash is safe to store only in the database.

## Backups and restore verification

Use managed PostgreSQL point-in-time recovery with an RPO of 15 minutes or better, daily encrypted logical dumps retained for 30 days, and private-object versioning retained for 30 days. Run `scripts/backup-postgres.sh` from a backup runner with `PGHOST`, `PGDATABASE`, `PGUSER`, and a protected `PGPASSFILE`; upload the dump and checksum to encrypted backup storage. At least monthly and before a schema release, restore into an isolated database named `rizpoint_restore_*` with `RIZPOINT_RESTORE_CONFIRM=RESTORE_ISOLATED` and `scripts/verify-postgres-restore.sh`.

Redis is not backed up as business state. Restore PostgreSQL and object versions first, then start the worker so idempotent jobs can resume from database checkpoints.

## Retention

Exports receive a seven-day expiry. `RIZPOINT_RETENTION_MODE=report` only records candidates. Set it to `delete` only after reviewing the report and a successful restore drill; deletion removes expired private export objects and records an audit event. Uploaded originals, financial evidence, and audit history remain retained until a separate approved data-deletion feature exists.

Historical metric points use each series' explicit retention period. The same
retention worker reports or deletes at most 1,000 expired points per run,
revalidates expiry transactionally, and records organization-scoped deletion
audit events. Automatic downsampling is disabled because raw normalized points
are replay evidence.

Live provider history cannot start until an owner records reviewed provider
terms and contractual retention for that organization, marketplace, and
capability. Rights default to internal-only and blocked export. Use the private
`/api/providers/data-rights` owner endpoint only after contract review; policy
changes are audit events. A shorter revised retention period may shorten an
existing series but a later request cannot silently lengthen it. Provider cache
and raw-evidence deadlines are also capped by the contractual period.

Durable API rate-limit buckets contain a scope and SHA-256 principal hash, not
the bearer/session value. Expired buckets are removed in bounded retention
runs. Maintain an edge/WAF rate limit as a separate production control.

## Research scale verification

Run `pnpm test:research-scale` against the local Compose PostgreSQL service for
the transaction-local 10k/100k/500k scaled benchmark. Set
`RIZPOINT_SCALE_PROFILE=full` to exercise 100k/1M/5M rows during a dedicated
capacity run. Compare results with `docs/PERFORMANCE.md`; do not change database
technology from an unmeasured assumption.

## Security release checks

Run `pnpm check:private-assets` after building. It checks tracked/untracked
private files, credential-shaped literals, and the generated web/extension
browser output for server-only credential markers. Run
`pnpm check:production-hardening` to enforce the Research Companion permission
allowlist and existing container/deployment controls. See
`docs/SECURITY_AUDIT.md` for the full audit mapping.

## Alerts

Alert on failed-final jobs, queue age, outbox publish/reconciliation errors, provider throttling, scan partial-success spikes, dependency readiness failures, ClamAV unavailability, backup age, restore failure, and any Sev-1 calculation or data-integrity incident. Configure `RIZPOINT_ERROR_TRACKING_WEBHOOK_URL` to a private HTTPS collector. Logs and telemetry must carry IDs only, never workbook cells, tokens, supplier prices, or refresh credentials.
