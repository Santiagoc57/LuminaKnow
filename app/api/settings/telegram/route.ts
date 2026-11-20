import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { connectTelegram, disconnectTelegram, newPairCode, telegramStatus } from "@/lib/telegram";

export const runtime = "nodejs";

export async function GET() {
  try { await requireProfile(); return NextResponse.json(await telegramStatus()); } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("connect"), token: z.string().trim().regex(/^\d+:[\w-]{20,}$/, "Pega la clave completa que te dio @BotFather.") }),
      z.object({ action: z.literal("pair") }),
      z.object({ action: z.literal("disconnect") }),
    ]).parse(await request.json());
    if (body.action === "connect") await connectTelegram(body.token);
    if (body.action === "pair") newPairCode();
    if (body.action === "disconnect") disconnectTelegram();
    return NextResponse.json(await telegramStatus());
  } catch (error) { return apiError(error); }
}
