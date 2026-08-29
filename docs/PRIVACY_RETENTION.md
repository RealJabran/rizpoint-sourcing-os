# Privacy, retention, and deletion

Last reviewed: 2026-08-29

## Amazon Information lifecycle

Amazon SP-API information is no longer an indefinite-retention category. RizPoint enforces the earlier of the source/entitlement requirement, an explicit shorter record policy, RizPoint's internal maximum of 18 **calendar months** from observation, or an applicable Amazon deletion event. Current Amazon policy requires applicable event-driven deletion within 30 days.

Current Amazon guidance is purpose-limited and does not state a universal 18-month non-PII maximum. The 18-month value is therefore a stricter RizPoint internal ceiling. See [Amazon Information inventory](./AMAZON_INFORMATION_INVENTORY.md).

The worker deletes object evidence before its database reference, processes bounded tenant-scoped batches, retries partial failures, minimizes reconstructive catalog projections, and retains only payload-free counts/audit/tombstone metadata. Supplier files, user inputs, and security logs are outside an Amazon-source purge. An owner/admin can create a destructive request from **Settings → Data & Providers** only with exact confirmation. This revokes local Amazon credentials and stops live provider work before deletion begins. Legal holds are not supported.

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
| Research/project decisions           | Amazon source snapshots expire/minimize; non-provider decision owner/date/outcome metadata may remain  |
| Supplier uploads and normalized rows | Retained until an approved tenant deletion workflow exists; originals stay private                     |
| Review records                       | Deduplicated and redacted before persistence; evidence retained for inspectable summaries              |
| Credentials                          | Retained encrypted until revoked/replaced; plaintext is never stored                                   |
| Audit events                         | Retained to explain security, policy, and decision history                                             |

`RIZPOINT_RETENTION_MODE=report` is the safe default for legacy export/provider-history cleanup. It reports export,
provider-evidence, and historical-point candidates without deleting those
objects/records; expired rate-limit buckets contain only one-way principal
hashes and are always safe to purge. Set mode to `delete` only after reviewing
the report, provider terms, legal holds, and a successful restore drill.

Amazon lifecycle enforcement defaults to deletion. `RIZPOINT_AMAZON_RETENTION_MODE=report` exists only for a reviewed migration rehearsal and must not remain enabled in production.

## Deletion workflow and limitations

The approved Amazon Information deletion workflow is implemented. Broader full-account privacy deletion remains a separate operational workflow; operators must not improvise direct cascading deletes.

Backups may retain deleted material until their documented rotation expires.
Restore procedures must reapply deletion tombstones before a restored system is
returned to service. Review identifiers or contact-like content must not be
used for enrichment; imported review text is minimized before storage.
