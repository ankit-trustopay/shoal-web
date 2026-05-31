import { currentUser } from "@clerk/nextjs/server";
import { DEFAULT_FREE_CREDITS, DEFAULT_USER_PLAN } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

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
      plan: DEFAULT_USER_PLAN,
    },
  });
}
