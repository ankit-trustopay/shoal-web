import { NextResponse } from "next/server";
import { corsJsonResponse, internalErrorResponse, requireAuthUserId } from "@/lib/api-auth";
import { corsHeaderValues } from "@/lib/cors";
import { resolveUserWallet, serializeUserWallet } from "@/lib/resolve-user-wallet";

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
 * Same wallet upsert + 12:30 AM reset logic as GET /api/users/:id (used by the UI).
 */
export async function GET() {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;

  try {
    const user = await resolveUserWallet(userId);
    console.log("User fetched/created:", user);

    return corsJsonResponse(serializeUserWallet(user), 200);
  } catch (error) {
    return internalErrorResponse("[GET /api/user/me]", error);
  }
}
