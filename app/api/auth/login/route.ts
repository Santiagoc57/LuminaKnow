import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createSessionToken, sessionCookie } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { loginWaitSeconds, recordLoginFailure, recordLoginSuccess } from "@/lib/login-throttle";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { profileId, pin } = z.object({ profileId: z.string(), pin: z.string() }).parse(await request.json());
    const profile = getDb().prepare("SELECT id, name, pin_hash AS pinHash, avatar_color AS avatarColor FROM profiles WHERE id = ?")
      .get(profileId) as { id: string; name: string; pinHash: string; avatarColor: string } | undefined;
    const wait = loginWaitSeconds(profileId);
    if (wait) return NextResponse.json({ error: `Demasiados intentos. Espera ${wait} s y vuelve a probar.` }, { status: 429 });
    if (!profile || !bcrypt.compareSync(pin, profile.pinHash)) {
      const locked = recordLoginFailure(profileId);
      throw new Error(locked ? `PIN incorrecto. Por seguridad, espera ${locked} s antes de volver a intentarlo.` : "PIN incorrecto.");
    }
    recordLoginSuccess(profileId);
    const response = NextResponse.json({ profile: { id: profile.id, name: profile.name, avatarColor: profile.avatarColor } });
    response.cookies.set(sessionCookie(createSessionToken(profile.id)));
    return response;
  } catch (error) {
    return apiError(error);
  }
}

