import type { User } from "@/app/generated/prisma/client";
import { resolveUserWallet } from "@/lib/resolve-user-wallet";

/**
 * Ensure a Prisma User row exists for the authenticated Clerk user.
 * Delegates to resolveUserWallet (upsert + 12:30 AM reset).
 */
export async function ensureClerkUser(userId: string): Promise<User> {
  return resolveUserWallet(userId);
}
