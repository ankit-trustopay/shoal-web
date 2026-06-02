import type { User } from "@/app/generated/prisma/client";
import {
  DEFAULT_FREE_DAILY_CREDITS,
  DEFAULT_USER_PLAN,
  isFreePlan,
} from "@/lib/billing";
import { prisma } from "@/lib/prisma";

/** UTC calendar day as YYYY-MM-DD for stable day-boundary checks. */
export function utcCalendarDayKey(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isNewUtcCalendarDay(
  lastReset: Date,
  now: Date = new Date(),
): boolean {
  return utcCalendarDayKey(lastReset) !== utcCalendarDayKey(now);
}

/**
 * On a new UTC calendar day, FREE-plan users receive exactly 150 daily credits (no stacking).
 * All users advance lastDailyReset so the check runs once per day.
 */
export async function applyDailyCreditResetIfNeeded(user: User): Promise<User> {
  if (!isNewUtcCalendarDay(user.lastResetDate)) {
    return user;
  }

  const now = new Date();
  const data: { lastResetDate: Date; dailyCredits?: number } = {
    lastResetDate: now,
  };

  if (isFreePlan(user.plan)) {
    // Strict overwrite — never add to balance; leftover daily credits expire at UTC midnight.
    data.dailyCredits = DEFAULT_FREE_DAILY_CREDITS;
  }

  return prisma.user.update({
    where: { id: user.id },
    data,
  });
}

export const newUserDefaults = {
  dailyCredits: DEFAULT_FREE_DAILY_CREDITS,
  vaultCredits: 0,
  plan: DEFAULT_USER_PLAN,
  lastResetDate: new Date(),
} as const;
