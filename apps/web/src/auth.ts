import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import CredentialsProvider from "next-auth/providers/credentials";
import type { NextAuthOptions } from "next-auth";
import { db } from "@rizpoint/database";

const scrypt = promisify(scryptCallback);

type PasswordHash = {
  salt: string;
  digest: string;
};

function parsePasswordHash(value: string): PasswordHash | null {
  const [scheme, salt, digest] = value.split("$");
  return scheme === "scrypt-v1" && salt && digest ? { salt, digest } : null;
}

export async function verifyPassword(password: string, stored: string) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const derived = (await scrypt(
    password,
    Buffer.from(parsed.salt, "base64url"),
    64,
  )) as Buffer;
  const expected = Buffer.from(parsed.digest, "base64url");
  return (
    expected.length === derived.length && timingSafeEqual(expected, derived)
  );
}

export async function createPasswordHash(password: string) {
  if (password.length < 14) throw new Error("PASSWORD_TOO_SHORT");
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt-v1$${salt.toString("base64url")}$$${derived.toString("base64url")}`.replace(
    "$$",
    "$",
  );
}

export const authOptions: NextAuthOptions = {
  ...(process.env.NEXTAUTH_SECRET
    ? { secret: process.env.NEXTAUTH_SECRET }
    : {}),
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "RizPoint private access",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;
        const user = await db.user.findUnique({
          where: { email },
          include: {
            memberships: {
              take: 1,
              orderBy: { createdAt: "asc" },
              include: { organization: { select: { slug: true } } },
            },
          },
        });
        if (!user || !user.active || user.memberships.length !== 1) return null;
        if (
          process.env.RIZPOINT_PRIVATE_MODE === "true" &&
          user.memberships[0]?.organization.slug !==
            process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG
        )
          return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.displayName ?? user.email,
          organizationId: user.memberships[0]!.organizationId,
          sessionEpoch: user.sessionEpoch,
        } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const principal = user as unknown as {
          organizationId: string;
          sessionEpoch: number;
        };
        token.organizationId = principal.organizationId;
        token.sessionEpoch = principal.sessionEpoch;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.organizationId = String(token.organizationId ?? "");
      }
      return session;
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
