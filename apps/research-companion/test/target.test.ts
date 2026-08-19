import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { targetFromUrl } from "../src/target.js";
it("extracts an ASIN from URL context without inspecting page HTML", () =>
  expect(
    targetFromUrl("https://www.amazon.com/dp/B0ABC12345?tag=x"),
  ).toMatchObject({ asin: "B0ABC12345", marketplaceId: "ATVPDKIKX0DER" }));

it("keeps extension permissions narrowly scoped", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
  ) as { permissions: string[]; host_permissions: string[] };
  expect(manifest.permissions).toEqual(["storage", "activeTab", "sidePanel"]);
  expect(manifest.host_permissions).not.toContain("*://*/*");
});
