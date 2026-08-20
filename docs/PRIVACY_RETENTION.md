# Privacy, retention, and deletion

Last reviewed: 2026-08-20

## Principles

- Collect the minimum data required for sourcing and research.
- Preserve organization scope, source, observation time, and purpose.
- A provider's contractual maximum overrides a longer product default.
- Missing provider-retention rights block new live history ingestion.
- Deletion is bounded, retry-safe, and auditable; absence is never converted to
  a zero metric.

## Current schedules

| Data                                 | Current policy                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Export objects                       | Seven-day expiry; download fails closed at expiry; report-first deletion mode                          |
| Provider cache/raw evidence          | Explicit `retainUntil`; private references cleared after object deletion                               |
| Historical metric points             | Per-series retention, now sourced from provider rights for live history; bounded oldest-first deletion |
| API rate-limit buckets               | Expire at the fixed-window boundary and are deleted in bounded retention runs                          |
| Research/project decisions           | Retained as auditable evidence until an approved tenant deletion workflow exists                       |
| Supplier uploads and normalized rows | Retained until an approved tenant deletion workflow exists; originals stay private                     |
| Review records                       | Deduplicated and redacted before persistence; evidence retained for inspectable summaries              |
| Credentials                          | Retained encrypted until revoked/replaced; plaintext is never stored                                   |
| Audit events                         | Retained to explain security, policy, and decision history                                             |

`RIZPOINT_RETENTION_MODE=report` is the safe default. It reports export,
provider-evidence, and historical-point candidates without deleting those
objects/records; expired rate-limit buckets contain only one-way principal
hashes and are always safe to purge. Set mode to `delete` only after reviewing
the report, provider terms, legal holds, and a successful restore drill.

## Deletion workflow and limitations

Automated self-service account/tenant erasure is not implemented. Operators
must not improvise direct cascading deletes. For an approved request: identify
the tenant, pause tenant jobs, inventory database and object references, apply
provider/legal holds, take the approved recovery checkpoint, execute a reviewed
tenant-scoped deletion runbook, verify object and database removal, and retain
only the legally required tombstone/audit proof.

Backups may retain deleted material until their documented rotation expires.
Restore procedures must reapply deletion tombstones before a restored system is
returned to service. Review identifiers or contact-like content must not be
used for enrichment; imported review text is minimized before storage.
