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
 * applyDailyCreditResetIfNeeded: on a new UTC calendar day, FREE users get credits
 * set to exactly 50 (not stacked with any prior balance).
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
        credits: user.credits,
        plan: user.plan,
        lastCreditReset: user.lastCreditReset.toISOString(),
      },
      200,
    );
  } catch (error) {
    return internalErrorResponse("[GET /api/user/me]", error);
  }
}
