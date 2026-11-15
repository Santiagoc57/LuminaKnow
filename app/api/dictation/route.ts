import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { transcribeDictation } from "@/lib/ai";

export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024;

// Recibe la grabación del micrófono y devuelve el texto dictado.
export async function POST(request: Request) {
  try {
    await requireProfile();
    const audio = Buffer.from(await request.arrayBuffer());
    if (audio.length < 1_000) throw new Error("No se oyó nada. Graba un poco más.");
    if (audio.length > MAX_BYTES) throw new Error("La grabación es demasiado larga.");
    const text = await transcribeDictation(audio, request.headers.get("content-type") || "audio/webm");
    return NextResponse.json({ text });
  } catch (error) { return apiError(error); }
}
