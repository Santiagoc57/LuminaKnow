import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { appInstalled, autostartEnabled, setAutostart } from "@/lib/autostart";
import { apiError } from "@/lib/http";
import { lanAddresses } from "@/lib/mobile-https";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireProfile();
    // Direcciones de este Mac en la red de casa, para abrir LUMINA desde otro Mac.
    const port = new URL(request.url).port || "3000";
    return NextResponse.json({ enabled: autostartEnabled(), appInstalled: appInstalled(), addresses: lanAddresses().map((ip) => `${ip}:${port}`) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const { enabled } = z.object({ enabled: z.boolean() }).parse(await request.json());
    return NextResponse.json({ enabled: await setAutostart(enabled), appInstalled: appInstalled() });
  } catch (error) { return apiError(error); }
}
