"use client";

import { ReactNode, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

interface AuthGuardProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

export function AuthGuard({ children, requireAdmin = false }: AuthGuardProps) {
  const { firebaseUser, userDoc, loading, isAdmin } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
      return;
    }
    // Signed in but no Firestore user doc means the allowlist rejected them
    // (or their data is mid-write). Bounce to landing.
    if (firebaseUser && userDoc === null) {
      router.replace("/");
      return;
    }
    if (requireAdmin && !isAdmin) {
      router.replace("/library");
    }
  }, [firebaseUser, userDoc, loading, isAdmin, requireAdmin, router]);

  if (loading || !firebaseUser || !userDoc) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-500">
          Opening the doors…
        </p>
      </div>
    );
  }

  if (requireAdmin && !isAdmin) return null;

  return <>{children}</>;
}
