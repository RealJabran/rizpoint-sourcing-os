# Amazon production security verification

Verification date: 2026-08-31  
Verification scope: Prompt 36L  
Repository release: `342bb22`  
Result: **NOT VERIFIED — production deployment not available**

Re-verification on 2026-08-31 produced the same result. Amazon's current
official Key Security Control Guidance was checked again before running the
repository gates; the applicable requirements have not weakened.

This is a sanitized verification summary. It is not deployment evidence and it
does not support changing either rejected Amazon Developer Profile answer to
**Yes**.

## Production deployment identification

| Field                    | Verified value                                                |
| ------------------------ | ------------------------------------------------------------- |
| Production hostname      | Not supplied or discoverable                                  |
| Deployment provider/type | Not supplied or discoverable                                  |
| Deployment date          | Not supplied or discoverable                                  |
| Application release      | Repository under review: `342bb22`                            |
| Production OS/runtime    | Not available for inspection                                  |
| Production topology      | No running `compose.production.yaml` deployment was available |

The reachable application at `localhost:3000` is the loopback-only development
stack. Prompt 36L explicitly excludes localhost from internet-facing evidence,
so no local result was promoted to production proof.

## Verification performed

- Reviewed the current official Amazon registration and Key Security Control
  guidance referenced by the repository. The guidance retrieved on 2026-08-31
  still requires TLS 1.2 or higher across applicable network boundaries and
  deployed network segmentation, firewalls/ACLs, IDS/IPS, and current
  anti-malware protection.
- Confirmed the 36K repository production topology and fail-closed controls are
  present at release `342bb22`.
- Ran `pnpm security:amazon:profile-readiness`. Result:
  `READY_FOR_YES=8`, `MANUAL_VERIFICATION_REQUIRED=13`, `NOT_READY=0`,
  `OVERALL=MANUAL_VERIFICATION_REQUIRED`.
- Ran `pnpm security:amazon:deployment-check -- --live --strict` without
  substituting local development configuration. It exited non-zero with 25
  static passes, 18 live-runtime failures, and 17 missing external evidence
  checks.
- Confirmed that no production Compose services, production hostname,
  secret-injected runtime, signed operator attestation, signed deployment
  report, or private evidence package was available in the current execution
  environment.

No external port scan, public TLS scan, firewall inspection, segmentation
probe, IDS/IPS alert test, EICAR anti-malware test, WAF validation, SIEM receipt
test, or internal TLS probe was run because there was no identified production
target. Inventing a target or testing an unrelated host would not be valid
evidence.

## Control outcome

| Control               | Repository ready | Deployment verified | Remaining evidence                                                             |
| --------------------- | :--------------: | :-----------------: | ------------------------------------------------------------------------------ |
| Host/cloud firewall   |       Yes        |         No          | Effective rules plus external port scan                                        |
| Network segmentation  |       Yes        |         No          | Active permitted/denied flow tests                                             |
| WAF                   |       Yes        |         No          | Active managed rules and harmless validation event                             |
| IDS/IPS               |       Yes        |         No          | Service/rule health, protected interface, test alert and SIEM receipt          |
| Endpoint anti-malware |       Yes        |         No          | Current definitions, scheduled/on-access protection and harmless isolated test |
| Public TLS            |       Yes        |         No          | Real hostname, trusted certificate, TLS 1.2/1.3 and legacy rejection scan      |
| Internal TLS          |       Yes        |         No          | Edge/application/data/provider/monitoring path probes                          |
| Database TLS          |       Yes        |         No          | Live `verify-full` connection evidence                                         |
| Redis TLS             |       Yes        |         No          | Live verified `rediss://` connection evidence                                  |
| Storage TLS           |       Yes        |         No          | Live private HTTPS object-storage connection evidence                          |
| Security monitoring   |       Yes        |         No          | Active TLS log ingestion and alert receipts                                    |

## Questionnaire decision

NETWORK_SECURITY_QUESTION:  
NO_NOT_SUPPORTED

The repository supplies the deployment controls, but no actual firewall,
network ACL, segmentation, WAF, IDS/IPS, endpoint anti-malware, or centralized
monitoring deployment was available for verification.

ENCRYPTION_IN_TRANSIT_QUESTION:  
NO_NOT_SUPPORTED

The production profile requires end-to-end TLS, but no real public endpoint or
secret-injected production environment was available to verify public TLS,
edge-to-application mTLS, PostgreSQL `verify-full`, Redis TLS, storage HTTPS,
Amazon/LWA TLS, or encrypted monitoring transport.

## Exact action required to resume Prompt 36L

Deploy the supported production profile by following
`deploy/amazon-production/README.md`, or provide access to the existing real
deployment through an approved non-secret operator session. The verifier needs:

1. the production HTTPS hostname and deployment provider/type;
2. read-only access to the host and cloud firewall/WAF/network control planes;
3. read-only access to Suricata, anti-malware and SIEM health/evidence;
4. the secret-injected runtime in which to execute the live strict checker;
5. paths to the current signed operator attestation, detached signature and
   trusted Ed25519 public key; and
6. an approved private output location for
   `amazon-security-evidence/2026-08-31/`.

Do not send credentials, private keys, refresh tokens, or unrestricted cloud
access in chat. Use the approved host session and secret-manager boundary.
