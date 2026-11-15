import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { appendSourceNote } from "@/lib/notes";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const { id, note } = z.object({ id: z.string().min(1), note: z.string().trim().min(1).max(10_000) }).parse(await request.json());
    if (!getDb().prepare("SELECT 1 FROM videos WHERE id = ?").get(id)) throw new Error("Esa fuente ya no está en Lúmina.");
    appendSourceNote(id, profile.id, note);
    return extensionJson(request, { ok: true });
  } catch (error) { return extensionError(request, error); }
}
