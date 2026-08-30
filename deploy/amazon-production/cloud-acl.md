# Provider firewall / ACL baseline

Apply this independently of the host UFW policy:

- Internet/WAF to edge: TCP/443 only; ideally restrict the origin to managed
  WAF egress ranges.
- Administration to host: private session manager/VPN, or TCP/22 from one
  explicitly approved CIDR. Never `0.0.0.0/0` or `::/0`.
- Host to managed PostgreSQL, Redis, storage, SIEM, Amazon SP-API and LWA: only
  required TLS ports/destinations.
- No ingress to PostgreSQL, Redis, scanner, ClamAV, object administration,
  worker, metrics, Docker API, IDS/IPS or SIEM administration from the Internet.
- Deny other ingress and east-west flows; log denied administrative attempts.

Retain a sanitized rule export and an external port scan. Cloud UI screenshots
alone are insufficient if the rule targets or effective routes are unclear.
