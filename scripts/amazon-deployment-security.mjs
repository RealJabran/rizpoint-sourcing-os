#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import {
  STATUS,
  evaluateAttestation,
  evaluateProductionCompose,
  evaluateRuntimeEnvironment,
  evaluateStaticFiles,
  loadAttestation,
  loadProductionCompose,
  summarize,
  verifyPublicTlsEndpoint,
} from "./lib/amazon-deployment-security.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

const json = process.argv.includes("--json");
const live = process.argv.includes("--live");
const strict = process.argv.includes("--strict");
const attestationPath =
  argument("attestation") ?? "deploy/amazon-hardened/operator-attestation.json";
const publicUrl = argument("public-url");

const [nginx, nextConfig, csp, privateAsset, attestation] = await Promise.all([
  readFile("deploy/amazon-hardened/nginx.conf", "utf8"),
  readFile("apps/web/next.config.ts", "utf8"),
  readFile("apps/web/src/content-security-policy.ts", "utf8"),
  readFile("scripts/check-private-assets.mjs", "utf8"),
  loadAttestation(attestationPath),
]);

const checks = [
  ...evaluateProductionCompose(loadProductionCompose()),
  ...evaluateStaticFiles({ nginx, nextConfig, csp, privateAsset }),
  ...(live
    ? evaluateRuntimeEnvironment(process.env)
    : [
        {
          id: "live-runtime-environment",
          status: STATUS.MANUAL,
          detail:
            "Run with --live from the deployed secret-injected runtime to verify actual endpoints and key strength.",
        },
      ]),
  ...(publicUrl
    ? await verifyPublicTlsEndpoint(publicUrl)
    : [
        {
          id: "live-public-tls",
          status: STATUS.MANUAL,
          detail:
            "Pass --public-url=https://deployed-host to validate its certificate, TLS protocol, and security headers.",
        },
      ]),
  ...evaluateAttestation(attestation),
];
const summary = summarize(checks);

if (json) {
  process.stdout.write(`${JSON.stringify({ checks, summary }, null, 2)}\n`);
} else {
  for (const check of checks)
    process.stdout.write(
      `${check.status.padEnd(28)} ${check.id}: ${check.detail}\n`,
    );
  process.stdout.write(
    `\nPASS=${summary.PASS} FAIL=${summary.FAIL} MANUAL_VERIFICATION_REQUIRED=${summary.MANUAL_VERIFICATION_REQUIRED}\n`,
  );
  process.stdout.write(
    "A configuration or attestation is evidence only for the deployment it actually inspected.\n",
  );
}

if (summary.FAIL > 0) process.exitCode = 1;
else if (strict && summary.MANUAL_VERIFICATION_REQUIRED > 0)
  process.exitCode = 2;
