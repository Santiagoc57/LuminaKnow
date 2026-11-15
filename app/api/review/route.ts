import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { getReviewSession } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const profile = await requireProfile();
    return NextResponse.json(getReviewSession(profile.id, { more: new URL(request.url).searchParams.get("more") === "1" }));
  } catch (error) { return apiError(error); }
}
