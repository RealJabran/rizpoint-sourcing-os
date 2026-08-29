# Amazon SP-API security controls

Last reviewed: 2026-08-29

Scope: RizPoint's application-enforced controls for the private Amazon SP-API
Solution Provider deployment. This is implementation evidence, not a
certification or legal opinion. Amazon's current policies and questionnaire
remain authoritative.

Prompt 36J lifecycle evidence is maintained in [Amazon Information inventory](./AMAZON_INFORMATION_INVENTORY.md), [third-party processor register](./THIRD_PARTY_PROCESSORS.md), and [Solution Provider Profile evidence](./AMAZON_SOLUTION_PROVIDER_PROFILE_EVIDENCE.md). Current Amazon guidance requires non-PII retention only as long as strictly necessary and secure deletion within 30 days after applicable deletion triggers. RizPoint additionally enforces an 18-calendar-month internal ceiling for ordinary SP-API observations.

## Authoritative basis

- [Amazon Key Security Control Guidance](https://developer-docs.amazon.com/sp-api/docs/guidance-to-address-key-security-controls-in-sp-api-integration), reviewed 2026-08-28.
- [Amazon SP-API policy update effective 2026-08-25](https://developer.amazonservices.com/policy-update-for-sp-api), reviewed 2026-08-28.
- [Safeguarding sensitive credentials](https://developer-docs.amazon.com/sp-api/docs/safeguarding-sensitive-credentials), reviewed 2026-08-28.
- [Application Management API credential-rotation guide](https://developer-docs.amazon.com/sp-api/docs/application-management-api-v2023-11-30-use-case-guide), reviewed 2026-08-28.

The 2026 policy update makes the ten-attempt lockout period explicitly 30
minutes and also calls for an internet-edge WAF, encrypted device storage, a
15-minute screen lock, an incident-management point of contact, and expanded
vulnerability testing. RizPoint enforces a 30-minute account lock and a
15-minute application-session idle timeout. A workstation screen lock, WAF,
device/storage encryption, incident contact, and third-party testing are
deployment or operational controls, not application features.

## Control evidence

Status vocabulary is strict: `IMPLEMENTED` means application-enforced and
tested; `PARTIALLY_IMPLEMENTED` means only part is enforced;
`EXTERNAL_OPERATION_REQUIRED` means a person or deployment platform must
actually perform it; `NOT_IMPLEMENTED` means no adequate control exists.

| Amazon control                                                        | Status                      | RizPoint implementation and evidence                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password length and complexity                                        | IMPLEMENTED                 | Central policy defaults to 14 characters and requires upper/lower/number/special: `apps/web/src/security/password-policy.ts`; `apps/web/test/security-controls.test.ts`.                                                                                                                 |
| Reject user identity terms                                            | IMPLEMENTED                 | Checks significant first/last/display/email-local/organization terms: `password-policy.ts`; unit tests.                                                                                                                                                                                  |
| Previous 10 passwords                                                 | IMPLEMENTED                 | `UserPasswordHistory`, last-ten verification, current-hash migration: schema/migration, `authentication.ts`, `security-management.ts`; integration replay test.                                                                                                                          |
| One-day minimum age                                                   | IMPLEMENTED                 | Ordinary changes are blocked before 24 hours. Forced migration/expired-password reset is the necessary account-recovery exception.                                                                                                                                                       |
| 365-day maximum lifetime                                              | IMPLEMENTED                 | Persisted expiry; login issues a one-time reset challenge and proxy denies normal access while expired/forced-reset: `authentication.ts`, `proxy.ts`.                                                                                                                                    |
| Password secrecy                                                      | IMPLEMENTED                 | Versioned per-password salted `scrypt-v1`; plaintext is never persisted: `password-hash.ts`. Existing hashes migrate without plaintext.                                                                                                                                                  |
| MFA for every production user                                         | IMPLEMENTED                 | Private production requires a confirmed factor and completed MFA login. TOTP uses a random secret, QR/manual enrollment, activation challenge, and no SMS: `totp.ts`, `authentication.ts`, `auth.ts`, `proxy.ts`.                                                                        |
| MFA secret protection                                                 | IMPLEMENTED                 | Versioned AES-256-GCM envelope with organization/user authenticated context and server-only 256-bit key: `security-vault.ts`, `runtime-config.ts`.                                                                                                                                       |
| Recovery codes                                                        | IMPLEMENTED                 | Ten random codes are returned once, individually scrypt-hashed, and one-use: `authentication.ts`; browser/integration tests.                                                                                                                                                             |
| MFA throttling                                                        | IMPLEMENTED                 | Durable organization/scope/principal-hash rate buckets; failures are audited and challenges capped.                                                                                                                                                                                      |
| Ten-attempt lockout                                                   | IMPLEMENTED                 | Atomic database increment prevents concurrent races; attempt ten locks for 30 minutes and emits one event: `authentication.ts`; concurrent integration test.                                                                                                                             |
| Login limiting/non-enumeration                                        | IMPLEMENTED                 | Independent durable network/principal limits; unknown, inactive, and invalid accounts share one public response and expensive password work.                                                                                                                                             |
| Unique individual users                                               | IMPLEMENTED                 | Unique normalized email, generic-account rejection, names, active status, organization membership, last authentication, creation/deactivation audit.                                                                                                                                     |
| Least-privilege RBAC                                                  | IMPLEMENTED                 | OWNER, ADMIN, RESEARCHER, VIEWER map to explicit permissions in `authorization.ts`; the server proxy authorizes every protected API request from current database role. Sensitive handlers also check permission.                                                                        |
| User deactivation                                                     | IMPLEMENTED                 | Disables user/membership, increments epoch, immediately revokes durable sessions, and audits: `security-management.ts`; integration/proxy tests.                                                                                                                                         |
| Removal within 24 hours                                               | EXTERNAL_OPERATION_REQUIRED | RizPoint removal is immediate once submitted; an owner/admin must submit it within 24 hours and separately revoke external identities.                                                                                                                                                   |
| Quarterly access review                                               | IMPLEMENTED                 | Security Settings shows all active users, role, effective permissions, MFA, last login, age/review date. APPROVED, REMOVE_ACCESS, CHANGE_ROLE require reviewer/reason and persist records. The human review is never auto-completed.                                                     |
| Security audit events                                                 | IMPLEMENTED                 | Tenant-scoped events cover required login, lock, password, MFA, recovery, user, role, review, provider, and rotation actions; context excludes secrets.                                                                                                                                  |
| SP-API refresh-token encryption                                       | IMPLEMENTED                 | Existing tenant-bound versioned AES-256-GCM envelope is preserved. Refresh tokens encrypt before persistence; LWA access tokens are worker-memory-only; browser DTOs/telemetry exclude credentials.                                                                                      |
| Credential/key inventory                                              | IMPLEMENTED                 | Provider/MFA envelopes persist key versions; rotation records contain type/version/actor/time/next due without secret values.                                                                                                                                                            |
| Annual API/encryption rotation                                        | EXTERNAL_OPERATION_REQUIRED | RizPoint records rotations/deadlines; real LWA and deployment keys must be rotated in Amazon/secret management. An earlier Amazon expiry controls.                                                                                                                                       |
| Immediate credential revocation                                       | PARTIALLY_IMPLEMENTED       | Local disconnect deletes the encrypted refresh-token envelope and audits. On compromise, an operator must revoke/rotate in Amazon too.                                                                                                                                                   |
| TLS/encrypted infrastructure                                          | PARTIALLY_IMPLEMENTED       | Supported profile permits TLS 1.2/1.3, fixes Node TLS 1.2+, requires PostgreSQL verify-full, Redis TLS, HTTPS storage/origins/callbacks/monitoring, and allowlisted Amazon endpoints. Live certificates/protocol and storage/backup/device encryption still require deployment evidence. |
| WAF and 15-minute workstation lock                                    | EXTERNAL_OPERATION_REQUIRED | The app has a 15-minute idle timeout and durable limits. A real WAF and managed-device screen lock are external controls.                                                                                                                                                                |
| Network segmentation/private services                                 | PARTIALLY_IMPLEMENTED       | Standalone production profile separates EDGE/APPLICATION/DATA/SECURITY and publishes only edge TCP/443. Actual cloud ACL, host firewall, outbound policy, and external port scan remain deployment evidence.                                                                             |
| IDS/IPS and centralized SIEM                                          | EXTERNAL_OPERATION_REQUIRED | Integration/evidence requirements are documented; application logs and Nginx are not mislabeled as IDS/IPS. A real managed platform or Suricata/Wazuh-equivalent must be installed and verified.                                                                                         |
| Upload anti-malware                                                   | IMPLEMENTED                 | Upload processing fails closed. Scanner readiness checks ClamAV availability and a bounded signature age; scanner tests cover current and stale definitions.                                                                                                                             |
| Host/server/endpoint anti-malware                                     | EXTERNAL_OPERATION_REQUIRED | ClamAV upload scanning does not prove tamper-protected protection on hosts/endpoints. Install, update, monitor, and evidence the actual agent at least monthly.                                                                                                                          |
| Security headers                                                      | IMPLEMENTED                 | CSP, HSTS, MIME sniffing, no-referrer, permissions policy, frame denial, Secure/HttpOnly cookies, HTTPS redirect, and insecure API rejection are configured and tested.                                                                                                                  |
| Secret-manager injection                                              | PARTIALLY_IMPLEMENTED       | Browser/build scans reject named secret families and the supported profile consumes process-injected values without committed secrets. The real secret manager/KMS identity and access policy require deployment evidence.                                                               |
| Incident response plan, IMPOC, phases and Amazon 24-hour procedure    | IMPLEMENTED                 | `INCIDENT_RESPONSE_PLAN.md` defines roles, severity, phases, incident playbooks, current official notification address verification, an authorization-only template, and a tenant incident deadline record. Human approval/contact roster remain operational.                            |
| Structured application security events and retention                  | IMPLEMENTED                 | Tenant events include outcome/source/correlation, sanitized context and a 12-month minimum deadline; alert/control/incident records are separate and tested. Central SIEM retention still requires deployment evidence.                                                                  |
| Log review, scans, penetration tests, training and recovery exercises | EXTERNAL_OPERATION_REQUIRED | The application records named review evidence and reports overdue controls; real bi-weekly/monthly/quarterly/annual work must be performed and attested.                                                                                                                                 |

No control is marked implemented merely because documentation describes it.

Network trust boundaries, the firewall dry-run, WAF/IDS choices, malware
health, at-rest coverage, secret injection, port verification, dated external
attestation, and the three-state questionnaire mapping are maintained in
[Amazon network security](AMAZON_NETWORK_SECURITY.md).

## Least-privilege roles

| Permission family                                      | Owner | Admin | Researcher | Viewer |
| ------------------------------------------------------ | :---: | :---: | :--------: | :----: |
| Manage organization                                    |  Yes  |  No   |     No     |   No   |
| Manage users/security/provider connections/credentials |  Yes  |  Yes  |     No     |   No   |
| Run research and wholesale scans                       |  Yes  |  Yes  |    Yes     |   No   |
| View research                                          |  Yes  |  Yes  |    Yes     |  Yes   |
| View financials and export                             |  Yes  |  Yes  |    Yes     |   No   |
| View audit log                                         |  Yes  |  Yes  |     No     |   No   |

The UI hides actions for usability, but the proxy and sensitive handlers are
the boundary. Organization/membership scope is server-derived; a client-supplied
organization ID never grants authority.

## Operator procedures

### User onboarding

1. An OWNER/ADMIN creates a named user in **Settings → Security** with a unique
   personal email, explicit role, and compliant temporary password.
2. Transfer it through a protected channel, never an issue, log, argument,
   source file, or chat transcript.
3. First login requires replacement and TOTP enrollment/confirmation. Recovery
   codes appear once and belong in an approved password manager.
4. Confirm the account, role, MFA, and audit events. There is no generic default
   administrator account.

### Termination or role change

Within 24 hours—and immediately when possible—record REMOVE_ACCESS or
CHANGE_ROLE in the access review. Removal invalidates sessions and epoch.
Separately revoke infrastructure, Seller Central, secret-manager, source-control,
and support identities because they are outside RizPoint.

### Quarterly review

At least every 90 days, review every active user in **Settings → Security** and
deliberately record APPROVED, REMOVE_ACCESS, or CHANGE_ROLE with a reason. An
unchanged page or elapsed date is not a completed review. Review deployment and
service identities separately.

### MFA reset

Verify identity out of band before a privileged reset and record a non-sensitive
reason. Reset disables the factor, destroys unused recovery-code hashes,
increments the session epoch, and revokes all sessions. The user must enroll a
new factor next login.

### SP-API and key rotation

1. Review Security Settings and Amazon/deployment expiry notices monthly.
2. Rotate by Amazon's notified deadline and at least annually; update only the
   secret manager, never `NEXT_PUBLIC_*`, Git, Compose literals, or browser input.
3. Validate a bounded live connection, then record type/key version in Security
   Settings. A record is evidence, not the rotation itself.
4. Re-encrypt stored envelopes in controlled maintenance before retiring an old
   encryption key.
5. On exposure, rotate/revoke immediately, disconnect locally, preserve
   non-secret evidence, and follow the incident/Amazon notification timeline.

## Amazon questionnaire mapping

These answers cover only the private RizPoint application as of the review date.
Use Amazon's exact current portal wording.

### Application questions that can truthfully be answered YES

- Passwords exceed 12 characters, meet mixed complexity, exclude identity
  terms, prevent last-ten reuse, and enforce one-day/365-day lifecycle.
- Every production application user must complete TOTP MFA.
- Ten failed attempts cause a durable, audited 30-minute lockout.
- Users have unique personal identities; generic default accounts are rejected.
- Explicit least-privilege roles and server permissions are enforced.
- Deactivation immediately revokes application sessions/access.
- Quarterly application-user reviews record reviewer, time, decision, reason.
- SP-API refresh tokens and TOTP secrets use versioned AES-256-GCM at rest;
  access tokens are not persisted.
- Application logs/audit omit passwords, MFA/recovery codes, tokens, and keys.
- The supported production profile exposes only edge TCP/443 and rejects
  insecure transport, unsafe Amazon endpoints, production demo mode, weak
  secrets, and stale/unavailable upload malware definitions.

### Must remain NO, partial, or deployment/operations dependent

- Real WAF, full-disk encryption, operating-system screen lock, SIEM, DLP,
  endpoint protection, and production KMS are not created by this repository.
- Review and 24-hour termination controls require timely human execution and
  separate revocation of service/external identities.
- Annual Amazon API/key rotation requires performing the real provider/secret
  manager operation; recording it in RizPoint is insufficient.
- Live TLS/certificates, firewall/ACLs, WAF, IDS/IPS, SIEM, host endpoint
  protection, storage/backup encryption, scans, penetration tests, third-party
  assessments, training, incident contact, insurance, and policy approvals need
  production evidence.
- RizPoint requests non-restricted Product Listing, Pricing, and Selling Partner
  Insights roles. Any restricted/PII role requires a new control review.

## Automated verification

- Unit: `apps/web/test/security-controls.test.ts`, `auth.test.ts`,
  `proxy.test.ts`, `runtime-config.test.ts`, and provider leakage/status tests.
- Database integration: `tests/integration/security-controls.integration.ts`
  covers concurrent lockout, TOTP, invalid MFA, one-use recovery, password
  reuse, inactive-user/tenant denial, deactivation, revocation, reset, and audit.
- Browser: `tests/browser/security.spec.ts` covers Settings, QR/manual setup,
  one-time recovery UX, browser-storage exclusion, DTO exclusion, and mobile.
- Deployment: `tests/security/amazon-deployment-security.test.mjs`,
  `apps/worker/test/runtime-config.test.ts`, scanner malware tests,
  `pnpm security:amazon:deployment-check`, and
  `pnpm security:amazon:ports` cover code-verifiable network controls.
- Gates: `pnpm verify`, `pnpm test:integration`, `pnpm test:browser`, and
  `pnpm release-gate:research`.

## Solution Provider Profile operational-security mapping

This maps the current public Amazon guidance families. The authenticated portal
wording and applicability decision remain authoritative when submitting. A
repository capability is `YES_SUPPORTED`; a control that requires current real
deployment/people evidence is `YES_AFTER_OPERATIONAL_ATTESTATION`; a missing
control is `NO_NOT_COMPLETE`.

| Security question/control family                                                                                       | Answer                            | Evidence boundary                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Formal incident-response plan with preparation, identification, containment, eradication, recovery and lessons learned | YES_SUPPORTED                     | Versioned `INCIDENT_RESPONSE_PLAN.md` and tenant incident records. Owner approval/exercise is still operational.                                          |
| Defined IMPOC, Incident Commander, technical responder and management owner                                            | YES_SUPPORTED                     | Roles/responsibilities defined; current private contact roster must be attested.                                                                          |
| Notify Amazon within 24 hours of a detected incident                                                                   | YES_SUPPORTED                     | Official address verified 2026-08-29; incident deadline is calculated and notification time/reference recorded; sending requires authorized human review. |
| Incident plan senior approval and review every six months/after changes or lessons                                     | YES_AFTER_OPERATIONAL_ATTESTATION | Review records and overdue gate exist; first real approval/review remains pending.                                                                        |
| Annual formal risk assessment and senior review                                                                        | YES_AFTER_OPERATIONAL_ATTESTATION | Risk register/process exists; formal owner review has not yet occurred.                                                                                   |
| Unique accounts, least privilege, MFA, lockout and password controls                                                   | YES_SUPPORTED                     | Application-enforced and tested by Prompt 36G.                                                                                                            |
| Remove terminated/changed access within 24 hours                                                                       | YES_AFTER_OPERATIONAL_ATTESTATION | Application revocation is immediate once submitted; timely human action and external/service identity removal require evidence.                           |
| Quarterly personnel and service-access review                                                                          | YES_AFTER_OPERATIONAL_ATTESTATION | Application-user recording is implemented; current user and external service review must be performed.                                                    |
| TLS 1.2+, firewall/ACL, segmentation, WAF and IDS/IPS                                                                  | YES_AFTER_OPERATIONAL_ATTESTATION | Code-ready profile is fail-closed; real deployment must be inspected.                                                                                     |
| Current tamper-protected antivirus on every server/endpoint and monthly updates                                        | YES_AFTER_OPERATIONAL_ATTESTATION | Upload ClamAV is enforced; host/endpoint protection remains external.                                                                                     |
| Centralized security logs, log integrity and all access-channel coverage                                               | YES_AFTER_OPERATIONAL_ATTESTATION | Structured tenant events exist; real edge/app/database/storage/WAF/endpoint SIEM collection and integrity need deployment proof.                          |
| Security logs retained at least 12 months                                                                              | YES_AFTER_OPERATIONAL_ATTESTATION | Database security events have a 12-month minimum deadline; full centralized production-source retention needs storage-policy evidence.                    |
| Real-time automated or bi-weekly manual security-log review                                                            | YES_AFTER_OPERATIONAL_ATTESTATION | Alerts/review records/14-day overdue checks exist; a real review has not been attested.                                                                   |
| Detect unauthorized API calls, request-rate anomalies and exfiltration                                                 | YES_AFTER_OPERATIONAL_ATTESTATION | Amazon 401/403/429 and request-rate alerts are supported; full SIEM/DLP/exfiltration/dark-web coverage remains external.                                  |
| Monthly vulnerability scan of every system processing/storing Amazon Information                                       | YES_AFTER_OPERATIONAL_ATTESTATION | CI scans code/dependencies/configuration; live hosts, endpoints, networks, APIs, data services and images need monthly evidence.                          |
| Scan code before releases                                                                                              | YES_SUPPORTED                     | Dependency audit, private-asset/secret scan, CodeQL, Trivy, tests and release gates are configured.                                                       |
| Critical remediation within 7 days and high within 30 days                                                             | YES_SUPPORTED                     | Policy, release audit and overdue evidence gate enforce the workflow; actual future cases require timely operational closure.                             |
| Annual qualified external/internal penetration test including APIs                                                     | YES_AFTER_OPERATIONAL_ATTESTATION | Scope and record are defined; no qualified annual test evidence exists yet.                                                                               |
| Quarterly backup/recovery test with RPO/RTO                                                                            | YES_AFTER_OPERATIONAL_ATTESTATION | Isolated test procedure and record exist; no current quarterly exercise evidence exists.                                                                  |
| Geographically appropriate secondary backups/site with RPO/RTO                                                         | YES_AFTER_OPERATIONAL_ATTESTATION | Architecture requires it; managed backup deployment must prove it.                                                                                        |
| Annual Amazon API credential and encryption-key rotation                                                               | YES_AFTER_OPERATIONAL_ATTESTATION | Inventory/deadlines/records exist; actual Amazon/secret-manager rotation must be performed.                                                               |
| Annual security-awareness training for approved users                                                                  | YES_AFTER_OPERATIONAL_ATTESTATION | Calendar/record exists; no current training evidence is claimed.                                                                                          |
| Annual third-party/vendor risk assessment                                                                              | YES_AFTER_OPERATIONAL_ATTESTATION | Provider rights and risk process exist; real annual review remains pending.                                                                               |
| Asset/device inventory and quarterly review                                                                            | YES_AFTER_OPERATIONAL_ATTESTATION | Architecture/data inventory exists; live systems/endpoints need current operational inventory.                                                            |
| Encrypted databases, object storage, backups, logs, servers and endpoint disks                                         | YES_AFTER_OPERATIONAL_ATTESTATION | Application credential encryption/TLS are supported; real at-rest platforms need proof.                                                                   |
| KMS lifecycle, secure key generation/access/revocation                                                                 | YES_AFTER_OPERATIONAL_ATTESTATION | Key-version architecture is supported; managed KMS/IAM/rotation evidence is external.                                                                     |
| PII retention/deletion within applicable Amazon limits                                                                 | NO_NOT_COMPLETE                   | RizPoint currently requests non-restricted roles and minimizes PII. A complete restricted-PII deletion lifecycle is not claimed.                          |
| DLP, dark-web monitoring and data-exfiltration detection                                                               | NO_NOT_COMPLETE                   | Not provided by the repository; select/deploy and attest real services before answering yes.                                                              |
| Managed endpoint policy/MDM and prohibition of personal-device storage                                                 | YES_AFTER_OPERATIONAL_ATTESTATION | Required by policy/runbook, but real managed-device enforcement is not yet verified.                                                                      |
| Formal change control and segregation of duties for PII systems                                                        | NO_NOT_COMPLETE                   | Single-owner private operation cannot fully demonstrate independent segregation; compensating review is not equivalent.                                   |
| Secure disposal of printed PII                                                                                         | YES_AFTER_OPERATIONAL_ATTESTATION | Operational policy applies if printed PII exists; no repository control can prove disposal.                                                               |
| Annual qualified third-party security assessment                                                                       | YES_AFTER_OPERATIONAL_ATTESTATION | Required by the calendar; no current assessment evidence is claimed.                                                                                      |

Prompt 37 is outside this mapping and has not started.
