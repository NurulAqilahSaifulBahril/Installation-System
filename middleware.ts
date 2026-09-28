import { NextRequest, NextResponse } from "next/server";

// Gatekeeping only: presence of the session cookie decides whether the
// browser gets the app shell or the login page. Whether that cookie is
// actually a live session is decided server-side — /api/auth/me on load,
// and requireUser() inside every write route — so a forged cookie shows an
// empty shell but can neither read job data nor save anything.
const SESSION_COOKIE = "session_token";

// Lets the Electron shell (electron/main.cjs) tell this app apart from any
// other local server that happens to be listening on the same port — e.g.
// Agent CRM, a separate app built the same way, which also defaults to 3000.
// Without this, a desktop shortcut that finds *something* already on the
// port has no way to know it's the wrong app before loading it.
export const APP_ID_HEADER = "x-eternalgy-app";
export const APP_ID = "installation-ops";

function withAppId(response: NextResponse) {
  response.headers.set(APP_ID_HEADER, APP_ID);
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname === "/warehouse" ||
    pathname.startsWith("/api/auth/") ||
    // The sign-in screen's calendar. Everything under /api/public/ is readable
    // by anyone who can reach the app, so nothing may be added here without
    // deciding that its contents are safe to publish — see the route itself.
    pathname.startsWith("/api/public/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.(png|jpg|jpeg|svg|gif|ico|webp)$/.test(pathname);

  if (isPublic) return withAppId(NextResponse.next());

  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  if (hasSession) return withAppId(NextResponse.next());

  if (pathname.startsWith("/api/")) {
    return withAppId(NextResponse.json({ error: "Not signed in." }, { status: 401 }));
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return withAppId(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
