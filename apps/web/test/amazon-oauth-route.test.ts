import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const consumeAmazonAuthorizationState = vi.fn();
const failAmazonAuthorizationState = vi.fn();
const encryptAuthorizationCode = vi.fn(() => "encrypted-code");
const hashAuthorizationState = vi.fn(() => "state-hash");
const readAmazonOAuthPublicConfiguration = vi.fn(() => ({
  callbackPublicKey: "public-key",
  callbackKeyVersion: 3,
}));

class AmazonConnectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

vi.mock("@rizpoint/amazon-sp-api", () => ({
  encryptAuthorizationCode,
  hashAuthorizationState,
  readAmazonOAuthPublicConfiguration,
}));
vi.mock("@rizpoint/database", () => ({
  AmazonConnectionError,
  consumeAmazonAuthorizationState,
  failAmazonAuthorizationState,
}));

describe("Amazon OAuth callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing state without touching persisted authorization", async () => {
    const { GET } =
      await import("../app/api/providers/amazon/oauth/callback/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/providers/amazon/oauth/callback?selling_partner_id=seller&spapi_oauth_code=secret-code",
      ),
    );
    expect(response.headers.get("location")).toContain(
      "authorization=invalid_state",
    );
    expect(consumeAmazonAuthorizationState).not.toHaveBeenCalled();
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("encrypts and queues a complete callback without returning secrets", async () => {
    consumeAmazonAuthorizationState.mockResolvedValue({ jobId: "job" });
    const { GET } =
      await import("../app/api/providers/amazon/oauth/callback/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/providers/amazon/oauth/callback?state=csrf&selling_partner_id=seller&spapi_oauth_code=secret-code",
      ),
    );
    expect(encryptAuthorizationCode).toHaveBeenCalledWith(
      "secret-code",
      "public-key",
    );
    expect(consumeAmazonAuthorizationState).toHaveBeenCalledWith({
      stateHash: "state-hash",
      encryptedOauthCode: "encrypted-code",
      oauthCodeKeyVersion: 3,
      sellerId: "seller",
    });
    expect(response.headers.get("location")).toContain(
      "authorization=processing",
    );
    expect(response.headers.get("location")).not.toContain("secret-code");
  });

  it("surfaces replay rejection as a safe outcome", async () => {
    consumeAmazonAuthorizationState.mockRejectedValue(
      new AmazonConnectionError("OAUTH_STATE_REPLAYED"),
    );
    const { GET } =
      await import("../app/api/providers/amazon/oauth/callback/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/providers/amazon/oauth/callback?state=csrf&selling_partner_id=seller&spapi_oauth_code=secret-code",
      ),
    );
    expect(response.headers.get("location")).toContain(
      "authorization=oauth_state_replayed",
    );
    expect(response.headers.get("location")).not.toContain("secret-code");
  });

  it("records an incomplete callback without storing a code", async () => {
    failAmazonAuthorizationState.mockResolvedValue({ count: 1 });
    const { GET } =
      await import("../app/api/providers/amazon/oauth/callback/route.js");
    const response = await GET(
      new NextRequest(
        "http://localhost/api/providers/amazon/oauth/callback?state=csrf&selling_partner_id=seller",
      ),
    );
    expect(failAmazonAuthorizationState).toHaveBeenCalledWith({
      stateHash: "state-hash",
      failureCode: "OAUTH_CALLBACK_INCOMPLETE",
    });
    expect(encryptAuthorizationCode).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("authorization=failed");
  });
});
