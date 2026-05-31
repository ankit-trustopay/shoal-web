import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { corsHeaders } from "@/lib/cors";

export function corsJsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders() });
}

export async function requireAuthUserId(): Promise<
  { userId: string } | { response: NextResponse }
> {
  const { userId } = await auth();

  if (!userId) {
    return {
      response: corsJsonResponse({ error: "Unauthorized" }, 401),
    };
  }

  return { userId };
}
