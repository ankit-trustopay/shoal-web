import { currentUser } from "@clerk/nextjs/server";
import type { User } from "@/app/generated/prisma/client";
import { DEFAULT_FREE_DAILY_CREDITS, DEFAULT_USER_PLAN } from "@/lib/billing";
import {
  getMostRecent1230AMIST,
  shouldResetDailyCreditsIST,
} from "@/lib/ist-credit-reset";
import { prisma } from "@/lib/prisma";

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
 * Wallet upsert + 12:30 AM IST daily credit reset on every profile fetch.
 */
export async function resolveUserWallet(userId: string): Promise<User> {
  const now = new Date();
  const userEmail = await resolveUserEmail(userId);
  const istBoundary = getMostRecent1230AMIST(now);

  console.log("[resolveUserWallet] start", {
    userId,
    now: now.toISOString(),
    istBoundary: istBoundary.toISOString(),
  });

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
      id: userId,
      email: userEmail,
      dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
      vaultCredits: 0,
      lastResetDate: now,
      plan: DEFAULT_USER_PLAN,
    },
  });

  if (shouldResetDailyCreditsIST(user.lastResetDate, now)) {
    console.log("[resolveUserWallet] applying IST 12:30 AM reset", {
      userId,
      previousReset: user.lastResetDate.toISOString(),
      dailyCreditsBefore: user.dailyCredits,
    });

    user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
        lastResetDate: now,
      },
    });

    console.log("[resolveUserWallet] reset complete", {
      userId,
      dailyCredits: user.dailyCredits,
      lastResetDate: user.lastResetDate.toISOString(),
    });
  }

  if (dailyCreditsNeedsPatch(user.dailyCredits)) {
    user = await prisma.user.update({
      where: { clerkId: userId },
      data: {
        dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
      },
    });
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
    lastResetDate: user.lastResetDate.toISOString(),
    // Legacy alias for older clients
    lastDailyReset: user.lastResetDate.toISOString(),
  };
}
