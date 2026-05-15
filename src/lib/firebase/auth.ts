import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  UserCredential,
} from "firebase/auth";
import { auth } from "./client";

const googleProvider = new GoogleAuthProvider();

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<UserCredential> {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<UserCredential> {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signInWithGoogle(): Promise<UserCredential> {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutUser(): Promise<void> {
  return signOut(auth);
}

export async function resetPassword(email: string): Promise<void> {
  return sendPasswordResetEmail(auth, email);
}

/**
 * After a successful auth (signup or first Google sign-in), call this endpoint
 * to validate the email against the invitation allowlist and create the
 * users/{uid} document. Throws on failure and signs the user back out.
 */
export async function onboardUser(idToken: string): Promise<{ role: "admin" | "member" }> {
  const res = await fetch("/api/users/onboard", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(body.error ?? "Onboarding failed");
  }
  return res.json();
}
