#!/usr/bin/env bash
set -euo pipefail

mode="${1:-plan}"
state_root="${RIZPOINT_SECURITY_STATE_DIR:-/var/lib/rizpoint-security}"
suricata_interface="${RIZPOINT_SURICATA_INTERFACE:-}"
siem_host="${RIZPOINT_SIEM_HOST:-}"
siem_port="${RIZPOINT_SIEM_PORT:-6514}"
siem_peer="${RIZPOINT_SIEM_PERMITTED_PEER:-}"
siem_ca="${RIZPOINT_SIEM_CA_FILE:-}"

plan() {
  cat <<'EOF'
RizPoint host-control plan (Debian/Ubuntu):
- install/enable Suricata and refresh its maintained rule feed;
- install/enable ClamAV daemon and freshclam, plus scheduled/on-access coverage;
- quarantine detections under root-only /var/lib/rizpoint-security/quarantine;
- forward sanitized host/container/Suricata/ClamAV events to a TLS SIEM;
- enable auditd, chrony and unattended security updates;
- validate services, signature/rule freshness and TLS monitoring transport.
This does not configure the host firewall; run firewall.sh separately.
EOF
}

require_apply_inputs() {
  [[ "$(id -u)" -eq 0 ]] || { echo "Apply requires root." >&2; exit 2; }
  [[ "${RIZPOINT_RECOVERY_ACCESS_CONFIRMED:-}" == "YES" ]] || {
    echo "Confirm provider-console recovery with RIZPOINT_RECOVERY_ACCESS_CONFIRMED=YES." >&2
    exit 2
  }
  [[ "${RIZPOINT_HOST_CONTROLS_CONFIRM:-}" == "APPLY_REVIEWED_RIZPOINT_HOST_CONTROLS" ]] || {
    echo "Set the exact RIZPOINT_HOST_CONTROLS_CONFIRM value after review." >&2
    exit 2
  }
  [[ -n "$suricata_interface" && -e "/sys/class/net/$suricata_interface" ]] || {
    echo "RIZPOINT_SURICATA_INTERFACE must name a real reviewed interface." >&2
    exit 2
  }
  [[ "$siem_host" =~ ^[A-Za-z0-9.-]+$ && "$siem_peer" =~ ^[A-Za-z0-9.*-]+$ ]] || {
    echo "Set RIZPOINT_SIEM_HOST and RIZPOINT_SIEM_PERMITTED_PEER." >&2
    exit 2
  }
  [[ -f "$siem_ca" ]] || { echo "RIZPOINT_SIEM_CA_FILE must exist." >&2; exit 2; }
}

install_units() {
  install -d -m 0700 "$state_root/quarantine"
  install -d -m 0750 /etc/rizpoint-security
  install -m 0750 /dev/stdin /usr/local/sbin/rizpoint-malware-scan <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
scan_root="${RIZPOINT_MALWARE_SCAN_ROOT:-/var/lib/docker/volumes}"
quarantine="/var/lib/rizpoint-security/quarantine"
install -d -m 0700 "$quarantine"
/usr/bin/clamdscan --fdpass --multiscan --move="$quarantine" "$scan_root"
SCRIPT

  install -m 0644 /dev/stdin /etc/systemd/system/rizpoint-malware-scan.service <<'UNIT'
[Unit]
Description=RizPoint scheduled anti-malware scan
After=clamav-daemon.service
Requires=clamav-daemon.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/rizpoint-malware-scan
User=root
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/rizpoint-security/quarantine
UNIT
  install -m 0644 /dev/stdin /etc/systemd/system/rizpoint-malware-scan.timer <<'UNIT'
[Unit]
Description=Run RizPoint anti-malware scan daily
[Timer]
OnCalendar=daily
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
UNIT

  install -m 0644 /dev/stdin /etc/systemd/system/rizpoint-clamonacc.service <<'UNIT'
[Unit]
Description=RizPoint ClamAV on-access protection
After=clamav-daemon.service
Requires=clamav-daemon.service
[Service]
ExecStart=/usr/sbin/clamonacc --foreground --fdpass --move=/var/lib/rizpoint-security/quarantine /var/lib/docker/volumes
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
}

configure_siem() {
  install -m 0644 "$siem_ca" /etc/rizpoint-security/siem-ca.pem
  sed \
    -e "s|@@SIEM_HOST@@|$siem_host|g" \
    -e "s|@@SIEM_PORT@@|$siem_port|g" \
    -e "s|@@SIEM_PEER@@|$siem_peer|g" \
    "$(dirname "$0")/monitoring/rsyslog-rizpoint.conf.tpl" \
    > /etc/rsyslog.d/60-rizpoint-security.conf
  chmod 0640 /etc/rsyslog.d/60-rizpoint-security.conf
  rsyslogd -N1
}

apply_controls() {
  require_apply_inputs
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    auditd chrony clamav clamav-daemon clamav-freshclam curl rsyslog-gnutls \
    suricata unattended-upgrades
  local backup="$state_root/host/$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$backup"
  for path in /etc/suricata /etc/clamav /etc/rsyslog.d /etc/systemd/system; do
    [[ -e "$path" ]] && cp -a "$path" "$backup/$(basename "$path")"
  done
  sed -i -E "s|^[[:space:]]*interface:[[:space:]].*|  interface: $suricata_interface|" /etc/suricata/suricata.yaml
  suricata-update
  suricata -T -c /etc/suricata/suricata.yaml
  install_units
  configure_siem
  freshclam || true
  systemctl daemon-reload
  systemctl enable --now auditd chrony clamav-daemon clamav-freshclam \
    rizpoint-clamonacc.service rizpoint-malware-scan.timer rsyslog suricata \
    unattended-upgrades
  validate
  echo "Host-control backup: $backup"
}

file_age_hours() {
  local path="$1"
  local now modified
  now="$(date +%s)"
  modified="$(stat -c %Y "$path")"
  echo $(( (now - modified) / 3600 ))
}

validate() {
  local failed=0
  for service in auditd chrony clamav-daemon clamav-freshclam \
    rizpoint-clamonacc.service rizpoint-malware-scan.timer rsyslog suricata \
    unattended-upgrades; do
    if systemctl is-active --quiet "$service"; then
      echo "PASS service-$service"
    else
      echo "FAIL service-$service"
      failed=1
    fi
  done
  local signature rule
  signature="$(find /var/lib/clamav -maxdepth 1 -type f \( -name '*.cvd' -o -name '*.cld' \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
  rule="$(find /var/lib/suricata/rules -type f -name '*.rules' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
  if [[ -n "$signature" && "$(file_age_hours "$signature")" -le 72 ]]; then
    echo "PASS anti-malware-signatures-current"
  else
    echo "FAIL anti-malware-signatures-stale-or-missing"; failed=1
  fi
  if [[ -n "$rule" && "$(file_age_hours "$rule")" -le 168 ]]; then
    echo "PASS ids-rules-current"
  else
    echo "FAIL ids-rules-stale-or-missing"; failed=1
  fi
  suricata -T -c /etc/suricata/suricata.yaml >/dev/null || failed=1
  rsyslogd -N1 >/dev/null || failed=1
  grep -q 'StreamDriverMode="1"' /etc/rsyslog.d/60-rizpoint-security.conf || {
    echo "FAIL siem-transport-not-tls"; failed=1;
  }
  [[ ! -S /var/run/docker.sock || ! -n "$(ss -ltn 2>/dev/null | awk '$4 ~ /:2375$|:2376$/')" ]] || {
    echo "FAIL docker-api-public"; failed=1;
  }
  [[ "$failed" -eq 0 ]] && echo "PASS host-security-controls"
  return "$failed"
}

test_alert() {
  [[ "$(id -u)" -eq 0 ]] || { echo "IDS test requires root." >&2; exit 2; }
  [[ "${RIZPOINT_IDS_TEST_CONFIRM:-}" == "RUN_HARMLESS_RIZPOINT_IDS_TEST" ]] || {
    echo "Set the exact RIZPOINT_IDS_TEST_CONFIRM after notifying monitoring." >&2
    exit 2
  }
  local eve=/var/log/suricata/eve.json
  [[ -f "$eve" ]] || { echo "Suricata eve.json is unavailable." >&2; exit 1; }
  local before
  before="$(wc -l <"$eve")"
  # testmynids.org is a public harmless IDS test endpoint. No RizPoint or Amazon
  # data is sent; this fixed GET is only run by an authorized root operator.
  curl --fail --silent --show-error --max-time 10 \
    http://testmynids.org/uid/index.html >/dev/null
  for _ in {1..10}; do
    if tail -n "+$((before + 1))" "$eve" | grep -q 'id check returned root'; then
      echo "PASS ids-harmless-test-alert-generated"
      echo "Confirm receipt in the TLS SIEM before signing deployment evidence."
      return 0
    fi
    sleep 1
  done
  echo "FAIL ids-harmless-test-alert-not-observed"
  return 1
}

rollback() {
  local backup="${2:-}"
  [[ "$(id -u)" -eq 0 ]] || { echo "Rollback requires root." >&2; exit 2; }
  [[ -d "$backup" && "$backup" == "$state_root"/host/* ]] || {
    echo "Supply an explicit backup under $state_root/host/." >&2; exit 2;
  }
  [[ "${RIZPOINT_HOST_CONTROLS_ROLLBACK_CONFIRM:-}" == "ROLLBACK_REVIEWED_RIZPOINT_HOST_CONTROLS" ]] || {
    echo "Rollback confirmation is missing." >&2; exit 2;
  }
  for name in suricata clamav rsyslog.d system; do
    [[ -d "$backup/$name" ]] || continue
    case "$name" in
      system) cp -a "$backup/$name/." /etc/systemd/system/ ;;
      *) cp -a "$backup/$name/." "/etc/$name/" ;;
    esac
  done
  systemctl daemon-reload
  echo "Restored reviewed configuration; run validate before returning traffic."
}

case "$mode" in
  plan) plan ;;
  apply) plan; apply_controls ;;
  validate) validate ;;
  test-alert) test_alert ;;
  rollback) rollback "$@" ;;
  *) echo "Usage: $0 plan|apply|validate|test-alert|rollback <backup-directory>" >&2; exit 2 ;;
esac
