import { z } from "zod";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { MAX_IMAGE_BYTES, sniffImage } from "@/lib/media";
import { createGallerySource } from "@/lib/vision";

export const runtime = "nodejs";

// Carrusel completo leído desde Firefox: llega como imágenes ya descargadas por la extensión.
export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const body = z.object({
      images: z.array(z.string().max(Math.ceil(MAX_IMAGE_BYTES * 1.4))).min(1).max(20),
      pageUrl: z.string().trim().url().catch(""),
      title: z.string().trim().default("").transform((value) => value.slice(0, 200)),
      author: z.string().trim().default("").transform((value) => value.slice(0, 120)),
    }).parse(await request.json());
    const images = body.images.map((encoded) => {
      const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
      const kind = sniffImage(bytes);
      if (!kind) throw new Error("Una de las imágenes no es compatible.");
      return { bytes, kind };
    });
    const result = await createGallerySource({ images, title: body.title, pageUrl: body.pageUrl, author: body.author, profileId: profile.id });
    return extensionJson(request, { ...result, luminaUrl: `/?video=${encodeURIComponent(result.id)}` }, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return extensionError(request, error); }
}
