import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

export function proxy(request: NextRequest) {
  const token = request.cookies.get("airguard_token")?.value;
  let authenticated = false;
  try { authenticated = Boolean(token && verifyToken(token)); } catch { authenticated = false; }
  if (authenticated) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to access your AirGuard data." }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/", request.url));
}

export const config = { matcher: ["/dashboard/:path*", "/legacy/dashboard.html", "/api/air-quality/:path*"] };
