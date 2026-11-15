import crypto from "node:crypto";
import { getDb } from "./db";
import { currentStreak, dueDate, NEW_CARD, nextProgress, type ReviewProgress, type ReviewRating } from "./review-schedule";
import { LOCAL_SUMMARY_NOTICE, RETRY_SUMMARY_NOTICE } from "./summary";
import type { ReviewCard, ReviewSession, SourceType } from "./types";
import { makeId, safeJson } from "./utils";

export const DAILY_REVIEW_LIMIT = 10;
const MAX_NEW_IDEAS_PER_SOURCE = 2;

type CardRow = {
  id: string;
  kind: ReviewCard["kind"];
  ref: string;
  text: string;
  note: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string | null;
  videoId: string;
  title: string;
  channel: string;
  sourceType: SourceType;
  thumbnailUrl: string;
};

function hash(text: string) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 32);
}

// Mantiene las tarjetas al día con lo que hay en la biblioteca: no borra el progreso de lo que sigue existiendo.
export function syncReviewCards(profileId: string, now = new Date()) {
  const db = getDb();
  const wanted = new Map<string, { kind: ReviewCard["kind"]; ref: string; videoId: string; text: string }>();
  const highlights = db.prepare("SELECT id, video_id AS videoId, quote FROM highlights").all() as Array<{ id: string; videoId: string; quote: string }>;
  highlights.forEach((item) => wanted.set(`highlight:${item.id}`, { kind: "highlight", ref: item.id, videoId: item.videoId, text: item.quote }));
  const summaries = db.prepare("SELECT id, summary_json AS summary FROM videos WHERE status = 'ready' AND summary_json IS NOT NULL").all() as Array<{ id: string; summary: string }>;
  summaries.forEach((row) => {
    const takeaways = safeJson<{ takeaways?: unknown }>(row.summary, {}).takeaways;
    if (!Array.isArray(takeaways)) return;
    takeaways.filter((text): text is string => typeof text === "string" && Boolean(text.trim()) && text.trim() !== LOCAL_SUMMARY_NOTICE && text.trim() !== RETRY_SUMMARY_NOTICE).forEach((text) => {
      const ref = `${row.id}:${hash(text)}`;
      wanted.set(`idea:${ref}`, { kind: "idea", ref, videoId: row.id, text: text.trim() });
    });
  });
  const existing = db.prepare("SELECT id, kind, ref FROM review_cards WHERE profile_id = ?").all(profileId) as Array<{ id: string; kind: string; ref: string }>;
  const known = new Set(existing.map((row) => `${row.kind}:${row.ref}`));
  const insert = db.prepare("INSERT INTO review_cards(id, profile_id, kind, ref, video_id, text, due_at, interval_days, ease, reps, lapses, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?)");
  const update = db.prepare("UPDATE review_cards SET text = ? WHERE profile_id = ? AND kind = ? AND ref = ? AND text != ?");
  const remove = db.prepare("DELETE FROM review_cards WHERE id = ?");
  db.transaction(() => {
    existing.filter((row) => !wanted.has(`${row.kind}:${row.ref}`)).forEach((row) => remove.run(row.id));
    wanted.forEach((card, key) => {
      if (known.has(key)) update.run(card.text, profileId, card.kind, card.ref, card.text);
      else insert.run(makeId("rcd"), profileId, card.kind, card.ref, card.videoId, card.text, now.toISOString(), NEW_CARD.ease, now.toISOString());
    });
  })();
}

function toCard(row: CardRow): ReviewCard {
  const progress: ReviewProgress = { intervalDays: row.intervalDays, ease: row.ease, reps: row.reps, lapses: row.lapses };
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    note: row.note,
    isNew: !row.lastReviewedAt,
    intervals: { again: nextProgress(progress, "again").intervalDays, good: nextProgress(progress, "good").intervalDays, easy: nextProgress(progress, "easy").intervalDays },
    video: { id: row.videoId, title: row.title, channel: row.channel, sourceType: row.sourceType, thumbnailUrl: row.thumbnailUrl },
  };
}

export function getReviewSession(profileId: string, options: { more?: boolean; now?: Date } = {}): ReviewSession {
  const now = options.now ?? new Date();
  syncReviewCards(profileId, now);
  const db = getDb();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const log = db.prepare("SELECT card_id AS cardId, reviewed_at AS reviewedAt FROM review_log WHERE profile_id = ? ORDER BY reviewed_at DESC LIMIT 2000").all(profileId) as Array<{ cardId: string; reviewedAt: string }>;
  const doneToday = log.filter((row) => row.reviewedAt >= startOfDay).length;
  const due = db.prepare(`
    SELECT c.id, c.kind, c.ref, c.text, COALESCE(h.note, '') AS note, c.interval_days AS intervalDays, c.ease, c.reps, c.lapses, c.last_reviewed_at AS lastReviewedAt,
      v.id AS videoId, COALESCE(NULLIF(v.custom_title, ''), v.title) AS title, v.channel, v.source_type AS sourceType, v.thumbnail_url AS thumbnailUrl
    FROM review_cards c
    JOIN videos v ON v.id = c.video_id AND v.archived_at IS NULL
    LEFT JOIN highlights h ON c.kind = 'highlight' AND h.id = c.ref
    WHERE c.profile_id = ? AND c.suspended = 0 AND c.due_at <= ?
  `).all(profileId, now.toISOString()) as CardRow[];
  const reviews = due.filter((row) => row.lastReviewedAt);
  // Lo ya visto va primero para no perderlo; después lo que subrayaste tú, y al final las ideas de los resúmenes.
  const ordered = [
    ...reviews,
    ...due.filter((row) => !row.lastReviewedAt && row.kind === "highlight"),
    ...due.filter((row) => !row.lastReviewedAt && row.kind === "idea").sort((a, b) => a.ref.split(":")[1].localeCompare(b.ref.split(":")[1])),
  ];
  const perSource = new Map<string, number>();
  const balanced = ordered.filter((row) => {
    if (row.lastReviewedAt || row.kind !== "idea") return true;
    const count = perSource.get(row.videoId) ?? 0;
    perSource.set(row.videoId, count + 1);
    return count < MAX_NEW_IDEAS_PER_SOURCE;
  });
  const slots = options.more ? DAILY_REVIEW_LIMIT : Math.max(0, DAILY_REVIEW_LIMIT - doneToday);
  return {
    cards: balanced.slice(0, slots).map(toCard),
    doneToday,
    dailyLimit: DAILY_REVIEW_LIMIT,
    remaining: due.length,
    streak: currentStreak(log.map((row) => new Date(row.reviewedAt)), now),
  };
}

export function rateReviewCard(profileId: string, cardId: string, rating: ReviewRating, now = new Date()) {
  const db = getDb();
  const card = db.prepare("SELECT interval_days AS intervalDays, ease, reps, lapses FROM review_cards WHERE id = ? AND profile_id = ?").get(cardId, profileId) as ReviewProgress | undefined;
  if (!card) throw new Error("Esa tarjeta ya no existe.");
  const next = nextProgress(card, rating);
  db.transaction(() => {
    db.prepare("UPDATE review_cards SET interval_days = ?, ease = ?, reps = ?, lapses = ?, due_at = ?, last_reviewed_at = ? WHERE id = ?")
      .run(next.intervalDays, next.ease, next.reps, next.lapses, dueDate(now, next.intervalDays).toISOString(), now.toISOString(), cardId);
    db.prepare("INSERT INTO review_log(id, profile_id, card_id, rating, reviewed_at) VALUES(?, ?, ?, ?, ?)").run(makeId("rlg"), profileId, cardId, rating, now.toISOString());
  })();
  return { intervalDays: next.intervalDays };
}

export function setReviewCardSuspended(profileId: string, cardId: string, suspended: boolean) {
  if (!getDb().prepare("UPDATE review_cards SET suspended = ? WHERE id = ? AND profile_id = ?").run(suspended ? 1 : 0, cardId, profileId).changes) throw new Error("Esa tarjeta ya no existe.");
}
