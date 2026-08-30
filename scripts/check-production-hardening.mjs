import { readFile } from "node:fs/promises";
import {
  STATUS,
  evaluateProductionCompose,
  evaluateStaticFiles,
  loadProductionCompose,
} from "./lib/amazon-deployment-security.mjs";

const checks = [
  [".env.production.example", "PHASE_ZERO_DEMO_MODE=false"],
  [".env.production.example", "RIZPOINT_PRIVATE_MODE=true"],
  ["apps/web/Dockerfile", "USER node"],
  ["apps/worker/Dockerfile", "USER node"],
  ["services/scanner/Dockerfile", "USER rizpoint"],
  ["docs/RECOVERY_RUNBOOK.md", "Recovery runbook"],
];
for (const [path, expected] of checks) {
  const content = await readFile(path, "utf8");
  if (!content.includes(expected))
    throw new Error(
      `Production hardening check failed: ${path} lacks ${expected}`,
    );
}

const companionManifest = JSON.parse(
  await readFile("apps/research-companion/manifest.json", "utf8"),
);
const permissions = companionManifest.permissions ?? [];
if (
  permissions.some((permission) =>
    ["tabs", "activeTab", "cookies", "identity", "clipboardRead"].includes(
      permission,
    ),
  )
)
  throw new Error(
    "Research Companion requests an unnecessary sensitive permission",
  );
if (
  (companionManifest.host_permissions ?? []).some(
    (host) => host === "<all_urls>" || host.includes("*://*"),
  )
)
  throw new Error("Research Companion host permissions must remain explicit");

const [
  nginx,
  nextConfig,
  csp,
  privateAsset,
  productionCompose,
  webStunnel,
  hostControls,
  firewall,
  monitoring,
] = await Promise.all([
  readFile("deploy/amazon-hardened/nginx.conf", "utf8"),
  readFile("apps/web/next.config.ts", "utf8"),
  readFile("apps/web/src/content-security-policy.ts", "utf8"),
  readFile("scripts/check-private-assets.mjs", "utf8"),
  readFile("compose.production.yaml", "utf8"),
  readFile("deploy/amazon-production/runtime/web-stunnel.conf", "utf8"),
  readFile("deploy/amazon-production/host-controls.sh", "utf8"),
  readFile("deploy/amazon-production/firewall.sh", "utf8"),
  readFile(
    "deploy/amazon-production/monitoring/rsyslog-rizpoint.conf.tpl",
    "utf8",
  ),
]);
const deploymentChecks = [
  ...evaluateProductionCompose(loadProductionCompose(), productionCompose),
  ...evaluateStaticFiles({
    nginx,
    nextConfig,
    csp,
    privateAsset,
    productionCompose,
    webStunnel,
    hostControls,
    firewall,
    monitoring,
  }),
];
const failures = deploymentChecks.filter(
  (check) => check.status === STATUS.FAIL,
);
if (failures.length > 0)
  throw new Error(
    `Amazon production topology hardening failed: ${failures
      .map((check) => `${check.id} (${check.detail})`)
      .join(", ")}`,
  );
