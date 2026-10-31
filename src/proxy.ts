import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/jwt";

export function proxy(request: NextRequest) {
  const demoRequested = request.nextUrl.searchParams.get("demo") === "1";
  const demoPage = demoRequested && ["/dashboard", "/legacy/dashboard.html"].includes(request.nextUrl.pathname);
  const demoDataPath = new Set(["/api/air-quality/current", "/api/air-quality/geocode", "/api/air-quality/status", "/api/air-quality/stations", "/api/air-quality/history"]);
  const demoDataRequest = demoRequested && request.method === "GET" && demoDataPath.has(request.nextUrl.pathname);
  if (demoPage || demoDataRequest) return NextResponse.next();

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
