import { execFileSync } from "node:child_process";

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
