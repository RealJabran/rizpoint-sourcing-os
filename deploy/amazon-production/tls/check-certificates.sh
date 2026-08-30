#!/usr/bin/env bash
set -euo pipefail

public_host="${RIZPOINT_PUBLIC_HOST:-}"
public_port="${RIZPOINT_PUBLIC_PORT:-443}"
internal_ca="${RIZPOINT_INTERNAL_CA_FILE:-/run/rizpoint/internal-ca/ca.pem}"
edge_cert="${RIZPOINT_EDGE_CLIENT_CERT_FILE:-/run/rizpoint/internal-ca/edge.pem}"
web_cert="${RIZPOINT_WEB_SERVER_CERT_FILE:-/run/rizpoint/internal-ca/web.pem}"
failed=0

for cert in "$internal_ca" "$edge_cert" "$web_cert"; do
  if openssl x509 -checkend 2592000 -noout -in "$cert" >/dev/null 2>&1; then
    echo "PASS certificate-valid-30-days $(basename "$cert")"
  else
    echo "FAIL certificate-missing-or-expiring $(basename "$cert")"; failed=1
  fi
done

if [[ -n "$public_host" ]]; then
  if timeout 10 openssl s_client -connect "$public_host:$public_port" \
    -servername "$public_host" -verify_return_error </dev/null 2>/dev/null |
    grep -q 'Verify return code: 0'; then
    echo "PASS public-certificate-trusted"
  else
    echo "FAIL public-certificate-untrusted"; failed=1
  fi
  for legacy in tls1 tls1_1; do
    if timeout 8 openssl s_client "-$legacy" -connect "$public_host:$public_port" \
      -servername "$public_host" </dev/null >/dev/null 2>&1; then
      echo "FAIL legacy-$legacy-accepted"; failed=1
    else
      echo "PASS legacy-$legacy-rejected"
    fi
  done
else
  echo "MANUAL public certificate and legacy-protocol check requires RIZPOINT_PUBLIC_HOST"
fi
exit "$failed"
