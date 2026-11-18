import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson } from "@/lib/extension-http";
import { mobileLibrary, pruneMobileThumbs } from "@/lib/mobile-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// La biblioteca completa en versión ligera para la app del celular (ver y leer sin conexión).
export async function GET(request: Request) {
  try {
    requireExtensionProfile(request);
    const library = mobileLibrary();
    pruneMobileThumbs(library.items.map((item) => `${item.id}-${item.thumb}.webp`));
    return extensionJson(request, library, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return extensionError(request, error); }
}
