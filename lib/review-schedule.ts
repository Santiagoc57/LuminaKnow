// Repetición espaciada: cada respuesta decide cuándo vuelve a aparecer una tarjeta.
export type ReviewRating = "again" | "good" | "easy";
export type ReviewProgress = { intervalDays: number; ease: number; reps: number; lapses: number };

export const NEW_CARD: ReviewProgress = { intervalDays: 0, ease: 2.3, reps: 0, lapses: 0 };

const MIN_EASE = 1.3;
const MAX_EASE = 3;
const MAX_INTERVAL_DAYS = 365;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function nextProgress(current: ReviewProgress, rating: ReviewRating): ReviewProgress {
  if (rating === "again") {
    return { intervalDays: 1, ease: clamp(current.ease - 0.2, MIN_EASE, MAX_EASE), reps: 0, lapses: current.lapses + 1 };
  }
  const base = current.reps === 0 ? 3 : current.reps === 1 ? 7 : Math.round(current.intervalDays * current.ease);
  if (rating === "good") {
    return { ...current, intervalDays: clamp(base, 1, MAX_INTERVAL_DAYS), reps: current.reps + 1 };
  }
  return { ...current, intervalDays: clamp(Math.round(base * 1.6), 1, MAX_INTERVAL_DAYS), ease: clamp(current.ease + 0.15, MIN_EASE, MAX_EASE), reps: current.reps + 1 };
}

// Vence a medianoche local, para que la tarjeta esté lista desde la mañana de ese día.
export function dueDate(now: Date, intervalDays: number) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + intervalDays);
}

export function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// La racha sigue viva si aún no has repasado hoy pero sí ayer.
export function currentStreak(reviewDates: Date[], now: Date) {
  const days = new Set(reviewDates.map(dayKey));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
