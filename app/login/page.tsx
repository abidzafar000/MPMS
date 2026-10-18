import { Building2, ArrowRight, LogIn, LogOut } from "lucide-react";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from "../chatgpt-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Login · Mehmaan PMS" };

export default async function LoginPage() {
  const user = await getChatGPTUser();
  return <main className="onboarding login-page">
    <div className="brand-symbol"><Building2 size={28}/></div>
    <div className="eyebrow">MEHMAAN · PROPERTY MANAGEMENT</div>
    <h1>Log in to your PMS.</h1>
    <p>Open your property workspace to manage bookings, rooms and your front desk.</p>
    {user ? <>
      <div className="login-account"><span className="text-small muted">Signed in as</span><strong>{user.displayName}</strong><span>{user.email}</span></div>
      <div className="actions login-actions">
        <a className="btn btn-primary" href="/">Open PMS <ArrowRight size={16}/></a>
        <a className="btn" href={chatGPTSignOutPath("/login")} target="_top"><LogOut size={16}/>Log out</a>
      </div>
      <p className="text-small login-help">To use another account, log out and then sign in with that account.</p>
    </> : <>
      <a className="btn btn-primary" href={chatGPTSignInPath("/")} target="_top"><LogIn size={16}/>Log in with ChatGPT</a>
      <p className="text-small login-help">Use the account your property owner has granted access to.</p>
    </>}
  </main>;
}
