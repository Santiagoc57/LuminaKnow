import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { mediaPathFromUrl, mimeForMediaName } from "@/lib/media";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ name: string }> }) {
  try {
    await requireProfile();
    const { name } = await context.params;
    const file = mediaPathFromUrl(`/api/media/${name}`);
    const mime = mimeForMediaName(name);
    if (!file || !mime || !fs.existsSync(file)) return NextResponse.json({ error: "Imagen no encontrada." }, { status: 404 });
    return new NextResponse(new Uint8Array(fs.readFileSync(/* turbopackIgnore: true */ file)), {
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return apiError(error); }
}
