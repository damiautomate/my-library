"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Header } from "@/components/library/Header";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  onboardUser,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signUpWithEmail,
} from "@/lib/firebase/auth";
import { auth } from "@/lib/firebase/client";

type Mode = "signin" | "signup";

// Friendly translations for Firebase Auth's terse error codes.
function humanizeAuthError(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const codeMatch = raw.match(/\(auth\/[a-z0-9-]+\)/);
  const code = codeMatch ? codeMatch[0].slice(1, -1) : "";

  const map: Record<string, string> = {
    "auth/email-already-in-use":
      "An account with that email already exists. Try signing in instead.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/wrong-password": "Wrong password. Try again or reset it.",
    "auth/invalid-credential":
      "Email or password is incorrect (or this account doesn't exist).",
    "auth/user-not-found":
      "No account with that email. Sign up if you have an invitation.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests":
      "Too many attempts. Wait a moment and try again.",
    "auth/network-request-failed":
      "Network problem. Check your connection and retry.",
    "auth/popup-closed-by-user": "Google sign-in window was closed.",
    "auth/popup-blocked":
      "Your browser blocked the Google sign-in popup.",
    "auth/operation-not-allowed":
      "This sign-in method isn't enabled. Ask the librarian.",
    "auth/unauthorized-domain":
      "This domain isn't authorized in Firebase. Tell the librarian.",
  };

  if (code && map[code]) return map[code];

  // Fall back to a cleaned-up version of whatever Firebase said.
  const cleaned = raw
    .replace(/^Firebase:\s*/, "")
    .replace(/\s*\(auth\/[a-z0-9-]+\)\.?$/, "")
    .trim();
  return cleaned || "Sign-in failed. Try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function afterAuth() {
    const u = auth.currentUser;
    if (!u) throw new Error("No user after auth");
    const token = await u.getIdToken(/* forceRefresh */ true);
    await onboardUser(token);
    router.push("/library");
  }

  async function handleEmailSubmit() {
    setError(null);
    setNotice(null);
    if (!email || !password) {
      setError("Email and password required");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email.trim().toLowerCase(), password);
      } else {
        await signInWithEmail(email.trim().toLowerCase(), password);
      }
      await afterAuth();
    } catch (err: unknown) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      await afterAuth();
    } catch (err: unknown) {
      setError(humanizeAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setError(null);
    if (!email) {
      setError("Enter your email above first");
      return;
    }
    try {
      await resetPassword(email.trim().toLowerCase());
      setNotice("Password reset email sent. Check your inbox.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not send reset";
      setError(msg);
    }
  }

  return (
    <>
      <Header />

      <main className="mx-auto flex max-w-md flex-col gap-6 px-6 py-16">
        <div>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.25em] text-oxblood-700">
            Enter the Library
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tightest">
            {mode === "signup" ? "Claim your invitation" : "Welcome back"}
          </h1>
          <p className="mt-3 text-sm text-ink-600">
            {mode === "signup"
              ? "You'll need an invitation. Once you sign up we'll match your email against the allowlist."
              : "Sign in to continue reading."}
          </p>
        </div>

        <div className="ml-card p-6">
          <div className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="reader@example.com"
              autoComplete="email"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />

            {error && (
              <div className="rounded-sm border border-oxblood-600/40 bg-oxblood-50 px-3 py-2 text-xs text-oxblood-700">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-sm border border-forest-600/40 bg-forest-50 px-3 py-2 text-xs text-forest-600">
                {notice}
              </div>
            )}

            <Button onClick={handleEmailSubmit} disabled={busy}>
              {busy
                ? "Working…"
                : mode === "signup"
                  ? "Sign up"
                  : "Sign in"}
            </Button>

            <div className="flex items-center gap-3 py-1">
              <div className="h-px flex-1 bg-ink-500/20" />
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-ink-500">
                or
              </span>
              <div className="h-px flex-1 bg-ink-500/20" />
            </div>

            <Button variant="outline" onClick={handleGoogle} disabled={busy}>
              <Mail size={14} />
              Continue with Google
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-ink-600">
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="underline-offset-4 hover:underline"
          >
            {mode === "signin"
              ? "I have an invitation — sign up"
              : "I already have an account — sign in"}
          </button>
          {mode === "signin" && (
            <button
              type="button"
              onClick={handleReset}
              className="underline-offset-4 hover:underline"
            >
              Forgot password?
            </button>
          )}
        </div>
      </main>
    </>
  );
}
