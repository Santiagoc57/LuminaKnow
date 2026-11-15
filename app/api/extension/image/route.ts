import { z } from "zod";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { itemTagState } from "@/lib/extension-item";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";
import { fetchPublicImage, MAX_IMAGE_BYTES, sniffImage } from "@/lib/media";
import { createImageSource } from "@/lib/vision";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const body = z.object({
      srcUrl: z.string().trim().default(""),
      // La extensión manda los bytes cuando la imagen solo se puede leer desde el navegador (miniaturas, data:, sesiones).
      bytesBase64: z.string().max(Math.ceil(MAX_IMAGE_BYTES * 1.4)).default(""),
      pageUrl: z.string().trim().url().catch(""),
      title: z.string().trim().default("").transform((value) => value.slice(0, 200)),
    }).parse(await request.json());
    let image: Awaited<ReturnType<typeof fetchPublicImage>>;
    if (body.bytesBase64) {
      const bytes = new Uint8Array(Buffer.from(body.bytesBase64, "base64"));
      const kind = sniffImage(bytes);
      if (!kind) throw new Error("Ese archivo no es una imagen compatible.");
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error("La imagen supera los 20 MB.");
      image = { bytes, kind };
    } else {
      if (!/^https?:\/\//i.test(body.srcUrl)) throw new Error("No se pudo leer esa imagen.");
      image = await fetchPublicImage(body.srcUrl);
    }
    const result = await createImageSource({ ...image, title: body.title, pageUrl: body.pageUrl, profileId: profile.id });
    return extensionJson(request, { ...result, ...itemTagState(result.id), luminaUrl: `/?video=${encodeURIComponent(result.id)}` }, { status: result.duplicate ? 200 : 201 });
  } catch (error) { return extensionError(request, error); }
}
