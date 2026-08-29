# Security maintenance calendar

Passing time never completes a control. Each task requires a named reviewer,
performed time, result, findings/actions, next due date and private evidence
reference in a `SecurityControlRecord` and/or the ignored deployment evidence
file used by `pnpm security:amazon:audit`.

| Cadence                           | Required work                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bi-weekly (14 days maximum)       | Review centralized security logs, alerts, access denials, provider anomalies, exports, administrative changes, incidents and pipeline health.                                 |
| Monthly (30/31 days maximum)      | Scan all systems processing/storing Amazon Information; triage findings; verify endpoint/server anti-malware and ClamAV updates.                                              |
| Quarterly (92 days maximum)       | Review all personnel and service access; inventory applicable systems/devices; perform an isolated backup/restore exercise and record RPO/RTO.                                |
| Every 6 months (183 days maximum) | Senior owner reviews/approves the incident response plan, roster, notification path and lessons learned.                                                                      |
| Annually (366 days maximum)       | Formal risk assessment; qualified penetration test; Amazon API credential review/rotation; encryption-key rotation; approved-user security training; third-party risk review. |

## Operator workflow

1. Copy `deploy/amazon-hardened/security-operations-evidence.example.json` to
   the ignored `security-operations-evidence.json` only on the controlled
   deployment/operator system.
2. Perform the real control. Never enter `VERIFIED` before inspecting evidence.
3. Record `performedAt`, `nextDueAt`, reviewer and a private evidence reference;
   do not embed credentials, provider payloads, buyer PII or supplier data.
4. Where supported, also submit the review through the tenant-scoped
   `/api/security/operations` boundary so Settings → Security shows it.
5. Run `pnpm security:amazon:audit`. Any invalid/overdue verified record is
   `FAIL`; absent evidence is `MANUAL_EVIDENCE_REQUIRED`.
6. Run with `--strict` for a production approval decision, where missing manual
   evidence also returns a failing exit status.
