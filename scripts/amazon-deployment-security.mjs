#!/usr/bin/env node
import { createHash, createPublicKey, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  STATUS,
  evaluateAttestation,
  evaluateProductionCompose,
  evaluateRuntimeEnvironment,
  evaluateStaticFiles,
  loadAttestation,
  loadProductionCompose,
  summarize,
  verifyAttestationSignature,
  verifyLegacyTlsRejected,
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
const strict = process.argv.includes("--strict") || live;
const attestationPath =
  argument("attestation") ?? "deploy/amazon-hardened/operator-attestation.json";
const publicUrl = argument("public-url");
const attestationSignaturePath = argument("attestation-signature");
const attestationPublicKeyPath = argument("attestation-public-key");
const reportOut = argument("report-out");
const signingKeyPath = argument("signing-key");

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
  attestation,
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
  loadAttestation(attestationPath),
]);

let attestationSignatureVerified = false;
if (attestation && attestationSignaturePath && attestationPublicKeyPath) {
  const [bytes, signatureBytes, publicKey] = await Promise.all([
    readFile(attestationPath),
    readFile(attestationSignaturePath, "utf8"),
    readFile(attestationPublicKeyPath, "utf8"),
  ]);
  attestationSignatureVerified = verifyAttestationSignature(
    bytes,
    Buffer.from(signatureBytes.trim(), "base64"),
    publicKey,
  );
}

const checks = [
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
    ? [
        ...(await verifyPublicTlsEndpoint(publicUrl)),
        ...(await verifyLegacyTlsRejected(publicUrl)),
      ]
    : [
        {
          id: "live-public-tls",
          status: STATUS.MANUAL,
          detail:
            "Pass --public-url=https://deployed-host to validate its certificate, TLS protocol, and security headers.",
        },
      ]),
  ...evaluateAttestation(attestation, new Date(), attestationSignatureVerified),
];
const summary = summarize(checks);

if (reportOut) {
  if (!live || !publicUrl || !signingKeyPath)
    throw new Error(
      "A signed report requires --live, --public-url and --signing-key.",
    );
  if (summary.FAIL > 0 || summary.MANUAL_VERIFICATION_REQUIRED > 0)
    throw new Error("Refusing to sign an incomplete deployment report.");
  const privateKey = await readFile(signingKeyPath, "utf8");
  const publicKey = createPublicKey(privateKey).export({
    type: "spki",
    format: "pem",
  });
  const report = Buffer.from(
    `${JSON.stringify(
      {
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        deploymentId: attestation.deploymentId,
        releaseSha: process.env.RIZPOINT_RELEASE_SHA,
        checks,
        summary,
        signerPublicKeyFingerprint: createHash("sha256")
          .update(
            createPublicKey(publicKey).export({ type: "spki", format: "der" }),
          )
          .digest("hex"),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(reportOut, report, { mode: 0o600, flag: "wx" });
  await writeFile(
    `${reportOut}.sig`,
    sign(null, report, privateKey).toString("base64") + "\n",
    {
      mode: 0o600,
      flag: "wx",
    },
  );
}

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
