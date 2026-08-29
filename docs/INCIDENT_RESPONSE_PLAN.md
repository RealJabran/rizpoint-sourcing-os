# RizPoint incident response plan

Amazon SP-API security plan version: **1.0**

Plan owner: **RizPoint LLC Owner / Incident Management Point of Contact**

Approved by: **PENDING — owner approval must be recorded as operational evidence**

`approved_at`: **PENDING**

`last_reviewed_at`: **PENDING — this document is not itself review evidence**

`next_review_due`: **six months or less after recorded approval/review**
Authoritative guidance reviewed: **2026-08-29**

This plan protects RizPoint, Amazon Information, SP-API access, provider
credentials, supplier information, and supporting systems. The private contact
roster containing names, telephone numbers, alternate channels, insurance and
legal contacts must be stored in the approved private operations vault—not Git.

Run `pnpm security:amazon:audit`. A missing or overdue six-month review remains
`MANUAL_EVIDENCE_REQUIRED` or `FAIL`; the application never marks a review
complete because time passed or this file exists.

## Authority and roles

For the current single-owner organization the RizPoint LLC Owner may hold all
roles, but must deliberately acknowledge each responsibility during an incident.
Delegates require individual accounts, MFA, least privilege, and a current
private contact roster.

| Role                                         | Current assignment                             | Authority and responsibility                                                                                         |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Incident Management Point of Contact (IMPOC) | RizPoint LLC Owner                             | Maintains contact details, receives reports, starts the clock at detection, owns Amazon notification and escalation. |
| Incident Commander                           | RizPoint LLC Owner unless formally delegated   | Declares severity, coordinates phases, approves containment, owns the timeline and preserves decision authority.     |
| Security/technical responder                 | RizPoint LLC Owner or approved named responder | Preserves evidence, contains access, rotates/revokes credentials, restores safely, and records technical findings.   |
| Business/management owner                    | RizPoint LLC Owner                             | Approves material downtime, legal/customer communications, costs, risk acceptance, recovery and closure.             |

No responder may auto-send an external notification, destroy evidence, restore
over production, or conceal an incident. The Incident Commander may stop web
mutations, provider access, exports, and workers when containment requires it.

## Official Amazon notification requirement

Amazon's current Key Security Control Guidance, checked 2026-08-29, requires
notification to **security@amazon.com within 24 hours of detecting a security
incident**. RizPoint applies this requirement whenever Amazon Information or
SP-API access/credentials may be involved. The IMPOC must confirm the address
against the current official policy immediately before sending.

At identification, create a tenant-scoped `SecurityIncident` record. Record:

- detection time and timezone;
- the automatically calculated notification deadline;
- whether Amazon Information or SP-API access may be involved;
- responsible IMPOC/Incident Commander;
- notification time;
- Amazon incident/case reference; and
- whether notification met the deadline.

Uncertainty does not stop the 24-hour clock. Send an accurate preliminary notice
after authorized human review and follow with updates. Never include refresh or
access tokens, passwords, MFA codes, encryption keys, unnecessary personal data,
supplier files, or unrestricted raw payloads.

### Prepared human-reviewed notification template

```text
To: security@amazon.com
Subject: SP-API security incident notification — RizPoint LLC — [incident reference]

Detection time (UTC):
Notification deadline (UTC):
Incident contact and secure callback channel:
Application / Solution Provider identifier:
Affected marketplace(s), if known:
Concise incident description:
Amazon Information or SP-API access potentially involved:
Known time window and scope:
Containment already completed:
Credentials revoked/rotated, if applicable:
Current customer/operational impact:
Next update time:

This notice excludes credentials, tokens, buyer PII, supplier contents, and raw provider payloads.
```

This template must never be sent automatically. The IMPOC and business owner
must review accuracy and approve transmission through an authorized channel.

## Severity

| Severity  | Definition                                                                                                                                                                     | Initial response target                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **SEV-1** | Confirmed or credible active exposure of Amazon Information/credentials, destructive compromise, ransomware, widespread unauthorized access, or material inability to contain. | Immediate paging; Incident Commander and IMPOC engaged now. |
| **SEV-2** | High-probability compromise or contained material security failure with limited known scope.                                                                                   | Engage within one hour.                                     |
| **SEV-3** | Suspicious or localized event requiring investigation without evidence of material exposure.                                                                                   | Same business day.                                          |
| **SEV-4** | Low-risk event, policy exception, blocked attempt, or security observation.                                                                                                    | Triage within two business days.                            |

Any event potentially involving Amazon Information or SP-API access follows the
24-hour notification assessment regardless of severity label.

## Incident phases

### PREPARATION

- Maintain the private contact/escalation roster and alternate communication.
- Keep individual MFA accounts, least privilege, recovery access, asset and key
  inventories, encrypted backups, logging/SIEM, endpoint protection and current
  restore instructions.
- Exercise non-production recovery quarterly and this plan at least every six
  months.
- Preserve a synchronized UTC time source and correlation IDs.

### IDENTIFICATION

- Record the earliest defensible detection time; do not substitute the later
  confirmation time.
- Open a `SecurityIncident`, assign Incident Commander/IMPOC, severity, affected
  tenant/deployment and non-sensitive summary.
- Preserve relevant logs, release SHA, provider request IDs, object versions,
  alert IDs and system snapshots with access-controlled chain-of-custody notes.
- Determine whether Amazon Information or SP-API access may be involved and set
  the 24-hour deadline immediately.

### CONTAINMENT

- Prefer reversible isolation: disable identities, revoke sessions, block
  egress, pause provider jobs/exports, isolate devices and preserve evidence.
- Revoke/rotate exposed credentials from a known-clean device and secret store.
- Do not silently fall back to mock data or replace missing evidence with zero.
- Obtain Incident Commander approval before destructive containment unless
  immediate action is essential to stop active harm.

### ERADICATION

- Remove malicious persistence, vulnerable dependencies, unauthorized users,
  leaked secrets and unsafe artifacts.
- Patch root cause; scan affected systems; validate IAM, network, database,
  object storage, CI and endpoint configurations.
- Rebuild from reviewed immutable artifacts when trust cannot be established.

### RECOVERY

- Restore only to an isolated target first; never restore over production.
- Validate tenant isolation, MFA, credential versions, data integrity, mock/live
  origin, provider capability and audit pipeline before reopening.
- Monitor for recurrence and document actual RPO/RTO.
- Business owner approves return to service; unresolved SEV-1 risk blocks it.

### POST-INCIDENT REVIEW

- Within ten business days, document timeline, root cause, scope, decisions,
  notifications, effectiveness, RPO/RTO, gaps and assigned corrective actions.
- Reconcile Amazon/customer/legal follow-ups and evidence retention.
- Update this plan after lessons learned and schedule control verification.
- Never rewrite the original incident timeline; append corrections.

## Incident-specific playbooks

### SP-API credential or provider-token exposure

Disable provider execution; revoke or rotate LWA client secret/refresh token and
encryption keys as appropriate; invalidate cached authorization state; inspect
provider request telemetry for unexpected calls; preserve key-version history;
validate marketplace access; notify Amazon within 24 hours when SP-API access may
be involved. Access tokens remain memory-only and must never be copied to the
incident record.

### Amazon Information exposure

Stop the exposed access path and exports, determine tenants/data classes/time
window, preserve access records without copying payloads, evaluate legal and
customer duties, notify Amazon within 24 hours, securely remove unauthorized
copies, validate deletion and monitor exfiltration signals.

### Database compromise

Isolate application/database connectivity, revoke identities and secrets,
capture managed-service/security evidence, determine tenant and table scope,
restore to an isolated environment, verify point-in-time integrity and rotate
affected keys before controlled recovery.

### Object-storage exposure

Block bucket/policy/public access, revoke signing/storage credentials, preserve
access logs and object versions, determine exposed keys/classes, expire signed
URLs, validate encryption/versioning/lifecycle, and notify Amazon if Amazon
Information may have been accessed.

### Malware

Quarantine the upload/device/host, stop processing, preserve hashes and scanner
metadata, update detection signatures, scan adjacent systems and do not release
the artifact. ClamAV upload scanning is not a substitute for host/endpoint
response.

### Unauthorized user or administrative access

Disable the individual account and sessions, preserve authentication/MFA/access
denial/admin events, review effective permissions and recent exports/provider
actions, reset MFA/password through a privileged audited procedure, and perform
an immediate access review.

### Git or secret leak

Treat the secret as compromised even after deletion. Revoke/rotate first,
identify clones/build logs/artifacts, remove from history only with reviewed
coordination, run repository and browser-bundle secret scans, invalidate builds
and document the exposure window.

### Lost administrative device

Use endpoint management to lock/wipe, disable sessions and device credentials,
rotate locally accessible secrets, review recent access, confirm encrypted disk
and screen-lock state, and do not reconnect the device until rebuilt/cleared.

### Ransomware

Disconnect affected systems without destroying volatile evidence, invoke the
Incident Commander, preserve encrypted snapshots, prohibit unreviewed ransom
communication/payment, rotate credentials from a clean device, rebuild from
known-good artifacts and isolated tested backups, and monitor reinfection.

### Dependency or build compromise

Stop releases/deployments, pin and preserve the suspect lockfile/artifact/SBOM,
revoke build credentials, inspect CI provenance and maintainer advisories,
replace the dependency/artifact, rebuild in a clean environment and complete
SAST/dependency/secret/container scans before resuming.

## Communications and evidence

- Only the IMPOC/business owner authorizes Amazon, regulator, law-enforcement,
  insurer, vendor or customer communications.
- Use the private out-of-band channel when production identity systems may be
  compromised.
- Security logs use identifiers and metadata; never increase sensitive logging
  during an incident.
- Government/regulatory notification and customer communication are determined
  with qualified legal advice. This plan is not legal advice.

## Review and approval

Senior management/owner must approve and review this plan at an interval no
longer than six months. Also review it after a material incident, major
infrastructure or provider change, recovery exercise failure, or lessons
learned. A `SecurityControlRecord` of type
`INCIDENT_RESPONSE_PLAN_REVIEW` must name the reviewer, performed time, result,
next due date, findings/actions and private evidence reference. Do not update the
metadata above or mark a review complete without that record.
