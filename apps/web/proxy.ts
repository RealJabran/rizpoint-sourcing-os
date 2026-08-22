import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@rizpoint/database";
import { assertProductionConfiguration } from "./src/runtime-config";

const publicPaths = [
  "/login",
  "/api/auth",
  "/api/health",
  "/api/ready",
  "/api/providers/amazon/oauth/callback",
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
  if (token?.sub && token.organizationId && Number.isInteger(sessionEpoch)) {
    const privateOrganizationSlug =
      process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG;
    if (!privateOrganizationSlug) return unauthorized(request, pathname);
    const user = await db.user.findFirst({
      where: {
        id: token.sub,
        active: true,
        sessionEpoch,
        memberships: {
          some: {
            organizationId: String(token.organizationId),
            organization: { slug: privateOrganizationSlug },
          },
        },
      },
      select: { id: true },
    });
    if (!user) return unauthorized(request, pathname);
    const headers = new Headers(request.headers);
    headers.set("x-rizpoint-organization-id", String(token.organizationId));
    return NextResponse.next({ request: { headers } });
  }
  return unauthorized(request, pathname);
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
