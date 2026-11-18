import { z } from "zod";
import { getDb } from "@/lib/db";
import { currentEmbeddingModel, embedTexts } from "@/lib/ai";
import { requireExtensionProfile } from "@/lib/extension-auth";
import { extensionError, extensionJson } from "@/lib/extension-http";
import { syncRetrievalUnit } from "@/lib/knowledge";
import { saveNoteContent } from "@/lib/notes";
import { addToShelf, removeFromShelf } from "@/lib/shelf";
import { addSpaceItem } from "@/lib/spaces";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["consume", "unconsume", "pin", "unpin"]), id: z.string().min(1) }),
  z.object({ action: z.literal("folder"), id: z.string().min(1), folderId: z.string().min(1) }),
  // baseUpdatedAt: la versión de la nota que tenía el celular. Si en el Mac cambió mientras tanto, no se pisa: se juntan las dos.
  z.object({ action: z.literal("note"), id: z.string().min(1), content: z.string().max(100_000), baseUpdatedAt: z.string().nullable().optional() }),
]);

// Cambios hechos desde el celular (también los que quedaron pendientes fuera de casa).
export async function POST(request: Request) {
  try {
    const profile = requireExtensionProfile(request);
    const body = schema.parse(await request.json());
    const db = getDb();
    const source = db.prepare("SELECT source_type AS sourceType FROM videos WHERE id = ?").get(body.id) as { sourceType: string } | undefined;
    if (!source) return extensionJson(request, { error: "Esta fuente ya no está en LUMINA.", gone: true }, { status: 404 });
    if (body.action === "consume" || body.action === "unconsume") {
      db.prepare("UPDATE videos SET consumed_at = ? WHERE id = ?").run(body.action === "consume" ? new Date().toISOString() : null, body.id);
      return extensionJson(request, { ok: true });
    }
    if (body.action === "pin") { addToShelf(body.id); return extensionJson(request, { ok: true }); }
    if (body.action === "folder") { addSpaceItem(body.folderId, body.id); return extensionJson(request, { ok: true }); }
    if (body.action !== "note") { removeFromShelf(body.id); return extensionJson(request, { ok: true }); }
    const current = db.prepare("SELECT content, updated_at AS updatedAt FROM notes WHERE video_id = ?").get(body.id) as { content: string; updatedAt: string } | undefined;
    let content = body.content;
    let merged = false;
    if (current?.content.trim() && body.baseUpdatedAt !== undefined && current.updatedAt !== body.baseUpdatedAt && current.content.trim() !== content.trim() && !content.includes(current.content.trim())) {
      content = `${current.content.trimEnd()}\n\n— Desde el celular —\n${content.trim()}`;
      merged = true;
    }
    const { changed, updatedAt } = saveNoteContent({ videoId: body.id, profileId: profile.id, content, forceVersion: merged });
    if (changed && source.sourceType !== "note") {
      const [embedding] = content.trim() ? await embedTexts([content]).catch(() => [null]) : [null];
      syncRetrievalUnit({ id: `ret_note_${body.id}`, videoId: body.id, sourceKind: "note", sourceRef: "note", text: content, embedding, embeddingModel: embedding ? currentEmbeddingModel() : "" });
    }
    return extensionJson(request, { ok: true, note: { content, updatedAt }, merged });
  } catch (error) { return extensionError(request, error); }
}
