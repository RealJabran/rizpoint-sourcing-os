import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".turbo",
  ".venv",
  "dist",
  "node_modules",
]);
const spreadsheetExtensions = new Set([".csv", ".xls", ".xlsx"]);
const allowedFixturePrefix = "packages/test-fixtures/";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name))
        paths.push(...(await walk(join(directory, entry.name))));
      continue;
    }
    paths.push(join(directory, entry.name));
  }
  return paths;
}

const root = process.cwd();
const violations = (await walk(root))
  .map((path) => relative(root, path).replaceAll("\\", "/"))
  .filter((path) => {
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
