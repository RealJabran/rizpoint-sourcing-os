import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_SECONDS = 15 * 60;
type Payload = { organizationId: string; expiresAt: number };
function secret() {
  const value =
    process.env.NEXTAUTH_SECRET ?? process.env.RIZPOINT_PRIVATE_ACCESS_TOKEN;
  if (!value) throw new Error("RESEARCH_COMPANION_SESSION_SECRET_UNAVAILABLE");
  return value;
}
function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}
export function createResearchCompanionSession(organizationId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      organizationId,
      expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS,
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
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied) return null;
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
    return typeof value.organizationId === "string" &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt > Math.floor(Date.now() / 1000)
      ? value
      : null;
  } catch {
    return null;
  }
}
