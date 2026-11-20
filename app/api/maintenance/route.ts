import { NextResponse } from "next/server";
import { retagStatus, startRetagLibrary } from "@/lib/retag";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { checkLinks, findDuplicates, listLinkProblems } from "@/lib/maintenance";
import { backfillSnapshots } from "@/lib/snapshots";
import { mergeTags, similarTagPairs } from "@/lib/tag-merge";
import { retitleLibrary } from "@/lib/retitle";

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
    const body = await request.json();
    const { action } = z.object({ action: z.enum(["check-links", "snapshots", "retag", "retag-status", "similar-tags", "merge-tags", "retitle"]) }).parse(body);
    if (action === "retitle") return NextResponse.json({ changed: await retitleLibrary() });
    if (action === "similar-tags") return NextResponse.json({ pairs: similarTagPairs() });
    if (action === "merge-tags") {
      const { keepId, mergeId } = z.object({ keepId: z.string().min(1), mergeId: z.string().min(1) }).parse(body);
      return NextResponse.json(mergeTags(keepId, mergeId));
    }
    if (action === "check-links") return NextResponse.json({ broken: await checkLinks() });
    if (action === "snapshots") return NextResponse.json(await backfillSnapshots());
    if (action === "retag") return NextResponse.json(startRetagLibrary());
    if (action === "retag-status") return NextResponse.json(retagStatus());
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
