# Security

## Threat model and boundaries

The browser is untrusted. Web routes enforce an organization context before querying or mutating tenant-owned state. PostgreSQL is canonical; Redis is transient queue transport. Scanner and object storage are private services.

## Phase 0 controls

- Environment templates contain placeholders only; all real `.env*` files are ignored and CI rejects them.
- Supplier files, exports, local object-store data, and test-private fixtures are ignored.
- Every tenant-owned query is scoped by `organization_id`. Phase 0 mock routes require explicit local-demo opt-in and must not be exposed as an authentication substitute.
- MinIO is configured as a private bucket; future uploads use short-lived signed URLs.
- The worker records only synthetic metadata in Phase 0 and redacts credential-shaped error text before logging.
- External provider contracts require provenance/freshness and never expose credential fields to the browser.
- CI rejects spreadsheets outside the synthetic fixture allowlist, preventing accidental supplier-catalog commits.

## Required before real uploads

- Enforce file type/size limits and antivirus scanning.
- Preserve leading-zero identifiers and reject unsafe formulas on export (`=`, `+`, `-`, `@`).
- Encrypt provider credentials at rest with rotation support.
- Add authentication, authorization tests, audit logging, retention/deletion controls, and operational incident procedures.
