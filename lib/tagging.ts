import { GEMINI_TEXT_MODEL, TAG_MODEL, resolveModelProvider, suggestLibraryTags, type BulkTagSuggestion } from "./ai";
import { getDb, refreshVideoSearch } from "./db";
import { syncVideoMemberships } from "./knowledge";
import { makeId, safeJson } from "./utils";

declare global {
  var __luminaTagJobs: Map<string, Promise<void>> | undefined;
}

const active = global.__luminaTagJobs ?? new Map<string, Promise<void>>();
global.__luminaTagJobs = active;

export type ApprovedTagging = BulkTagSuggestion;

export function sourceTextRows(videoIds: string[]) {
  if (!videoIds.length) return [];
  const db = getDb();
  const placeholders = videoIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT v.id, COALESCE(NULLIF(v.custom_title, ''), v.title) AS title, v.channel AS author,
      TRIM(COALESCE(v.description, '') || '\n' || COALESCE(v.transcript_text, '') || '\n' ||
        COALESCE((SELECT GROUP_CONCAT(si.text, '\n') FROM source_items si WHERE si.video_id = v.id), '') || '\n' ||
        COALESCE((SELECT n.content FROM notes n WHERE n.video_id = v.id), '')) AS content
    FROM videos v WHERE v.id IN (${placeholders})
  `).all(...videoIds) as Array<{ id: string; title: string; author: string; content: string }>;
}

export async function createTaggingPreview(input: { profileId: string; videoIds: string[]; interests: string; modelId: string; replaceExisting?: boolean }) {
  const ids = [...new Set(input.videoIds)].slice(0, 500);
  const rows = sourceTextRows(ids);
  if (rows.length !== ids.length) throw new Error("Una o más fuentes ya no existen.");
  const previewRows = input.replaceExisting ? rows : rows.slice(0, 12);
  const suggestions: BulkTagSuggestion[] = [];
  for (let offset = 0; offset < previewRows.length; offset += 12) suggestions.push(...await suggestLibraryTags(previewRows.slice(offset, offset + 12), input.interests, input.modelId));
  const id = makeId("tagjob");
  const now = new Date().toISOString();
  const estimatedUnits = rows.reduce((total, row) => total + Math.ceil((row.title.length + row.author.length + Math.min(row.content.length, 6_000)) / 4), 0);
  const db = getDb();
  db.transaction(() => {
    db.prepare(`INSERT INTO bulk_tag_jobs(id, profile_id, status, model_id, interests, source_ids_json, sample_ids_json, estimated_units, mode, created_at, updated_at)
      VALUES(?, ?, 'preview', ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .run(id, input.profileId, input.modelId, input.interests, JSON.stringify(ids), JSON.stringify(previewRows.map((row) => row.id)), estimatedUnits, input.replaceExisting ? "replace" : "add", now, now);
    const insert = db.prepare(`INSERT INTO bulk_tag_suggestions(id, job_id, video_id, tag_name, tag_kind, confidence, accepted, created_at) VALUES(?, ?, ?, ?, ?, ?, 1, ?)`);
    suggestions.forEach((source) => source.tags.forEach((tag) => insert.run(makeId("suggestion"), id, source.videoId, tag.tagId, tag.level === "primary" ? "canonical" : "descriptive", tag.confidence, now)));
    db.prepare(`INSERT INTO tagging_configs(id, interests, updated_by, updated_at) VALUES('default', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET interests = excluded.interests, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(input.interests, input.profileId, now);
  })();
  return { id, suggestions, estimatedUnits, sourceCount: ids.length, sampleCount: previewRows.length, replaceExisting: Boolean(input.replaceExisting) };
}

function applySuggestions(jobId: string, suggestions: ApprovedTagging[], replaceExisting = false) {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const source of suggestions) {
      if (replaceExisting) db.prepare("DELETE FROM video_tags WHERE video_id = ?").run(source.videoId);
      const rows = source.tags.map((tag) => ({ tag, row: db.prepare("SELECT id, level FROM tags WHERE catalog_key = ? AND active = 1").get(tag.tagId) as { id: string; level: string } | undefined })).filter((item) => item.row && item.row.level === item.tag.level);
      const selected = [...rows.filter((item) => item.tag.level === "primary").slice(0, 3), ...rows.filter((item) => item.tag.level === "secondary").slice(0, 2)];
      for (const { tag, row } of selected) {
        const result = db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence, bulk_job_id) VALUES(?, ?, 'ai', ?, ?)").run(source.videoId, row!.id, tag.confidence, jobId);
        if (result.changes) db.prepare("INSERT OR IGNORE INTO bulk_tag_changes(job_id, video_id, tag_id, created_at) VALUES(?, ?, ?, ?)").run(jobId, source.videoId, row!.id, now);
      }
    }
  })();
  [...new Set(suggestions.map((source) => source.videoId))].forEach((videoId) => { refreshVideoSearch(videoId); syncVideoMemberships(videoId); });
}

async function runTaggingJob(jobId: string) {
  const db = getDb();
  const job = db.prepare("SELECT model_id AS modelId, interests, source_ids_json AS sourceIdsJson, sample_ids_json AS sampleIdsJson, approved_json AS approvedJson, mode FROM bulk_tag_jobs WHERE id = ?").get(jobId) as { modelId: string; interests: string; sourceIdsJson: string; sampleIdsJson: string; approvedJson: string; mode: string } | undefined;
  if (!job) return;
  const sourceIds = safeJson<string[]>(job.sourceIdsJson, []);
  const sampleIds = new Set(safeJson<string[]>(job.sampleIdsJson, []));
  const approved = safeJson<ApprovedTagging[]>(job.approvedJson, []);
  db.prepare("UPDATE bulk_tag_jobs SET status = 'running', error = '', updated_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
  try {
    applySuggestions(jobId, approved, job.mode === "replace");
    let processed = approved.length;
    const remaining = sourceTextRows(sourceIds.filter((id) => !sampleIds.has(id)));
    for (let offset = 0; offset < remaining.length; offset += 12) {
      const batch = remaining.slice(offset, offset + 12);
      const suggestions = await suggestLibraryTags(batch, job.interests, job.modelId);
      applySuggestions(jobId, suggestions, job.mode === "replace");
      processed += batch.length;
      db.prepare("UPDATE bulk_tag_jobs SET processed_count = ?, updated_at = ? WHERE id = ?").run(processed, new Date().toISOString(), jobId);
    }
    if (job.mode === "replace") db.prepare("UPDATE tags SET active = 0, archived_at = ? WHERE level = 'legacy' AND NOT EXISTS (SELECT 1 FROM video_tags WHERE tag_id = tags.id)").run(new Date().toISOString());
    db.prepare("UPDATE bulk_tag_jobs SET status = 'complete', processed_count = ?, updated_at = ? WHERE id = ?").run(sourceIds.length, new Date().toISOString(), jobId);
  } catch (error) {
    db.prepare("UPDATE bulk_tag_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(error instanceof Error ? error.message : String(error), new Date().toISOString(), jobId);
  }
}

export function scheduleTaggingJob(jobId: string) {
  if (active.has(jobId)) return;
  const task = runTaggingJob(jobId).finally(() => active.delete(jobId));
  active.set(jobId, task);
}

export function recoverTaggingJobs() {
  const jobs = getDb().prepare("SELECT id FROM bulk_tag_jobs WHERE status IN ('queued', 'running') ORDER BY created_at").all() as Array<{ id: string }>;
  jobs.forEach((job) => scheduleTaggingJob(job.id));
}

export function startTaggingJob(jobId: string, profileId: string, approved: ApprovedTagging[]) {
  const db = getDb();
  const job = db.prepare("SELECT id, model_id AS modelId, mode, source_ids_json AS sourceIdsJson FROM bulk_tag_jobs WHERE id = ? AND profile_id = ? AND status = 'preview'").get(jobId, profileId) as { id: string; modelId: string; mode: string; sourceIdsJson: string } | undefined;
  if (!job) throw new Error("La vista previa ya no está disponible.");
  const provider = resolveModelProvider(job.modelId);
  if (provider === "none") throw new Error("El modelo seleccionado ya no está disponible.");
  const model = provider === "gemini" ? GEMINI_TEXT_MODEL : TAG_MODEL;
  const sourceIds = safeJson<string[]>(job.sourceIdsJson, []);
  const snapshot: Record<string, Array<{ tagId: string; origin: string; confidence: number; bulkJobId: string | null }>> = {};
  if (job.mode === "replace") sourceIds.forEach((videoId) => {
    snapshot[videoId] = db.prepare("SELECT tag_id AS tagId, origin, confidence, bulk_job_id AS bulkJobId FROM video_tags WHERE video_id = ?").all(videoId) as typeof snapshot[string];
  });
  db.prepare("UPDATE bulk_tag_jobs SET status = 'queued', approved_json = ?, snapshot_json = ?, model_id = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(approved), JSON.stringify(snapshot), job.modelId || model, new Date().toISOString(), jobId);
  scheduleTaggingJob(jobId);
}

export function undoTaggingJob(jobId: string, profileId: string) {
  const db = getDb();
  const job = db.prepare("SELECT status, mode, snapshot_json AS snapshotJson FROM bulk_tag_jobs WHERE id = ? AND profile_id = ?").get(jobId, profileId) as { status: string; mode: string; snapshotJson: string } | undefined;
  if (!job || job.status !== "complete") throw new Error("Solo puedes deshacer un lote completado.");
  db.transaction(() => {
    if (job.mode === "replace") {
      const snapshot = safeJson<Record<string, Array<{ tagId: string; origin: string; confidence: number; bulkJobId: string | null }>>>(job.snapshotJson, {});
      const insert = db.prepare("INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence, bulk_job_id) VALUES(?, ?, ?, ?, ?)");
      Object.entries(snapshot).forEach(([videoId, tags]) => {
        db.prepare("DELETE FROM video_tags WHERE video_id = ?").run(videoId);
        tags.forEach((tag) => insert.run(videoId, tag.tagId, tag.origin, tag.confidence, tag.bulkJobId));
      });
      db.prepare("UPDATE tags SET active = 1, archived_at = NULL WHERE level = 'legacy' AND EXISTS (SELECT 1 FROM video_tags WHERE tag_id = tags.id)").run();
    } else db.prepare("DELETE FROM video_tags WHERE bulk_job_id = ?").run(jobId);
    db.prepare("UPDATE bulk_tag_jobs SET status = 'undone', updated_at = ? WHERE id = ?").run(new Date().toISOString(), jobId);
  })();
  const videos = db.prepare("SELECT DISTINCT video_id AS videoId FROM bulk_tag_changes WHERE job_id = ?").all(jobId) as Array<{ videoId: string }>;
  videos.forEach(({ videoId }) => { refreshVideoSearch(videoId); syncVideoMemberships(videoId); });
}
