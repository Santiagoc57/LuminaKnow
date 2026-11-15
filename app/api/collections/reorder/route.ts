import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { reorderCollection } from "@/lib/collections";

export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = z.object({ collectionId: z.string().min(1), parentId: z.string().min(1).nullable(), sortOrder: z.number().int().min(0) }).parse(await request.json());
    reorderCollection(body.collectionId, body.parentId, body.sortOrder);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
