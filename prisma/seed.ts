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
  clerkId: "test-user-001",
  email: "founder@shoalai.com",
  dailyCredits: 150,
  vaultCredits: 0,
  plan: "FREE",
  lastDailyReset: new Date(),
} as const;

async function main() {
  const user = await prisma.user.upsert({
    where: { clerkId: SEED_USER.clerkId },
    create: SEED_USER,
    update: {
      email: SEED_USER.email,
      dailyCredits: SEED_USER.dailyCredits,
      vaultCredits: SEED_USER.vaultCredits,
      plan: SEED_USER.plan,
    },
  });

  console.log("Seeded user:", {
    id: user.id,
    email: user.email,
    dailyCredits: user.dailyCredits,
    vaultCredits: user.vaultCredits,
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
