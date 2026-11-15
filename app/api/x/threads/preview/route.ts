import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { previewXThread } from "@/lib/x-thread";

export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = z.object({ url: z.string().trim().min(1), additionalUrls: z.array(z.string().trim().min(1)).max(99).default([]) }).parse(await request.json());
    return NextResponse.json(await previewXThread(body.url, body.additionalUrls));
  } catch (error) {
    return apiError(error);
  }
}
