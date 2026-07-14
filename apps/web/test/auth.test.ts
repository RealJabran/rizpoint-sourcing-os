import { describe, expect, it } from "vitest";
import { createPasswordHash, verifyPassword } from "../src/auth.js";

describe("private credentials", () => {
  it("uses a salted server-side password verifier", async () => {
    const hash = await createPasswordHash("a-long-private-password");
    expect(hash).toMatch(/^scrypt-v1\$/);
    await expect(verifyPassword("a-long-private-password", hash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("not-the-password", hash)).resolves.toBe(false);
  });
});
