# Security logging and review

Policy owner: RizPoint LLC Security Owner

Version: 1.0
Approval/central-SIEM evidence: **PENDING production operational attestation**

## Event boundary

`SecurityAuditEvent` is the tenant-scoped canonical application security event.
It records timestamp, organization ID, actor/target IDs when known, allowlisted
event type, success/failure/denied/warning outcome, source, request correlation,
a one-way source-principal hash where appropriate, non-sensitive context and a
minimum 12-month retention deadline. Provider/workflow events remain separate;
high-risk security projections are correlated by IDs.

Coverage includes:

- authentication success/failure, MFA challenges, recovery, lock/unlock;
- individual users, roles, sessions and access reviews;
- provider authorization/disconnection and credential rotation;
- server-side authorization denials;
- completed high-risk exports;
- configuration/administrative changes and security errors;
- provider authorization/throttle/request-rate anomalies;
- malware, backup/restore, log-pipeline, datastore-readiness and secret-scan
  signals supplied by their authoritative deployment systems.

The application evaluator creates organization-scoped, deduplicated
`SecurityAlert` records for repeated authentication/MFA failures, lockouts and
Amazon/provider anomalies. Infrastructure/SIEM integrations must create the
remaining operational alerts without sending sensitive payloads.

## Prohibited log content

Never log Amazon access/refresh tokens, passwords, MFA secrets/codes, recovery
codes, encryption/client secrets, cookies/authorization headers, buyer PII,
supplier file contents/prices, raw provider credentials/responses, workbook
cells, object bodies or unrestricted request/response bodies. Use IDs, counts,
states, hashes, release SHA, correlation and sanitized error codes.

The structured context sanitizer drops credential/payload-shaped keys and
bounds strings. Pino redaction and `check:private-assets` are additional layers,
not permission to log raw content first.

## Central collection, integrity and retention

Production must send edge, application, worker, database/storage audit,
provider-anomaly, malware/endpoint, WAF/IDS and deployment events to a private
central SIEM/log service in near real time. Restrict write/read/admin roles,
enable immutable or protected retention, alert on pipeline gaps, synchronize UTC
time and retain security logs for **at least 12 months**. Longer retention needs
a documented business/legal purpose.

The database retention deadline prevents application security records from
being treated as short-lived logs. It does not prove that container stdout,
edge, database, storage or endpoint logs are centralized or immutable; that
requires dated production evidence. Amazon Information must not be copied into
logs to satisfy retention.

## Automated alerting

Page/notify through the approved private channel for critical/high signals:
credential changes, malware/secret detection, backup/log pipeline failure,
Amazon authorization spikes, provider abuse, account lockouts and unexpected
administrator actions. Alerts contain identifier, event type, time, source,
severity, counts/thresholds and correlation only. Never attach raw payloads.

## Bi-weekly manual review

Where real-time automated analysis is incomplete, conduct a manual review at
least every 14 days. Review:

1. log source completeness, ingestion delay, clock synchronization and pipeline
   failure alerts;
2. login/MFA failures, lockouts, denied access and inactive identities;
3. user/role/MFA/session/access-review and unexpected administrative changes;
4. provider authorization, credentials, 401/403/429 and request-rate anomalies;
5. exports, object/database access and security errors;
6. malware, endpoint/WAF/IDS, backup/restore and secret-scan findings;
7. open alerts/incidents and prior action items.

Record a `SECURITY_LOG_REVIEW` with review period start/end, named reviewer,
timestamp, source coverage, result, findings, action items/owners/deadlines and a
private evidence reference. A finding that meets incident criteria invokes the
incident plan. Do not mark the review complete automatically.

### Review record template

```text
Review period (UTC):
Reviewer:
Review timestamp (UTC):
Log sources expected / received / missing:
Queries/detections reviewed:
Findings and severity:
Incidents opened:
Action item / owner / due date:
Private evidence reference:
Next review due (no later than 14 days):
```
