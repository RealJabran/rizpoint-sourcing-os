#!/usr/bin/env bash
set -euo pipefail

mode="${1:-plan}"
state_root="${RIZPOINT_SECURITY_STATE_DIR:-/var/lib/rizpoint-security}"
admin_cidr="${RIZPOINT_ADMIN_CIDR:-}"
ssh_mode="${RIZPOINT_SSH_MODE:-restricted-cidr}"

if [[ "$ssh_mode" == "restricted-cidr" && ! "$admin_cidr" =~ ^[0-9A-Fa-f:.]+/[0-9]{1,3}$ ]]; then
  echo "Set RIZPOINT_ADMIN_CIDR or use RIZPOINT_SSH_MODE=private-channel." >&2
  exit 2
fi

plan() {
  echo "UFW plan: default deny incoming; default deny routed; allow HTTPS 443."
  if [[ "$ssh_mode" == "restricted-cidr" ]]; then
    echo "SSH 22 allowed only from reviewed administration CIDR: $admin_cidr"
  else
    echo "No public SSH rule; provider console/session manager is required."
  fi
  echo "Explicit public denies: 80,3000,3001,3310,5432,6379,8000,9000,9001,9090."
  echo "Docker publishes only edge 443; cloud firewall must independently match this policy."
}

validate() {
  command -v ufw >/dev/null || { echo "FAIL ufw-not-installed"; return 1; }
  local status
  status="$(ufw status verbose)"
  grep -q "Status: active" <<<"$status" || { echo "FAIL firewall-inactive"; return 1; }
  grep -qi "Default: deny (incoming)" <<<"$status" || { echo "FAIL inbound-not-deny"; return 1; }
  grep -qi "deny (routed)" <<<"$status" || { echo "FAIL forwarding-not-deny"; return 1; }
  grep -Eq '^443/tcp[[:space:]]+ALLOW' <<<"$status" || { echo "FAIL https-not-allowed"; return 1; }
  for port in 80 3000 3001 3310 5432 6379 8000 9000 9001 9090; do
    if grep -Eq "^${port}(/tcp)?[[:space:]]+ALLOW[[:space:]]+Anywhere" <<<"$status"; then
      echo "FAIL prohibited-public-port-$port"
      return 1
    fi
  done
  echo "PASS host-firewall-baseline"
}

apply() {
  [[ "$(id -u)" -eq 0 ]] || { echo "Apply requires root." >&2; exit 2; }
  [[ "${RIZPOINT_RECOVERY_ACCESS_CONFIRMED:-}" == "YES" ]] || {
    echo "Confirm working provider console recovery with RIZPOINT_RECOVERY_ACCESS_CONFIRMED=YES." >&2
    exit 2
  }
  [[ "${RIZPOINT_FIREWALL_CONFIRM:-}" == "APPLY_REVIEWED_RIZPOINT_FIREWALL" ]] || {
    echo "Set the exact RIZPOINT_FIREWALL_CONFIRM value after reviewing plan." >&2
    exit 2
  }
  command -v ufw >/dev/null || { echo "Install ufw first." >&2; exit 2; }
  local backup="$state_root/firewall/$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$backup"
  cp -a /etc/ufw "$backup/ufw"
  ufw default deny incoming
  ufw default deny routed
  ufw default allow outgoing
  if [[ "$ssh_mode" == "restricted-cidr" ]]; then
    ufw allow from "$admin_cidr" to any port 22 proto tcp comment RizPoint-admin
  fi
  ufw allow 443/tcp comment RizPoint-HTTPS
  for port in 80 3000 3001 3310 5432 6379 8000 9000 9001 9090; do
    ufw deny "$port/tcp"
  done
  ufw logging medium
  ufw --force enable
  validate
  echo "Firewall backup: $backup"
}

rollback() {
  local backup="${2:-}"
  [[ "$(id -u)" -eq 0 ]] || { echo "Rollback requires root." >&2; exit 2; }
  [[ -d "$backup/ufw" && "$backup" == "$state_root"/firewall/* ]] || {
    echo "Supply an explicit validated backup under $state_root/firewall/." >&2
    exit 2
  }
  [[ "${RIZPOINT_FIREWALL_ROLLBACK_CONFIRM:-}" == "ROLLBACK_REVIEWED_RIZPOINT_FIREWALL" ]] || {
    echo "Rollback confirmation is missing." >&2
    exit 2
  }
  ufw disable
  cp -a "$backup/ufw/." /etc/ufw/
  ufw --force enable
  validate
}

case "$mode" in
  plan) plan ;;
  validate) validate ;;
  apply) plan; apply ;;
  rollback) rollback "$@" ;;
  *) echo "Usage: $0 plan|validate|apply|rollback <backup-directory>" >&2; exit 2 ;;
esac
