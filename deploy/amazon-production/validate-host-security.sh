#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
failed=0
"$root/firewall.sh" validate || failed=1
"$root/host-controls.sh" validate || failed=1

for port in 3000 3001 3310 5432 6379 8000 9000 9001 9090; do
  if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)$port$"; then
    echo "FAIL prohibited-host-listener-$port"
    failed=1
  else
    echo "PASS no-host-listener-$port"
  fi
done

if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'name=seccomp'; then
  echo "PASS docker-seccomp"
else
  echo "FAIL docker-seccomp-missing"
  failed=1
fi

if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -qx yes; then
  echo "PASS time-synchronized"
else
  echo "FAIL time-not-synchronized"
  failed=1
fi

exit "$failed"
