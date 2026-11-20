"use client";

import { useEffect, useState } from "react";
import { Copy, Download, FileText, Link2, LoaderCircle, Save, X } from "lucide-react";
import type { AppVideo } from "@/lib/types";

// Herramientas para producir con lo guardado: documento con citas a partir de un espacio, y línea de tiempo de un tema.

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

// Markdown sencillo (títulos, listas, negritas, cursivas, citas [n]) → HTML seguro.
function renderMarkdown(markdown: string, sources: Array<{ n: number; id: string }>) {
  const byN = new Map(sources.map((source) => [source.n, source.id]));
  const inline = (text: string) => escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[(\d+)\]/g, (match, n) => byN.has(Number(n)) ? `<a class="doc-cite" href="/?video=${encodeURIComponent(byN.get(Number(n))!)}" target="_blank" rel="noreferrer">${n}</a>` : match);
  const out: string[] = [];
  let list: "ul" | "ol" | "" = "";
  const close = () => { if (list) { out.push(`</${list}>`); list = ""; } };
  for (const raw of markdown.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { close(); continue; }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) { close(); const level = Math.min(heading[1].length + 1, 5); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (/^---+$/.test(line.trim())) { close(); out.push("<hr>"); continue; }
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) { close(); out.push(`<${kind}>`); list = kind; }
      out.push(`<li>${inline((bullet || numbered)![1])}</li>`);
      continue;
    }
    close();
    out.push(line.startsWith(">") ? `<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>` : `<p>${inline(line)}</p>`);
  }
  close();
  return out.join("");
}

const FORMATS = [
  { id: "informe", label: "Informe" },
  { id: "guion", label: "Guion de video" },
  { id: "post", label: "Post" },
  { id: "resumen", label: "Resumen" },
] as const;

export function SpaceDocumentModal({ spaceId, spaceName, onClose, onSaved }: { spaceId: string; spaceName: string; onClose: () => void; onSaved?: () => void }) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("informe");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ markdown: string; sources: Array<{ n: number; id: string; title: string }> } | null>(null);
  const [notice, setNotice] = useState("");
  const generate = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/spaces/${spaceId}/document`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format, focus }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo crear el documento.");
      setResult(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el documento."); }
    finally { setBusy(false); }
  };
  const fileName = `${spaceName} — ${FORMATS.find((item) => item.id === format)!.label}`.replace(/[\\/:*?"<>|]/g, "");
  const copy = async () => { if (!result) return; await navigator.clipboard.writeText(result.markdown); setNotice("Copiado"); };
  const download = () => {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${fileName}.md` });
    link.click(); URL.revokeObjectURL(url);
  };
  const saveAsNote = async () => {
    if (!result) return;
    const response = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `# ${fileName}\n\n${result.markdown}` }) });
    setNotice(response.ok ? "Guardado como nota en tu Lúmina" : "No se pudo guardar como nota");
    if (response.ok) onSaved?.();
  };
  return <div className="lv-modal-backdrop space-tool-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="space-tool" role="dialog" aria-label={`Documento de ${spaceName}`}>
      <header><FileText size={18} /><strong>Documento de «{spaceName}»</strong><button onClick={onClose} aria-label="Cerrar"><X size={16} /></button></header>
      <div className="space-tool-controls">
        <div className="space-tool-formats">{FORMATS.map((item) => <button key={item.id} className={format === item.id ? "on" : ""} onClick={() => setFormat(item.id)}>{item.label}</button>)}</div>
        <input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder="Enfoque (opcional): p. ej. «para un público joven», «solo lo económico»" onKeyDown={(event) => { if (event.key === "Enter") void generate(); }} />
        <button className="primary-button" disabled={busy} onClick={() => void generate()}>{busy ? <><LoaderCircle className="spin" size={15} /> Escribiendo…</> : result ? "Volver a escribir" : "Crear documento"}</button>
      </div>
      {error && <p className="lv-error">{error}</p>}
      {result ? <>
        <article className="space-doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.markdown, result.sources) }} />
        <footer><span>{result.sources.length} fuentes citadas{notice ? ` · ${notice}` : ""}</span><button onClick={() => void copy()}><Copy size={14} /> Copiar</button><button onClick={download}><Download size={14} /> Descargar .md</button><button onClick={() => void saveAsNote()}><Save size={14} /> Guardar como nota</button></footer>
      </> : !busy && <p className="space-tool-hint">La IA lee los resúmenes, tus subrayados y tus notas de este espacio y escribe el documento citando cada fuente con [n].</p>}
    </div>
  </div>;
}

// Línea de tiempo: lo guardado sobre un tema, agrupado por mes (por fecha de guardado o de publicación).
export function TimelineModal({ title, videos, onOpen, onClose }: { title: string; videos: AppVideo[]; onOpen: (id: string) => void; onClose: () => void }) {
  const [basis, setBasis] = useState<"saved" | "published">("saved");
  const dated = videos.map((video) => ({ video, date: basis === "published" && video.sourcePublishedAt ? video.sourcePublishedAt : video.createdAt })).filter((item) => !Number.isNaN(new Date(item.date).getTime()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const groups = new Map<string, typeof dated>();
  dated.forEach((item) => { const key = new Date(item.date).toLocaleDateString("es", { month: "long", year: "numeric" }); groups.set(key, [...(groups.get(key) ?? []), item]); });
  return <div className="lv-modal-backdrop space-tool-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="space-tool timeline" role="dialog" aria-label={`Línea de tiempo de ${title}`}>
      <header><strong>Línea de tiempo · {title}</strong><span className="space-tool-formats small"><button className={basis === "saved" ? "on" : ""} onClick={() => setBasis("saved")}>Cuándo lo guardé</button><button className={basis === "published" ? "on" : ""} onClick={() => setBasis("published")}>Cuándo se publicó</button></span><button onClick={onClose} aria-label="Cerrar"><X size={16} /></button></header>
      <div className="timeline-body">{[...groups].map(([month, items]) => <section key={month}>
        <h3>{month} <small>{items.length}</small></h3>
        <ol>{items.map(({ video, date }) => <li key={video.id}><button onClick={() => onOpen(video.id)}>
          <time>{new Date(date).toLocaleDateString("es", { day: "numeric", month: "short" })}</time>
          <span className="timeline-thumb" style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined} />
          <span><strong>{video.title}</strong><small>{video.summary?.cardSummary || video.summary?.gist || video.channel}</small></span>
        </button></li>)}</ol>
      </section>)}{!dated.length && <p className="space-tool-hint">No hay nada con fecha en esta selección.</p>}</div>
    </div>
  </div>;
}

// Compartir un espacio con un enlace de solo lectura (sin notas, subrayados ni chats).
export function ShareSpaceModal({ spaceId, spaceName, onClose }: { spaceId: string; spaceName: string; onClose: () => void }) {
  const [state, setState] = useState<{ enabled: boolean; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const call = async (init?: RequestInit) => {
    const response = await fetch(`/api/spaces/${spaceId}/share`, { headers: { "content-type": "application/json" }, ...init });
    if (response.ok) setState(await response.json());
  };
  useEffect(() => {
    let alive = true;
    fetch(`/api/spaces/${spaceId}/share`).then((response) => response.ok ? response.json() : null).then((value) => { if (alive && value) setState(value); }).catch(() => undefined);
    return () => { alive = false; };
  }, [spaceId]);
  const toggle = async (enabled: boolean) => { setBusy(true); try { await call({ method: "POST", body: JSON.stringify({ enabled }) }); } finally { setBusy(false); } };
  const copy = async () => { if (!state?.url) return; await navigator.clipboard.writeText(state.url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  return <div className="lv-modal-backdrop space-tool-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="space-tool share" role="dialog" aria-label={`Compartir ${spaceName}`}>
      <header><strong>Compartir · {spaceName}</strong><button onClick={onClose} aria-label="Cerrar"><X size={16} /></button></header>
      <div className="share-body">
        <label className="settings-check"><input type="checkbox" disabled={busy || !state} checked={Boolean(state?.enabled)} onChange={(event) => void toggle(event.target.checked)} /> Cualquiera con el enlace puede verlo (solo lectura)</label>
        {state?.enabled && <div className="share-link"><Link2 size={14} /><input readOnly value={state.url} onFocus={(event) => event.target.select()} /><button onClick={() => void copy()}>{copied ? "Copiado" : <><Copy size={13} /> Copiar</>}</button></div>}
        <p className="settings-help">Se ven los títulos, imágenes, resúmenes y enlaces originales; nunca tus notas, subrayados ni chats. El enlace funciona para quien esté en tu misma red (Wi-Fi de casa u oficina) mientras LUMINA esté encendida. Si lo desactivas, el enlace deja de funcionar; al activarlo otra vez se crea uno nuevo.</p>
      </div>
    </div>
  </div>;
}
