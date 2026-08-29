# Security risk register

Owner: RizPoint LLC Owner

Review status: **PENDING first formal owner approval**
Required cadence: at least annually and after material architecture, provider,
data-classification or incident changes.

Likelihood and impact use `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. Risk rating is
the approved combination of likelihood and impact. Status is `OPEN`,
`MITIGATING`, `ACCEPTED`, or `CLOSED`. Risk acceptance requires the business
owner, expiration date, rationale and compensating controls in private evidence.

| ID   | Asset                                | Threat                                               | Vulnerability                                            | Likelihood | Impact   | Risk rating | Control                                                                                                                              | Control owner                 | Status     | Review date                 | Residual risk                     |
| ---- | ------------------------------------ | ---------------------------------------------------- | -------------------------------------------------------- | ---------- | -------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------- | --------------------------- | --------------------------------- |
| R-01 | SP-API refresh tokens and LWA secret | Credential theft/misuse                              | Secret-store, host or operator compromise                | MEDIUM     | CRITICAL | CRITICAL    | AES-256-GCM tenant-bound envelopes, worker-only access, managed-secret deployment, telemetry/browser leak tests, rotation/revocation | Security owner                | MITIGATING | PENDING                     | MEDIUM after verified deployment  |
| R-02 | Amazon observations                  | Cross-tenant disclosure                              | IDOR or missing organization predicate                   | LOW        | CRITICAL | HIGH        | Tenant-scoped repositories, compound foreign keys, RBAC, cross-tenant integration tests                                              | Engineering/security owner    | MITIGATING | PENDING                     | LOW after live assessment         |
| R-03 | PostgreSQL                           | Data theft/destruction                               | Infrastructure/IAM compromise or unverified encryption   | MEDIUM     | CRITICAL | CRITICAL    | Private TLS database, least privilege, encrypted storage/backups, audit/SIEM, isolated restore                                       | Infrastructure owner          | OPEN       | PENDING                     | Requires deployment evidence      |
| R-04 | Private object storage               | Public or over-broad object access                   | Policy error or leaked signing/storage credential        | MEDIUM     | HIGH     | HIGH        | Private bucket, short-lived signed operations, HTTPS/KMS/versioning/lifecycle, external policy verification                          | Infrastructure owner          | OPEN       | PENDING                     | Requires deployment evidence      |
| R-05 | User identities                      | Account takeover                                     | Phishing, password/MFA/session theft                     | MEDIUM     | HIGH     | HIGH        | Named accounts, password lifecycle, TOTP, lockout, 15-minute idle session, access reviews and alerts                                 | Security owner                | MITIGATING | PENDING                     | MEDIUM                            |
| R-06 | Internet edge                        | Exploit, credential stuffing, denial of service      | WAF/firewall/IDS not yet deployed and attested           | HIGH       | HIGH     | CRITICAL    | TLS edge, rate limits, supported firewall baseline; deploy verified WAF/IDS/SIEM                                                     | Infrastructure owner          | OPEN       | PENDING                     | HIGH until deployment             |
| R-07 | Security logs                        | Attack remains undetected or logs altered            | Central SIEM and immutable 12-month retention unverified | HIGH       | HIGH     | CRITICAL    | Structured database events, correlation/outcome fields, 12-month minimum; deploy centralized integrity-controlled collection/review  | Security owner                | OPEN       | PENDING                     | HIGH until deployment             |
| R-08 | Worker/provider runtime              | Unexpected 401/403/429/request spike                 | Provider abuse, revocation or runaway job                | MEDIUM     | HIGH     | HIGH        | Durable request telemetry, rate budgets, retry limits, security-signal evaluator and deduplicated alerts                             | Engineering owner             | MITIGATING | PENDING                     | MEDIUM                            |
| R-09 | Upload/scanner path                  | Malware or parser exploitation                       | Malicious supplier workbook or stale signatures          | MEDIUM     | HIGH     | HIGH        | Type/size bounds, isolated scanner, fail-closed ClamAV and signature-age readiness; endpoint protection remains external             | Security owner                | MITIGATING | PENDING                     | MEDIUM after endpoint attestation |
| R-10 | Dependencies/build chain             | Vulnerable or compromised package/image/action       | Transitive dependency or CI supply-chain compromise      | MEDIUM     | CRITICAL | CRITICAL    | Lockfile, dependency audit, SAST, secret and Trivy scans, patch SLAs, annual penetration test                                        | Engineering/security owner    | MITIGATING | 2026-08-29 discovery review | MEDIUM after recurring scans      |
| R-11 | Backups/recovery                     | Irrecoverable or compromised restore                 | Untested, stale or unencrypted backups                   | MEDIUM     | CRITICAL | CRITICAL    | Encrypted geographically appropriate backups, quarterly isolated restore test, RPO/RTO evidence                                      | Infrastructure/business owner | OPEN       | PENDING                     | Requires recovery exercise        |
| R-12 | Administrator endpoint               | Lost device, malware, credential exfiltration        | Endpoint/MDM controls not yet attested                   | MEDIUM     | CRITICAL | CRITICAL    | Full-disk encryption, 15-minute lock, endpoint protection/MDM, remote wipe, individual MFA                                           | Security owner                | OPEN       | PENDING                     | Requires endpoint evidence        |
| R-13 | Incident response                    | Missed Amazon notification or weak containment       | Unapproved/untested plan or stale contact roster         | MEDIUM     | CRITICAL | CRITICAL    | Formal plan, IMPOC, automatic 24-hour deadline, six-month review and incident exercise                                               | Business/security owner       | MITIGATING | PENDING                     | HIGH until approved/exercised     |
| R-14 | Third-party providers                | Contract/security failure or unlawful redistribution | Unknown retention/export/security commitments            | MEDIUM     | HIGH     | HIGH        | Entitlements/data-rights matrix, export field policy, annual vendor review, rapid disablement                                        | Business/security owner       | MITIGATING | PENDING                     | MEDIUM                            |

## Review procedure

1. Inventory systems, devices, providers, data classes, trust boundaries and
   changes since the prior review.
2. Validate each threat, control effectiveness and external evidence; do not
   mark documentation as implementation.
3. Re-rate inherent and residual risk, assign owner/actions/deadlines and obtain
   senior-management approval for acceptance.
4. Record a tenant-scoped `RISK_ASSESSMENT` control record and its private
   evidence reference. The next review must be no later than one year.
5. Feed unacceptable risks into the incident, vulnerability, access, recovery,
   supplier/provider and 90-day roadmaps.
