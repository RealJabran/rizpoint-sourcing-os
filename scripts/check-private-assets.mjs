import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";

const spreadsheetExtensions = new Set([".csv", ".xls", ".xlsx"]);
const allowedFixturePrefix = "packages/test-fixtures/";

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const violations = repositoryFiles.filter((path) => {
  const filename = path.split("/").at(-1) ?? "";
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return (
    (filename.startsWith(".env") && !filename.endsWith(".example")) ||
    (spreadsheetExtensions.has(extension) &&
      !path.startsWith(allowedFixturePrefix))
  );
});

if (violations.length > 0) {
  throw new Error(
    `Private environment or supplier files are not allowed: ${violations.join(", ")}`,
  );
}

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const credentialPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bamzn1\.application-oa2-client\.[A-Za-z0-9_-]{20,}\b/,
  /\b(?:sk|rk)-[A-Za-z0-9_-]{24,}\b/,
];

for (const path of repositoryFiles) {
  if (!textExtensions.has(extname(path).toLowerCase())) continue;
  const info = await stat(path);
  if (info.size > 2_000_000) continue;
  const content = await readFile(path, "utf8");
  if (credentialPatterns.some((pattern) => pattern.test(content)))
    throw new Error(`Credential-shaped material is not allowed: ${path}`);
}

const browserForbiddenMarkers = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "PROVIDER_CREDENTIAL_KEY_V1",
  "SP_API_LWA_CLIENT_SECRET",
  "SP_API_REFRESH_TOKEN",
  "S3_SECRET_KEY",
  "KEEPA_API_KEY",
];

async function filesUnder(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) files.push(...(await filesUnder(child)));
      else files.push(child);
    }
    return files;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

for (const root of ["apps/web/.next/static", "apps/research-companion/dist"]) {
  for (const path of await filesUnder(root)) {
    const info = await stat(path);
    if (info.size > 5_000_000) continue;
    const content = await readFile(path, "utf8");
    const marker = browserForbiddenMarkers.find((value) =>
      content.includes(value),
    );
    if (marker)
      throw new Error(`Server credential marker ${marker} leaked into ${path}`);
    if (credentialPatterns.some((pattern) => pattern.test(content)))
      throw new Error(`Credential-shaped material leaked into ${path}`);
  }
}
