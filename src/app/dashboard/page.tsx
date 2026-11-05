import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { authenticateToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await authenticateToken(token).catch(() => null);
  if (!user) redirect("/");
  redirect("/legacy/dashboard.html");
}
