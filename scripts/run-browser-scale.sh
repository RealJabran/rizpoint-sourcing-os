#!/usr/bin/env bash
set -euo pipefail

# The fixture directory is outside the repository. It carries only temporary
# synthetic IDs and is mounted read/write solely for the setup/cleanup scripts.
fixture_dir="$(mktemp -d -t rizpoint-analysis-scale.XXXXXX)"
fixture_path="$fixture_dir/fixture.json"
memory_path="$fixture_dir/container-rss-kib.log"

sample_compose_memory_kib() {
  docker stats --no-stream --format '{{.MemUsage}}' \
    "$(docker compose ps -q web)" "$(docker compose ps -q worker)" 2>/dev/null |
    awk '
      function kib(value, unit, amount) {
        match(value, /^([0-9.]+)([A-Za-z]+)$/, parts)
        amount = parts[1] + 0
        unit = parts[2]
        if (unit == "GiB") return amount * 1024 * 1024
        if (unit == "MiB") return amount * 1024
        if (unit == "KiB") return amount
        if (unit == "B") return amount / 1024
        return 0
      }
      { print int(kib($1)) }
    '
}

cleanup() {
  if [[ -f "$fixture_path" ]]; then
    docker compose run --rm --no-deps \
      --volume "$PWD/tests/integration:/app/tests/integration:ro" \
      --volume "$fixture_dir:/fixtures" \
      --env RIZPOINT_SCALE_FIXTURE_ACTION=cleanup \
      --env RIZPOINT_SCALE_FIXTURE_PATH=/fixtures/fixture.json \
      worker pnpm exec tsx tests/integration/analysis-browser-scale.fixture.ts
  fi
  rm -f "$fixture_path"
  rmdir "$fixture_dir" 2>/dev/null || true
}
trap cleanup EXIT

docker compose run --rm --no-deps \
  --volume "$PWD/tests/integration:/app/tests/integration:ro" \
  --volume "$fixture_dir:/fixtures" \
  --env PHASE_ZERO_DEMO_MODE=true \
  --env RIZPOINT_SCALE_FIXTURE_ACTION=setup \
  --env RIZPOINT_SCALE_FIXTURE_PATH=/fixtures/fixture.json \
  worker pnpm exec tsx tests/integration/analysis-browser-scale.fixture.ts

RIZPOINT_BROWSER_SCALE_FIXTURE_PATH="$fixture_path" \
  pnpm exec playwright test tests/browser/analysis-scale.spec.ts &
test_pid=$!
while kill -0 "$test_pid" 2>/dev/null; do
  sample_compose_memory_kib >>"$memory_path" || true
  sleep 1
done
wait "$test_pid"

if [[ -s "$memory_path" ]]; then
  peak_rss_kib="$(sort -n "$memory_path" | tail -n 1 | tr -d '[:space:]')"
  echo "browser analysis scale peak Compose web/worker memory: ${peak_rss_kib} KiB"
fi
