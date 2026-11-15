import { z } from "zod";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson } from "@/lib/extension-http";
import { createNote } from "@/lib/notes";

export const runtime = "nodejs";

// Texto compartido desde el celular que no trae enlace: se guarda como nota.
export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const { text } = z.object({ text: z.string().trim().min(1).max(20_000) }).parse(await request.json());
    return extensionJson(request, createNote({ content: text, profileId: profile.id }), { status: 201 });
  } catch (error) { return extensionError(request, error); }
}
