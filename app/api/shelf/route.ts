import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { reorderShelf, SHELF_LIMIT } from "@/lib/shelf";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  try {
    await requireProfile();
    const { ids } = z.object({ ids: z.array(z.string().min(1)).max(SHELF_LIMIT) }).parse(await request.json());
    reorderShelf(ids);
    return NextResponse.json({ ok: true });
  } catch (error) { return apiError(error); }
}
