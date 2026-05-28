import type { Metadata } from "next";
import { adminDb } from "@/lib/firebase/admin";
import { ShareReader } from "./ShareReader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public, no-auth book share page (Phase 9t). Reached via /share/<token>.
 *
 * This server component does two things:
 *   1. generateMetadata — sets Open Graph / Twitter tags so the link renders
 *      a rich preview (cover, title, author) when pasted into WhatsApp,
 *      iMessage, Slack, etc. This is why the page is a server component.
 *   2. Renders the <ShareReader> client island, which fetches the sanitized
 *      book from /api/share/<token> and drives the actual readers in guest
 *      mode (progress saved to localStorage, no account required).
 *
 * No AuthGuard — that's the whole point. Access control lives entirely in the
 * token: the API returns 404 for unknown/disabled tokens, and the file proxy
 * only serves bytes when ?share=<token> matches the book.
 */

interface PageProps {
  params: { token: string };
}

/** Minimal server-side lookup for OG tags. Mirrors the gate in the public
 * API (enabled + published) so we don't emit a preview for a dead link. */
async function fetchShareMeta(token: string): Promise<{
  title: string;
  authors?: string[];
  description?: string;
  cover_url?: string;
} | null> {
  if (!token || token.length < 16) return null;
  try {
    const q = await adminDb
      .collection("books")
      .where("share_token", "==", token)
      .limit(1)
      .get();
    if (q.empty) return null;
    const b = q.docs[0].data() as Record<string, unknown>;
    if (b.share_enabled !== true || b.status !== "published") return null;
    return {
      title: (b.title as string) ?? "A book",
      authors: (b.authors as string[]) ?? undefined,
      description: (b.description as string) ?? undefined,
      cover_url: (b.cover_url as string) ?? undefined,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const meta = await fetchShareMeta(params.token);
  if (!meta) {
    return {
      title: "Book not found",
      robots: { index: false, follow: false },
    };
  }
  const byline = meta.authors?.length ? `by ${meta.authors.join(", ")}` : "";
  const title = `${meta.title}${byline ? ` ${byline}` : ""}`;
  const description =
    meta.description?.slice(0, 200) ||
    "A book shared with you from the library.";
  return {
    // Never let shared books get indexed by search engines.
    robots: { index: false, follow: false },
    title,
    description,
    openGraph: {
      title,
      description,
      type: "book",
      images: meta.cover_url ? [{ url: meta.cover_url }] : undefined,
    },
    twitter: {
      card: meta.cover_url ? "summary_large_image" : "summary",
      title,
      description,
      images: meta.cover_url ? [meta.cover_url] : undefined,
    },
  };
}

export default function SharePage({ params }: PageProps) {
  return <ShareReader token={params.token} />;
}
