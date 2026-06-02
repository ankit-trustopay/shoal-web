import { corsJsonResponse, internalErrorResponse, requireAuthUserId } from "@/lib/api-auth";
import { resolveUserWallet, serializeUserWallet } from "@/lib/resolve-user-wallet";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/users/:id
 * Upserts the authenticated user's wallet, applies 12:30 AM UTC daily reset,
 * and returns daily + vault credits.
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

    const user = await resolveUserWallet(userId);

    return corsJsonResponse(serializeUserWallet(user), 200);
  } catch (error) {
    return internalErrorResponse("[GET /api/users/[id]]", error);
  }
}
