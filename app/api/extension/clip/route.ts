import { z } from "zod";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { createNote } from "@/lib/notes";

export const runtime = "nodejs";

// Texto seleccionado en cualquier app (vía OpenClip): se guarda como una cita, con la app o la página de origen.
export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const body = z.object({
      text: z.string().trim().min(1, "No hay texto seleccionado.").max(20_000),
      sourceUrl: z.string().trim().url().catch(""),
      sourceTitle: z.string().trim().max(300).default(""),
      app: z.string().trim().max(120).default(""),
    }).parse(await request.json());
    const quote = body.text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    const origin = body.sourceUrl ? `— [${body.sourceTitle || new URL(body.sourceUrl).hostname.replace(/^www\./, "")}](${body.sourceUrl})` : body.app ? `— desde ${body.app}` : "";
    const result = createNote({ content: [quote, origin].filter(Boolean).join("\n\n"), profileId: profile.id });
    return extensionJson(request, { ...result, luminaUrl: `/?video=${encodeURIComponent(result.id)}` }, { status: 201 });
  } catch (error) { return extensionError(request, error); }
}
