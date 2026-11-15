import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";
import { getSessionSecret } from "./secrets";

const COOKIE_NAME = "lumina_session";

type SessionPayload = { profileId: string; expiresAt: number };

function sign(value: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function createSessionToken(profileId: string) {
  const encoded = Buffer.from(JSON.stringify({
    profileId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
  } satisfies SessionPayload)).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie(""), maxAge: 0 };
}

export async function getCurrentProfile() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as SessionPayload;
    if (payload.expiresAt < Date.now()) return null;
    return (getDb().prepare("SELECT id, name, avatar_color AS avatarColor FROM profiles WHERE id = ?")
      .get(payload.profileId) as { id: string; name: string; avatarColor: string } | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("UNAUTHORIZED");
  return profile;
}

