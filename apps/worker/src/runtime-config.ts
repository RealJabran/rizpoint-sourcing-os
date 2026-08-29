export function assertWorkerProductionConfiguration() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.RIZPOINT_PRIVATE_MODE !== "true"
  )
    return;
  const required = [
    "DATABASE_URL",
    "REDIS_URL",
    "SCANNER_BASE_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_SERVER_SIDE_ENCRYPTION",
    "S3_VERSIONING_ENABLED",
    "S3_LIFECYCLE_MANAGED",
    "RIZPOINT_ERROR_TRACKING_WEBHOOK_URL",
  ];
  const invalid = required.filter((name) => {
    const value = process.env[name] ?? "";
    return !value || /replace-with|changeme|example/i.test(value);
  });
  if (invalid.length)
    throw new Error(
      `worker_production_configuration_invalid:${invalid.join(",")}`,
    );
  if (process.env.MALWARE_SCAN_MODE !== "clamav")
    throw new Error(
      "worker_production_configuration_invalid:malware_scan_mode",
    );
  if (!(process.env.NODE_OPTIONS ?? "").includes("--tls-min-v1.2"))
    throw new Error(
      "worker_production_configuration_invalid:tls_minimum_required",
    );
  if (!databaseUsesVerifiedTls(process.env.DATABASE_URL))
    throw new Error(
      "worker_production_configuration_invalid:database_tls_required",
    );
  if (!redisUsesTls(process.env.REDIS_URL))
    throw new Error(
      "worker_production_configuration_invalid:redis_tls_required",
    );
  if (!httpsUrl(process.env.S3_ENDPOINT))
    throw new Error(
      "worker_production_configuration_invalid:storage_tls_required",
    );
  if (!safeScannerUrl(process.env.SCANNER_BASE_URL))
    throw new Error(
      "worker_production_configuration_invalid:scanner_endpoint_not_allowed",
    );
  if (
    !["AES256", "aws:kms"].includes(process.env.S3_SERVER_SIDE_ENCRYPTION ?? "")
  )
    throw new Error(
      "worker_production_configuration_invalid:storage_encryption_required",
    );
  if (process.env.S3_VERSIONING_ENABLED !== "true")
    throw new Error(
      "worker_production_configuration_invalid:storage_versioning_required",
    );
  if (process.env.S3_LIFECYCLE_MANAGED !== "true")
    throw new Error(
      "worker_production_configuration_invalid:storage_lifecycle_required",
    );
  if (
    process.env.S3_SERVER_SIDE_ENCRYPTION === "aws:kms" &&
    !process.env.S3_KMS_KEY_ID
  )
    throw new Error(
      "worker_production_configuration_invalid:storage_kms_key_required",
    );
  if (!httpsUrl(process.env.RIZPOINT_ERROR_TRACKING_WEBHOOK_URL))
    throw new Error(
      "worker_production_configuration_invalid:error_tracking_https_required",
    );
  if (process.env.PROVIDER_MODE === "sp_api") {
    const providerValues = [
      "SP_API_LWA_CLIENT_ID",
      "SP_API_LWA_CLIENT_SECRET",
      "PROVIDER_CREDENTIAL_KEY_V1",
      "SP_API_ENDPOINT",
    ].filter((name) => {
      const value = process.env[name] ?? "";
      return !value || /replace-with|changeme|example/i.test(value);
    });
    if (providerValues.length)
      throw new Error(
        `worker_production_configuration_invalid:${providerValues.join(",")}`,
      );
    if (!validAmazonEndpoint(process.env.SP_API_ENDPOINT))
      throw new Error(
        "worker_production_configuration_invalid:sp_api_endpoint_not_allowed",
      );
    if (
      Buffer.from(process.env.PROVIDER_CREDENTIAL_KEY_V1 ?? "", "base64")
        .length !== 32
    )
      throw new Error(
        "worker_production_configuration_invalid:provider_credential_key_invalid",
      );
  }
  if (
    process.env.SP_API_OAUTH_REDIRECT_URI &&
    !httpsUrl(process.env.SP_API_OAUTH_REDIRECT_URI)
  )
    throw new Error(
      "worker_production_configuration_invalid:oauth_callback_https_required",
    );
}

function httpsUrl(value: string | undefined): boolean {
  try {
    return new URL(value!).protocol === "https:";
  } catch {
    return false;
  }
}

function databaseUsesVerifiedTls(value: string | undefined): boolean {
  try {
    const url = new URL(value!);
    return (
      ["postgresql:", "postgres:"].includes(url.protocol) &&
      url.searchParams.get("sslmode") === "verify-full"
    );
  } catch {
    return false;
  }
}

function safeScannerUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value!);
    if (url.username || url.password || url.search || url.hash) return false;
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "scanner")
    );
  } catch {
    return false;
  }
}

function validAmazonEndpoint(value: string | undefined): boolean {
  return new Set([
    "https://sellingpartnerapi-na.amazon.com",
    "https://sellingpartnerapi-eu.amazon.com",
    "https://sellingpartnerapi-fe.amazon.com",
  ]).has((value ?? "").replace(/\/$/, ""));
}

function redisUsesTls(value: string | undefined): boolean {
  try {
    return new URL(value!).protocol === "rediss:";
  } catch {
    return false;
  }
}
