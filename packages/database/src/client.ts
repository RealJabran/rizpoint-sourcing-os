import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

// A non-routable development placeholder keeps build-time module evaluation safe.
// Runtime paths that access the database still fail if a real connection is absent.
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://invalid:invalid@127.0.0.1:1/invalid";

const adapter = new PrismaPg({ connectionString });

export const db = new PrismaClient({ adapter });
