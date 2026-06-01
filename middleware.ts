import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { corsHeaderValues } from "@/lib/cors";

/**
 * Public API routes (no Clerk session). Engine webhooks use ENGINE_WEBHOOK_SECRET.
 * Equivalent to legacy authMiddleware({ publicRoutes: [...] }).
 */
const publicRoutes = ["/api/webhooks/engine", "/api/webhooks(.*)"];

const isPublicApiRoute = createRouteMatcher(publicRoutes);

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(corsHeaderValues)) {
    response.headers.set(key, value);
  }
  return response;
}

export default clerkMiddleware(async (auth, request) => {
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 200,
      headers: corsHeaderValues,
    });
  }

  if (isPublicApiRoute(request)) {
    return withCors(NextResponse.next());
  }

  const { userId } = await auth();

  if (!userId) {
    return withCors(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
  }

  return withCors(NextResponse.next());
});

export const config = {
  matcher: "/api/:path*",
};
