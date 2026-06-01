import type { User } from "@/app/generated/prisma/client";
import { DEFAULT_FREE_CREDITS, DEFAULT_USER_PLAN, isFreePlan } from "@/lib/billing";
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
 * On a new UTC calendar day, FREE-plan users receive exactly 50 credits (no stacking).
 * All users advance lastCreditReset so the check runs once per day.
 */
export async function applyDailyCreditResetIfNeeded(user: User): Promise<User> {
  if (!isNewUtcCalendarDay(user.lastCreditReset)) {
    return user;
  }

  const now = new Date();
  const data: { lastCreditReset: Date; credits?: number } = {
    lastCreditReset: now,
  };

  if (isFreePlan(user.plan)) {
    data.credits = DEFAULT_FREE_CREDITS;
  }

  return prisma.user.update({
    where: { id: user.id },
    data,
  });
}

export const newUserDefaults = {
  credits: DEFAULT_FREE_CREDITS,
  plan: DEFAULT_USER_PLAN,
  lastCreditReset: new Date(),
} as const;
