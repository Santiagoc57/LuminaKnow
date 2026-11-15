import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { createSmartSpace, listSmartSpaces, reorderSmartSpaces } from "@/lib/spaces";

export const runtime = "nodejs";

const spaceSchema = z.object({
  name: z.string().trim().min(1, "Ponle un nombre a la carpeta.").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  query: z.string().trim().max(300).optional(),
  videoId: z.string().min(1).optional(),
});

export async function GET() {
  try {
    await requireProfile();
    return NextResponse.json({ spaces: listSmartSpaces() });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    return NextResponse.json({ space: createSmartSpace(spaceSchema.parse(await request.json())) }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PUT(request: Request) {
  try {
    await requireProfile();
    const { ids } = z.object({ ids: z.array(z.string().min(1)).max(500) }).parse(await request.json());
    reorderSmartSpaces(ids);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
