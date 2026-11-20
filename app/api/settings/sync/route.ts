import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { setSyncEnabled, syncNow, syncStatus } from "@/lib/icloud-sync";

export const runtime = "nodejs";

export async function GET() {
  try { await requireProfile(); return NextResponse.json(syncStatus()); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = z.object({ action: z.enum(["enable", "disable", "sync"]) }).parse(await request.json());
    const result = body.action === "sync" ? syncNow() : setSyncEnabled(body.action === "enable");
    return NextResponse.json({ ...syncStatus(), result });
  } catch (error) { return apiError(error); }
}
