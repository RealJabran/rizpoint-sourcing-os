import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";
import { db } from "@rizpoint/database";
import { permissionsForRole } from "./security/authorization";
import { completeMfaAuthentication } from "./security/authentication";

export { createPasswordHash, verifyPassword } from "./security/password-hash";

export const authOptions: NextAuthOptions = {
  ...(process.env.NEXTAUTH_SECRET
    ? { secret: process.env.NEXTAUTH_SECRET }
    : {}),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "RizPoint MFA challenge",
      credentials: {
        challengeToken: { label: "Authentication challenge", type: "text" },
        mfaCode: { label: "Authenticator code", type: "text" },
        recoveryCode: { label: "Recovery code", type: "text" },
      },
      async authorize(credentials) {
        const challengeToken = credentials?.challengeToken;
        if (!challengeToken) return null;
        const principal = await completeMfaAuthentication({
          challengeToken,
          ...(credentials?.mfaCode ? { code: credentials.mfaCode } : {}),
          ...(credentials?.recoveryCode
            ? { recoveryCode: credentials.recoveryCode }
            : {}),
        });
        return principal as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const principal = user as unknown as {
          organizationId: string;
          role: "OWNER" | "ADMIN" | "RESEARCHER" | "VIEWER";
          sessionEpoch: number;
          securitySessionId: string;
        };
        token.organizationId = principal.organizationId;
        token.role = principal.role;
        token.permissions = permissionsForRole(principal.role);
        token.sessionEpoch = principal.sessionEpoch;
        token.securitySessionId = principal.securitySessionId;
        token.mfaVerified = true;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.organizationId = String(token.organizationId ?? "");
        session.user.role = String(token.role ?? "VIEWER") as
          "OWNER" | "ADMIN" | "RESEARCHER" | "VIEWER";
        session.user.permissions = Array.isArray(token.permissions)
          ? token.permissions.map(String)
          : [];
      }
      return session;
    },
  },
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const sessionId = String(token?.securitySessionId ?? "");
      if (!sessionId) return;
      await db.userSession.updateMany({
        where: { id: sessionId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: "USER_SIGN_OUT" },
      });
    },
  },
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Secure-rizpoint.session-token"
          : "rizpoint.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
};
