import { NextRequest, NextResponse } from "next/server";

// Gatekeeping only: presence of the session cookie decides whether the
// browser gets the app shell or the login page. Whether that cookie is
// actually a live session is decided server-side — /api/auth/me on load,
// and requireUser() inside every write route — so a forged cookie shows an
// empty shell but can neither read job data nor save anything.
const SESSION_COOKIE = "session_token";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    // The sign-in screen's calendar. Everything under /api/public/ is readable
    // by anyone who can reach the app, so nothing may be added here without
    // deciding that its contents are safe to publish — see the route itself.
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|gif|ico|webp)$/.test(pathname);

  if (isPublic) return NextResponse.next();

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
