# Expanded platform security audit

Audit date: 2026-08-20

Scope: Prompt 34 research platform and preserved wholesale workflow

## Result

The inspected private-platform boundary is suitable for the current
single-owner deployment model after the controls in this prompt. This is not a
claim of third-party certification or a legal opinion. Multi-tenant commercial
release still requires roles/admin authorization, formal deletion operations,
edge denial-of-service controls, dependency/container scanning in deployment,
and review of each provider contract.

## Coverage

| Area                                | Finding/control                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth/session                        | Scrypt password verifier; secure Auth.js cookie; membership and session-epoch revalidation; production fails closed                              |
| Tenant isolation/IDOR/cross-project | Server-owned organization context and tenant-scoped parent-child repository checks; cross-tenant integration and denied-route tests              |
| Provider credentials                | Encrypted envelopes, worker-only decryption, status projections exclude secret fields                                                            |
| Extension auth                      | Audience/version/time-bound token; session-only token storage; HTTPS/loopback backend origin; no Amazon DOM/cookie access                        |
| Object storage/raw evidence         | Private bucket, tenant-prefixed keys, signed short-lived operations, private raw references and bounded retention                                |
| Logs                                | Structured allowlisted metadata and credential-shaped redaction; no provider URLs with query secrets                                             |
| Exports                             | Shared spreadsheet neutralization; raw payload exclusion; Explorer field redaction and fail-closed wholesale financial-export rights             |
| Imported reviews/files              | Authorized inputs only, review text minimization/deduplication, file signature/size/archive bounds, fail-closed malware scan                     |
| Prompt injection                    | Imported instruction-like text is untrusted; Copilot uses allowlisted tools, bounded results, citations, and no arbitrary SQL/mutation           |
| SSRF                                | Server outbound destinations are configuration/provider controlled; production endpoint checks; companion URL is parsed but never server-fetched |
| Rate-limit abuse                    | Durable tenant/scope/principal-hash buckets on high-risk research/upload/session-adjacent endpoints                                              |
| Background jobs                     | Transactional outbox, deterministic IDs, leases, state predicates, bounded retry/concurrency, prior data preserved on failures                   |
| Retention/deletion                  | Contractual provider retention, bounded workers, report-first destructive mode, explicit current deletion limitation                             |
| Secret scanning                     | Repository/private-file checks plus credential patterns and browser/extension build-output markers                                               |
| Provider licensing                  | Internal-vs-redistributable scope, export policy/allowlist, terms version/reference, effective/expiry window, retention and audit event          |

## Acceptance evidence

- Browser and extension output checks reject known server credential markers and
  credential-shaped literals.
- Cross-tenant tests cover provider-right reads/writes, rate-limit buckets,
  research projects, history, Explorer, and wholesale exports.
- The Manifest V3 extension requests only `storage` and `sidePanel`, with four
  explicit Amazon host patterns and no wildcard, tabs, activeTab, cookies,
  clipboard, or identity permission.
- Provider export decisions fail closed and support field-level allowlists.

See [Threat model](THREAT_MODEL.md), [Data classification](DATA_CLASSIFICATION.md),
[Provider data rights](PROVIDER_DATA_RIGHTS.md), and
[Privacy/retention](PRIVACY_RETENTION.md).
