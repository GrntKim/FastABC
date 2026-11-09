import { type NextRequest, NextResponse } from "next/server";

// Set by the API on localhost:8000; cookies ignore ports, so the web app sees it too.
// Only its presence is checked here: the API decides whether it is valid, and a 401 brings the user back to /login.
const SESSION_COOKIE = "fastabc_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  // every page except the login page and Next's own files
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
