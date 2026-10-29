import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth redirect: send visitors without a session cookie to /login
 * with a real 307 before rendering. This is only a UX shortcut — every page
 * and Server Action still verifies the session (and ownership/role) itself.
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/book/:path*", "/checkout/:path*", "/rentals/:path*", "/profile/:path*", "/admin/:path*"],
};
