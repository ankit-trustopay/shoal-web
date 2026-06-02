import { NextResponse } from "next/server";
import { corsJsonResponse, internalErrorResponse, requireAuthUserId } from "@/lib/api-auth";
import { ensureClerkUser } from "@/lib/ensure-clerk-user";
import { corsHeaderValues } from "@/lib/cors";

/**
 * OPTIONS /api/user/me
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaderValues,
  });
}

/**
 * GET /api/user/me
 * Returns the authenticated user's account. On each request, ensureClerkUser runs
 * applyDailyCreditResetIfNeeded: on a new UTC calendar day, FREE users get dailyCredits
 * set to exactly 150 (not stacked) while vaultCredits are preserved.
 */
export async function GET() {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;

  try {
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
    return internalErrorResponse("[GET /api/user/me]", error);
  }
}
