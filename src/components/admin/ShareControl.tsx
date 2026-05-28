"use client";

import { useState } from "react";
import { Share2, Copy, Check, Link2Off, RefreshCw, Loader2 } from "lucide-react";
import type { Book } from "@/lib/types";
import { auth as firebaseAuth } from "@/lib/firebase/client";

interface Props {
  book: Book;
  onChanged?: () => void;
}

/**
 * Admin control for a book's public share link (Phase 9t).
 *
 * Generate → POST /api/books/{id}/share (enables + creates token if missing)
 * Regenerate → POST with { regenerate: true } (rotates token, invalidates old)
 * Disable → DELETE (keeps token, gates access off)
 *
 * The link is read-only & view-only for recipients; no account needed. The
 * panel surfaces the security model plainly so the curator knows what they're
 * exposing.
 */
export function ShareControl({ book, onChanged }: Props) {
  const [busy, setBusy] = useState<null | "enable" | "regen" | "disable">(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const enabled = !!book.share_enabled && !!book.share_token;
  const shareUrl =
    typeof window !== "undefined" && book.share_token
      ? `${window.location.origin}/share/${book.share_token}`
      : "";

  async function authHeader(): Promise<string> {
    const u = firebaseAuth.currentUser;
    if (!u) throw new Error("Not signed in");
    return `Bearer ${await u.getIdToken()}`;
  }

  async function call(
    method: "POST" | "DELETE",
    body?: Record<string, unknown>,
  ) {
    setErr(null);
    try {
      const res = await fetch(`/api/books/${book.id}/share`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: await authHeader(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Failed (${res.status})`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  async function onNativeShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: book.title, url: shareUrl });
      } catch {
        /* cancelled */
      }
    } else {
      void onCopy();
    }
  }

  return (
    <div className="mt-4 rounded-sm border ml-hairline bg-parchment-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base text-ink-900">
            Share this book
            {enabled && (
              <span className="ml-2 inline-flex items-center gap-1 align-middle font-mono text-[0.6rem] uppercase tracking-[0.15em] text-forest-600">
                <Check size={11} />
                Link active
              </span>
            )}
          </p>
          <p className="mt-1 max-w-xl text-xs text-ink-600">
            Create a public link that opens this one book — no login, no access
            to the rest of the library. View-only. Anyone with the link can
            open it; disable or regenerate any time to revoke access.
          </p>
        </div>
      </div>

      {enabled ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 truncate rounded-sm border border-ink-500/25 bg-parchment-100 px-2.5 py-1.5 font-mono text-xs text-ink-700"
            />
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-2.5 py-1.5 text-xs text-ink-700 hover:bg-parchment-100"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={onNativeShare}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-oxblood-700 bg-oxblood-700 px-2.5 py-1.5 text-xs text-parchment-50 hover:bg-oxblood-800"
            >
              <Share2 size={12} />
              Share
            </button>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                if (
                  !confirm(
                    "Regenerate the link? The current link will stop working for everyone you've already sent it to.",
                  )
                )
                  return;
                setBusy("regen");
                await call("POST", { regenerate: true });
                setBusy(null);
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-ink-600 hover:text-ink-900 disabled:opacity-50"
            >
              {busy === "regen" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              Regenerate
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("disable");
                await call("DELETE");
                setBusy(null);
              }}
              className="inline-flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-oxblood-700 hover:text-oxblood-800 disabled:opacity-50"
            >
              {busy === "disable" ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Link2Off size={11} />
              )}
              Disable link
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("enable");
            await call("POST");
            setBusy(null);
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-sm border border-ink-500/30 bg-parchment-50 px-3 py-1.5 text-xs text-ink-700 hover:bg-parchment-100 disabled:opacity-50"
        >
          {busy === "enable" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Share2 size={12} />
          )}
          {book.share_token ? "Re-enable share link" : "Create share link"}
        </button>
      )}

      {err && <p className="mt-2 text-xs text-oxblood-700">{err}</p>}
    </div>
  );
}
