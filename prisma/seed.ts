import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const SEED_USER = {
  id: "test-user-001",
  email: "founder@shoalai.com",
  credits: 50,
  plan: "FREE",
  lastCreditReset: new Date(),
} as const;

async function main() {
  const user = await prisma.user.upsert({
    where: { id: SEED_USER.id },
    create: SEED_USER,
    update: {
      email: SEED_USER.email,
      credits: SEED_USER.credits,
      plan: SEED_USER.plan,
    },
  });

  console.log("Seeded user:", {
    id: user.id,
    email: user.email,
    credits: user.credits,
  });
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
