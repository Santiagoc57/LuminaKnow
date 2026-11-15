"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileText, History, Link2, LoaderCircle, Plus, RotateCcw } from "lucide-react";
import { findHighlightRanges } from "@/lib/highlight-ranges";
import { linkQueryAtCaret, notePreview, parseInline, parseNoteBlocks, toggleTaskLine } from "@/lib/note-text";
import type { AppVideo, Highlight, NoteConnection, NoteVersion } from "@/lib/types";

async function readJson<T = { ok: boolean }>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la acción.");
  return payload as T;
}

const SAVE_DELAY_MS = 800;

function Text({ text, highlights }: { text: string; highlights: Highlight[] }) {
  const ranges = findHighlightRanges(text, highlights);
  if (!ranges.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={range.start} className="lv-mark" data-highlight-id={range.id}>{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function Inline({ text, highlights, onOpenLink }: { text: string; highlights: Highlight[]; onOpenLink: (title: string) => void }) {
  return <>{parseInline(text).map((node, index) => {
    if (node.kind === "text") return <Text key={index} text={node.text} highlights={highlights} />;
    if (node.kind === "bold") return <strong key={index}><Text text={node.text} highlights={highlights} /></strong>;
    if (node.kind === "em") return <em key={index}><Text text={node.text} highlights={highlights} /></em>;
    if (node.kind === "code") return <code key={index}>{node.text}</code>;
    if (node.kind === "mark") return <mark key={index} className="lv-note-mark"><Text text={node.text} highlights={highlights} /></mark>;
    if (node.kind === "url") return <a key={index} href={node.href} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{node.text}</a>;
    if (node.kind === "link") return <button key={index} className="lv-note-link" onClick={(event) => { event.stopPropagation(); onOpenLink(node.title); }}>{node.title}</button>;
    return null;
  })}</>;
}

function NoteRendered({ content, highlights, onOpenLink, onToggleTask }: { content: string; highlights: Highlight[]; onOpenLink: (title: string) => void; onToggleTask: (line: number) => void }) {
  const inline = (text: string) => <Inline text={text} highlights={highlights} onOpenLink={onOpenLink} />;
  return <>{parseNoteBlocks(content).map((block) => {
    if (block.kind === "h1") return <h1 key={block.line}>{inline(block.text)}</h1>;
    if (block.kind === "h2") return <h2 key={block.line}>{inline(block.text)}</h2>;
    if (block.kind === "h3") return <h3 key={block.line}>{inline(block.text)}</h3>;
    if (block.kind === "quote") return <blockquote key={block.line}>{inline(block.text)}</blockquote>;
    if (block.kind === "item") return <p key={block.line} className="lv-note-item">{inline(block.text)}</p>;
    if (block.kind === "code") return <pre key={block.line}>{block.text}</pre>;
    if (block.kind === "task") return <label key={block.line} className={`lv-note-task ${block.checked ? "done" : ""}`} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={block.checked} onChange={() => onToggleTask(block.line)} /><span>{inline(block.text)}</span></label>;
    return <p key={block.line}>{inline(block.text)}</p>;
  })}</>;
}

export function NoteBody({ video, onSaved, onSettled, onOpenLink }: {
  video: AppVideo;
  onSaved: () => Promise<void>;
  onSettled: () => Promise<void>;
  onOpenLink: (title: string) => void;
}) {
  const initial = video.note?.content ?? "";
  const [content, setContent] = useState(initial);
  const [editing, setEditing] = useState(!initial.trim());
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [link, setLink] = useState<{ start: number; query: string } | null>(null);
  const [targets, setTargets] = useState<NoteConnection[]>([]);
  const [active, setActive] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const latest = useRef(initial);
  const saved = useRef(initial);
  const timer = useRef<number | null>(null);

  const persist = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const value = latest.current;
    if (value === saved.current) return;
    setStatus("saving");
    try {
      await readJson(`/api/videos/${video.id}/note`, { method: "PUT", body: JSON.stringify({ content: value }) });
      saved.current = value;
      setStatus("saved");
      await onSaved();
    } catch { setStatus("error"); }
  }, [onSaved, video.id]);

  function change(value: string, caret?: number) {
    latest.current = value;
    setContent(value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void persist(), SAVE_DELAY_MS);
    if (caret !== undefined) {
      const next = linkQueryAtCaret(value, caret);
      setLink(next);
      setActive(0);
    }
  }

  // Al cambiar de nota o cerrar, lo pendiente se guarda aunque el componente ya no exista.
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    if (latest.current !== saved.current) void fetch(`/api/videos/${video.id}/note`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: latest.current }) });
  }, [video.id]);

  const query = link?.query;
  useEffect(() => {
    if (query === undefined) return;
    const handle = window.setTimeout(() => {
      void readJson<{ targets: NoteConnection[] }>(`/api/notes?q=${encodeURIComponent(query)}&exclude=${encodeURIComponent(video.id)}`).then((result) => setTargets(result.targets)).catch(() => setTargets([]));
    }, 120);
    return () => window.clearTimeout(handle);
  }, [query, video.id]);

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [content, editing]);

  const wantsCreate = Boolean(query?.trim()) && !targets.some((target) => target.title.toLocaleLowerCase("es") === query?.trim().toLocaleLowerCase("es"));
  const optionCount = targets.length + (wantsCreate ? 1 : 0);

  async function insertLink(title: string, create: boolean) {
    if (!link || !textarea.current) return;
    const caret = textarea.current.selectionStart;
    const inserted = `[[${title}]]`;
    const next = `${content.slice(0, link.start)}${inserted}${content.slice(caret)}`;
    const position = link.start + inserted.length;
    setLink(null);
    change(next);
    window.requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(position, position); });
    if (create) { try { await readJson("/api/notes", { method: "POST", body: JSON.stringify({ content: `# ${title}` }) }); await onSettled(); } catch { setStatus("error"); } }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!link || !optionCount) { if (event.key === "Escape" && link) setLink(null); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => (current + 1) % optionCount); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => (current - 1 + optionCount) % optionCount); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setLink(null); }
    else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      if (active < targets.length) void insertLink(targets[active].title, false);
      else void insertLink(query!.trim(), true);
    }
  }

  function startEditing() {
    if (window.getSelection()?.toString()) return;
    setEditing(true);
    window.requestAnimationFrame(() => textarea.current?.focus());
  }

  return <div className="lv-reading lv-note">
    <p className={`lv-note-status ${status}`} role="status">{status === "saving" ? "Guardando…" : status === "saved" ? "Guardado" : status === "error" ? "No se pudo guardar. Sigue escribiendo para reintentar." : " "}</p>
    {editing ? <div className="lv-note-editor">
      <textarea ref={textarea} autoFocus value={content} aria-label="Contenido de la nota" spellCheck placeholder={"# Título de tu nota\n\nEscribe aquí. Usa [[ para enlazar otra nota."} onChange={(event) => change(event.target.value, event.target.selectionStart)} onKeyDown={onKeyDown} onSelect={(event) => { const element = event.currentTarget; setLink(linkQueryAtCaret(element.value, element.selectionStart)); }} onBlur={() => { window.setTimeout(() => { if (document.activeElement !== textarea.current) { setLink(null); void persist().then(onSettled); if (latest.current.trim()) setEditing(false); } }, 150); }} />
      {link && optionCount > 0 && <div className="lv-link-menu" role="listbox" aria-label="Enlazar con">
        {targets.map((target, index) => <button key={target.id} role="option" aria-selected={index === active} className={index === active ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); void insertLink(target.title, false); }}><FileText size={13} /><span>{target.title}</span></button>)}
        {wantsCreate && <button role="option" aria-selected={active === targets.length} className={active === targets.length ? "active" : ""} onMouseDown={(event) => { event.preventDefault(); void insertLink(query!.trim(), true); }}><Plus size={13} /><span>Crear nota «{query!.trim()}»</span></button>}
      </div>}
      <p className="lv-note-help"># título · **negrita** · *cursiva* · ==resaltado== · - lista · - [ ] tarea · &gt; cita · [[enlace]]</p>
    </div> : <div className="lv-note-rendered" onClick={startEditing} title="Clic para editar">
      <NoteRendered content={content} highlights={video.highlights ?? []} onOpenLink={onOpenLink} onToggleTask={(line) => { change(toggleTaskLine(content, line)); }} />
    </div>}
  </div>;
}

export function NoteConnections({ backlinks, outgoing, onOpenLink, onOpen }: { backlinks: NoteConnection[]; outgoing: NoteConnection[]; onOpenLink: (title: string) => void; onOpen: (id: string) => void }) {
  if (!backlinks.length && !outgoing.length) return null;
  return <section className="lv-connections">
    <h3><Link2 size={13} /> Conexiones</h3>
    {backlinks.length > 0 && <><small>Enlazan aquí</small>{backlinks.map((item) => <button key={item.id} onClick={() => onOpen(item.id!)}>{item.title}</button>)}</>}
    {outgoing.length > 0 && <><small>Enlaza a</small>{outgoing.map((item) => <button key={item.title} className={item.id ? "" : "missing"} onClick={() => item.id ? onOpen(item.id) : onOpenLink(item.title)} title={item.id ? undefined : "Esta nota aún no existe: pulsa para crearla"}>{item.title}{!item.id && <em> · crear</em>}</button>)}</>}
  </section>;
}

function versionDate(value: string) {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function NoteHistory({ videoId, onRestored }: { videoId: string; onRestored: () => void }) {
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setError("");
    try { setVersions((await readJson<{ versions: NoteVersion[] }>(`/api/videos/${videoId}/versions`)).versions); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial."); }
  }
  async function restore(id: string) {
    setBusy(true); setError("");
    try {
      await readJson(`/api/videos/${videoId}/versions`, { method: "POST", body: JSON.stringify({ versionId: id }) });
      setOpen(false);
      setVersions(null);
      onRestored();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo restaurar."); }
    finally { setBusy(false); }
  }
  return <section className="lv-history">
    <button className="lv-ghost-action" onClick={() => void toggle()} aria-expanded={open}><History size={12} /> Historial</button>
    {open && (versions === null && !error ? <p className="lv-ghost-wait"><LoaderCircle className="spin" size={13} /> Cargando…</p>
      : versions?.length === 0 ? <small>Aún no hay versiones anteriores. Se guarda una cada 10 minutos de edición.</small>
        : <ul>{versions?.map((version) => <li key={version.id}><div><strong>{versionDate(version.createdAt)}</strong><span>{notePreview(version.content).slice(0, 90) || "(vacía)"}</span></div><button disabled={busy} onClick={() => void restore(version.id)} title="Restaurar esta versión; la actual queda en el historial" aria-label={`Restaurar la versión del ${versionDate(version.createdAt)}`}><RotateCcw size={13} /></button></li>)}</ul>)}
    {error && <p className="lv-error">{error}</p>}
  </section>;
}

const QUICK_NOTE_DRAFT = "lumina-quick-note-draft";

export function QuickNote({ onCreated }: { onCreated: () => Promise<void> }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  // Un borrador olvidado sobrevive a recargar la página hasta que se guarde.
  useEffect(() => {
    const timer = window.setTimeout(() => setValue(window.localStorage.getItem(QUICK_NOTE_DRAFT) ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useLayoutEffect(() => {
    if (!area.current) return;
    area.current.style.height = "auto";
    area.current.style.height = `${Math.max(area.current.scrollHeight, 96)}px`;
  }, [value]);
  async function save() {
    const content = value.trim();
    if (!content || busy) return;
    setBusy(true); setError("");
    try {
      await readJson("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
      setValue("");
      setOpen(false);
      window.localStorage.removeItem(QUICK_NOTE_DRAFT);
      await onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la nota."); }
    finally { setBusy(false); }
  }
  // Cerrada es solo un «+»; al pulsarla se abre para escribir y, si queda vacía, vuelve a cerrarse.
  if (!open && !value) return <button className="lv-quick-note lv-quick-note-plus" onClick={() => { setOpen(true); window.requestAnimationFrame(() => area.current?.focus()); }} aria-label="Nueva nota" title="Nueva nota"><Plus size={22} /></button>;
  return <div className="lv-quick-note">
    <small>Nueva nota</small>
    <textarea ref={area} autoFocus={open} value={value} disabled={busy} aria-label="Nueva nota" placeholder="Escribe algo…" onChange={(event) => { setValue(event.target.value); window.localStorage.setItem(QUICK_NOTE_DRAFT, event.target.value); }} onBlur={() => { if (!value.trim()) setOpen(false); void save(); }} onKeyDown={(event) => { if (event.key === "Escape" && !value.trim()) { setOpen(false); return; } if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); } }} />
    {error && <p className="lv-error">{error}</p>}
  </div>;
}
