#!/usr/bin/env bash
set -euo pipefail

output="${1:-}"
[[ -n "$output" && "$output" != "/" && "$output" != "$HOME" ]] || {
  echo "Usage: $0 <new-private-output-directory>" >&2; exit 2;
}
[[ ! -e "$output" ]] || { echo "Output already exists; refusing overwrite." >&2; exit 2; }
umask 077
mkdir -p "$output"

openssl ecparam -name prime256v1 -genkey -noout -out "$output/ca-key.pem"
openssl req -x509 -new -sha256 -days 730 -key "$output/ca-key.pem" \
  -subj "/CN=RizPoint production internal CA" -out "$output/ca.pem"

issue() {
  local name="$1" usage="$2"
  openssl ecparam -name prime256v1 -genkey -noout -out "$output/$name-key.pem"
  openssl req -new -sha256 -key "$output/$name-key.pem" -subj "/CN=$name" \
    -out "$output/$name.csr"
  cat >"$output/$name.ext" <<EOF
subjectAltName=DNS:$name
extendedKeyUsage=$usage
keyUsage=digitalSignature,keyAgreement
EOF
  openssl x509 -req -sha256 -days 365 -in "$output/$name.csr" \
    -CA "$output/ca.pem" -CAkey "$output/ca-key.pem" -CAcreateserial \
    -extfile "$output/$name.ext" -out "$output/$name.pem"
  rm "$output/$name.csr" "$output/$name.ext"
}
issue web serverAuth
issue edge clientAuth
chmod 0400 "$output"/*-key.pem
chmod 0444 "$output"/*.pem
echo "Created private CA and mTLS leaf material in $output."
echo "Move ca-key.pem to an offline secret manager; it must not remain on the host."
