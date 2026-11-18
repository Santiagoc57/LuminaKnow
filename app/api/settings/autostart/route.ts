import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { appInstalled, autostartEnabled, setAutostart } from "@/lib/autostart";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireProfile();
    return NextResponse.json({ enabled: autostartEnabled(), appInstalled: appInstalled() });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());
    return NextResponse.json({ enabled: await setAutostart(enabled), appInstalled: appInstalled() });
  } catch (error) { return apiError(error); }
}
