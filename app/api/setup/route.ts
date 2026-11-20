import bcrypt from "bcryptjs";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getGeminiKey, getOpenAIKey, setGeminiKey, setOpenAIKey } from "@/lib/secrets";
import { getAIProvider, hasAIKey } from "@/lib/ai";
import { makeId } from "@/lib/utils";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

const setupSchema = z.object({
  profiles: z.array(z.object({
    name: z.string().trim().min(2).max(32),
    pin: z.string().regex(/^\d{4,8}$/),
  })).length(2),
  geminiApiKey: z.string().trim().optional().default(""),
  openaiApiKey: z.string().trim().optional().default(""),
});

export async function GET() {
  try {
    // Perfiles ocultos (settings.hidden_profiles): no se borran, solo no aparecen al entrar. LUMINA es de una sola persona.
    const hiddenRow = getDb().prepare("SELECT value FROM settings WHERE key = 'hidden_profiles'").get() as { value: string } | undefined;
    let hidden: string[] = [];
    try { hidden = hiddenRow ? JSON.parse(hiddenRow.value) : []; } catch { hidden = []; }
    const all = getDb().prepare("SELECT id, name, avatar_color AS avatarColor FROM profiles ORDER BY created_at").all() as Array<{ id: string; name: string; avatarColor: string }>;
    const visible = all.filter((profile) => !hidden.includes(profile.id));
    const profiles = visible.length ? visible : all;
    return NextResponse.json({ configured: profiles.length > 0, profiles, hasAiKey: hasAIKey(), aiProvider: getAIProvider(), hasGeminiKey: Boolean(getGeminiKey()), hasOpenAIKey: Boolean(getOpenAIKey()) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const db = getDb();
    const existing = db.prepare("SELECT COUNT(*) AS count FROM profiles").get() as { count: number };
    if (existing.count) throw new Error("El espacio ya fue configurado.");
    const data = setupSchema.parse(await request.json());
    const colors = ["#e96945", "#788c7c"];
    const insert = db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES(?, ?, ?, ?, ?)");
    db.transaction(() => data.profiles.forEach((profile, index) => {
      insert.run(makeId("usr"), profile.name, bcrypt.hashSync(profile.pin, 11), colors[index], new Date().toISOString());
    }))();
    if (data.geminiApiKey) setGeminiKey(data.geminiApiKey);
    if (data.openaiApiKey) setOpenAIKey(data.openaiApiKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
