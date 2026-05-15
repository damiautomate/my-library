import { NextResponse } from "next/server";

// Implemented in Phase 2 — see spec §15.
export async function POST() {
  return NextResponse.json(
    { error: "Signed upload is implemented in Phase 2." },
    { status: 501 },
  );
}
