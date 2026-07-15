function storageOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(
  publicStorageEndpoint = process.env.S3_PUBLIC_ENDPOINT,
): string {
  const connectSources = ["'self'", storageOrigin(publicStorageEndpoint)]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources}`,
  ].join("; ");
}
