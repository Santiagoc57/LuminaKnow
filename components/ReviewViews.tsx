"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, EyeOff, Flame, GraduationCap, Highlighter, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import type { AppVideo, LibraryCollection, LibraryTag, ReviewCard, ReviewSession, SmartSpace } from "@/lib/types";
import { DetailModal } from "./DiscoverViews";

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la acción.");
  return payload as T;
}

function intervalLabel(days: number) {
  if (days <= 1) return "mañana";
  if (days < 30) return `en ${days} días`;
  if (days < 60) return "en 1 mes";
  if (days < 365) return `en ${Math.round(days / 30)} meses`;
  return "en 1 año";
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function DailyReview({ videos, catalog, collections, spaces, onChanged, onOpenVideo }: {
  videos: AppVideo[];
  catalog: LibraryTag[];
  collections: LibraryCollection[];
  spaces: SmartSpace[];
  onChanged: () => Promise<void>;
  onOpenVideo: (id: string) => void;
}) {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [position, setPosition] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<ReviewCard | null>(null);
  const [discardedCount, setDiscardedCount] = useState(0);

  const load = useCallback(async (more = false) => {
    setError("");
    try {
      setSession(await readJson<ReviewSession>(`/api/review${more ? "?more=1" : ""}`));
      setPosition(0);
      setReviewed(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos cargar tu revisión."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const card = session?.cards[position];

  const answer = useCallback(async (action: "again" | "good" | "easy" | "discard") => {
    if (!card || busy) return;
    setBusy(true); setError("");
    try {
      await readJson(`/api/review/${card.id}`, { method: "POST", body: JSON.stringify({ action }) });
      setDiscarded(action === "discard" ? card : null);
      if (action === "discard") setDiscardedCount((current) => current + 1);
      else setReviewed((current) => current + 1);
      setPosition((current) => current + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar tu respuesta."); }
    finally { setBusy(false); }
  }, [busy, card]);

  async function undoDiscard() {
    if (!discarded) return;
    const restored = discarded;
    setDiscarded(null);
    try {
      await readJson(`/api/review/${restored.id}`, { method: "POST", body: JSON.stringify({ action: "restore" }) });
      setPosition((current) => Math.max(0, current - 1));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo deshacer."); }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (openId || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement).closest("input, textarea, select")) return;
      if (event.key === "1") void answer("again");
      if (event.key === "2") void answer("good");
      if (event.key === "3") void answer("easy");
      if (event.key === "x" || event.key === "X") void answer("discard");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, openId]);

  const modal = openId && <DetailModal videoId={openId} catalog={catalog} collections={collections} spaces={spaces} onClose={() => setOpenId(null)} onChanged={onChanged} onOpenFull={onOpenVideo} />;
  const undo = discarded && <div className="lv-toast lv-grid-toast" role="status">No volverá a aparecer.<button onClick={() => void undoDiscard()}>Deshacer</button></div>;

  if (error && !session) return <main className="lv-review"><div className="lv-review-end"><p className="lv-error">{error}</p><button onClick={() => void load()}><RefreshCw size={14} /> Reintentar</button></div></main>;
  if (!session) return <main className="lv-review"><LoaderCircle className="spin" size={22} /></main>;

  if (!card) {
    const doneNow = session.doneToday + reviewed;
    const streak = reviewed > 0 && session.doneToday === 0 ? Math.max(session.streak + 1, 1) : session.streak;
    const quizSources = videos.filter((video) => video.status === "ready" && video.sourceType === "youtube");
    const stillDue = session.remaining - session.cards.length;
    const onlyDiscarded = !doneNow && discardedCount > 0;
    return <main className="lv-review">
      <div className="lv-review-end">
        {doneNow > 0 ? <>
          <h1>Listo por hoy</h1>
          <p>Repasaste {plural(doneNow, "idea", "ideas")}. Lo importante volverá justo cuando esté por olvidarse.</p>
          {streak > 0 && <span className="lv-review-streak"><Flame size={15} /> {plural(streak, "día seguido", "días seguidos")}</span>}
        </> : onlyDiscarded ? <h1>Revisión despejada</h1> : session.remaining === 0 ? <>
          <h1>Nada que repasar por ahora</h1>
          <p>Subraya pasajes mientras lees o analiza fuentes con IA, y aparecerán aquí.</p>
        </> : <h1>Tu revisión está lista</h1>}
        {stillDue > 0 && <button onClick={() => void load(true)}>Seguir repasando ({stillDue})</button>}
        {quizSources.length > 0 && <section className="lv-review-quizzes">
          <h2><GraduationCap size={14} /> Ponte a prueba con un cuestionario</h2>
          {quizSources.slice(0, 6).map((video) => <button key={video.id} onClick={() => onOpenVideo(video.id)}>{video.title}</button>)}
        </section>}
      </div>
      {undo}
      {modal}
    </main>;
  }

  const total = session.cards.length;
  return <main className="lv-review">
    <div className="lv-review-progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={position} aria-label="Progreso de la revisión"><i style={{ width: `${(position / total) * 100}%` }} /></div>
    <header className="lv-review-head"><span>{position + 1} de {total}</span>{session.streak > 0 && <span className="lv-review-streak"><Flame size={13} /> {session.streak}</span>}</header>
    <article className="lv-review-card" key={card.id}>
      <small className={card.kind === "highlight" ? "highlight" : ""}>{card.kind === "highlight" ? <><Highlighter size={12} /> Tu subrayado</> : <><Sparkles size={12} /> Idea clave del resumen</>}</small>
      <blockquote>{card.text}</blockquote>
      {card.note && <p className="lv-review-note">{card.note}</p>}
      <button className="lv-review-source" onClick={() => setOpenId(card.video.id)} title="Abrir la fuente">
        {card.video.thumbnailUrl && <img src={card.video.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
        <span><strong>{card.video.title}</strong>{card.video.channel && <em>{card.video.channel}</em>}</span>
        <BookOpen size={14} />
      </button>
    </article>
    <div className="lv-review-actions">
      <button disabled={busy} onClick={() => void answer("again")}><strong>Lo olvidé</strong><small>{intervalLabel(card.intervals.again)}</small><kbd>1</kbd></button>
      <button className="primary" disabled={busy} onClick={() => void answer("good")}><strong>Lo recuerdo</strong><small>{intervalLabel(card.intervals.good)}</small><kbd>2</kbd></button>
      <button disabled={busy} onClick={() => void answer("easy")}><strong>Muy fácil</strong><small>{intervalLabel(card.intervals.easy)}</small><kbd>3</kbd></button>
    </div>
    <button className="lv-review-discard" disabled={busy} onClick={() => void answer("discard")}><EyeOff size={13} /> No volver a mostrar <kbd>X</kbd></button>
    {error && <p className="lv-error">{error}</p>}
    {undo}
    {modal}
  </main>;
}
