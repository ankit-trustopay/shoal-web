import { corsJsonResponse, requireAuthUserId } from "@/lib/api-auth";
import { ensureClerkUser } from "@/lib/ensure-clerk-user";
import { internalErrorResponse } from "@/lib/api-auth";

type RouteParams = { params: Promise<{ id: string }> };

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

    const user = await ensureClerkUser(userId);

    return corsJsonResponse(
      {
        id: user.id,
        email: user.email,
        dailyCredits: user.dailyCredits,
        vaultCredits: user.vaultCredits,
        plan: user.plan,
        lastDailyReset: user.lastDailyReset.toISOString(),
      },
      200,
    );
  } catch (error) {
    return internalErrorResponse("[GET /api/users/[id]]", error);
  }
}

