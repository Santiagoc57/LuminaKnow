import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { rateReviewCard, setReviewCardSuspended } from "@/lib/review";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const { action } = z.object({ action: z.enum(["again", "good", "easy", "discard", "restore"]) }).parse(await request.json());
    if (action === "discard" || action === "restore") {
      setReviewCardSuspended(profile.id, id, action === "discard");
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(rateReviewCard(profile.id, id, action));
  } catch (error) { return apiError(error); }
}
