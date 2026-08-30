# Managed WAF deployment requirement

Place a professionally maintained managed WAF in front of the RizPoint HTTPS
edge. The supported baseline requires the provider's current OWASP managed rule
set, per-IP and per-principal request-rate rules, bot/abuse protection, and
additional authentication and administration-path protection. The origin must
accept TCP/443 only from the WAF/proxy egress ranges, with a separate private
administration path.

WAF logs must redact or omit request bodies, cookies, authorization headers,
OAuth codes, supplier content and provider payloads. Send rule/action metadata
to the TLS SIEM. Test in log/count mode, review false positives, then enforce.
Export the provider rule-set version, origin ACL, enforcement mode, test result
and dated change ticket as private deployment evidence. A README or DNS proxy
setting is not evidence that the WAF is installed.
