import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string;
      role: "OWNER" | "ADMIN" | "RESEARCHER" | "VIEWER";
      permissions: string[];
    } & NonNullable<Session["user"]>;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    organizationId?: string;
    sessionEpoch?: number;
    securitySessionId?: string;
    role?: "OWNER" | "ADMIN" | "RESEARCHER" | "VIEWER";
    permissions?: string[];
    mfaVerified?: boolean;
  }
}
