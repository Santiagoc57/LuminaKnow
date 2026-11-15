import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { listNoteVersions, restoreNoteVersion } from "@/lib/notes";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Params) {
  try {
    await requireProfile();
    const { id } = await context.params;
    return NextResponse.json({ versions: listNoteVersions(id) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: Params) {
  try {
    const profile = await requireProfile();
    const { id } = await context.params;
    const { versionId } = z.object({ versionId: z.string().min(1) }).parse(await request.json());
    return NextResponse.json(restoreNoteVersion(id, versionId, profile.id));
  } catch (error) { return apiError(error); }
}
