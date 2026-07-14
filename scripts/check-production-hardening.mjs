import { readFile } from "node:fs/promises";

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
