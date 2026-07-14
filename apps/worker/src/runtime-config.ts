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
  if (!databaseUsesTls(process.env.DATABASE_URL))
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
  if (!httpsUrl(process.env.RIZPOINT_ERROR_TRACKING_WEBHOOK_URL))
    throw new Error(
      "worker_production_configuration_invalid:error_tracking_https_required",
    );
}

function httpsUrl(value: string | undefined): boolean {
  try {
    return new URL(value!).protocol === "https:";
  } catch {
    return false;
  }
}

function databaseUsesTls(value: string | undefined): boolean {
  try {
    const url = new URL(value!);
    return (
      ["postgresql:", "postgres:"].includes(url.protocol) &&
      ["require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    );
  } catch {
    return false;
  }
}

function redisUsesTls(value: string | undefined): boolean {
  try {
    return new URL(value!).protocol === "rediss:";
  } catch {
    return false;
  }
}
