# Security

## Threat model and boundaries

The browser is untrusted. Web routes enforce an organization context before querying or mutating tenant-owned state. PostgreSQL is canonical; Redis is transient queue transport. Scanner and object storage are private services.

## Phase 1 controls

- Environment templates contain placeholders only; all real `.env*` files are ignored and CI rejects them.
- Supplier files, exports, local object-store data, and test-private fixtures are ignored.
- Every tenant-owned query is scoped by `organization_id`. Phase 0 mock routes require explicit local-demo opt-in and must not be exposed as an authentication substitute.
- MinIO is configured as a private bucket. Browser upload uses a five-minute signed URL and an origin-scoped local CORS rule.
- Uploads are limited to 50 MiB using object-store metadata before bytes are downloaded. CSV/XLS/XLSX filename and file signature must agree; XLSX archive expansion, sheet, row, and column limits reject rather than truncate.
- Inspection fails closed unless ClamAV reports a clean file. `MALWARE_SCAN_MODE=mock` is test-only and must not be used in a deployed environment.
- Spreadsheet values are treated as data, never formulas. Formula-like input cells are retained as source evidence and flagged; exports remain unimplemented and must escape them before delivery.
- The worker records only synthetic metadata in Phase 0 and redacts credential-shaped error text before logging.
- External provider contracts require provenance/freshness and never expose credential fields to the browser.
- CI rejects spreadsheets outside the synthetic fixture allowlist, preventing accidental supplier-catalog commits.

## Required before production rollout

- Add identity-aware authorization; the current demo organization is not production authentication.
- Reject unsafe formulas on export (`=`, `+`, `-`, `@`) when exports are implemented.
- Provider refresh tokens are encrypted at rest with AES-256-GCM and versioned `PROVIDER_CREDENTIAL_KEY_V1`; this key is server/worker-only and must be supplied by the deployment secret manager. Browser APIs expose connection status only, never token material.
- Add authentication, authorization tests, audit logging, retention/deletion controls, and operational incident procedures.
