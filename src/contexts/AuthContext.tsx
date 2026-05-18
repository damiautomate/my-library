"use client";

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase/client";
import type { UserDoc } from "@/lib/types";

interface AuthState {
  /** Firebase auth user, null when signed out, undefined while loading. */
  firebaseUser: FirebaseUser | null | undefined;
  /** Firestore user document (role, display name, etc.). */
  userDoc: UserDoc | null | undefined;
  /** True until both auth and the user doc have resolved. */
  loading: boolean;
  /** Convenience flag. */
  isAdmin: boolean;
}

const AuthCtx = createContext<AuthState>({
  firebaseUser: undefined,
  userDoc: undefined,
  loading: true,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<
    FirebaseUser | null | undefined
  >(undefined);
  const [userDoc, setUserDoc] = useState<UserDoc | null | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      if (!u) setUserDoc(null);
    });
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    const unsub = onSnapshot(doc(db, "users", firebaseUser.uid), (snap) => {
      setUserDoc(snap.exists() ? (snap.data() as UserDoc) : null);
    });
    return unsub;
  }, [firebaseUser]);

  const loading = firebaseUser === undefined || (firebaseUser !== null && userDoc === undefined);
  const isAdmin = userDoc?.role === "admin";

  return (
    <AuthCtx.Provider value={{ firebaseUser, userDoc, loading, isAdmin }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthCtx);
}
