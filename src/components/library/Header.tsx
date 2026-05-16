"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Library,
  LogOut,
  Search as SearchIcon,
  Settings,
  User as UserIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { signOutUser } from "@/lib/firebase/auth";

export function Header() {
  const { firebaseUser, userDoc, isAdmin } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await signOutUser();
    router.push("/");
  }

  return (
    <header className="border-b ml-hairline bg-parchment-50/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4">
        <Link
          href={firebaseUser ? "/library" : "/"}
          className="group flex items-center gap-2.5"
        >
          <span className="rounded-full border ml-hairline bg-parchment-100 p-1.5 transition-colors group-hover:bg-parchment-200">
            <Library size={16} className="text-oxblood-700" />
          </span>
          <span className="font-display text-xl tracking-tight">
            My Library
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {firebaseUser ? (
            <>
              <Link
                href="/library"
                className="px-3 py-1.5 text-ink-700 hover:text-ink-900"
              >
                Library
              </Link>
              <Link
                href="/library/browse"
                className="px-3 py-1.5 text-ink-700 hover:text-ink-900"
              >
                Browse
              </Link>
              <Link
                href="/library/shelf"
                className="px-3 py-1.5 text-ink-700 hover:text-ink-900"
              >
                My Shelf
              </Link>
              <Link
                href="/library/search"
                className="rounded-sm p-1.5 text-ink-700 hover:bg-parchment-100 hover:text-ink-900"
                aria-label="Search"
              >
                <SearchIcon size={14} />
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-ink-700 hover:text-ink-900"
                >
                  <Settings size={14} />
                  Admin
                </Link>
              )}
              <div className="mx-2 h-5 w-px bg-ink-500/20" />
              <div className="flex items-center gap-2 px-2 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600">
                <UserIcon size={12} />
                {userDoc?.display_name ?? userDoc?.email ?? "Reader"}
              </div>
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-ink-600 hover:bg-parchment-100 hover:text-ink-900"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-sm border border-ink-500/30 px-4 py-1.5 text-ink-800 hover:bg-parchment-100"
            >
              Enter
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
