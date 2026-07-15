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
  environment = process.env.NODE_ENV,
): string {
  const connectSources = ["'self'", storageOrigin(publicStorageEndpoint)]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  // React and Next.js development overlays reconstruct call stacks with eval.
  // Never loosen production CSP for that local-only tooling requirement.
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(environment === "development" ? ["'unsafe-eval'"] : []),
  ].join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources}`,
  ].join("; ");
}
