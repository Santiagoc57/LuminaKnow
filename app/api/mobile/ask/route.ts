import { z } from "zod";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson } from "@/lib/extension-http";
import { generateChatAnswer } from "@/lib/scoped-chat";

export const runtime = "nodejs";

// Chat desde el celular: a una fuente (id) o a toda la biblioteca. Responde la Mac, así que solo funciona en casa.
export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const body = z.object({ question: z.string().trim().min(2).max(2_000), id: z.string().min(1).optional() }).parse(await request.json());
    const answer = await generateChatAnswer({ question: body.question, videoIds: body.id ? [body.id] : [], modelId: "auto" });
    const seen = new Set<string>();
    const sources = answer.citations.filter((citation) => citation.videoId && !seen.has(citation.videoId) && seen.add(citation.videoId)).map((citation) => ({ id: citation.videoId!, title: citation.videoTitle || "" }));
    // Las marcas [S1] no le dicen nada al celular: se quitan y las fuentes van aparte.
    // Solo se quitan espacios (no saltos de línea), para no deshacer párrafos y listas.
    const content = answer.content
      .replace(/[ \t]*\[S\d+[^\]]*\](?:[ \t]*(?:,|y|e)[ \t]*\[S\d+[^\]]*\])*/g, "")
      .replace(/[ \t]+[—–-][ \t]*(?=[.:,*]|$)/gm, "")
      .replace(/[ \t]+([.,:;])/g, "$1");
    return extensionJson(request, { content, sources });
  } catch (error) { return extensionError(request, error); }
}
