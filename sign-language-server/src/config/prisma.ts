import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing required database setting: DATABASE_URL");
}

const pool = new Pool({
  connectionString,
  max: process.env.VERCEL ? 1 : 5,
});

if (process.env.VERCEL) {
  attachDatabasePool(pool);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(pool),
});

export default prisma;
