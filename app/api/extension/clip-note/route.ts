import { z } from "zod";
import { getDb } from "@/lib/db";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson, extensionOptions } from "@/lib/extension-http";

export const runtime = "nodejs";

export function OPTIONS(request: Request) { return extensionOptions(request); }

// La nota que escribes al guardar un recorte, pegada a ese subrayado (el más reciente con ese texto).
export async function POST(request: Request) {
  try {
    requireExtensionProfile(request);
    const body = z.object({ id: z.string().min(1), quote: z.string().trim().min(1).max(10_000), note: z.string().trim().min(1).max(4_000) }).parse(await request.json());
    const db = getDb();
    const highlight = db.prepare("SELECT id FROM highlights WHERE video_id = ? AND quote = ? ORDER BY created_at DESC LIMIT 1").get(body.id, body.quote.trim()) as { id: string } | undefined;
    if (!highlight) {
      // El recorte se guardó como cita (nota propia): la nota se añade debajo.
      const note = db.prepare("SELECT content FROM notes WHERE video_id = ?").get(body.id) as { content: string } | undefined;
      if (!note) throw new Error("No encontré el recorte para añadirle la nota.");
      db.prepare("UPDATE notes SET content = ?, updated_at = ? WHERE video_id = ?").run(`${note.content.trimEnd()}\n\n${body.note}`, new Date().toISOString(), body.id);
      return extensionJson(request, { ok: true, attachedTo: "note" });
    }
    db.prepare("UPDATE highlights SET note = ? WHERE id = ?").run(body.note, highlight.id);
    return extensionJson(request, { ok: true, attachedTo: "highlight" });
  } catch (error) { return extensionError(request, error); }
}
