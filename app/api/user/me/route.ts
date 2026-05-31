import { NextResponse } from "next/server";
import { corsJsonResponse, requireAuthUserId } from "@/lib/api-auth";
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
 * Returns the authenticated user's credit balance and plan from the database.
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
        credits: user.credits,
        plan: user.plan,
      },
      200,
    );
  } catch (error) {
    console.error("[GET /api/user/me] Database error:", error);
    return corsJsonResponse({ error: "Internal server error" }, 500);
  }
}
