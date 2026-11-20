import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProfile } from "@/lib/auth";
import { apiError } from "@/lib/http";
import { setWatchedFolder, watchStatus } from "@/lib/watch-folders";

export const runtime = "nodejs";

export async function GET() {
  try { await requireProfile(); return NextResponse.json(watchStatus()); } catch (error) { return apiError(error); }
}

// Activar o quitar una carpeta. «choose» abre el selector de carpetas de macOS en este Mac.
export async function POST(request: Request) {
  try {
    await requireProfile();
    const body = z.object({ action: z.enum(["add", "remove", "choose"]), path: z.string().max(1000).optional() }).parse(await request.json());
    if (body.action === "choose") {
      try {
        const { stdout } = await promisify(execFile)("osascript", ["-e", 'POSIX path of (choose folder with prompt "Elige una carpeta para que LUMINA guarde sus PDF e imágenes nuevos")'], { timeout: 120_000 });
        const chosen = stdout.trim().replace(/\/$/, "");
        if (chosen) return NextResponse.json(setWatchedFolder(chosen, true));
      } catch { /* cancelado */ }
      return NextResponse.json(watchStatus());
    }
    if (!body.path) throw new Error("Falta la carpeta.");
    return NextResponse.json(setWatchedFolder(body.path, body.action === "add"));
  } catch (error) { return apiError(error); }
}
