import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { itemTagState } from "@/lib/extension-item";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

// El aviso de la extensión pregunta aquí por las etiquetas reales mientras la IA termina.
export async function GET(request: Request) {
  try {
    requireExtensionProfile(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) throw new Error("Falta la fuente.");
    return extensionJson(request, itemTagState(id));
  } catch (error) { return extensionError(request, error); }
}
