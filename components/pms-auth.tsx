"use client";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { Building2, LogOut, ArrowRight } from "lucide-react";
import { authClient } from "../lib/auth-client";
import { identityFromSession, type PmsIdentity } from "../lib/pms-identity";
import "./pms-auth.css";

export type AuthMode = "sign-in" | "sign-up" | "verify-email" | "forgot-password" | "reset-password";
const titles: Record<AuthMode, string> = {
  "sign-in": "Log in to your PMS.", "sign-up": "Create your account.",
  "verify-email": "Verify your email.", "forgot-password": "Reset your password.", "reset-password": "Choose a new password.",
};
const errorText = (error: unknown, fallback: string) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
};

export function LogoutButton({ className = "btn", style }: { className?: string; style?: CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const logout = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw result.error;
      window.location.replace("/login");
    } catch { setError("Could not log out. Please try again."); setBusy(false); }
  };
  return <><button type="button" className={className} style={style} disabled={busy} onClick={() => void logout()}><LogOut size={16}/>{busy ? "Logging out…" : "Log out"}</button>{error && <p className="auth-inline-error" role="alert">{error}</p>}</>;
}

export function AuthPanel({ initialMode = "sign-in", token = "" }: {
  initialMode?: AuthMode; token?: string;
}) {
  const [identity, setIdentity] = useState<PmsIdentity>({ status: "anonymous" });
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    // Refresh through a Route Handler: Server Components cannot set the
    // replacement cookies returned by Neon for an older or revoked session.
    void (async () => {
      try {
        const response = await fetch("/api/auth/get-session?disableCookieCache=true", {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Sign-in could not be checked. Please try again.");
        const current = identityFromSession(await response.json());
        if (current.status === "invalid") throw new Error("Sign-in could not be checked. Please try again.");
        if (controller.signal.aborted) return;
        setIdentity(current);
        if (current.status === "unverified") {
          setEmail(current.email);
          if (initialMode !== "reset-password") setMode("verify-email");
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(errorText(failure, "Sign-in could not be checked. Please try again."));
      } finally { if (!controller.signal.aborted) setCheckingSession(false); }
    })();
    return () => controller.abort();
  }, [initialMode]);
  const changeMode = (next: AuthMode) => { setMode(next); setPassword(""); setConfirmation(""); setError(""); setMessage(""); };
  const openWorkspace = () => window.location.assign("/");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const normalizedEmail = email.trim().toLowerCase();
      if (mode === "sign-in") {
        const result = await authClient.signIn.email({ email: normalizedEmail, password });
        if (result.error) {
          if (result.error.code === "EMAIL_NOT_VERIFIED") {
            setMode("verify-email"); setPassword(""); setMessage("Enter your email verification code. Request a new code below if needed."); return;
          }
          throw result.error;
        }
        openWorkspace();
      } else if (mode === "sign-up") {
        const result = await authClient.signUp.email({ email: normalizedEmail, name: name.trim(), password });
        if (result.error) throw result.error;
        setPassword("");
        if (result.data?.user?.emailVerified === true) openWorkspace();
        else { setMode("verify-email"); setMessage("Check your email and enter the verification code. An account alone does not grant access to another property's records."); }
      } else if (mode === "verify-email") {
        const result = await authClient.emailOtp.verifyEmail({ email: normalizedEmail, otp: code.trim() });
        if (result.error) throw result.error;
        setCode("");
        const session = await authClient.getSession();
        if (session.error) throw session.error;
        if (session.data?.user?.emailVerified === true) openWorkspace();
        else { setMode("sign-in"); setMessage("Your email is verified. Log in to open your workspace."); }
      } else if (mode === "forgot-password") {
        const result = await authClient.requestPasswordReset({ email: normalizedEmail, redirectTo: new URL("/auth/reset-password", window.location.origin).href });
        if (result.error) throw result.error;
        setMessage("If an account matches this email, password reset instructions will arrive shortly.");
      } else {
        if (!token) throw new Error("This reset link is missing its token. Request a new link.");
        if (password !== confirmation) throw new Error("The passwords do not match.");
        const result = await authClient.resetPassword({ newPassword: password, token });
        if (result.error) throw result.error;
        setPassword(""); setConfirmation(""); setMode("sign-in"); setMessage("Password updated. Log in with your new password.");
      }
    } catch (failure) { setError(errorText(failure, "Sign-in is temporarily unavailable. Please try again.")); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (busy) return;
    if (!email.trim()) { setError("Enter your sign-in email first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "email-verification" });
      if (result.error) throw result.error;
      setMessage("A new verification code has been requested. Check your inbox.");
    } catch (failure) { setError(errorText(failure, "The code could not be sent. Please try again.")); }
    finally { setBusy(false); }
  };
  const authenticated = identity.status === "authenticated";
  return <main className="onboarding auth-page">
    <div className="brand-symbol"><Building2 size={28}/></div>
    <div className="eyebrow">MEHMAAN · PROPERTY MANAGEMENT</div>
    <h1>{authenticated && mode !== "reset-password" ? "Your PMS account." : titles[mode]}</h1>
    <p>Use your own email and password. Property access follows the permissions your owner assigns.</p>
    {checkingSession ? <p role="status">Checking your session…</p> : authenticated && mode !== "reset-password" ? <>
      <div className="login-account"><span className="text-small muted">Signed in as</span><strong>{identity.user.displayName}</strong><span>{identity.user.email}</span></div>
      <div className="actions auth-actions"><a className="btn btn-primary" href="/">Open PMS <ArrowRight size={16}/></a><LogoutButton/></div>
    </> : <>
      {identity.status !== "unverified" && (mode === "sign-in" || mode === "sign-up") && <div className="auth-tabs" aria-label="Account access"><button type="button" className={`btn ${mode === "sign-in" ? "btn-primary" : ""}`} disabled={busy} onClick={() => changeMode("sign-in")}>Log in</button><button type="button" className={`btn ${mode === "sign-up" ? "btn-primary" : ""}`} disabled={busy} onClick={() => changeMode("sign-up")}>Create account</button></div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      {mode === "reset-password" && !token && <div className="notice error" role="alert">This reset link is incomplete. <button type="button" className="link-button" onClick={() => changeMode("forgot-password")}>Request a new reset link</button></div>}
      {mode === "verify-email" && <p className="auth-help">Enter the verification code from your email. Verify the same email your property owner added.</p>}
      <form className="auth-form" onSubmit={submit}>
        {mode === "sign-up" && <label className="field"><span>Full name</span><input value={name} onChange={event => setName(event.target.value)} required maxLength={120} autoComplete="name" disabled={busy}/></label>}
        {mode !== "reset-password" && <label className="field"><span>Email</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoComplete="email" disabled={busy} readOnly={identity.status === "unverified"}/></label>}
        {(mode === "sign-in" || mode === "sign-up" || mode === "reset-password") && <label className="field"><span>{mode === "reset-password" ? "New password" : "Password"}</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={mode === "sign-in" ? undefined : 8} maxLength={128} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} disabled={busy}/>{mode !== "sign-in" && <small>Use at least 8 characters.</small>}</label>}
        {mode === "reset-password" && <label className="field"><span>Confirm new password</span><input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy}/></label>}
        {mode === "verify-email" && <label className="field"><span>Verification code</span><input value={code} onChange={event => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" required maxLength={12} disabled={busy}/></label>}
        <button className="btn btn-primary" disabled={busy || (mode === "reset-password" && !token)}>{busy ? "Please wait…" : mode === "sign-in" ? "Log in" : mode === "sign-up" ? "Create account" : mode === "verify-email" ? "Verify email" : mode === "forgot-password" ? "Send reset instructions" : "Save new password"}</button>
      </form>
      <div className="auth-secondary">
        {mode === "sign-in" && <button type="button" className="link-button" disabled={busy} onClick={() => changeMode("forgot-password")}>Forgot password?</button>}
        {mode === "verify-email" && <button type="button" className="link-button" disabled={busy} onClick={() => void resend()}>Send a new verification code</button>}
        {identity.status !== "unverified" && mode !== "sign-in" && <button type="button" className="link-button" disabled={busy} onClick={() => changeMode("sign-in")}>Back to log in</button>}
        {identity.status === "unverified" && <LogoutButton/>}
      </div>
      <p className="auth-help">Creating a login does not add you to an existing hotel. Ask its owner to add your verified email in Staff & assignments.</p>
    </>}
    <a className="auth-home" href="/">Back to PMS</a>
  </main>;
}
