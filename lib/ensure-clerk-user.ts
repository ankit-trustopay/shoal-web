import { currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const DEFAULT_FREE_CREDITS = 50;

/**
 * Ensure a Prisma User row exists for the authenticated Clerk user.
 */
export async function ensureClerkUser(userId: string) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (existing) {
    return existing;
  }

  const clerkUser = await currentUser();
  const email =
    clerkUser?.primaryEmailAddress?.emailAddress ??
    clerkUser?.emailAddresses[0]?.emailAddress ??
    `${userId}@clerk.local`;

  return prisma.user.create({
    data: {
      id: userId,
      email,
      credits: DEFAULT_FREE_CREDITS,
    },
  });
}
