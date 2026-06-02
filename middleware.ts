import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { corsHeaderValues } from "@/lib/cors";

/**
 * @clerk/nextjs v7 — use createRouteMatcher (not legacy authMiddleware publicRoutes).
 * Webhooks must never call auth() or auth.protect(); they use ENGINE_WEBHOOK_SECRET in the route.
 */
const isWebhookRoute = createRouteMatcher(["/api/webhooks(.*)"]);

/** Routes that require a signed-in Clerk user. Everything else under /api is public. */
const isProtectedApiRoute = createRouteMatcher([
  "/api/user(.*)",
  "/api/swarms(.*)",
  "/api/debates(.*)",
]);

function isWebhookPathname(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/api/webhooks/engine" || path.startsWith("/api/webhooks/");
}

function withCors(response: NextResponse) {
  for (const [key, value] of Object.entries(corsHeaderValues)) {
    response.headers.set(key, value);
  }
  return response;
}

export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 200,
      headers: corsHeaderValues,
    });
  }

  // Engine POST /api/webhooks/engine — bypass Clerk entirely (no auth(), no protect()).
  if (isWebhookPathname(pathname) || isWebhookRoute(request)) {
    return withCors(NextResponse.next());
  }

  if (!isProtectedApiRoute(request)) {
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
  // Run Clerk on API routes except /api/webhooks/* (engine callbacks).
  matcher: ["/api/((?!webhooks).*)"],
};
