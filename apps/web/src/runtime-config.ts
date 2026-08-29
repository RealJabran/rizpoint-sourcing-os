const placeholder = /replace-with|changeme|example|^$/i;

function validHttpsUrl(value: string | undefined): boolean {
  try {
    return Boolean(value) && new URL(value!).protocol === "https:";
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

function sameHttpsOrigin(
  first: string | undefined,
  second: string | undefined,
) {
  try {
    const left = new URL(first!);
    const right = new URL(second!);
    return left.protocol === "https:" && left.origin === right.origin;
  } catch {
    return false;
  }
}

function validAmazonEndpoint(value: string | undefined): boolean {
  const endpoints = new Set([
    "https://sellingpartnerapi-na.amazon.com",
    "https://sellingpartnerapi-eu.amazon.com",
    "https://sellingpartnerapi-fe.amazon.com",
  ]);
  return endpoints.has((value ?? "").replace(/\/$/, ""));
}

export function assertProductionConfiguration() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.RIZPOINT_PRIVATE_MODE !== "true"
  )
    return;
  const required = [
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_PUBLIC_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "NEXTAUTH_SECRET",
    "NEXTAUTH_URL",
    "NEXT_PUBLIC_APP_URL",
    "RIZPOINT_PRIVATE_ORGANIZATION_SLUG",
    "MFA_CREDENTIAL_KEY_V1",
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
  if (!(process.env.NODE_OPTIONS ?? "").includes("--tls-min-v1.2"))
    throw new Error("production_configuration_invalid:tls_minimum_required");
  if (process.env.MALWARE_SCAN_MODE !== "clamav")
    throw new Error("production_configuration_invalid:malware_scan_mode");
  if (!validHttpsUrl(process.env.NEXTAUTH_URL))
    throw new Error(
      "production_configuration_invalid:nextauth_url_https_required",
    );
  if (
    !sameHttpsOrigin(process.env.NEXTAUTH_URL, process.env.NEXT_PUBLIC_APP_URL)
  )
    throw new Error(
      "production_configuration_invalid:application_origin_mismatch",
    );
  if ((process.env.NEXTAUTH_SECRET?.length ?? 0) < 32)
    throw new Error(
      "production_configuration_invalid:nextauth_secret_too_short",
    );
  if (
    Buffer.from(process.env.MFA_CREDENTIAL_KEY_V1 ?? "", "base64").length !== 32
  )
    throw new Error(
      "production_configuration_invalid:mfa_credential_key_invalid",
    );
  if (!databaseUsesVerifiedTls(process.env.DATABASE_URL))
    throw new Error("production_configuration_invalid:database_tls_required");
  if (!validHttpsUrl(process.env.S3_ENDPOINT))
    throw new Error("production_configuration_invalid:storage_tls_required");
  if (!validHttpsUrl(process.env.S3_PUBLIC_ENDPOINT))
    throw new Error(
      "production_configuration_invalid:public_storage_tls_required",
    );
  if (
    !["AES256", "aws:kms"].includes(process.env.S3_SERVER_SIDE_ENCRYPTION ?? "")
  )
    throw new Error(
      "production_configuration_invalid:storage_encryption_required",
    );
  if (
    process.env.S3_SERVER_SIDE_ENCRYPTION === "aws:kms" &&
    !process.env.S3_KMS_KEY_ID
  )
    throw new Error(
      "production_configuration_invalid:storage_kms_key_required",
    );
  if (process.env.S3_VERSIONING_ENABLED !== "true")
    throw new Error(
      "production_configuration_invalid:storage_versioning_required",
    );
  if (process.env.S3_LIFECYCLE_MANAGED !== "true")
    throw new Error(
      "production_configuration_invalid:storage_lifecycle_required",
    );
  if (
    process.env.SP_API_ENDPOINT &&
    !validAmazonEndpoint(process.env.SP_API_ENDPOINT)
  )
    throw new Error(
      "production_configuration_invalid:sp_api_endpoint_not_allowed",
    );
  if (process.env.SP_API_OAUTH_REDIRECT_URI) {
    const callback = new URL(process.env.SP_API_OAUTH_REDIRECT_URI);
    if (
      !sameHttpsOrigin(process.env.NEXTAUTH_URL, callback.toString()) ||
      callback.pathname !== "/api/providers/amazon/oauth/callback" ||
      callback.search ||
      callback.hash
    )
      throw new Error(
        "production_configuration_invalid:oauth_callback_not_allowed",
      );
  }
}
