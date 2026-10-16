import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/register-admin",
  "/forgot-password",
  "/reset-password",
];

const AUTH_REDIRECT_PATHS = [
  "/login",
  "/register",
  "/register-admin",
];

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET
);

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some((path) =>
    pathname.startsWith(path)
  );

  const isAuthRedirectPath = AUTH_REDIRECT_PATHS.some((path) =>
    pathname.startsWith(path)
  );

  const isApiAuth = pathname.startsWith("/api/auth");

  const isStaticAsset =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/images");

  // Authentication API routes and static assets remain accessible.
  if (isApiAuth || isStaticAsset) {
    return NextResponse.next();
  }

  const token = request.cookies.get("token")?.value;

  /*
   * No token.
   */
  if (!token) {
    if (isPublic) {
      return NextResponse.next();
    }

    return NextResponse.redirect(
      new URL("/login", request.url)
    );
  }

  /*
   * Verify token.
   */
  let payload;

  try {
    const result = await jwtVerify(
      token,
      JWT_SECRET
    );

    payload = result.payload;
  } catch {
    const response = isPublic
      ? NextResponse.next()
      : NextResponse.redirect(
          new URL("/login", request.url)
        );

    /*
     * Remove invalid/expired token.
     */
    response.cookies.set("token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  }

  /*
   * IMPORTANT:
   *
   * A valid JWT must also contain a user ID.
   *
   * This prevents old/broken tokens such as:
   *
   * { role: "admin" }
   *
   * from being treated as authenticated.
   */
  if (!payload.sub) {
    const response = isPublic
      ? NextResponse.next()
      : NextResponse.redirect(
          new URL("/login", request.url)
        );

    response.cookies.set("token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return response;
  }

  /*
   * Authenticated user visiting login/register pages.
   */
  if (isPublic && isAuthRedirectPath) {
    return NextResponse.redirect(
      new URL("/dashboard", request.url)
    );
  }

  /*
   * Public pages are accessible.
   */
  if (isPublic) {
    return NextResponse.next();
  }

  /*
   * Protected route with valid JWT.
   */
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};