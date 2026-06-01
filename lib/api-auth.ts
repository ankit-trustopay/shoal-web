import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { corsHeaders } from "@/lib/cors";

export function corsJsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

function internalErrorResponse(context: string, error: unknown) {
  console.error(context, error);
  const detail =
    error instanceof Error ? error.message : "Unexpected server error";
  return corsJsonResponse(
    {
      error: "Internal server error",
      message:
        process.env.NODE_ENV === "development" ? detail : "Something went wrong",
    },
    500,
  );
}

export async function requireAuthUserId(): Promise<
  { userId: string } | { response: NextResponse }
> {
  try {
    const authState = await auth();
    const userId = authState.userId;

    if (!userId) {
      return {
        response: corsJsonResponse(
          { error: "Unauthorized", message: "Valid Clerk session required" },
          401,
        ),
      };
    }

    return { userId };
  } catch (error) {
    return {
      response: internalErrorResponse("[auth] Clerk validation failed:", error),
    };
  }
}

export { internalErrorResponse };
