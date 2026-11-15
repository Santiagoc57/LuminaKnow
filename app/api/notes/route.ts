import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createNote, resolveLinkTarget, searchLinkTargets } from "@/lib/notes";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireProfile();
    const params = new URL(request.url).searchParams;
    const exact = params.get("title");
    if (exact !== null) return NextResponse.json({ target: resolveLinkTarget(exact) ?? null });
    return NextResponse.json({ targets: searchLinkTargets(params.get("q") ?? "", params.get("exclude") ?? "") });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const profile = await requireProfile();
    const { content } = z.object({ content: z.string().max(100_000) }).parse(await request.json());
    return NextResponse.json(createNote({ content, profileId: profile.id }), { status: 201 });
  } catch (error) { return apiError(error); }
}
