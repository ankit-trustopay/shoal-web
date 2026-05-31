import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { corsHeaderValues } from "@/lib/cors";

const isPublicApiRoute = createRouteMatcher(["/api/webhooks/engine(.*)"]);

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

  if (!isPublicApiRoute(request)) {
    const { userId } = await auth();

    if (!userId) {
      return withCors(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
  }

  return withCors(NextResponse.next());
});

export const config = {
  matcher: "/api/:path*",
};
