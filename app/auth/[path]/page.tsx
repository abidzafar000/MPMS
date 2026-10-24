import { notFound } from "next/navigation";
import { AuthPanel, type AuthMode } from "../../../components/pms-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account access · Mehmaan PMS" };
const modes = new Set<AuthMode>(["sign-in", "sign-up", "verify-email", "forgot-password", "reset-password"]);

export default async function AuthPage({ params, searchParams }: {
  params: Promise<{ path: string }>; searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { path } = await params;
  if (!modes.has(path as AuthMode)) notFound();
  const query = await searchParams;
  const token = typeof query.token === "string" && query.token.length <= 4000 ? query.token : "";
  return <AuthPanel initialMode={path as AuthMode} token={token}/>;
}
