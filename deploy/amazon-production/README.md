# RizPoint Amazon production deployment

This is the one supported, low-maintenance private SP-API deployment path. It
prepares a single hardened Debian/Ubuntu Linux host for RizPoint containers,
uses managed private PostgreSQL, Redis and object storage, and relies on a
managed WAF and SIEM. It is automation, not evidence that any control is live.
Prompt 36L must inspect the real deployment before the rejected Amazon answers
can change to **Yes**.

## Trust boundary and prerequisites

Read `docs/AMAZON_NETWORK_SECURITY.md` first. Required external services are:

- a Linux host with recoverable provider console/session-manager access;
- a DNS name and trusted public certificate (or managed edge certificate);
- private PostgreSQL with hostname verification and encrypted storage/backups;
- private TLS Redis;
- private HTTPS object storage with KMS encryption/versioning/lifecycle;
- a managed WAF in front of TCP/443;
- a TLS-ingesting SIEM with alerting and at least the applicable Amazon log
  retention; and
- an approved secret manager. The example below uses 1Password `op run`, but
  Vault, Doppler or a cloud secret manager is acceptable.

The deployment host must have Docker Engine, Compose v2, OpenSSL 3, Node 22,
PNPM 11, UFW, Suricata, ClamAV/freshclam, rsyslog-gnutls, auditd and chrony.

## Ordered workflow

1. Create a private change record and confirm provider console recovery works.
2. Copy `config/production.env.tpl` to a **private operations vault**, replace
   references with the approved secret-manager paths, and never commit it.
3. Generate the internal CA and mTLS leaf certificates on an approved admin
   workstation with `tls/generate-internal-pki.sh`. Store the CA private key
   offline/in the secret manager; deploy only the CA certificate and required
   leaf certificate/key pairs with mode `0400`/`0444`.
4. Review firewall output: `sudo ./firewall.sh plan`, then `validate`. Apply
   only from provider console with the confirmations described by the script.
5. Review `host-controls.sh plan`, then apply the Suricata, ClamAV, audit/time,
   update and TLS-SIEM baseline from recoverable console access.
   Run its explicit `test-alert` mode after notifying monitoring, and confirm
   the harmless Suricata alert reached the SIEM before attesting IDS health.
6. Configure the managed WAF using `waf/README.md`; keep raw request bodies,
   cookies, authorization headers and provider payloads out of WAF logs.
7. Build immutable images in CI. Inject secrets without Compose `.env` loading:

   ```bash
   COMPOSE_DISABLE_ENV_FILE=1 op run --env-file=/private/rizpoint-production.env -- \
     docker compose --env-file /dev/null -f compose.production.yaml up -d --build
   ```

8. Run `./validate-host-security.sh`, `./tls/check-certificates.sh`, and
   `pnpm security:amazon:ports -- --host=<public-host> --allow=443` from an
   external network.
9. Create, sign and retain the sanitized deployment report outside Git using
   the strict command documented in `docs/AMAZON_NETWORK_SECURITY.md`. Import
   that signed report in **Settings → Security → Amazon Compliance**.
10. Prompt 36L independently verifies the real server, cloud ACL/WAF, SIEM,
    endpoint coverage and every TLS path. Until then the application stays
    `EXTERNAL_ACTION_REQUIRED`.

`host-controls.sh` supports `plan`, `apply`, `validate`, and explicit
`rollback`; `firewall.sh` provides the same recovery-oriented lifecycle.
`validate-host-security.sh` is the combined host check. See `cloud-acl.md` and
`waf/README.md` for controls that must be implemented in the selected provider.

## Updates, backup and rollback

- Apply OS security updates at least monthly and critical fixes within the
  documented SLA. Rebuild/redeploy pinned images; do not patch containers.
- Run `suricata-update` daily and freshclam continuously. The validation script
  fails stale signatures/rules and inactive services.
- Run the existing encrypted PostgreSQL backup and isolated restore procedure.
- Before application updates, retain the previous image digests and sanitized
  deployment report. Roll back with the prior immutable digests, then rerun all
  validators.
- `firewall.sh rollback <backup-directory>` and
  `host-controls.sh rollback <backup-directory>` require explicit confirmation.
  They never run automatically.

No script in this directory changes an Amazon questionnaire answer.
