import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { LIBRARY_TAG_CATALOG } from "./canonical-tags";
import visionLabels from "./vision-labels-es.json";

const VISION_LABELS_ES = visionLabels as Record<string, string>;

const dataDirectory = process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data");
export const databasePath = path.join(dataDirectory, "lumina.sqlite");

declare global {
  var __luminaDb: Database.Database | undefined;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      avatar_color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      youtube_id TEXT NOT NULL UNIQUE,
      source_type TEXT NOT NULL DEFAULT 'youtube',
      source_published_at TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'Procesando video…',
      custom_title TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      thumbnail_url TEXT NOT NULL DEFAULT '',
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      source_language TEXT NOT NULL DEFAULT '',
      output_language TEXT NOT NULL DEFAULT 'es',
      status TEXT NOT NULL,
      summary_json TEXT,
      transcript_text TEXT NOT NULL DEFAULT '',
      transcript_source TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      added_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ready_at TEXT
    );
    CREATE TABLE IF NOT EXISTS transcript_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      text TEXT NOT NULL,
      embedding BLOB,
      UNIQUE(video_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_tags (
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(video_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS video_collections (
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      PRIMARY KEY(video_id, collection_id)
    );
    CREATE TABLE IF NOT EXISTS notes (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      updated_by TEXT NOT NULL REFERENCES profiles(id),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(video_id, profile_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      model TEXT NOT NULL,
      input_units INTEGER NOT NULL DEFAULT 0,
      output_units INTEGER NOT NULL DEFAULT 0,
      estimated_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(
      video_id UNINDEXED,
      title,
      channel,
      description,
      transcript
    );
    CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
    CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chunks_video_ordinal ON transcript_chunks(video_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_created_at ON usage_events(created_at);
  `);

  migrateSavedVideos(db);
  migrateSourceTypes(db);
  migrateConnectedKnowledge(db);
  migrateProfessionalLibrary(db);
  migrateTagTaxonomy(db);
  ensureCanonicalLibraryTags(db);
  migrateDiscovery(db);
  purgeOrphanIndexes(db);

  try {
    sqliteVec.load(db);
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS chunk_vectors USING vec0(embedding float[1536])");
  } catch (error) {
    console.warn("sqlite-vec no pudo cargarse; se usará búsqueda vectorial en memoria.", error);
  }

  db.prepare("INSERT OR IGNORE INTO settings(key, value) VALUES('monthly_budget_usd', '10')").run();
  db.pragma("optimize");
}

// Los índices de texto no se limpian solos: sin esto, lo borrado seguiría guardado y se podría encontrar.
function purgeOrphanIndexes(db: Database.Database) {
  for (const table of ["library_search", "retrieval_search", "video_search"]) {
    if (hasTable(db, table)) db.prepare(`DELETE FROM ${table} WHERE video_id NOT IN (SELECT id FROM videos)`).run();
  }
  if (hasTable(db, "knowledge_nodes")) db.prepare(`
    DELETE FROM knowledge_nodes WHERE node_type IN ('person', 'organization', 'tool', 'place', 'concept', 'idea')
      AND id NOT IN (SELECT source_node_id FROM knowledge_edges) AND id NOT IN (SELECT target_node_id FROM knowledge_edges)
  `).run();
}

export function deleteSourceEverywhere(videoId: string) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM knowledge_nodes WHERE node_type = 'video' AND ref_id = ?").run(videoId);
    db.prepare("DELETE FROM videos WHERE id = ?").run(videoId);
    purgeOrphanIndexes(db);
  })();
}

function migrateDiscovery(db: Database.Database) {
  const columns = new Set((db.prepare("PRAGMA table_info(videos)").all() as Array<{ name: string }>).map((column) => column.name));
  if (!columns.has("archived_at")) db.exec("ALTER TABLE videos ADD COLUMN archived_at TEXT");
  if (!columns.has("resurfaced_at")) db.exec("ALTER TABLE videos ADD COLUMN resurfaced_at TEXT");
  if (!columns.has("consumed_at")) db.exec("ALTER TABLE videos ADD COLUMN consumed_at TEXT");
  if (!columns.has("top_position")) db.exec("ALTER TABLE videos ADD COLUMN top_position INTEGER");
  if (!columns.has("link_status")) db.exec("ALTER TABLE videos ADD COLUMN link_status TEXT");
  if (!columns.has("link_checked_at")) db.exec("ALTER TABLE videos ADD COLUMN link_checked_at TEXT");
  if (!columns.has("snapshot_saved_at")) db.exec("ALTER TABLE videos ADD COLUMN snapshot_saved_at TEXT");
  db.exec("CREATE TABLE IF NOT EXISTS local_vectors (unit_id TEXT PRIMARY KEY, video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE, text_hash TEXT NOT NULL, vector BLOB NOT NULL)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS smart_spaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      color TEXT NOT NULL,
      query TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      quote TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'reader',
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL,
      UNIQUE(video_id, quote)
    );
    CREATE TABLE IF NOT EXISTS visual_analysis (
      video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
      text TEXT NOT NULL DEFAULT '',
      labels_json TEXT NOT NULL DEFAULT '[]',
      colors_json TEXT NOT NULL DEFAULT '[]',
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      objects_json TEXT NOT NULL DEFAULT '[]',
      ai_model TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      analyzed_at TEXT NOT NULL
    );
  `);
  if (!hasColumn(db, "visual_analysis", "feature_print")) db.exec("ALTER TABLE visual_analysis ADD COLUMN feature_print BLOB");
  db.exec(`
    CREATE TABLE IF NOT EXISTS note_versions (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES profiles(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_note_versions_video ON note_versions(video_id, created_at DESC);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_cards (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      due_at TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 0,
      ease REAL NOT NULL DEFAULT 2.3,
      reps INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      suspended INTEGER NOT NULL DEFAULT 0,
      last_reviewed_at TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(profile_id, kind, ref)
    );
    CREATE INDEX IF NOT EXISTS idx_review_cards_due ON review_cards(profile_id, suspended, due_at);
    CREATE TABLE IF NOT EXISTS review_log (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL,
      rating TEXT NOT NULL,
      reviewed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_log_profile ON review_log(profile_id, reviewed_at DESC);
  `);
  if (!hasColumn(db, "smart_spaces", "sort_order")) db.exec("ALTER TABLE smart_spaces ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  db.exec(`
    CREATE TABLE IF NOT EXISTS space_items (
      space_id TEXT NOT NULL REFERENCES smart_spaces(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL,
      PRIMARY KEY(space_id, video_id)
    );
  `);
}

function ensureCanonicalLibraryTags(db: Database.Database) {
  const now = new Date().toISOString();
  const findByCatalogKey = db.prepare("SELECT id FROM tags WHERE catalog_key = ?");
  const findByName = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE");
  const insert = db.prepare("INSERT INTO tags(id, name, color, kind, level, sort_order, active, catalog_key, created_at) VALUES(?, ?, ?, 'canonical', ?, ?, 1, ?, ?)");
  const promote = db.prepare("UPDATE tags SET name = ?, color = ?, kind = 'canonical', level = ?, sort_order = ?, active = 1, catalog_key = ?, archived_at = NULL WHERE id = ?");
  const copyAssignments = db.prepare(`
    INSERT OR IGNORE INTO video_tags(video_id, tag_id, origin, confidence, bulk_job_id)
    SELECT video_id, ?, origin, confidence, bulk_job_id FROM video_tags WHERE tag_id = ?
  `);
  const copyParentRelations = db.prepare(`
    INSERT OR IGNORE INTO tag_relations(parent_tag_id, child_tag_id)
    SELECT ?, child_tag_id FROM tag_relations WHERE parent_tag_id = ? AND child_tag_id != ?
  `);
  const copyChildRelations = db.prepare(`
    INSERT OR IGNORE INTO tag_relations(parent_tag_id, child_tag_id)
    SELECT parent_tag_id, ? FROM tag_relations WHERE child_tag_id = ? AND parent_tag_id != ?
  `);
  const deleteTag = db.prepare("DELETE FROM tags WHERE id = ?");
  const insertRelation = db.prepare("INSERT OR IGNORE INTO tag_relations(parent_tag_id, child_tag_id) VALUES(?, ?)");
  db.transaction(() => {
    const idsByName = new Map<string, string>();
    LIBRARY_TAG_CATALOG.forEach((tag) => {
      const catalogMatch = findByCatalogKey.get(tag.id) as { id: string } | undefined;
      const nameMatch = findByName.get(tag.name) as { id: string } | undefined;
      if (catalogMatch && nameMatch && catalogMatch.id !== nameMatch.id) {
        copyAssignments.run(nameMatch.id, catalogMatch.id);
        copyParentRelations.run(nameMatch.id, catalogMatch.id, nameMatch.id);
        copyChildRelations.run(nameMatch.id, catalogMatch.id, nameMatch.id);
        deleteTag.run(catalogMatch.id);
      }
      const existing = nameMatch || catalogMatch;
      const id = existing?.id || tag.id;
      if (existing) promote.run(tag.name, tag.color, tag.level, tag.sortOrder, tag.id, id);
      else insert.run(id, tag.name, tag.color, tag.level, tag.sortOrder, tag.id, now);
      idsByName.set(tag.name, id);
    });
    LIBRARY_TAG_CATALOG.filter((tag) => tag.level === "secondary").forEach((tag) => {
      const childId = idsByName.get(tag.name)!;
      tag.parentNames.forEach((parentName) => insertRelation.run(idsByName.get(parentName), childId));
    });
  })();
}

function migrateTagTaxonomy(db: Database.Database) {
  if (!hasColumn(db, "tags", "level")) db.exec("ALTER TABLE tags ADD COLUMN level TEXT NOT NULL DEFAULT 'legacy'");
  if (!hasColumn(db, "tags", "sort_order")) db.exec("ALTER TABLE tags ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  if (!hasColumn(db, "tags", "active")) db.exec("ALTER TABLE tags ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
  if (!hasColumn(db, "tags", "catalog_key")) db.exec("ALTER TABLE tags ADD COLUMN catalog_key TEXT");
  if (!hasColumn(db, "tags", "archived_at")) db.exec("ALTER TABLE tags ADD COLUMN archived_at TEXT");
  if (!hasColumn(db, "bulk_tag_jobs", "mode")) db.exec("ALTER TABLE bulk_tag_jobs ADD COLUMN mode TEXT NOT NULL DEFAULT 'add'");
  if (!hasColumn(db, "bulk_tag_jobs", "snapshot_json")) db.exec("ALTER TABLE bulk_tag_jobs ADD COLUMN snapshot_json TEXT NOT NULL DEFAULT '{}'");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_catalog_key ON tags(catalog_key) WHERE catalog_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tags_level_active_order ON tags(level, active, sort_order, name);
    CREATE TABLE IF NOT EXISTS tag_relations (
      parent_tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      child_tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY(parent_tag_id, child_tag_id),
      CHECK(parent_tag_id != child_tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tag_relations_child ON tag_relations(child_tag_id, parent_tag_id);
  `);
}

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

function hasTable(db: Database.Database, table: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table));
}

function migrateSavedVideos(db: Database.Database) {
  if (!hasColumn(db, "videos", "custom_title")) {
    db.exec("ALTER TABLE videos ADD COLUMN custom_title TEXT NOT NULL DEFAULT ''");
  }
}

function migrateSourceTypes(db: Database.Database) {
  if (!hasColumn(db, "videos", "source_type")) db.exec("ALTER TABLE videos ADD COLUMN source_type TEXT NOT NULL DEFAULT 'youtube'");
  if (!hasColumn(db, "videos", "source_published_at")) db.exec("ALTER TABLE videos ADD COLUMN source_published_at TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db, "videos", "thread_status")) db.exec("ALTER TABLE videos ADD COLUMN thread_status TEXT NOT NULL DEFAULT 'single'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_videos_source_type ON videos(source_type, created_at DESC)");
}

function createNamedMigrationBackup(db: Database.Database, name: string) {
  const backupDirectory = process.env.LUMINA_BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = path.join(backupDirectory, `${name}-${stamp}-${process.pid}.sqlite`);
  db.prepare("VACUUM INTO ?").run(destination);
}

function migrateProfessionalLibrary(db: Database.Database) {
  const needsCollectionTree = !hasColumn(db, "collections", "parent_id");
  const needsSourceItems = !hasTable(db, "source_items");
  if (needsCollectionTree || needsSourceItems) createNamedMigrationBackup(db, "pre-professional-library");

  if (needsCollectionTree) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE collections_professional (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL COLLATE NOCASE,
            color TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            parent_id TEXT REFERENCES collections_professional(id) ON DELETE SET NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT
          );
          INSERT INTO collections_professional(id, name, color, description, parent_id, sort_order, created_at, updated_at)
          SELECT id, name, color, COALESCE(description, ''), NULL,
            ROW_NUMBER() OVER (ORDER BY name) - 1, created_at, updated_at
          FROM collections;

          CREATE TABLE video_collections_professional (
            video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
            collection_id TEXT NOT NULL REFERENCES collections_professional(id) ON DELETE CASCADE,
            PRIMARY KEY(video_id, collection_id)
          );
          INSERT INTO video_collections_professional(video_id, collection_id)
          SELECT video_id, collection_id FROM video_collections;

          DROP TABLE video_collections;
          DROP TABLE collections;
          ALTER TABLE collections_professional RENAME TO collections;
          ALTER TABLE video_collections_professional RENAME TO video_collections;
        `);
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  }

  if (!hasColumn(db, "tags", "kind")) db.exec("ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'manual'");
  if (!hasColumn(db, "video_tags", "origin")) db.exec("ALTER TABLE video_tags ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'");
  if (!hasColumn(db, "video_tags", "confidence")) db.exec("ALTER TABLE video_tags ADD COLUMN confidence REAL NOT NULL DEFAULT 1");
  if (!hasColumn(db, "video_tags", "bulk_job_id")) db.exec("ALTER TABLE video_tags ADD COLUMN bulk_job_id TEXT");

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_parent_name
    ON collections(COALESCE(parent_id, ''), name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_collections_parent_order ON collections(parent_id, sort_order, name);
    CREATE INDEX IF NOT EXISTS idx_video_collections_collection ON video_collections(collection_id, video_id);

    CREATE TABLE IF NOT EXISTS source_items (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      external_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL DEFAULT 0,
      url TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT '',
      author_handle TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      preview_url TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE(video_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_source_items_video_ordinal ON source_items(video_id, ordinal);
    CREATE INDEX IF NOT EXISTS idx_source_items_external ON source_items(external_id);

    CREATE TABLE IF NOT EXISTS tagging_configs (
      id TEXT PRIMARY KEY,
      interests TEXT NOT NULL DEFAULT '',
      updated_by TEXT REFERENCES profiles(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bulk_tag_jobs (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('preview', 'queued', 'running', 'complete', 'failed', 'undone')),
      model_id TEXT NOT NULL DEFAULT 'auto',
      interests TEXT NOT NULL DEFAULT '',
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      sample_ids_json TEXT NOT NULL DEFAULT '[]',
      approved_json TEXT NOT NULL DEFAULT '[]',
      estimated_units INTEGER NOT NULL DEFAULT 0,
      processed_count INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bulk_tag_suggestions (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES bulk_tag_jobs(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      tag_name TEXT NOT NULL,
      tag_kind TEXT NOT NULL CHECK(tag_kind IN ('canonical', 'descriptive')),
      confidence REAL NOT NULL DEFAULT 0.5,
      accepted INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bulk_tag_changes (
      job_id TEXT NOT NULL REFERENCES bulk_tag_jobs(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(job_id, video_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bulk_tag_jobs_profile_created ON bulk_tag_jobs(profile_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bulk_tag_suggestions_job_video ON bulk_tag_suggestions(job_id, video_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS library_search USING fts5(
      video_id UNINDEXED,
      title,
      author,
      content,
      notes,
      tags,
      collections
    );
  `);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO source_items(id, video_id, external_id, ordinal, url, author_name, text, published_at, preview_url, created_at)
    SELECT 'item_' || id, id, youtube_id, 0, url, channel, description, source_published_at, thumbnail_url, ?
    FROM videos WHERE source_type != 'youtube'
  `).run(now);
  if (needsCollectionTree || needsSourceItems) {
    db.exec(`
      DELETE FROM library_search;
      INSERT INTO library_search(video_id, title, author, content, notes, tags, collections)
      SELECT v.id, COALESCE(NULLIF(v.custom_title, ''), v.title), v.channel,
        TRIM(COALESCE(v.description, '') || '\n' || COALESCE(v.transcript_text, '') || '\n' ||
          COALESCE((SELECT GROUP_CONCAT(si.text, '\n') FROM source_items si WHERE si.video_id = v.id), '')),
        COALESCE((SELECT n.content FROM notes n WHERE n.video_id = v.id), ''),
        COALESCE((SELECT GROUP_CONCAT(t.name, ' ') FROM tags t JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = v.id), ''),
        COALESCE((SELECT GROUP_CONCAT(c.name, ' ') FROM collections c JOIN video_collections vc ON vc.collection_id = c.id WHERE vc.video_id = v.id), '')
      FROM videos v;
    `);
  }
}

function createPreMigrationBackup(db: Database.Database) {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM conversations").get() as { count: number }).count;
  if (!count) return;
  const backupDirectory = process.env.LUMINA_BACKUP_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const destination = path.join(backupDirectory, `pre-unified-chat-${stamp}-${process.pid}.sqlite`);
  db.prepare("VACUUM INTO ?").run(destination);
}

function migrateUnifiedChat(db: Database.Database) {
  if (hasTable(db, "conversation_contexts")) return;
  createPreMigrationBackup(db);
  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE conversations_v3 (
          id TEXT PRIMARY KEY,
          video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL CHECK(scope_type IN ('video', 'collection', 'tag', 'selection')),
          scope_id TEXT NOT NULL,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          title TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO conversations_v3(id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at)
        SELECT id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at FROM conversations;
        DROP TABLE conversations;
        ALTER TABLE conversations_v3 RENAME TO conversations;

        CREATE TABLE conversation_contexts (
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          context_type TEXT NOT NULL CHECK(context_type IN ('collection', 'tag', 'video')),
          context_id TEXT NOT NULL,
          mode TEXT NOT NULL CHECK(mode IN ('include', 'exclude')),
          created_at TEXT NOT NULL,
          PRIMARY KEY(conversation_id, context_type, context_id)
        );
        CREATE TABLE chat_turns (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          user_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
          assistant_message_id TEXT UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
          model_id TEXT NOT NULL DEFAULT 'auto',
          status TEXT NOT NULL CHECK(status IN ('queued', 'generating', 'complete', 'failed')),
          error TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  const now = new Date().toISOString();
  db.exec(`
    INSERT OR IGNORE INTO conversation_contexts(conversation_id, context_type, context_id, mode, created_at)
    SELECT id, scope_type, scope_id, 'include', COALESCE(created_at, '${now}')
    FROM conversations WHERE scope_type IN ('video', 'collection', 'tag');
    INSERT OR IGNORE INTO conversation_contexts(conversation_id, context_type, context_id, mode, created_at)
    SELECT DISTINCT m.conversation_id, 'video', ms.video_id, 'include', '${now}'
    FROM message_sources ms JOIN messages m ON m.id = ms.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.scope_type = 'selection';
    UPDATE conversations SET title = COALESCE(NULLIF(TRIM(title), ''),
      SUBSTR((SELECT content FROM messages WHERE conversation_id = conversations.id AND role = 'user' ORDER BY created_at LIMIT 1), 1, 72),
      'Conversación');
  `);
}

function migrateConversationPins(db: Database.Database) {
  if (!hasColumn(db, "conversations", "pinned_at")) {
    db.exec("ALTER TABLE conversations ADD COLUMN pinned_at TEXT");
  }
}

function migrateConnectedKnowledge(db: Database.Database) {
  if (!hasColumn(db, "collections", "description")) db.exec("ALTER TABLE collections ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  if (!hasColumn(db, "collections", "updated_at")) db.exec("ALTER TABLE collections ADD COLUMN updated_at TEXT");

  if (!hasColumn(db, "conversations", "scope_type")) {
    db.pragma("foreign_keys = OFF");
    try {
      db.transaction(() => {
        db.exec(`
          CREATE TABLE conversations_v2 (
            id TEXT PRIMARY KEY,
            video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
            scope_type TEXT NOT NULL CHECK(scope_type IN ('video', 'collection', 'selection')),
            scope_id TEXT NOT NULL,
            profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            title TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(scope_type, scope_id, profile_id)
          );
          INSERT INTO conversations_v2(id, video_id, scope_type, scope_id, profile_id, title, created_at, updated_at)
          SELECT id, video_id, 'video', video_id, profile_id, '', created_at, updated_at FROM conversations;

          CREATE TABLE messages_v2 (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL REFERENCES conversations_v2(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            citations_json TEXT NOT NULL DEFAULT '[]',
            model_id TEXT NOT NULL DEFAULT 'auto',
            created_at TEXT NOT NULL
          );
          INSERT INTO messages_v2(id, conversation_id, role, content, citations_json, model_id, created_at)
          SELECT id, conversation_id, role, content, citations_json, 'auto', created_at FROM messages;

          DROP TABLE messages;
          DROP TABLE conversations;
          ALTER TABLE conversations_v2 RENAME TO conversations;
          ALTER TABLE messages_v2 RENAME TO messages;
        `);
      })();
    } finally {
      db.pragma("foreign_keys = ON");
    }
  } else if (!hasColumn(db, "messages", "model_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN model_id TEXT NOT NULL DEFAULT 'auto'");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_sources (
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      PRIMARY KEY(message_id, video_id)
    );
    CREATE TABLE IF NOT EXISTS retrieval_units (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      source_kind TEXT NOT NULL CHECK(source_kind IN ('transcript', 'summary', 'note')),
      source_ref TEXT NOT NULL,
      start_seconds REAL,
      end_seconds REAL,
      text TEXT NOT NULL,
      embedding BLOB,
      embedding_model TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      UNIQUE(video_id, source_kind, source_ref)
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_search USING fts5(
      unit_id UNINDEXED,
      video_id UNINDEXED,
      text
    );
    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      node_type TEXT NOT NULL CHECK(node_type IN ('video', 'collection', 'tag', 'person', 'organization', 'tool', 'place', 'concept', 'idea')),
      ref_id TEXT,
      label TEXT NOT NULL,
      normalized_label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      embedding BLOB,
      embedding_model TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      target_node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('manual', 'membership', 'tag', 'ai', 'semantic')),
      confidence REAL NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('suggested', 'confirmed', 'hidden')),
      explanation TEXT NOT NULL DEFAULT '',
      evidence_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_node_id, target_node_id, relation_type, origin)
    );
    CREATE TABLE IF NOT EXISTS entity_mentions (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      chunk_id INTEGER REFERENCES transcript_chunks(id) ON DELETE SET NULL,
      start_seconds REAL,
      end_seconds REAL,
      evidence TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_nodes_ref
    ON knowledge_nodes(node_type, ref_id) WHERE ref_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_label ON knowledge_nodes(node_type, normalized_label);
    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source_status ON knowledge_edges(source_node_id, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target_status ON knowledge_edges(target_node_id, status);
    CREATE INDEX IF NOT EXISTS idx_entity_mentions_video ON entity_mentions(video_id, node_id);
    CREATE INDEX IF NOT EXISTS idx_retrieval_units_video_kind ON retrieval_units(video_id, source_kind);
    CREATE INDEX IF NOT EXISTS idx_conversations_scope_profile ON conversations(scope_type, scope_id, profile_id);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_sources_video ON message_sources(video_id, message_id);
  `);

  migrateUnifiedChat(db);
  migrateConversationPins(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversations_profile_updated ON conversations(profile_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_profile_pinned_updated
    ON conversations(profile_id, (pinned_at IS NULL), pinned_at DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_conversation_contexts_lookup ON conversation_contexts(context_type, context_id, mode);
    CREATE INDEX IF NOT EXISTS idx_chat_turns_conversation_status ON chat_turns(conversation_id, status, created_at);
  `);

  const now = new Date().toISOString();
  db.prepare("UPDATE collections SET updated_at = COALESCE(updated_at, created_at, ?)").run(now);
  const insertUnit = db.prepare(`
    INSERT OR IGNORE INTO retrieval_units(id, video_id, source_kind, source_ref, start_seconds, end_seconds, text, embedding, embedding_model, updated_at)
    SELECT 'ret_transcript_' || id, video_id, 'transcript', CAST(id AS TEXT), start_seconds, end_seconds, text, embedding, '', ?
    FROM transcript_chunks
  `);
  insertUnit.run(now);
  const insertTextUnit = db.prepare(`
    INSERT OR IGNORE INTO retrieval_units(id, video_id, source_kind, source_ref, start_seconds, end_seconds, text, embedding, embedding_model, updated_at)
    VALUES(?, ?, ?, ?, NULL, NULL, ?, NULL, '', ?)
  `);
  const summaries = db.prepare("SELECT id, summary_json AS summaryJson FROM videos WHERE summary_json IS NOT NULL AND TRIM(summary_json) != ''").all() as Array<{ id: string; summaryJson: string }>;
  summaries.forEach((video) => {
    try {
      const summary = JSON.parse(video.summaryJson) as { gist?: string; keyPoints?: Array<string | { text?: string }>; chapters?: Array<{ title?: string; summary?: string }>; takeaways?: string[] };
      const points = (summary.keyPoints ?? []).map((point) => typeof point === "string" ? point : point.text).filter(Boolean);
      const text = [summary.gist, ...points, ...(summary.chapters ?? []).flatMap((chapter) => [chapter.title, chapter.summary]), ...(summary.takeaways ?? [])].filter(Boolean).join("\n");
      if (text.trim()) insertTextUnit.run(`ret_summary_${video.id}`, video.id, "summary", "main", text, now);
    } catch { /* El JSON inválido se conserva en videos para una recuperación manual. */ }
  });
  const notes = db.prepare("SELECT video_id AS videoId, content FROM notes WHERE TRIM(content) != ''").all() as Array<{ videoId: string; content: string }>;
  notes.forEach((note) => insertTextUnit.run(`ret_note_${note.videoId}`, note.videoId, "note", "note", note.content, now));
  db.prepare(`
    INSERT INTO retrieval_search(unit_id, video_id, text)
    SELECT r.id, r.video_id, r.text FROM retrieval_units r
    WHERE NOT EXISTS (SELECT 1 FROM retrieval_search s WHERE s.unit_id = r.id)
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO message_sources(message_id, video_id)
    SELECT m.id, c.video_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.scope_type = 'video' AND c.video_id IS NOT NULL
  `).run();
}

// Las migraciones se revisan una vez por carga del módulo (también tras recargar el código en desarrollo),
// no en cada consulta: antes, cargar miles de fuentes las repetía miles de veces.
let migrationsChecked = false;

export function getDb() {
  if (global.__luminaDb && migrationsChecked) return global.__luminaDb;
  if (global.__luminaDb) {
    migrationsChecked = true;
    try {
    migrateSavedVideos(global.__luminaDb);
    migrateSourceTypes(global.__luminaDb);
    if (!hasTable(global.__luminaDb, "conversation_contexts")) migrateConnectedKnowledge(global.__luminaDb);
    else migrateConversationPins(global.__luminaDb);
    migrateProfessionalLibrary(global.__luminaDb);
    migrateTagTaxonomy(global.__luminaDb);
    ensureCanonicalLibraryTags(global.__luminaDb);
    migrateDiscovery(global.__luminaDb);
    } catch (error) { migrationsChecked = false; throw error; }
    return global.__luminaDb;
  }
  fs.mkdirSync(dataDirectory, { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  global.__luminaDb = db;
  migrate(db);
  // Base recién abierta (al arrancar o tras bajar una copia de iCloud): se revisan sus migraciones.
  migrationsChecked = false;
  return getDb();
}

export function refreshVideoSearch(videoId: string) {
  const db = getDb();
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId) as Record<string, string> | undefined;
  if (!video) return;
  db.prepare("DELETE FROM video_search WHERE video_id = ?").run(videoId);
  db.prepare("INSERT INTO video_search(video_id, title, channel, description, transcript) VALUES(?, ?, ?, ?, ?)")
    .run(videoId, video.custom_title || video.title, video.channel, video.description, video.transcript_text);
  const note = db.prepare("SELECT content FROM notes WHERE video_id = ?").get(videoId) as { content: string } | undefined;
  const tags = (db.prepare("SELECT t.name FROM tags t JOIN video_tags vt ON vt.tag_id = t.id WHERE vt.video_id = ? ORDER BY t.name").all(videoId) as Array<{ name: string }>).map((item) => item.name).join(" ");
  const collections = (db.prepare("SELECT c.name FROM collections c JOIN video_collections vc ON vc.collection_id = c.id WHERE vc.video_id = ? ORDER BY c.name").all(videoId) as Array<{ name: string }>).map((item) => item.name).join(" ");
  const sourceItems = (db.prepare("SELECT text FROM source_items WHERE video_id = ? ORDER BY ordinal").all(videoId) as Array<{ text: string }>).map((item) => item.text).join("\n");
  const visual = db.prepare("SELECT text, labels_json AS labels, description, objects_json AS objects FROM visual_analysis WHERE video_id = ?").get(videoId) as { text: string; labels: string; description: string; objects: string } | undefined;
  const visualWords = visual ? [visual.text, visual.description, ...(JSON.parse(visual.objects) as string[]), ...(JSON.parse(visual.labels) as Array<{ id: string }>).flatMap((label) => [label.id, VISION_LABELS_ES[label.id]])].filter(Boolean).join("\n") : "";
  const highlights = (db.prepare("SELECT quote, note FROM highlights WHERE video_id = ?").all(videoId) as Array<{ quote: string; note: string }>).flatMap((item) => [item.quote, item.note]).filter(Boolean).join("\n");
  db.prepare("DELETE FROM library_search WHERE video_id = ?").run(videoId);
  db.prepare("INSERT INTO library_search(video_id, title, author, content, notes, tags, collections) VALUES(?, ?, ?, ?, ?, ?, ?)")
    .run(videoId, video.custom_title || video.title, video.channel, [video.description, video.transcript_text, sourceItems, visualWords].filter(Boolean).join("\n"), [note?.content, highlights].filter(Boolean).join("\n"), tags, collections);
}
