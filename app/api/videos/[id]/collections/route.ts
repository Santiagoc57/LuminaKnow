import { z } from "zod";
import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/http";
import { syncVideoMemberships } from "@/lib/knowledge";

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireProfile();
    const { id } = await context.params;
    const { collectionIds } = z.object({ collectionIds: z.array(z.string()).max(30) }).parse(await request.json());
    const db = getDb();
    db.transaction(() => {
      db.prepare("DELETE FROM video_collections WHERE video_id = ?").run(id);
      const insert = db.prepare("INSERT OR IGNORE INTO video_collections(video_id, collection_id) VALUES(?, ?)");
      collectionIds.forEach((collectionId) => insert.run(id, collectionId));
    })();
    syncVideoMemberships(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
