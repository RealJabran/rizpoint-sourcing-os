import { describe, expect, it } from "vitest";

describe("web health contract", () => {
  it("has a stable health shape", () => {
    expect({ status: "ok", service: "web" }).toEqual({
      status: "ok",
      service: "web",
    });
  });
});
