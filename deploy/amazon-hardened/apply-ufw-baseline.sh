#!/usr/bin/env bash
set -euo pipefail

admin_cidr="${RIZPOINT_ADMIN_CIDR:-}"
confirmation="${RIZPOINT_FIREWALL_CONFIRM:-}"

if [[ ! "$admin_cidr" =~ ^[0-9A-Fa-f:.]+/[0-9]{1,3}$ ]]; then
  echo "Set RIZPOINT_ADMIN_CIDR to the reviewed VPN/administration CIDR." >&2
  exit 2
fi

commands=(
  "ufw default deny incoming"
  "ufw default allow outgoing"
  "ufw allow from $admin_cidr to any port 22 proto tcp comment RizPoint-admin"
  "ufw allow 443/tcp comment RizPoint-HTTPS"
  "ufw deny 80/tcp"
  "ufw deny 3000/tcp"
  "ufw deny 3001/tcp"
  "ufw deny 3310/tcp"
  "ufw deny 5432/tcp"
  "ufw deny 6379/tcp"
  "ufw deny 8000/tcp"
  "ufw deny 9000/tcp"
  "ufw deny 9001/tcp"
  "ufw --force enable"
)

printf 'Operator-reviewed UFW plan (no changes made):\n'
printf '  %s\n' "${commands[@]}"

if [[ "${1:-}" != "--apply" ]]; then
  echo "Dry run only. Review cloud security groups, console access, and this plan."
  exit 0
fi
if [[ "$confirmation" != "APPLY_REVIEWED_RIZPOINT_FIREWALL" ]]; then
  echo "Refusing to mutate the host without RIZPOINT_FIREWALL_CONFIRM=APPLY_REVIEWED_RIZPOINT_FIREWALL." >&2
  exit 2
fi
if [[ "$(id -u)" -ne 0 ]]; then
  echo "The reviewed --apply operation must run as root from a recoverable console session." >&2
  exit 2
fi

for command in "${commands[@]}"; do
  read -r -a parts <<< "$command"
  "${parts[@]}"
done
