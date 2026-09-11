import { defineConfig } from "prisma/config";

/**
 * Prisma 7 no longer auto-loads env files, and `datasource.directUrl` was
 * removed. Node 24's built-in loader lets us keep secrets in `.env.local`
 * (as specced) without adding `dotenv` as a dependency.
 *
 * Precedence: real process env wins on Vercel, where no `.env.local` exists
 * and loadEnvFile throws harmlessly.
 */
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // Absent or unreadable — expected in CI and on Vercel.
  }
}

/**
 * The CLI (migrate, db push, studio) wants the UNPOOLED Neon URL; running
 * migrations through a connection pooler is unreliable. The runtime client
 * uses the pooled URL instead — see lib/db.ts.
 *
 * Read lazily via process.env rather than prisma/config's `env()` helper,
 * which throws on a missing variable. `prisma generate` must succeed with no
 * database configured at all, because it runs during the Vercel build.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
