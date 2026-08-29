#!/usr/bin/env node
import { connect } from "node:net";
import { EXTERNAL_PORTS_TO_PROBE } from "./lib/amazon-deployment-security.mjs";

const host = process.argv
  .find((value) => value.startsWith("--host="))
  ?.slice(7);
const allow = new Set(
  (
    process.argv.find((value) => value.startsWith("--allow="))?.slice(8) ??
    "443"
  )
    .split(",")
    .map(Number),
);
const timeoutMs = Number(
  process.argv.find((value) => value.startsWith("--timeout-ms="))?.slice(13) ??
    "1500",
);

if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
  throw new Error(
    "Usage: pnpm security:amazon:ports -- --host=public.example --allow=443",
  );
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000)
  throw new Error("timeout must be between 100 and 10000 milliseconds");

function probe(port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const finish = (open) => {
      socket.destroy();
      resolve({ port, open });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

const results = await Promise.all(EXTERNAL_PORTS_TO_PROBE.map(probe));
const unexpected = results.filter((item) => item.open && !allow.has(item.port));
const expectedClosed = results.filter(
  (item) => !item.open && allow.has(item.port),
);
for (const item of results)
  process.stdout.write(
    `${item.open ? "OPEN  " : "CLOSED"} ${host}:${item.port}\n`,
  );
if (unexpected.length > 0 || expectedClosed.length > 0) {
  process.stderr.write(
    `FAIL unexpected_open=${unexpected.map((item) => item.port).join(",") || "none"} expected_but_closed=${expectedClosed.map((item) => item.port).join(",") || "none"}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    "PASS only the explicitly allowed public ports are reachable.\n",
  );
}
