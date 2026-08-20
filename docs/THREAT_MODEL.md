# Threat model

Last reviewed: 2026-08-20

## Scope and trust boundaries

The browser and Research Companion are untrusted clients. The Next.js web
service is the only public application boundary. PostgreSQL is canonical;
Redis carries retryable messages only. The worker, scanner, malware scanner,
database, metrics endpoint, and private S3-compatible storage remain on private
networks. Amazon and licensed data providers are external trust boundaries.

Protected assets include account sessions, organization data, provider
credentials, supplier files, imported reviews, raw provider evidence,
calculation evidence, exports, audit history, and provider contractual rights.
Provider data rights are security policy: a user who may view an internal-use
metric is not automatically entitled to redistribute it.

## Principal threats and controls

| Threat                              | Current control                                                                                                                                                                              | Verification                                            | Residual/operational requirement                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Session theft or replay             | Secure HttpOnly same-site Auth.js cookie, eight-hour JWT, membership and session-epoch revalidation on every protected request                                                               | `auth.test.ts`, `proxy.test.ts`                         | TLS and secret rotation remain deployment responsibilities                   |
| Cross-tenant/IDOR access            | Organization scope is supplied server-side; repositories validate parent and child organization ownership                                                                                    | research/provider integration tests and route tests     | Add role policy before multi-user self-service administration                |
| Credential disclosure               | Provider secrets use AES-256-GCM envelopes; status APIs exclude encrypted fields; workers decrypt only in memory                                                                             | provider runtime tests and browser-bundle secret scan   | Deployment secret manager and key rotation are required                      |
| Extension token theft               | Audience-bound 15-minute HMAC token, HTTPS/loopback backend origin validation, token in `storage.session`, no page DOM or cookies read                                                       | companion session, URL, and manifest tests              | Users must not paste tokens into third-party pages                           |
| Object enumeration                  | Private bucket, tenant-prefixed keys, short-lived signed operations, tenant/expiry checks before download                                                                                    | object-storage and export-route tests                   | Bucket policy, encryption, versioning, and lifecycle are deployment controls |
| Malicious uploaded file             | Size/type/signature/archive bounds and fail-closed ClamAV scanning before workbook parsing                                                                                                   | scanner and upload tests                                | Keep scanner signatures current                                              |
| Spreadsheet formula injection       | Text cells are neutralized after leading whitespace; numeric cells stay typed; export columns are allowlisted                                                                                | export-engine/scanner tests                             | New exporters must use the shared export engine                              |
| Prompt injection from imported text | Copilot uses allowlisted retrieval, bounded rows, citations, and sanitizes instruction-like imported content; models cannot issue SQL or mutations                                           | Copilot repository tests                                | Any future model adapter needs adversarial evals before enablement           |
| SSRF                                | Scanner and provider endpoints come from server configuration and are production-validated; companion URL is never fetched by RizPoint; its client backend origin requires HTTPS or loopback | runtime configuration and companion URL tests           | New URL-taking integrations require explicit egress allowlists               |
| Provider-data redistribution        | Entitlements default to `INTERNAL_ONLY` + `BLOCK`; effective/expiry windows and field allowlists are evaluated server-side; Product Explorer redacts blocked fields                          | provider-rights unit/integration and export route tests | Configure rights from an actually reviewed contract, never assumptions       |
| Rate-limit abuse                    | Durable tenant/scope/principal-hash buckets protect upload signing, Copilot, companion, and rights administration                                                                            | rate-limit unit/integration tests                       | Edge/WAF limits remain recommended for volumetric denial of service          |
| Queue replay or poisoning           | Transactional outbox, deterministic job IDs, tenant-scoped claims, leases, state predicates, bounded retries/concurrency                                                                     | worker/integration tests                                | Redis is not restored as canonical business state                            |
| Log/evidence leakage                | Structured allowlisted logs, credential-shaped redaction, private raw-evidence references, retention jobs                                                                                    | observability and private-asset checks                  | Operators must not add payload logging during incident debugging             |
| Stale or unlawful retention         | Contractual retention is required before live history ingestion; series and cache deadlines are explicit; deletion is bounded and auditable                                                  | market-history and retention tests                      | Destructive retention remains opt-in after backup/restore drill              |

## Abuse cases that must fail closed

- A tenant supplies another tenant's project, export, product, or entitlement ID.
- An entitlement is missing, internal-only, not yet effective, or expired.
- A provider field is absent from a field-level redistribution allowlist.
- A live history provider has no reviewed contractual retention period.
- A companion token has the wrong audience, excessive lifetime, invalid
  signature, future issue time, or exceeds the size bound.
- A production browser bundle contains a credential-shaped literal or a
  server-only credential environment marker.
- A provider, upload scanner, or object store is unavailable. The system must
  return unavailable/partial state and must not silently weaken the control.

## Security ownership

Engineering owns code controls and tests. The deployment owner owns TLS,
network isolation, secret storage, backup/restore drills, malware signature
updates, incident response, and provider-contract review. Legal/provider terms
must be reviewed by an authorized person; RizPoint stores the resulting policy
metadata but does not decide that a license permits redistribution.
