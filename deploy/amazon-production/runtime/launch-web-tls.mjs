import { spawn } from "node:child_process";

const processes = [
  spawn(
    "/usr/bin/stunnel4",
    ["/app/deploy/amazon-production/runtime/web-stunnel.conf"],
    { stdio: "inherit" },
  ),
  spawn("node", ["apps/web/.next/standalone/apps/web/server.js"], {
    stdio: "inherit",
  }),
];

let stopping = false;
function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of processes) if (!child.killed) child.kill(signal);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => stop(signal));
}

for (const child of processes) {
  child.once("error", () => stop());
  child.once("exit", (code, signal) => {
    stop();
    process.exitCode = code ?? (signal ? 1 : 0);
  });
}
