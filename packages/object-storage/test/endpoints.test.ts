import { describe, expect, it } from "vitest";
import { storageEndpointConfiguration } from "../src/index.js";

describe("object storage endpoint contract", () => {
  it("keeps service traffic internal and signs browser URLs for the public endpoint", () => {
    expect(
      storageEndpointConfiguration({
        S3_ENDPOINT: "http://minio:9000",
        S3_PUBLIC_ENDPOINT: "http://localhost:9000",
      }),
    ).toEqual({
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
    });
  });

  it("uses the internal endpoint only when no browser endpoint is configured", () => {
    expect(
      storageEndpointConfiguration({ S3_ENDPOINT: "https://private-s3.test" }),
    ).toEqual({
      endpoint: "https://private-s3.test",
      publicEndpoint: "https://private-s3.test",
    });
  });
});
