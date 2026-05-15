import { NextResponse } from "next/server";

// Implemented in Phase 3 — see spec §14.
export async function POST() {
  return NextResponse.json(
    { error: "ISBN auto-fetch is implemented in Phase 3." },
    { status: 501 },
  );
}
