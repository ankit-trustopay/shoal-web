import { currentUser } from "@clerk/nextjs/server";
import type { User } from "@/app/generated/prisma/client";
import { DEFAULT_FREE_DAILY_CREDITS, DEFAULT_USER_PLAN } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

/**
 * Most recent 12:30 AM UTC boundary at or before `now`.
 */
export function getMostRecent1230AM(now: Date = new Date()): Date {
  const todayAt1230 = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      30,
      0,
      0,
    ),
  );

  if (now.getTime() >= todayAt1230.getTime()) {
    return todayAt1230;
  }

  const yesterdayAt1230 = new Date(todayAt1230);
  yesterdayAt1230.setUTCDate(yesterdayAt1230.getUTCDate() - 1);
  return yesterdayAt1230;
}

async function resolveUserEmail(clerkUserId: string): Promise<string> {
  let userEmail = `${clerkUserId}@clerk.local`;

  try {
    const clerkUser = await currentUser();
    userEmail =
      clerkUser?.primaryEmailAddress?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      userEmail;
  } catch (error) {
    console.warn(
      "[resolveUserWallet] Clerk currentUser() failed; using fallback email:",
      error,
    );
  }

  return userEmail;
}

function dailyCreditsNeedsPatch(value: number | null | undefined): boolean {
  return value == null || Number.isNaN(value);
}

/**
 * Bulletproof wallet upsert for Clerk users.
 * - upsert on clerkId
 * - create with 150 daily credits
 * - 12:30 AM UTC reset when lastDailyReset is before the latest boundary
 * - patch null/missing dailyCredits to 150
 */
export async function resolveUserWallet(userId: string): Promise<User> {
  const now = new Date();
  const userEmail = await resolveUserEmail(userId);

  // Legacy rows created before clerkId existed (id was the Clerk user id).
  const legacy = await prisma.user.findFirst({
    where: {
      OR: [{ clerkId: userId }, { id: userId }],
    },
  });

  if (legacy && legacy.clerkId !== userId) {
    await prisma.user.update({
      where: { id: legacy.id },
      data: { clerkId: userId },
    });
  }

  let user = await prisma.user.upsert({
    where: { clerkId: userId },
    update: {},
    create: {
      clerkId: userId,
      // Keep id = Clerk user id so existing Swarm.userId FK rows keep working.
      id: userId,
      email: userEmail,
      dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
      vaultCredits: 0,
      lastDailyReset: now,
      plan: DEFAULT_USER_PLAN,
    },
  });

  console.log("User fetched/created:", user);

  const mostRecent1230AM = getMostRecent1230AM(now);

  if (user.lastDailyReset < mostRecent1230AM) {
    user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
        lastDailyReset: now,
      },
    });
    console.log("User fetched/created:", user);
  }

  if (dailyCreditsNeedsPatch(user.dailyCredits)) {
    user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
      },
    });
    console.log("User fetched/created:", user);
  }

  return user;
}

export function serializeUserWallet(user: User) {
  return {
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    dailyCredits: user.dailyCredits,
    vaultCredits: user.vaultCredits,
    plan: user.plan,
    lastDailyReset: user.lastDailyReset.toISOString(),
  };
}
