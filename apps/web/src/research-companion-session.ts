import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 15 * 60;
const TOKEN_VERSION = 1;
const TOKEN_AUDIENCE = "rizpoint-research-companion";
type Payload = {
  version: number;
  audience: string;
  organizationId: string;
  issuedAt: number;
  expiresAt: number;
};
function secret() {
  const value =
    process.env.NEXTAUTH_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : process.env.RIZPOINT_PRIVATE_ACCESS_TOKEN);
  if (!value) throw new Error("RESEARCH_COMPANION_SESSION_SECRET_UNAVAILABLE");
  return value;
}
function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}
export function createResearchCompanionSession(organizationId: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      version: TOKEN_VERSION,
      audience: TOKEN_AUDIENCE,
      organizationId,
      issuedAt,
      expiresAt: issuedAt + TTL_SECONDS,
    } satisfies Payload),
  ).toString("base64url");
  return {
    token: `${payload}.${signature(payload)}`,
    expiresAt: new Date(
      (Math.floor(Date.now() / 1000) + TTL_SECONDS) * 1000,
    ).toISOString(),
  };
}
export function verifyResearchCompanionSession(token: string): Payload | null {
  if (token.length > 4_096) return null;
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || token.split(".").length !== 2) return null;
  const expected = signature(payload);
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    return null;
  try {
    const value = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Payload;
    const now = Math.floor(Date.now() / 1000);
    return value.version === TOKEN_VERSION &&
      value.audience === TOKEN_AUDIENCE &&
      typeof value.organizationId === "string" &&
      value.organizationId.length > 0 &&
      Number.isSafeInteger(value.issuedAt) &&
      Number.isSafeInteger(value.expiresAt) &&
      value.issuedAt <= now + 60 &&
      value.expiresAt > now &&
      value.expiresAt <= value.issuedAt + TTL_SECONDS
      ? value
      : null;
  } catch {
    return null;
  }
}
