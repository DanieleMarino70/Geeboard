import path from "node:path";
import process from "node:process";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer reads .env on its own.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // Already in the environment (CI, docker), or no .env file — fine.
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
