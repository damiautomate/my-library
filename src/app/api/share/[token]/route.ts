import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import type { SharedBook, VoiceSegment, EpubChapterMapping } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PUBLIC, NO AUTH — resolve a share token to a sanitized book (Phase 9t).
 *
 * GET /api/share/{token}
 *
 * Security properties:
 *   - The token is the ONLY accepted input. There's no bookId parameter, so
 *     a caller can't pivot from a valid token to a sibling book.
 *   - Returns ONLY the SharedBook subset — never the raw doc. Admin metadata,
 *     status, the share token itself, store links, etc. never leave the server.
 *   - 404 (not 403) when the token is unknown or sharing is disabled, so we
 *     don't confirm whether a given token ever existed.
 *
 * The lookup queries by share_token (a single-field auto-indexed query) and
 * then verifies share_enabled in code — avoids needing a composite index.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || token.length < 16) {
    // Too short to be one of our 24-char tokens — don't even query.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const q = await adminDb
    .collection("books")
    .where("share_token", "==", token)
    .limit(1)
    .get();

  if (q.empty) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const doc = q.docs[0];
  const book = doc.data() as Record<string, unknown>;

  // Gate: sharing must be explicitly enabled, and the book must be published.
  // A draft book, or one whose share was disabled, is invisible here.
  if (book.share_enabled !== true || book.status !== "published") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const segments = Array.isArray(book.voice_segments)
    ? (book.voice_segments as VoiceSegment[])
    : undefined;

  // Build the strictly-sanitized payload. Note we deliberately do NOT include
  // pdf_url / epub_url / audio_summary_url — the share page loads those via
  // the token-authorized file proxy (/api/file/{id}/{kind}?share={token}).
  // Voice segment URLs are returned as-is (raw Cloudinary), matching the
  // signed-in reader which also plays segment URLs directly.
  const shared: SharedBook = {
    id: doc.id,
    title: (book.title as string) ?? "Untitled",
    authors: (book.authors as string[]) ?? undefined,
    description: (book.description as string) ?? undefined,
    cover_url: (book.cover_url as string) ?? undefined,
    page_count: (book.page_count as number) ?? undefined,
    has_pdf: !!book.pdf_url,
    has_epub: !!book.epub_url,
    has_voice: !!segments && segments.length > 0,
    has_audio_summary: !!book.audio_summary_url,
    voice_segments: segments,
    voice_mode: (book.voice_mode as "synced" | "premium") ?? undefined,
    voice_total_seconds: (book.voice_total_seconds as number) ?? undefined,
    chapter_map: (book.epub_chapter_map as EpubChapterMapping[]) ?? undefined,
  };

  return NextResponse.json(
    { ok: true, book: shared },
    { headers: { "Cache-Control": "no-store" } },
  );
}
