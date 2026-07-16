import { describe, expect, it } from "vitest";
import {
  LwaAccessTokenProvider,
  SpApiTransport,
  readSpApiConnectionConfig,
  testSpApiConnection,
} from "../src/index.js";

const enabled = process.env.SP_API_LIVE_SMOKE === "1";

describe.skipIf(!enabled)("opt-in live SP-API connection smoke", () => {
  it("performs one non-destructive Sellers marketplace-participations request", async () => {
    const config = readSpApiConnectionConfig();
    const tokens = new LwaAccessTokenProvider(config, config.refreshToken);
    const transport = new SpApiTransport(
      config,
      Object.assign(() => tokens.getAccessToken(), {
        invalidate: () => tokens.invalidate(),
      }),
    );
    const health = await testSpApiConnection(transport);
    expect(health).toMatchObject({ status: "CONNECTED" });
  }, 30_000);
});
