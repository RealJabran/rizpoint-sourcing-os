import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@rizpoint/database";
import { assertProductionConfiguration } from "./src/runtime-config";
import {
  requiredPermissionForRequest,
  roleHasPermission,
} from "./src/security/authorization";
import { SESSION_IDLE_TIMEOUT_MS } from "./src/security/authentication";

const publicPaths = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/ready",
  "/api/providers/amazon/oauth/callback",
  "/api/security/login/start",
  "/api/security/mfa/enrollment/start",
  "/api/security/mfa/enrollment/confirm",
  "/api/security/password/reset",
  "/favicon.ico",
];

export async function proxy(request: NextRequest) {
  assertProductionConfiguration();
  const { pathname } = request.nextUrl;
  const privateMode = process.env.RIZPOINT_PRIVATE_MODE === "true";
  const localDemo =
    !privateMode &&
    process.env.PHASE_ZERO_DEMO_MODE === "true" &&
    process.env.RIZPOINT_ALLOW_UNAUTHENTICATED_DEMO === "true" &&
    isLoopbackUrl(request.url) &&
    isLoopbackUrl(process.env.NEXT_PUBLIC_APP_URL) &&
    isLoopbackUrl(process.env.NEXTAUTH_URL);
  if (process.env.NODE_ENV === "production" && !privateMode && !localDemo)
    throw new Error("production_configuration_invalid:private_mode_required");
  if (!privateMode && !localDemo)
    throw new Error("local_configuration_invalid:demo_flags_required");
  if (localDemo) return NextResponse.next();
  if (process.env.NODE_ENV === "production" && !requestUsesHttps(request))
    return requireHttps(request, pathname);
  if (
    publicPaths.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  )
    return NextResponse.next();
  const token = await getToken({
    req: request,
    ...(process.env.NEXTAUTH_SECRET
      ? { secret: process.env.NEXTAUTH_SECRET }
      : {}),
  });
  const sessionEpoch = Number(token?.sessionEpoch);
  const securitySessionId = String(token?.securitySessionId ?? "");
  if (
    token?.sub &&
    token.organizationId &&
    token.mfaVerified === true &&
    securitySessionId &&
    Number.isInteger(sessionEpoch)
  ) {
    const privateOrganizationSlug =
      process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG;
    if (!privateOrganizationSlug) return unauthorized(request, pathname);
    const now = new Date();
    const user = await db.user.findFirst({
      where: {
        id: token.sub,
        active: true,
        sessionEpoch,
        mustChangePassword: false,
        passwordExpiresAt: { gt: now },
        mfaFactor: { is: { confirmedAt: { not: null }, disabledAt: null } },
        sessions: {
          some: {
            id: securitySessionId,
            organizationId: String(token.organizationId),
            sessionEpoch,
            revokedAt: null,
            expiresAt: { gt: now },
            lastSeenAt: {
              gt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS),
            },
          },
        },
        memberships: {
          some: {
            organizationId: String(token.organizationId),
            active: true,
            organization: { slug: privateOrganizationSlug },
          },
        },
      },
      select: {
        id: true,
        memberships: {
          where: {
            organizationId: String(token.organizationId),
            active: true,
          },
          take: 1,
          select: { role: true },
        },
      },
    });
    if (!user) return unauthorized(request, pathname);
    const role = user.memberships[0]?.role;
    if (!role) return unauthorized(request, pathname);
    const requiredPermission = requiredPermissionForRequest(
      pathname,
      request.method,
    );
    if (!roleHasPermission(role, requiredPermission)) {
      await db.securityAuditEvent.create({
        data: {
          organizationId: String(token.organizationId),
          actorUserId: user.id,
          eventType: "ACCESS_DENIED",
          outcome: "DENIED",
          source: "AUTHORIZATION",
          requestCorrelationId:
            request.headers.get("x-request-id")?.slice(0, 128) ?? null,
          context: {
            method: request.method,
            route: pathname.slice(0, 300),
            requiredPermission,
            role,
          },
        },
      });
      return forbidden(request, pathname);
    }
    await db.userSession.updateMany({
      where: {
        id: securitySessionId,
        userId: user.id,
        organizationId: String(token.organizationId),
        revokedAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - 60_000) },
      },
      data: { lastSeenAt: now },
    });
    const headers = new Headers(request.headers);
    headers.set("x-rizpoint-organization-id", String(token.organizationId));
    headers.set("x-rizpoint-user-id", user.id);
    headers.set("x-rizpoint-role", role);
    headers.set("x-rizpoint-required-permission", requiredPermission);
    return NextResponse.next({ request: { headers } });
  }
  return unauthorized(request, pathname);
}

function requestUsesHttps(request: NextRequest): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  return (forwarded ?? request.nextUrl.protocol.replace(":", "")) === "https";
}

function requireHttps(request: NextRequest, pathname: string): NextResponse {
  // Never forward an OAuth code or another API query through a redirect.
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "HTTPS_REQUIRED" }, { status: 400 });
  const canonical = new URL(process.env.NEXTAUTH_URL!);
  canonical.pathname = request.nextUrl.pathname;
  canonical.search = request.nextUrl.search;
  return NextResponse.redirect(canonical, 308);
}

function forbidden(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  return NextResponse.redirect(new URL("/", request.url));
}

function isLoopbackUrl(value: string | undefined): boolean {
  try {
    const hostname = new URL(value ?? "").hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

function unauthorized(request: NextRequest, pathname: string): NextResponse {
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const login = new URL("/login", request.url);
  login.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
