export const PASSWORD_MINIMUM_LENGTH = 14;
export const PASSWORD_HISTORY_DEPTH = 10;
export const PASSWORD_MINIMUM_AGE_MS = 24 * 60 * 60 * 1_000;
export const PASSWORD_MAXIMUM_AGE_MS = 365 * 24 * 60 * 60 * 1_000;

export type PasswordIdentity = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email: string;
  organizationName?: string | null;
};

export type PasswordPolicyFailure =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_UPPERCASE_REQUIRED"
  | "PASSWORD_LOWERCASE_REQUIRED"
  | "PASSWORD_NUMBER_REQUIRED"
  | "PASSWORD_SPECIAL_REQUIRED"
  | "PASSWORD_CONTAINS_IDENTITY";

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function significantIdentityParts(identity: PasswordIdentity): string[] {
  const emailLocal = identity.email.split("@")[0] ?? "";
  const sources = [
    identity.firstName,
    identity.lastName,
    identity.displayName,
    emailLocal,
    identity.organizationName,
  ].filter((value): value is string => Boolean(value));
  const parts = new Set<string>();
  for (const source of sources) {
    const whole = normalized(source);
    if (whole.length >= 4) parts.add(whole);
    for (const part of source.split(/[^\p{L}\p{N}]+/u)) {
      const candidate = normalized(part);
      if (candidate.length >= 4) parts.add(candidate);
    }
  }
  return [...parts];
}

export function validatePasswordPolicy(
  password: string,
  identity: PasswordIdentity,
): PasswordPolicyFailure[] {
  const failures: PasswordPolicyFailure[] = [];
  if (password.length < PASSWORD_MINIMUM_LENGTH)
    failures.push("PASSWORD_TOO_SHORT");
  if (!/[A-Z]/u.test(password)) failures.push("PASSWORD_UPPERCASE_REQUIRED");
  if (!/[a-z]/u.test(password)) failures.push("PASSWORD_LOWERCASE_REQUIRED");
  if (!/[0-9]/u.test(password)) failures.push("PASSWORD_NUMBER_REQUIRED");
  if (!/[^A-Za-z0-9]/u.test(password))
    failures.push("PASSWORD_SPECIAL_REQUIRED");
  const normalizedPassword = normalized(password);
  if (
    significantIdentityParts(identity).some((part) =>
      normalizedPassword.includes(part),
    )
  )
    failures.push("PASSWORD_CONTAINS_IDENTITY");
  return failures;
}

export function passwordExpiresAt(changedAt: Date): Date {
  return new Date(changedAt.getTime() + PASSWORD_MAXIMUM_AGE_MS);
}

export function passwordCanChange(changedAt: Date, now = new Date()): boolean {
  return now.getTime() - changedAt.getTime() >= PASSWORD_MINIMUM_AGE_MS;
}

export function passwordIsExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function isGenericAccountEmail(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  return new Set([
    "admin",
    "administrator",
    "default",
    "root",
    "shared",
    "test",
    "user",
  ]).has(local);
}
