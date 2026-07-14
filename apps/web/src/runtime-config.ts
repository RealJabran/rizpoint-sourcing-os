const placeholder = /replace-with|changeme|example|^$/i;

function validHttpsUrl(value: string | undefined): boolean {
  try {
    return Boolean(value) && new URL(value!).protocol === "https:";
  } catch {
    return false;
  }
}

function databaseUsesTls(value: string | undefined): boolean {
  try {
    const url = new URL(value!);
    return (
      ["postgresql:", "postgres:"].includes(url.protocol) &&
      (url.searchParams.get("sslmode") === "require" ||
        url.searchParams.get("sslmode") === "verify-ca" ||
        url.searchParams.get("sslmode") === "verify-full" ||
        url.searchParams.get("ssl") === "true")
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

export function assertProductionConfiguration() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.RIZPOINT_PRIVATE_MODE !== "true"
  )
    return;
  const required = [
    "DATABASE_URL",
    "REDIS_URL",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "RIZPOINT_PRIVATE_ORGANIZATION_SLUG",
    "S3_SERVER_SIDE_ENCRYPTION",
    "S3_VERSIONING_ENABLED",
    "S3_LIFECYCLE_MANAGED",
  ];
  const missing = required.filter((name) => {
    const value = process.env[name];
    return !value || placeholder.test(value);
  });
  if (missing.length > 0)
    throw new Error(`production_configuration_invalid:${missing.join(",")}`);
  if (process.env.PHASE_ZERO_DEMO_MODE === "true")
    throw new Error("production_configuration_invalid:demo_mode");
  if (process.env.MALWARE_SCAN_MODE !== "clamav")
    throw new Error("production_configuration_invalid:malware_scan_mode");
  if (!validHttpsUrl(process.env.NEXTAUTH_URL))
    throw new Error(
      "production_configuration_invalid:nextauth_url_https_required",
    );
  if ((process.env.NEXTAUTH_SECRET?.length ?? 0) < 32)
    throw new Error(
      "production_configuration_invalid:nextauth_secret_too_short",
    );
  if (!databaseUsesTls(process.env.DATABASE_URL))
    throw new Error("production_configuration_invalid:database_tls_required");
  if (!redisUsesTls(process.env.REDIS_URL))
    throw new Error("production_configuration_invalid:redis_tls_required");
  if (!validHttpsUrl(process.env.S3_ENDPOINT))
    throw new Error("production_configuration_invalid:storage_tls_required");
  if (
    !["AES256", "aws:kms"].includes(process.env.S3_SERVER_SIDE_ENCRYPTION ?? "")
  )
    throw new Error(
      "production_configuration_invalid:storage_encryption_required",
    );
  if (process.env.S3_VERSIONING_ENABLED !== "true")
    throw new Error(
      "production_configuration_invalid:storage_versioning_required",
    );
  if (process.env.S3_LIFECYCLE_MANAGED !== "true")
    throw new Error(
      "production_configuration_invalid:storage_lifecycle_required",
    );
}
