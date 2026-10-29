import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

async function handleAuth(request: Request) {
  try {
    const handlers = toNextJsHandler(getAuth());
    return await (request.method === "GET" ? handlers.GET(request) : handlers.POST(request));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Authentication is unavailable.";
    return Response.json({ message: detail }, { status: 503 });
  }
}

export const GET = handleAuth;
export const POST = handleAuth;
