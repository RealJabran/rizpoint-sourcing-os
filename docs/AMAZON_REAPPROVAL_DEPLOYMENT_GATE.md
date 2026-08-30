# Amazon SP-API re-approval deployment gate

Status: **CODE_READY — real deployment and independent verification pending**  
Reviewed: 2026-08-30  
Scope: the two rejected network-security and encryption-in-transit controls

This gate is deliberately not an Amazon questionnaire answer. Prompt 36K makes
the repository deployable and verifiable. Only Prompt 36L may inspect the real
host/cloud environment and decide whether evidence supports changing an answer
to **Yes**.

## Control state

| Control              | CODE_READY | DEPLOYED | VERIFIED | EXTERNAL_ACTION_REQUIRED |
| -------------------- | :--------: | :------: | :------: | :----------------------: |
| Firewall             |    Yes     |    No    |    No    |           Yes            |
| Network segmentation |    Yes     |    No    |    No    |           Yes            |
| WAF                  |    Yes     |    No    |    No    |           Yes            |
| IDS/IPS              |    Yes     |    No    |    No    |           Yes            |
| Anti-malware         |    Yes     |    No    |    No    |           Yes            |
| TLS public           |    Yes     |    No    |    No    |           Yes            |
| TLS internal         |    Yes     |    No    |    No    |           Yes            |
| Database TLS         |    Yes     |    No    |    No    |           Yes            |
| Redis TLS            |    Yes     |    No    |    No    |           Yes            |
| Storage TLS          |    Yes     |    No    |    No    |           Yes            |
| Security monitoring  |    Yes     |    No    |    No    |           Yes            |

“Code ready” means a deploy/validate/fail-closed path exists and has automated
repository tests. It does not mean a service is installed, licensed, healthy,
or protecting the RizPoint production system.

## Technical evidence now available

- `compose.production.yaml`: five trust zones, public edge-only port, internal
  edge-to-web mTLS, verified managed data transports, immutable/read-only
  application containers, resource/restart limits, secret mounts and journald.
- `deploy/amazon-production/`: ordered private deployment workflow; cloud ACL
  and managed WAF requirements; safe UFW lifecycle; Suricata; ClamAV/freshclam
  on-access plus scheduled scanning/quarantine; rsyslog TLS; audit/time/update
  services; internal PKI and certificate-age checks; combined host validation.
- `pnpm security:amazon:deployment-check`: static and live checks, public TLS
  and legacy-protocol probes, no plaintext production endpoints, signed dated
  operator attestation, and strict refusal to sign incomplete reports.
- **Settings → Security → Amazon Compliance**: owner-only, tenant-scoped import
  of signed sanitized verifier results. Unsigned, altered, stale, manual or
  incomplete evidence cannot become verified.

## Smallest owner deployment action

Provision one recoverable Debian/Ubuntu production host plus private managed
PostgreSQL, TLS Redis and HTTPS/KMS object storage. Put a managed WAF in front
of TCP/443 and provision a TLS SIEM. Store all keys/secrets in an approved
secret manager. From provider-console access, follow
`deploy/amazon-production/README.md` exactly and retain outputs in the private
operations vault. Do not run the firewall apply mode from an unrecoverable SSH
session.

After deployment, request Prompt 36L with access to the real host/cloud control
planes. It must inspect effective firewall/ACL routes, port reachability,
Suricata alerting, malware health/signatures/quarantine, WAF/SIEM enforcement,
public/internal/provider/data/storage/monitoring TLS, secret identities,
certificate renewal and actual signed output. Until that succeeds, both
previously rejected questionnaire controls remain deployment-dependent.
