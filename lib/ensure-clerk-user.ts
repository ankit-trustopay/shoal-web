import { currentUser } from "@clerk/nextjs/server";
import type { User } from "@/app/generated/prisma/client";
import {
  applyDailyCreditResetIfNeeded,
  newUserDefaults,
} from "@/lib/daily-credit-reset";
import { prisma } from "@/lib/prisma";

/**
 * Ensure a Prisma User row exists for the authenticated Clerk user and apply
 * daily FREE-plan credit reset when the UTC calendar day has changed.
 */
export async function ensureClerkUser(userId: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });

  if (existing) {
    return applyDailyCreditResetIfNeeded(existing);
  }

  let email = `${userId}@clerk.local`;

  try {
    const clerkUser = await currentUser();
    email =
      clerkUser?.primaryEmailAddress?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      email;
  } catch (error) {
    console.warn(
      "[ensureClerkUser] Clerk currentUser() failed; using fallback email:",
      error,
    );
  }

  const created = await prisma.user.create({
    data: {
      id: userId,
      email,
      dailyCredits: newUserDefaults.dailyCredits,
      vaultCredits: newUserDefaults.vaultCredits,
      plan: newUserDefaults.plan,
      lastDailyReset: newUserDefaults.lastDailyReset,
    },
  });

  return created;
}
