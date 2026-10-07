import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/* Prisma 7 connects through a driver adapter rather than a URL in the
   schema. One client per process; Next's dev server re-evaluates
   modules on every change, so it is cached on globalThis. */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set — `npm run setup:env` writes a .env with one and with generated secrets");
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/* The pool's two timeouts, which pg leaves at "never": a request that cannot get a connection (the database restarting, a pool used up)
   waits for ever, and a page that hangs for a minute is worse than one that says it could not. Five seconds to get a connection, and a
   connection nobody used for half a minute goes back, so a quiet panel does not hold ten of them open against a small Postgres. */
const POOL = { connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...POOL }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
