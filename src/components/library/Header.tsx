"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Library,
  LogOut,
  Menu,
  Search as SearchIcon,
  Settings,
  User as UserIcon,
  X as XIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { signOutUser } from "@/lib/firebase/auth";

const NAV_LINKS = [
  { href: "/library", label: "Library" },
  { href: "/library/browse", label: "Browse" },
  { href: "/library/shelf", label: "My Shelf" },
  { href: "/library/passport", label: "Passport" },
];

export function Header() {
  const { firebaseUser, userDoc, isAdmin } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Portal target only exists in the browser; gate on mount to stay SSR-safe.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Close drawer on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function handleSignOut() {
    await signOutUser();
    router.push("/");
  }

  return (
    <header className="border-b ml-hairline bg-parchment-50/70 backdrop-blur-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 md:px-6">
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

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 text-sm lg:flex">
          {firebaseUser ? (
            <>
              {NAV_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={
                    "px-3 py-1.5 transition-colors " +
                    (pathname === l.href
                      ? "text-ink-900"
                      : "text-ink-700 hover:text-ink-900")
                  }
                >
                  {l.label}
                </Link>
              ))}
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
                {userDoc?.display_name?.split(/[\s|]/)[0] ?? "Reader"}
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

        {/* Mobile: just a search + hamburger */}
        <div className="flex items-center gap-1 lg:hidden">
          {firebaseUser ? (
            <>
              <Link
                href="/library/search"
                className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
                aria-label="Search"
              >
                <SearchIcon size={16} />
              </Link>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-sm p-2 text-ink-700 hover:bg-parchment-100"
                aria-label="Open menu"
              >
                <Menu size={18} />
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-sm border border-ink-500/30 px-3 py-1.5 text-sm text-ink-800 hover:bg-parchment-100"
            >
              Enter
            </Link>
          )}
        </div>
      </div>

      {/* Mobile drawer — rendered through a portal to document.body so its
       * fixed positioning is relative to the viewport and can never be
       * trapped by the header's backdrop-blur (which establishes a
       * containing block for fixed descendants on Chrome). */}
      {mounted &&
        open &&
        firebaseUser &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-ink-900/60 lg:hidden"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="ml-auto flex h-full w-72 max-w-[85vw] flex-col overflow-y-auto border-l border-ink-900/10 bg-parchment-50 shadow-paper-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b ml-hairline px-5 py-4">
                <div className="flex items-center gap-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-ink-600">
                  <UserIcon size={12} />
                  {userDoc?.display_name?.split(/[\s|]/)[0] ?? "Reader"}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-sm p-1 text-ink-600 hover:bg-parchment-100"
                  aria-label="Close menu"
                >
                  <XIcon size={16} />
                </button>
              </div>

              <nav className="flex flex-1 flex-col">
                {NAV_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={
                      "border-b ml-hairline px-5 py-3 font-display text-lg transition-colors " +
                      (pathname === l.href
                        ? "bg-parchment-100 text-oxblood-700"
                        : "text-ink-800 hover:bg-parchment-100")
                    }
                  >
                    {l.label}
                  </Link>
                ))}
                {isAdmin && (
                  <Link
                    href="/admin"
                    className="flex items-center gap-2 border-b ml-hairline px-5 py-3 font-display text-lg text-ink-800 hover:bg-parchment-100"
                  >
                    <Settings size={14} />
                    Admin
                  </Link>
                )}
              </nav>

              <button
                type="button"
                onClick={handleSignOut}
                className="flex items-center gap-2 border-t ml-hairline px-5 py-4 text-sm text-ink-600 hover:bg-parchment-100 hover:text-oxblood-700"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </div>,
          document.body,
        )}
    </header>
  );
}
