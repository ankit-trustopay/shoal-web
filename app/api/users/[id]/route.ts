import { corsJsonResponse, requireAuthUserId } from "@/lib/api-auth";
import { internalErrorResponse } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

function computeDailyResetCutoff(now: Date): Date {
  // Vercel/serverless typically runs in UTC. We deliberately compute the cutoff
  // in UTC so the behavior is deterministic across regions.
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0, 0),
  );
}

/**
 * GET /api/users/:id
 * Returns the requested user's wallet snapshot.
 *
 * Important: We only allow a user to read their own Clerk ID. If the user does
 * not yet exist in Prisma (fresh login), we create them with default wallets.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) return authResult.response;

  const { userId } = authResult;

  try {
    const { id } = await params;

    if (id !== userId) {
      return corsJsonResponse({ error: "Forbidden" }, 403);
    }

    const now = new Date();
    const createdDefaults = {
      id: userId,
      // Unique constraint requires email; we can backfill later from Clerk if needed.
      email: `${userId}@clerk.local`,
      dailyCredits: 150,
      vaultCredits: 0,
      lastDailyReset: now,
    };

    // 1) Fetch by Clerk ID. 2) Create immediately if missing.
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    const user = existing
      ? existing
      : await prisma.user.create({
          data: createdDefaults,
        });

    // 3) 12:30 AM (UTC) reset logic.
    const cutoff = computeDailyResetCutoff(now);
    let resolved = user;

    if (now >= cutoff && user.lastDailyReset < cutoff) {
      resolved = await prisma.user.update({
        where: { id: userId },
        data: {
          dailyCredits: 150,
          lastDailyReset: now,
        },
      });
    }

    return corsJsonResponse(
      {
        id: resolved.id,
        email: resolved.email,
        dailyCredits: resolved.dailyCredits,
        vaultCredits: resolved.vaultCredits,
        plan: resolved.plan,
        lastDailyReset: resolved.lastDailyReset.toISOString(),
      },
      200,
    );
  } catch (error) {
    return internalErrorResponse("[GET /api/users/[id]]", error);
  }
}

