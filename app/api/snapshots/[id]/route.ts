import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { snapshotPath } from "@/lib/snapshots";

// Sirve la copia guardada sin permitir scripts: solo texto, imágenes y estilos.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const file = snapshotPath(id);
    if (!file || !fs.existsSync(file)) return NextResponse.json({ error: "Esta página no tiene copia guardada." }, { status: 404 });
    return new NextResponse(fs.readFileSync(file), { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; img-src * data:; style-src 'unsafe-inline'; sandbox allow-popups allow-popups-to-escape-sandbox", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
