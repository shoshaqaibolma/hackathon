import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 removed `datasourceUrl` and `datasource.directUrl`; connecting now
 * goes through a driver adapter. The split is explicit:
 *
 *   - runtime (here)         -> pooled DATABASE_URL, via Neon's pgBouncer endpoint
 *   - CLI (prisma.config.ts) -> unpooled DIRECT_URL, because migrations through
 *                               a connection pooler are unreliable
 */
function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

// Next.js dev hot-reload would otherwise open a new pool on every edit.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    const client = createClient();
    if (process.env.NODE_ENV !== "production") {
      globalForPrisma.prisma = client;
      return client;
    }
    globalForPrisma.prisma = client;
  }
  return globalForPrisma.prisma;
}

/**
 * Constructed lazily on first property access, not at import time.
 *
 * /health must be able to render and report "DATABASE_URL not set" as a real
 * state. An eagerly-constructed client would throw during module evaluation
 * and take the whole page down precisely when it is most needed.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    // Prisma's methods rely on `this`; bind them to the real client so calls
    // through the proxy (including tagged templates like $queryRaw) behave.
    return typeof value === "function" ? value.bind(client) : value;
  },
});
