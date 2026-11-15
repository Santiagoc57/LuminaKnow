import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { checkLinks, findDuplicates, listLinkProblems } from "@/lib/maintenance";
import { backfillSnapshots } from "@/lib/snapshots";

// Mantenimiento de la biblioteca: duplicados y enlaces rotos.
export async function GET() {
  try {
    await requireProfile();
    return NextResponse.json({ duplicates: findDuplicates(), broken: listLinkProblems() });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { action } = z.object({ action: z.enum(["check-links", "snapshots"]) }).parse(await request.json());
    if (action === "check-links") return NextResponse.json({ broken: await checkLinks() });
    if (action === "snapshots") return NextResponse.json(await backfillSnapshots());
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
