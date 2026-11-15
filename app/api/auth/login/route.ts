import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createSessionToken, sessionCookie } from "@/lib/auth";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { profileId, pin } = z.object({ profileId: z.string(), pin: z.string() }).parse(await request.json());
    const profile = getDb().prepare("SELECT id, name, pin_hash AS pinHash, avatar_color AS avatarColor FROM profiles WHERE id = ?")
      .get(profileId) as { id: string; name: string; pinHash: string; avatarColor: string } | undefined;
    if (!profile || !bcrypt.compareSync(pin, profile.pinHash)) throw new Error("PIN incorrecto.");
    const response = NextResponse.json({ profile: { id: profile.id, name: profile.name, avatarColor: profile.avatarColor } });
    response.cookies.set(sessionCookie(createSessionToken(profile.id)));
    return response;
  } catch (error) {
    return apiError(error);
  }
}

