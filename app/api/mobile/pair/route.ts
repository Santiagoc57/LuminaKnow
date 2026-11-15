import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/http";
import { redeemPairCode } from "@/lib/mobile-pair";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { code } = z.object({ code: z.string().trim().min(6).max(12) }).parse(await request.json());
    return NextResponse.json({ token: redeemPairCode(code) });
  } catch (error) { return apiError(error); }
}
