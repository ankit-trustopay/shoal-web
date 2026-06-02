import { currentUser } from "@clerk/nextjs/server";
import type { User } from "@/app/generated/prisma/client";
import { DEFAULT_FREE_DAILY_CREDITS, DEFAULT_USER_PLAN } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

/**
 * Most recent 12:30 AM UTC boundary at or before `now`.
 * - If now is 1:00 PM, boundary is today 12:30 AM.
 * - If now is 12:15 AM, boundary is yesterday 12:30 AM.
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

async function resolveCreateEmail(userId: string): Promise<string> {
  let email = `${userId}@clerk.local`;

  try {
    const clerkUser = await currentUser();
    email =
      clerkUser?.primaryEmailAddress?.emailAddress ??
      clerkUser?.emailAddresses[0]?.emailAddress ??
      email;
  } catch (error) {
    console.warn(
      "[resolveUserWallet] Clerk currentUser() failed; using fallback email:",
      error,
    );
  }

  return email;
}

/**
 * Upsert user wallet, apply 12:30 AM UTC daily reset, and guarantee new users
 * receive 150 daily credits on first login.
 */
export async function resolveUserWallet(userId: string): Promise<User> {
  const now = new Date();
  const email = await resolveCreateEmail(userId);

  const user = await prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email,
      dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
      vaultCredits: 0,
      lastDailyReset: now,
      plan: DEFAULT_USER_PLAN,
    },
    update: {},
  });

  const mostRecent1230AM = getMostRecent1230AM(now);

  if (user.lastDailyReset < mostRecent1230AM) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
        lastDailyReset: now,
      },
    });
  }

  return user;
}

export function serializeUserWallet(user: User) {
  return {
    id: user.id,
    email: user.email,
    dailyCredits: user.dailyCredits,
    vaultCredits: user.vaultCredits,
    plan: user.plan,
    lastDailyReset: user.lastDailyReset.toISOString(),
  };
}
