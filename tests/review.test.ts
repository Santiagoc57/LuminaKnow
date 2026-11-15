import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { currentStreak, dueDate, NEW_CARD, nextProgress } from "../lib/review-schedule";
import { LOCAL_SUMMARY_NOTICE } from "../lib/summary";

test("cada respuesta espacia la tarjeta como corresponde", () => {
  const first = nextProgress(NEW_CARD, "good");
  assert.equal(first.intervalDays, 3);
  const second = nextProgress(first, "good");
  assert.equal(second.intervalDays, 7);
  const third = nextProgress(second, "good");
  assert.equal(third.intervalDays, Math.round(7 * NEW_CARD.ease));
  assert.ok(nextProgress(NEW_CARD, "easy").intervalDays > first.intervalDays);
  assert.ok(nextProgress(NEW_CARD, "easy").ease > NEW_CARD.ease);
  const forgotten = nextProgress(third, "again");
  assert.deepEqual([forgotten.intervalDays, forgotten.reps, forgotten.lapses], [1, 0, 1]);
  assert.ok(forgotten.ease < third.ease);
  let worn = NEW_CARD;
  for (let index = 0; index < 20; index += 1) worn = nextProgress(worn, "again");
  assert.equal(worn.ease, 1.3, "la facilidad tiene un mínimo");
  assert.equal(nextProgress({ ...NEW_CARD, reps: 5, intervalDays: 300, ease: 3 }, "easy").intervalDays, 365, "nunca se aleja más de un año");
});

test("vence a medianoche local y la racha entiende los días", () => {
  const now = new Date(2026, 10, 30, 21, 15);
  assert.equal(dueDate(now, 1).getTime(), new Date(2026, 11, 1).getTime(), "cruza el cambio de mes");
  const day = (date: number) => new Date(2026, 10, date, 12);
  assert.equal(currentStreak([], now), 0);
  assert.equal(currentStreak([day(30), day(30), day(29), day(28), day(26)], now), 3);
  assert.equal(currentStreak([day(29), day(28)], now), 2, "si aún no repasas hoy, la racha sigue viva");
  assert.equal(currentStreak([day(27)], now), 0);
});

test("las tarjetas salen de subrayados e ideas y el progreso es de cada perfil", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-review-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?review=${stamp}`);
  const db = getDb();
  const iso = new Date().toISOString();
  for (const id of ["ana", "beto"]) db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES(?, ?, 'x', '#000', ?)").run(id, id, iso);
  const addVideo = (id: string, takeaways: string[]) => db.prepare("INSERT INTO videos(id, youtube_id, source_type, url, title, status, summary_json, added_by, created_at, updated_at) VALUES(?, ?, 'web', 'https://example.com', ?, 'ready', ?, 'ana', ?, ?)").run(id, id, id, JSON.stringify({ gist: "g", keyPoints: [], chapters: [], takeaways }), iso, iso);
  addVideo("v1", ["uno", "dos", "tres", "cuatro"]);
  addVideo("v2", ["cinco", LOCAL_SUMMARY_NOTICE]);
  db.prepare("INSERT INTO highlights(id, video_id, quote, note, origin, created_by, created_at) VALUES('h1', 'v2', 'Mi subrayado', 'Mi comentario', 'reader', 'ana', ?)").run(iso);
  const { DAILY_REVIEW_LIMIT, getReviewSession, rateReviewCard, setReviewCardSuspended, syncReviewCards } = await import(`../lib/review?review=${stamp}`);
  const now = new Date(2026, 10, 6, 10);
  const session = getReviewSession("ana", { now });
  assert.equal(session.cards[0].kind, "highlight", "lo que subrayaste va primero");
  assert.equal(session.cards[0].note, "Mi comentario");
  assert.equal(session.cards.filter((card: { video: { id: string } }) => card.video.id === "v1").length, 2, "no satura con ideas de una sola fuente");
  assert.equal(session.cards.length, 4);
  assert.equal(session.remaining, 6, "el aviso de resumen local no se convierte en tarjeta");

  const first = session.cards[0];
  assert.deepEqual(first.intervals, { again: 1, good: 3, easy: 5 });
  assert.equal(rateReviewCard("ana", first.id, "good", now).intervalDays, 3);
  assert.throws(() => rateReviewCard("beto", first.id, "good", now), /ya no existe/, "un perfil no toca las tarjetas de otro");

  const later = getReviewSession("ana", { now });
  assert.equal(later.doneToday, 1);
  assert.equal(later.streak, 1);
  assert.ok(!later.cards.some((card: { id: string }) => card.id === first.id), "lo respondido no se repite hoy");
  assert.ok(getReviewSession("ana", { now: new Date(2026, 10, 9, 8) }).cards.some((card: { id: string }) => card.id === first.id), "vuelve el día que le toca");
  assert.equal(getReviewSession("beto", { now }).doneToday, 0);

  const hidden = later.cards[0].id;
  setReviewCardSuspended("ana", hidden, true);
  assert.ok(!getReviewSession("ana", { now }).cards.some((card: { id: string }) => card.id === hidden), "descartar la saca");
  setReviewCardSuspended("ana", hidden, false);

  for (const card of getReviewSession("ana", { now }).cards) rateReviewCard("ana", card.id, "again", now);
  for (let index = 0; index < DAILY_REVIEW_LIMIT; index += 1) db.prepare("INSERT INTO review_log(id, profile_id, card_id, rating, reviewed_at) VALUES(?, 'ana', 'x', 'good', ?)").run(`l${index}`, now.toISOString());
  assert.equal(getReviewSession("ana", { now: new Date(2026, 10, 6, 11) }).cards.length, 0, "respeta el límite diario");

  db.prepare("DELETE FROM highlights WHERE id = 'h1'").run();
  syncReviewCards("ana", now);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM review_cards WHERE kind = 'highlight' AND profile_id = 'ana'").get() as { c: number }).c, 0, "un subrayado borrado sale de la revisión");
  const lapses = () => (db.prepare("SELECT lapses FROM review_cards WHERE profile_id = 'ana' AND lapses > 0 LIMIT 1").get() as { lapses: number }).lapses;
  const before = lapses();
  syncReviewCards("ana", now);
  assert.equal(lapses(), before, "sincronizar no borra el progreso");
  db.prepare("UPDATE videos SET archived_at = ?").run(iso);
  assert.equal(getReviewSession("beto", { now }).cards.length, 0, "lo archivado no se repasa");

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
