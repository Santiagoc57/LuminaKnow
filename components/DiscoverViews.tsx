"use client";

import { SpaceDocumentModal, TimelineModal } from "./SpaceTools";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Headphones,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BookA,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  CalendarRange,
  FileText,
  Github,
  Globe,
  MessageSquareQuote,
  MessagesSquare,
  StickyNote,
  Eye,
  Bot,
  Highlighter,
  ImageIcon,
  Layers,
  Folder,
  Lightbulb,
  LoaderCircle,
  Maximize2,
  Languages,
  Link2,
  Mic,
  Square,
  Waypoints,
  ListOrdered,
  MoreHorizontal,
  MessageCircle,
  Palette,
  Pin,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ListChecks,
  Shuffle,
  Sparkles,
  Tag,
  Trash2,
  WandSparkles,
  X,
  Cpu,
  PenTool,
  Clapperboard,
  Landmark,
  ScrollText,
  TrendingUp,
  Users,
  FlaskConical,
  HeartPulse,
  GraduationCap,
  Target,
  Megaphone,
  Gamepad2,
} from "lucide-react";
import type { GhostAction } from "@/lib/ghost-prompt";
import { findHighlightRanges } from "@/lib/highlight-ranges";
import { isProvisionalSummary } from "@/lib/summary";
import { colorName as colorNameEs } from "@/lib/visual-colors";
import { notePreview, quoteFromNote, type QuoteParts } from "@/lib/note-text";
import { formatPrice } from "@/lib/web-product";
import type { AppVideo, Highlight, LibraryCollection, LibraryTag, NoteConnection, SmartSpace } from "@/lib/types";
import { NoteBody, NoteConnections, NoteHistory, QuickNote } from "./NoteViews";
import dynamic from "next/dynamic";

// El grafo se carga solo al abrirlo (y así no hay importación circular con ConnectedWorkspaces).
const GraphWorkspace = dynamic(() => import("./ConnectedWorkspaces").then((module) => module.GraphWorkspace), { ssr: false });
import { formatTimestamp, isAudioFileUrl } from "@/lib/utils";
import { libraryQueryTerms, spaceQueryMatches } from "@/lib/library-query";
import { playSound } from "@/lib/sounds";

async function readJson<T = { ok: boolean }>(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la acción.");
  return payload as T;
}

export function sourceArtwork(video: AppVideo) {
  return video.sourceItems[0]?.previewUrl || video.thumbnailUrl || "";
}

function sourceHost(video: AppVideo) {
  if (video.sourceType === "note") return "Nota";
  if (video.sourceType === "palette") return "Paleta";
  if (video.sourceType === "pdf" && video.url.startsWith("local://")) return "PDF";
  if (video.url.startsWith("local://")) return "Imagen";
  try { return new URL(video.url).hostname.replace(/^www\./, ""); } catch { return video.channel; }
}

function SnooMark() {
  return <svg className="site-snoo" viewBox="0 0 20 20" aria-hidden><circle cx="10" cy="10" r="10" fill="#ff4500" /><ellipse cx="10" cy="11.6" rx="5.4" ry="3.9" fill="#fff" /><circle cx="7.9" cy="11.2" r=".95" fill="#ff4500" /><circle cx="12.1" cy="11.2" r=".95" fill="#ff4500" /><path d="M7.9 13.3q2.1 1.3 4.2 0" stroke="#ff4500" strokeWidth=".7" fill="none" strokeLinecap="round" /><circle cx="13.9" cy="5.1" r="1.15" fill="#fff" /><path d="M10 7.7 10.9 4.5l3 .6" stroke="#fff" strokeWidth=".8" fill="none" strokeLinecap="round" /><circle cx="5.2" cy="9.4" r="1.1" fill="#fff" /><circle cx="14.8" cy="9.4" r="1.1" fill="#fff" /></svg>;
}

// Icono del sitio en lugar del dominio escrito: ocupa menos y se reconoce de un vistazo.
// Solo usa iconos propios o el que guardó la propia página (no se consulta a terceros).
function SiteIcon({ video }: { video: AppVideo }) {
  const [failed, setFailed] = useState(false);
  const host = sourceHost(video);
  const favicon = typeof video.sourceItems[0]?.metadata?.faviconUrl === "string" ? video.sourceItems[0].metadata.faviconUrl : "";
  const mark = video.sourceType === "youtube" ? <img src="/youtube.svg" alt="" />
    : video.sourceType === "reddit" ? <SnooMark />
    : video.sourceType === "x" ? <b className="site-x">𝕏</b>
    : host.includes("substack") ? <img src="/substack.svg" alt="" />
    : favicon && !failed ? <img src={favicon} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <b>{host.slice(0, 1).toLocaleUpperCase()}</b>;
  return <span className="lv-site-icon" title={host} aria-label={host}>{mark}</span>;
}

function sourceText(video: AppVideo) {
  if (video.sourceType === "note") return notePreview(video.note?.content ?? "", video.title);
  return video.summary?.sourceTranslation || video.sourceItems.map((item) => item.text.trim()).filter(Boolean).join("\n\n") || video.description || "";
}

function sourcePreview(video: AppVideo) {
  return video.summary?.cardSummary || video.summary?.gist || sourceText(video);
}

function savedAgo(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return "Guardado hoy";
  if (days === 1) return "Guardado ayer";
  if (days < 30) return `Guardado hace ${days} días`;
  const months = Math.floor(days / 30);
  return months < 12 ? `Guardado hace ${months} ${months === 1 ? "mes" : "meses"}` : `Guardado hace ${Math.floor(months / 12)} a`;
}

type DetailPayload = { video: AppVideo; transcript: Array<{ id: number; startSeconds: number; text: string }>; connections?: { backlinks: NoteConnection[]; outgoing: NoteConnection[] }; related?: RelatedItem[] };
type RelatedItem = { id: string; title: string; thumbnailUrl: string; sourceType: AppVideo["sourceType"]; channel: string; gist: string; score: number; reasons: Array<{ kind: "tag" | "collection" | "author"; label: string }> };

function Marked({ text, highlights }: { text: string; highlights: Highlight[] }) {
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

function formatShortDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
}

// Recortes cuyo texto no aparece en lo guardado (por ejemplo, un comentario recortado de un hilo que no se pudo leer).
function LooseClips({ highlights, texts, variant = "quote" }: { highlights: Highlight[]; texts: string[]; variant?: "quote" | "comments" }) {
  const loose = highlights.filter((highlight) => !texts.some((text) => text && findHighlightRanges(text, [highlight]).length));
  if (!loose.length) return null;
  // En Reddit los recortes suelen ser comentarios: se muestran como tarjetas de comentario, no como un bloque amarillo.
  if (variant === "comments") return <section className="lv-clip-comments" aria-label="Comentarios que recortaste">
    <h2>{loose.length === 1 ? "Comentario que recortaste" : `${loose.length} comentarios que recortaste`}</h2>
    {loose.map((highlight) => <div key={highlight.id} data-highlight-id={highlight.id}><RedditComment author="Comentario recortado" publishedAt={highlight.createdAt}>
      {highlight.quote.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph.trim()}</p>)}
      {highlight.note && <small className="lv-reddit-note">{highlight.note}</small>}
    </RedditComment></div>)}
  </section>;
  return <section className="lv-loose-clips" aria-label="Recortes guardados de esta página">
    <h2>{loose.length === 1 ? "Tu recorte" : `Tus recortes · ${loose.length}`}</h2>
    {loose.map((highlight) => <blockquote key={highlight.id} data-highlight-id={highlight.id}>{highlight.quote}{highlight.note && <small>{highlight.note}</small>}</blockquote>)}
  </section>;
}

// Comentario con el aspecto de Reddit: avatar, usuario, «hace 6 días» y el texto alineado bajo el nombre.
const REDDIT_AVATAR_COLORS = ["#ff4500", "#0dd3bb", "#24a0ed", "#ff66ac", "#7193ff", "#ffb000", "#46d160", "#ea0027"];
function relativeTime(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  const seconds = (date.getTime() - Date.now()) / 1000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3_600], ["minute", 60]];
  const format = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  return "ahora";
}

function RedditComment({ author, publishedAt, url, children, nested = false, main = false }: { author: string; publishedAt?: string; url?: string; children: React.ReactNode; nested?: boolean; main?: boolean }) {
  const name = author.replace(/^u\//, "") || "usuario";
  const color = REDDIT_AVATAR_COLORS[[...name].reduce((total, char) => total + char.charCodeAt(0), 0) % REDDIT_AVATAR_COLORS.length];
  return <article className={`lv-reddit-comment ${nested ? "nested" : ""} ${main ? "main" : ""}`}>
    <span className="lv-reddit-avatar" style={{ background: color }} aria-hidden><svg viewBox="0 0 20 20"><circle cx="10" cy="11.5" r="5.2" fill="#fff" /><circle cx="8" cy="11" r="1" fill={color} /><circle cx="12" cy="11" r="1" fill={color} /><circle cx="14.2" cy="5.2" r="1.3" fill="#fff" /><path d="M10 6.3 11 3.6l3 .9" stroke="#fff" strokeWidth=".9" fill="none" /></svg></span>
    <div className="lv-reddit-main">
      <header><strong>{name}</strong>{publishedAt && relativeTime(publishedAt) && <span>· {relativeTime(publishedAt)}</span>}{url && <a href={url} target="_blank" rel="noreferrer" aria-label="Abrir en Reddit"><ExternalLink size={12} /></a>}</header>
      <div className="lv-reddit-body">{children}</div>
    </div>
  </article>;
}

// Cita: letra editorial grande, centrada, con su autor abajo (como las «quotes» de mymind).
function QuoteBody({ quote, onEdit }: { quote: QuoteParts; onEdit: () => void }) {
  return <div className="lv-quote-stage">
    <blockquote className="lv-quote-big"><span aria-hidden>“</span>{quote.text}<span aria-hidden>”</span></blockquote>
    {quote.author && <p className="lv-quote-author">{quote.author}</p>}
    <button className="lv-quote-edit" onClick={onEdit}>Editar</button>
  </div>;
}

// Modo lectura: letra (libro o moderna), tamaño y «enfoque» que oculta el panel. Se recuerda entre artículos.
function ReaderControls() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<{ font: "serif" | "sans"; size: number; focus: boolean }>({ font: "serif", size: 18, focus: false });
  useEffect(() => {
    const timer = window.setTimeout(() => { try { const saved = JSON.parse(window.localStorage.getItem("lumina-reader") || "null"); if (saved) setPrefs((current) => ({ ...current, ...saved, focus: false })); } catch { /* sin preferencias guardadas */ } }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const article = ref.current?.closest<HTMLElement>(".lv-article");
    const detail = ref.current?.closest<HTMLElement>(".lv-detail");
    article?.style.setProperty("--reader-size", `${prefs.size}px`);
    article?.classList.toggle("sans", prefs.font === "sans");
    detail?.classList.toggle("lv-focus", prefs.focus);
    try { window.localStorage.setItem("lumina-reader", JSON.stringify({ font: prefs.font, size: prefs.size })); } catch { /* almacenamiento no disponible */ }
    return () => { detail?.classList.remove("lv-focus"); };
  }, [prefs]);
  const update = (patch: Partial<typeof prefs>) => setPrefs((current) => ({ ...current, ...patch }));
  return <div ref={ref} className="lv-reader-controls">
    <button className={open ? "on" : ""} onClick={() => setOpen((current) => !current)} title="Letra y tamaño" aria-expanded={open}>Aa</button>
    <button className={prefs.focus ? "on" : ""} onClick={() => update({ focus: !prefs.focus })} title="Modo enfoque: oculta el panel">{prefs.focus ? "Salir del enfoque" : "Enfoque"}</button>
    {open && <div className="lv-reader-menu">
      <div role="radiogroup" aria-label="Letra"><button className={prefs.font === "serif" ? "on serif" : "serif"} onClick={() => update({ font: "serif" })}>Libro</button><button className={prefs.font === "sans" ? "on" : ""} onClick={() => update({ font: "sans" })}>Moderna</button></div>
      <div aria-label="Tamaño"><button onClick={() => update({ size: Math.max(15, prefs.size - 1) })} aria-label="Letra más pequeña">A−</button><span>{prefs.size}</span><button onClick={() => update({ size: Math.min(26, prefs.size + 1) })} aria-label="Letra más grande">A+</button></div>
    </div>}
  </div>;
}

function galleryOf(video: AppVideo) {
  if (video.sourceType !== "image") return [];
  const urls = video.sourceItems.map((item) => item.previewUrl).filter(Boolean);
  return urls.length > 1 ? urls : [];
}

function movieOf(video: AppVideo) {
  return video.sourceType === "web" ? video.sourceItems[0]?.metadata?.movie ?? null : null;
}

async function toggleWatched(video: AppVideo) {
  if (!video.consumedAt) playSound("done");
  await readJson(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ action: video.consumedAt ? "unconsume" : "consume" }) });
}

// Película o serie: carátula, año, duración, dirección, nota, sinopsis y el estado «Por ver» / «Vista».
function MovieBody({ video, onChanged }: { video: AppVideo; onChanged?: () => void }) {
  const movie = movieOf(video)!;
  const [busy, setBusy] = useState(false);
  const facts = [movie.year, movie.duration, movie.director && `Dir. ${movie.director}`].filter(Boolean);
  const host = sourceHost(video);
  return <div className="lv-movie-stage">
    {sourceArtwork(video) ? <img className="lv-movie-poster" src={sourceArtwork(video)} alt={movie.name || video.title} referrerPolicy="no-referrer" /> : <div className="lv-movie-poster empty">🎬</div>}
    <div className="lv-movie-info">
      <small>{movie.kind === "series" ? "Serie" : "Película"}</small>
      <h1>{movie.name || video.title}</h1>
      {facts.length > 0 && <p className="lv-movie-facts">{facts.join(" · ")}{movie.rating && <span>★ {movie.rating}</span>}</p>}
      {movie.synopsis && <p className="lv-movie-synopsis">{movie.synopsis}</p>}
      <div className="lv-product-actions">
        <button className={video.consumedAt ? "watched" : ""} disabled={busy} onClick={() => { setBusy(true); void toggleWatched(video).then(() => onChanged?.()).finally(() => setBusy(false)); }}>{video.consumedAt ? <><Check size={14} /> Vista</> : <>＋ Por ver</>}</button>
        <a href={video.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ver en {host}</a>
      </div>
    </div>
  </div>;
}

// Aviso de copia permanente: si la página original se cayó, se ofrece la copia guardada.
function SnapshotNote({ video }: { video: AppVideo }) {
  if (!video.snapshotSavedAt) return null;
  const broken = video.linkStatus === "broken" || video.linkStatus === "unreachable";
  return <p className={`lv-snapshot-note ${broken ? "broken" : ""}`}>{broken ? "La página original ya no responde. " : ""}<a href={`/api/snapshots/${video.id}`} target="_blank" rel="noreferrer">Ver copia guardada</a> · {new Date(video.snapshotSavedAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}</p>;
}

function productOf(video: AppVideo) {
  return video.sourceType === "web" ? video.sourceItems[0]?.metadata?.product ?? null : null;
}

async function replaceCover(videoId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/videos/${videoId}/cover`, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "No se pudo cambiar la foto.");
}

// Producto: la foto en grande, con precio, marca y el enlace a la tienda. Se puede soltar otra foto encima.
function ProductBody({ video, onChanged }: { video: AppVideo; onChanged?: () => void }) {
  const product = productOf(video)!;
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const artwork = sourceArtwork(video);
  const drop = async (files: FileList | null) => {
    const file = [...(files ?? [])].find((item) => item.type.startsWith("image/"));
    if (!file) return;
    setError("");
    try { await replaceCover(video.id, file); onChanged?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar la foto."); }
  };
  return <div className={`lv-product-stage ${dragging ? "dragging" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void drop(event.dataTransfer.files); }}>
    {artwork ? <img src={artwork} alt={video.title} referrerPolicy="no-referrer" /> : <div className="lv-product-empty">Sin foto</div>}
    <div className="lv-product-info">
      {product.brand && <small>{product.brand}</small>}
      <strong>{video.title}</strong>
      {product.price && <span className="lv-price">{formatPrice(product.price, product.currency)}</span>}
      <div className="lv-product-actions">
        <a href={video.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Ver en la tienda</a>
        <label>Cambiar foto<input type="file" accept="image/*" onChange={(event) => void drop(event.target.files)} /></label>
      </div>
      {error && <small className="lv-error">{error}</small>}
    </div>
    {dragging && <div className="lv-product-drop">Suelta la imagen para usarla como foto principal</div>}
  </div>;
}

function TweetCard({ item, fallbackName, highlights, joined }: { item: AppVideo["sourceItems"][number]; fallbackName: string; highlights: Highlight[]; joined: boolean }) {
  const name = item.authorName || fallbackName;
  const date = item.publishedAt ? new Date(item.publishedAt) : null;
  const when = date && !Number.isNaN(date.getTime()) ? `${date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })} · ${date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return <article className={`lv-tweet ${joined ? "joined" : ""}`}>
    <div className="lv-tweet-avatar">{item.metadata?.avatarUrl ? <img src={item.metadata.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}</div>
    <div className="lv-tweet-body">
      <header><strong>{name}</strong>{item.authorHandle && <small>@{item.authorHandle.replace(/^@/, "")}</small>}</header>
      {item.text && <p><Marked text={item.text} highlights={highlights} /></p>}
      {item.previewUrl && <img className="lv-tweet-media" src={item.previewUrl} alt="" referrerPolicy="no-referrer" />}
      {when && <footer>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{when}</a> : when}</footer>}
    </div>
  </article>;
}

// Paleta: franjas grandes; clic en un color copia su código.
// Como mymind: la imagen llena el espacio y lo que sobra se pinta con el color de sus bordes,
// así el póster parece continuar hasta los lados en vez de quedar dentro de un marco gris.
function edgeColor(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const size = 48;
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x > 1 && x < size - 2 && y > 1 && y < size - 2) continue;
    const index = (y * size + x) * 4;
    if (data[index + 3] < 128) continue;
    r += data[index]; g += data[index + 1]; b += data[index + 2]; count += 1;
  }
  return count ? `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})` : null;
}

function ImageStage({ src, alt, fallback, gallery = [] }: { src: string; alt: string; fallback?: string; gallery?: string[] }) {
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const shown = gallery.length ? gallery[slide] : src;
  const stageRef = useRef<HTMLDivElement>(null);
  const color = backdrop || fallback || "#1f1e1b";
  // El mismo color pinta también el marco alrededor del panel, como en mymind.
  useEffect(() => {
    const detail = stageRef.current?.closest<HTMLElement>(".lv-detail");
    detail?.style.setProperty("--lv-backdrop", color);
    return () => { detail?.style.removeProperty("--lv-backdrop"); };
  }, [color]);
  return <div ref={stageRef} className="lv-image-stage" style={{ background: color }}>
    {gallery.length > 1 && <>
      <button className="lv-gallery-step prev" onClick={() => setSlide((current) => (current - 1 + gallery.length) % gallery.length)} aria-label="Foto anterior">‹</button>
      <button className="lv-gallery-step next" onClick={() => setSlide((current) => (current + 1) % gallery.length)} aria-label="Foto siguiente">›</button>
      <span className="lv-gallery-count">{slide + 1} / {gallery.length}</span>
    </>}
    <img key={shown} className="lv-image-full" src={shown} alt={alt} referrerPolicy="no-referrer" crossOrigin={shown.startsWith("/") ? undefined : "anonymous"} onLoad={(event) => { try { setBackdrop(edgeColor(event.currentTarget)); } catch { /* imagen de otro sitio: se usa el color guardado */ } }} />
  </div>;
}

function PaletteBody({ video }: { video: AppVideo }) {
  const [copied, setCopied] = useState("");
  const colors = video.visual?.colors ?? [];
  const origin = video.sourceItems[0]?.url;
  const copy = (hex: string) => { void navigator.clipboard.writeText(hex.toUpperCase()).then(() => { setCopied(hex); window.setTimeout(() => setCopied(""), 1400); }); };
  return <div className="lv-reading lv-palette-view">
    <div className="lv-palette-strip">{colors.map((swatch) => <button key={swatch.hex} style={{ background: swatch.hex, flexGrow: Math.max(swatch.share, 0.1) }} onClick={() => copy(swatch.hex)} title="Copiar código">
      <span>{copied === swatch.hex ? "Copiado" : swatch.hex.toUpperCase()}</span><small>{colorNameEs(swatch.hex)} · {Math.round(swatch.share * 100)}%</small>
    </button>)}</div>
    {origin && <figure className="lv-palette-origin"><img src={origin} alt="" referrerPolicy="no-referrer" /><figcaption>Sacada de esta imagen</figcaption></figure>}
  </div>;
}

function PdfBody({ video }: { video: AppVideo }) {
  const pages = video.sourceItems.filter((item) => item.text.trim());
  const [view, setView] = useState<"text" | "file">(pages.length ? "text" : "file");
  const highlights = video.highlights ?? [];
  const info = pages[0]?.metadata;
  const fileUrl = `/api/media/${video.id}.pdf`;
  return <div className={`lv-reading lv-pdf ${view === "file" ? "file" : ""}`}>
    <div className="lv-pdf-head">
      <div role="tablist" aria-label="Forma de ver el PDF">
        <button role="tab" aria-selected={view === "text"} className={view === "text" ? "active" : ""} disabled={!pages.length} onClick={() => setView("text")}>Texto</button>
        <button role="tab" aria-selected={view === "file"} className={view === "file" ? "active" : ""} onClick={() => setView("file")}>PDF original</button>
      </div>
      {info?.pageCount && <small>{info.pageCount} {info.pageCount === 1 ? "página" : "páginas"}</small>}
    </div>
    {view === "file" ? <iframe className="lv-pdf-frame" src={fileUrl} title={video.title} /> : <>
      <h1>{video.title}</h1>
      {video.channel && <p className="lv-byline">{video.channel}</p>}
      {video.description && video.url.includes("arxiv.org") && <section className="lv-pdf-abstract"><h2>Resumen del autor</h2><p><Marked text={video.description} highlights={highlights} /></p></section>}
      {info?.truncated && <p className="lv-empty-copy">Este PDF es muy largo: solo se extrajeron las primeras 1.500 páginas.</p>}
      {pages.map((page) => <section key={page.id} className="lv-pdf-page">
        <small>Página {page.metadata?.page}{page.metadata?.ocr ? " · leída de una imagen" : ""}</small>
        {page.text.split(/\n{2,}/).map((paragraph, index) => <p key={index}><Marked text={paragraph} highlights={highlights} /></p>)}
      </section>)}
    </>}
  </div>;
}

function SourceBody({ video, transcript, minutesOpen = false, onCoverChanged }: DetailPayload & { minutesOpen?: boolean; onCoverChanged?: () => void }) {
  const [playing, setPlaying] = useState(false);
  // Lo que está en otro idioma se lee en español por defecto; el original queda a un clic.
  const [showOriginal, setShowOriginal] = useState(false);
  const translation = video.summary?.sourceTranslation?.trim() || "";
  const translated = Boolean(translation) && !showOriginal;
  const languageToggle = translation ? <button className="lv-lang-toggle" onClick={() => setShowOriginal((current) => !current)}><Languages size={13} /> {showOriginal ? "Ver en español" : "Ver original"}</button> : null;
  const translatedParagraphs = (marked: Highlight[]) => translation.split(/\n{2,}/).map((paragraph, index) => <p key={index} className="lv-translated"><Marked text={paragraph.trim()} highlights={marked} /></p>);
  const artwork = sourceArtwork(video);
  const highlights = video.highlights ?? [];
  if (video.sourceType === "pdf") return <PdfBody video={video} />;
  if (video.sourceType === "palette") return <PaletteBody video={video} />;
  if (video.sourceType === "image") {
    return <ImageStage src={artwork} alt={video.visual?.description || video.title} fallback={video.visual?.colors?.[0]?.hex} gallery={galleryOf(video)} />;
  }
  if (video.sourceType === "audio") {
    // Podcast o audio: carátula, reproductor si es un archivo directo, y el resumen minuto a minuto con la transcripción.
    const at = (seconds: number) => <span className="lv-audio-time">{formatTimestamp(seconds)}</span>;
    return <div className="lv-reading lv-audio">
      <div className="lv-audio-stage">
        {artwork ? <img src={artwork} alt="" referrerPolicy="no-referrer" /> : <span className="lv-audio-art"><Headphones size={44} /></span>}
        <div>
          <h2>{video.title}</h2>
          {video.channel && <p>{video.channel}{video.durationSeconds ? ` · ${Math.round(video.durationSeconds / 60)} min` : ""}</p>}
          {isAudioFileUrl(video.url) ? <audio controls preload="none" src={video.url} /> : <a className="lv-audio-open" href={video.url} target="_blank" rel="noreferrer"><Play size={14} fill="currentColor" /> Escuchar en el original</a>}
        </div>
      </div>
      <LooseClips highlights={highlights} texts={[...transcript.map((chunk) => chunk.text), video.description]} />
      <section className="lv-tldw">
        <h2>Minuto a minuto</h2>
        {video.summary && <p>{video.summary.cardSummary || video.summary.gist}</p>}
        {(video.summary?.sections ?? []).map((section, index) => <div key={index} className="lv-tldw-section">
          <h3>{section.title}</h3>
          <ul>{section.points.map((point, pointIndex) => <li key={pointIndex}>{typeof point.startSeconds === "number" && at(point.startSeconds)} {point.text}</li>)}</ul>
        </div>)}
        {!video.summary && <p className="lv-empty-copy">{video.status === "ready" ? "Aún no tiene resumen; abajo está la transcripción." : "Escuchando y transcribiendo el audio…"}</p>}
        {transcript.length > 0 && <details className="lv-transcript-fold" open={!video.summary}>
          <summary>Transcripción completa<button type="button" className="lv-transcript-download" title="Descargar la transcripción (.txt)" aria-label="Descargar la transcripción" onClick={(event) => { event.preventDefault(); event.stopPropagation(); downloadTranscript(video, transcript); }}><ArrowDown size={13} /></button></summary>
          <div className="lv-transcript">{transcript.map((chunk) => <p key={chunk.id}>{at(chunk.startSeconds)} {chunk.text}</p>)}</div>
        </details>}
      </section>
    </div>;
  }
  if (video.sourceType === "youtube") {
    // Como mymind: el video ocupa la pantalla; el resumen y las etiquetas viven en el panel de la derecha.
    return <div className="lv-reading lv-video">
      <div className="lv-player">{playing
        ? <iframe src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1`} title={video.title} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
        : <button onClick={() => setPlaying(true)} aria-label={`Reproducir ${video.title}`}>{artwork && <img src={artwork} alt="" />}<span><Play size={26} fill="currentColor" /></span></button>}</div>
      <LooseClips highlights={highlights} texts={[...transcript.map((chunk) => chunk.text), video.description]} />
      {minutesOpen && <section className="lv-tldw" id="lv-minutes">
        <h2>Minuto a minuto</h2>
        {video.summary && <p>{video.summary.cardSummary || video.summary.gist}</p>}
        {(video.summary?.sections ?? []).map((section, index) => <div key={index} className="lv-tldw-section">
          <h3>{section.title}</h3>
          <ul>{section.points.map((point, pointIndex) => <li key={pointIndex}>{typeof point.startSeconds === "number" && <a href={`https://www.youtube.com/watch?v=${video.youtubeId}&t=${Math.floor(point.startSeconds)}s`} target="_blank" rel="noreferrer">{formatTimestamp(point.startSeconds)}</a>}{point.text}</li>)}</ul>
        </div>)}
        {!video.summary && <p className="lv-empty-copy">Aún no tiene resumen; abajo está la transcripción.</p>}
        {transcript.length > 0 && <details className="lv-transcript-fold" open={!video.summary}>
          <summary>Transcripción completa<button type="button" className="lv-transcript-download" title="Descargar la transcripción (.txt)" aria-label="Descargar la transcripción" onClick={(event) => { event.preventDefault(); event.stopPropagation(); downloadTranscript(video, transcript); }}><ArrowDown size={13} /></button></summary>
          <div className="lv-transcript">{transcript.map((chunk) => <p key={chunk.id}><a href={`https://www.youtube.com/watch?v=${video.youtubeId}&t=${Math.floor(chunk.startSeconds)}s`} target="_blank" rel="noreferrer">{formatTimestamp(chunk.startSeconds)}</a><span><Marked text={chunk.text} highlights={highlights} /></span></p>)}</div>
        </details>}
      </section>}
    </div>;
  }
  if (video.sourceType === "x") {
    const items = video.sourceItems.filter((item) => item.text.trim() || item.previewUrl);
    const baseShown = items.length ? items : [{ id: "fallback", authorName: video.channel, authorHandle: "", text: video.description || video.title, previewUrl: video.thumbnailUrl, publishedAt: video.sourcePublishedAt || "", url: video.url, metadata: {} } as AppVideo["sourceItems"][number]];
    const shown = translated ? [{ ...baseShown[0], text: translation }] : baseShown;
    // Como mymind: el tweet como tarjeta centrada, con su imagen; el resto vive en el panel.
    return <div className="lv-tweet-stage">
      {languageToggle}
      <div className="lv-tweets">
        {shown.map((item, index) => <TweetCard key={item.id} item={item} fallbackName={video.channel} highlights={highlights} joined={index < shown.length - 1} />)}
        <a className="lv-tweet-foot" href={video.url} target="_blank" rel="noreferrer"><span>Publicación de {shown[0]?.authorHandle ? `@${shown[0].authorHandle.replace(/^@/, "")}` : video.channel}</span><b>𝕏</b></a>
      </div>
      <div className="lv-tweet-clips"><LooseClips highlights={highlights} texts={shown.map((item) => item.text)} /></div>
    </div>;
  }
  if (video.sourceType === "reddit") {
    const items = video.sourceItems.filter((item) => item.text.trim() || item.previewUrl);
    const first = items[0];
    const isComment = first?.metadata?.kind === "comment";
    const post = !isComment && first && first.ordinal === 0 && first.text.startsWith(video.title) ? first : null;
    const comments = post ? items.slice(1) : items;
    const postBody = post ? post.text.slice(video.title.length).trim() : "";
    // Título limpio (sin « : r/macmini») y la comunidad como etiqueta aparte, como en Reddit.
    const subreddit = (video.title.match(/:\s*(r\/[\w]+)\s*$/) || video.url.match(/reddit\.com\/(r\/[\w]+)/i) || [])[1] || "";
    const cleanTitle = video.title.replace(/\s*:\s*r\/[\w]+\s*$/, "");
    const onlyTitle = !isComment && comments.length === 0 && !postBody && !post?.previewUrl && items.every((item) => item.text.trim() === video.title.trim() || item.text.trim() === cleanTitle);
    return <div className="lv-reading lv-thread">
      {isComment ? <p className="lv-site">Comentario en {first.metadata?.parentUrl ? <a href={first.metadata.parentUrl} target="_blank" rel="noreferrer">{first.metadata.parentTitle || "la publicación"}</a> : first.metadata?.parentTitle || "Reddit"}</p> : <header className="lv-reddit-head">
        <p>{subreddit && <span className="lv-subreddit">{subreddit}</span>}{video.channel && !/reddit\.com$/.test(video.channel) && <span>{subreddit ? video.channel.replace(` · ${subreddit}`, "") : video.channel}</span>}{video.sourcePublishedAt && <span>{formatShortDate(video.sourcePublishedAt)}</span>}</p>
        <h1>{cleanTitle}</h1>
      </header>}
      <LooseClips highlights={highlights} texts={items.map((item) => item.text)} variant="comments" />
      {onlyTitle && <div className="lv-thread-missing"><p>De este hilo solo se guardó el título. Ábrelo en Firefox y pulsa <strong>Guardar</strong> en Lúmina para traer la publicación y sus comentarios.</p><a href={video.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir en Reddit</a></div>}
      {languageToggle}
      {translated ? <div className="lv-thread-translation">{translatedParagraphs(highlights)}</div> : <>
      {post && <>
        {video.channel && !/reddit\.com$/.test(video.channel) && <p className="lv-byline">{video.channel}</p>}
        {postBody && postBody.split(/\n{2,}/).map((paragraph, index) => <p key={index} className="lv-thread-body"><Marked text={paragraph} highlights={highlights} /></p>)}
        {post.previewUrl && <img className="lv-thread-image" src={post.previewUrl} alt="" referrerPolicy="no-referrer" />}
        {comments.length > 0 && <h2 className="lv-thread-count">{comments.length} {comments.length === 1 ? "comentario guardado" : "comentarios guardados"}</h2>}
      </>}
      {comments.length > 0 ? comments.map((item, index) => {
        const depth = Math.min(isComment && index > 0 ? 1 : item.metadata?.depth ?? 0, 6);
        return <div key={item.id} style={depth > 0 ? { marginLeft: depth * 22 } : undefined}><RedditComment author={item.authorName || video.channel} publishedAt={item.publishedAt} url={item.url} nested={depth > 0} main={isComment && index === 0}>
          {item.text.split(/\n{2,}/).map((paragraph, paragraphIndex) => <p key={paragraphIndex}><Marked text={paragraph} highlights={highlights} /></p>)}
          {item.previewUrl && <img src={item.previewUrl} alt="" referrerPolicy="no-referrer" />}
        </RedditComment></div>;
      }) : !post && !onlyTitle && <article><header><strong>{video.channel || sourceHost(video)}</strong></header><p><Marked text={video.description || video.title} highlights={highlights} /></p></article>}
      </>}
    </div>;
  }
  if (movieOf(video)) return <MovieBody video={video} onChanged={onCoverChanged} />;
  if (productOf(video)) return <ProductBody video={video} onChanged={onCoverChanged} />;
  const sections = video.sourceItems.filter((item) => item.text.trim());
  const articleLength = sections.reduce((total, item) => total + item.text.length, 0);
  // Como mymind: una web sin artículo largo (una herramienta, una tienda, un repositorio) se muestra como
  // una captura dentro de un marco de navegador; los artículos se leen en una columna con letra de libro.
  let looksLikeArticle = video.sourceItems.some((item) => item.metadata?.sourceKind === "substack");
  try {
    const url = new URL(video.url);
    const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
    // Un artículo suele tener una ruta con título («/blog/como-construir-una-mente»); una herramienta o un repo, no.
    looksLikeArticle ||= !url.hostname.includes("github.com") && (slug.split(/[-_]/).length >= 4 || /\/(blog|post|posts|article|articles|news|p|noticias|opinion)\//.test(url.pathname));
  } catch { /* enlace local */ }
  if ((articleLength < 1_200 || !looksLikeArticle) && !translated) {
    return <div className="lv-web-stage">
      <figure className="lv-browser-frame">
        <div className="lv-browser-bar"><i /><i /><i /><span>{sourceHost(video)}</span><RegenerateCover video={video} onDone={onCoverChanged} /></div>
        {artwork ? <img src={artwork} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : <div className="lv-browser-empty"><strong>{video.title}</strong>{video.description && <p>{video.description}</p>}</div>}
        <a className="lv-browser-open" href={video.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Abrir {sourceHost(video)}</a>
      </figure>
      <SnapshotNote video={video} />
      <LooseClips highlights={highlights} texts={[...sections.map((item) => item.text), video.description]} />
    </div>;
  }
  return <div className="lv-reading lv-article">
    <ReaderControls />
    <SnapshotNote video={video} />
    {artwork && <img className="lv-hero" src={artwork} alt="" referrerPolicy="no-referrer" />}
    <p className="lv-site">{sourceHost(video)}</p>
    <h1>{video.title}</h1>
    {video.channel && <p className="lv-byline">{video.channel}</p>}
    <LooseClips highlights={highlights} texts={[...sections.map((item) => item.text), video.description]} />
    {languageToggle}
    {translated ? translatedParagraphs(highlights) : sections.length > 0 ? sections.map((item, index) => <section key={item.id}>
      {item.metadata?.heading && item.metadata.heading !== video.title && <h2>{item.metadata.heading}</h2>}
      {item.text.split(/\n{2,}/).map((paragraph, paragraphIndex) => <p key={`${index}-${paragraphIndex}`}><Marked text={paragraph} highlights={highlights} /></p>)}
    </section>) : <p className="lv-empty-copy"><Marked text={video.description || "Solo guardamos el enlace. Analízalo para traer el texto del artículo."} highlights={highlights} /></p>}
  </div>;
}

type GhostEntry = { id: number; action: GhostAction; selection: string; question: string; answer: string; error: string; pending: boolean };

const GHOST_LABELS: Record<GhostAction, string> = { ask: "Pregunta", explain: "Explicación", define: "Definición", simplify: "En simple" };

const TYPE_CHIPS: Record<AppVideo["sourceType"], { label: string; query: string; Icon: typeof Play }> = {
  youtube: { label: "Video", query: "tipo:video", Icon: Play },
  x: { label: "Tweet", query: "tipo:x", Icon: MessageSquareQuote },
  reddit: { label: "Reddit", query: "tipo:reddit", Icon: MessagesSquare },
  web: { label: "Web", query: "tipo:web", Icon: Globe },
  image: { label: "Imagen", query: "tipo:imagen", Icon: ImageIcon },
  note: { label: "Nota", query: "tipo:nota", Icon: StickyNote },
  pdf: { label: "PDF", query: "tipo:pdf", Icon: FileText },
  palette: { label: "Paleta", query: "tipo:paleta", Icon: Palette },
  audio: { label: "Audio", query: "tipo:audio", Icon: Headphones },
};

// Las etiquetas del catálogo llevan el icono de su tema (las subetiquetas, el de su tema padre);
// las libres (las que pones tú o la IA) van sin icono. Así se ve de un vistazo qué es categoría y qué no.
const THEME_ICONS: Record<string, typeof Play> = {
  "Inteligencia artificial": Sparkles, "Tecnología": Cpu, "Diseño gráfico": PenTool, "Audiovisual": Clapperboard,
  "Política": Landmark, "Filosofía": Lightbulb, "Historia": ScrollText, "Economía": TrendingUp, "Cultura": Users,
  "Ciencia": FlaskConical, "Salud": HeartPulse, "Educación": GraduationCap, "Productividad": Target,
  "Comunicación": Megaphone, "Entretenimiento": Gamepad2,
};

function CatalogTagIcon({ tag, catalog }: { tag: { id: string; name: string; level: string }; catalog: LibraryTag[] }) {
  const parentName = tag.level === "primary" ? tag.name : catalog.find((item) => item.id === catalog.find((entry) => entry.id === tag.id)?.parentIds[0])?.name;
  const Icon = (parentName && THEME_ICONS[parentName]) || Tag;
  return <Icon size={10} className="lv-tag-icon" aria-hidden />;
}

// Primera capa: el tipo de cosa guardada. La pone Lúmina y no se puede quitar.
function TypeChip({ video, onSearch }: { video: AppVideo; onSearch?: (query: string) => void }) {
  const chip = TYPE_CHIPS[video.sourceType];
  if (!chip) return null;
  const label = movieOf(video) ? (movieOf(video)!.kind === "series" ? "Serie" : "Película") : productOf(video) ? "Producto" : video.sourceType === "note" && quoteFromNote(video.note?.content || "") ? "Cita" : video.sourceType === "reddit" && video.sourceItems[0]?.metadata?.kind === "comment" ? "Comentario" : video.sourceType === "pdf" && video.url.includes("arxiv.org") ? "Paper" : chip.label;
  const content = <><chip.Icon size={12} />{label}</>;
  return <span className="lv-tag type">{onSearch ? <button className="lv-tag-name" onClick={() => onSearch(chip.query)} title={`Ver todo: ${label}`}>{content}</button> : content}</span>;
}

// Graba con el micrófono del navegador y lo pasa a texto en el servidor (funciona también en Firefox).
export function useDictation(onText: (text: string) => void) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; });
  useEffect(() => () => { recorder.current?.stream.getTracks().forEach((track) => track.stop()); }, []);
  const toggle = async () => {
    setError("");
    if (recorder.current?.state === "recording") { recorder.current.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      media.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setState("working");
        try {
          const blob = new Blob(chunks, { type: media.mimeType || "audio/webm" });
          const response = await fetch("/api/dictation", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
          const result = await response.json() as { text?: string; error?: string };
          if (!response.ok) throw new Error(result.error || "No se pudo transcribir.");
          if (result.text) onTextRef.current(result.text);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo transcribir."); }
        finally { setState("idle"); }
      };
      recorder.current = media;
      media.start();
      setState("recording");
    } catch { setError("No hay acceso al micrófono. Revisa el permiso del navegador."); setState("idle"); }
  };
  return { state, error, toggle: () => void toggle() };
}

type OverlayTab = "related" | "graph";

// Conexiones y grafo ocupan el lugar del video: se ven grandes y se cierran para volver a la fuente.
function ConnectionsOverlay({ tab, onTab, onClose, items, video, catalog, collections, onOpen, onSearch }: {
  tab: OverlayTab;
  onTab: (tab: OverlayTab) => void;
  onClose: () => void;
  items: RelatedItem[];
  video: AppVideo;
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  onOpen: (id: string) => void;
  onSearch?: (query: string) => void;
}) {
  const [filter, setFilter] = useState("");
  // Los motivos compartidos, de más a menos frecuentes: sirven de filtro y de mapa de por qué se parecen.
  const reasons = [...items.flatMap((item) => item.reasons).reduce((map, reason) => {
    const key = `${reason.kind}:${reason.label}`;
    const current = map.get(key) ?? { ...reason, key, count: 0 };
    current.count += 1;
    return map.set(key, current);
  }, new Map<string, { kind: string; label: string; key: string; count: number }>()).values()].sort((a, b) => b.count - a.count);
  const visible = filter ? items.filter((item) => item.reasons.some((reason) => `${reason.kind}:${reason.label}` === filter)) : items;
  const active = reasons.find((reason) => reason.key === filter);
  const strength = (score: number) => (score >= 9 ? "Muy relacionada" : score >= 5 ? "Relacionada" : "Algo en común");
  // En vez del resumen, la tarjeta dice por qué se relaciona con lo que estás viendo.
  const listJoin = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] || "";
  const whyText = (item: RelatedItem) => {
    const tags = item.reasons.filter((reason) => reason.kind === "tag").map((reason) => reason.label);
    const collections = item.reasons.filter((reason) => reason.kind === "collection").map((reason) => reason.label);
    const author = item.reasons.find((reason) => reason.kind === "author");
    return [
      tags.length ? `Las dos tratan de ${listJoin(tags.slice(0, 4))}${tags.length > 4 ? " y más" : ""}.` : "",
      collections.length ? `Las guardaste en ${collections.length === 1 ? "la colección" : "las colecciones"} ${listJoin(collections)}.` : "",
      author ? `Son del mismo autor: ${author.label}.` : "",
    ].filter(Boolean).join(" ");
  };
  return <section className="lv-overlay" id="lv-overlay">
    <header>
      <div className="lv-overlay-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "related"} className={tab === "related" ? "on" : ""} onClick={() => onTab("related")}><Link2 size={14} /> Conexiones <b>{items.length}</b></button>
        <button role="tab" aria-selected={tab === "graph"} className={tab === "graph" ? "on" : ""} onClick={() => onTab("graph")}><Waypoints size={14} /> Grafo</button>
      </div>
      <button className="lv-overlay-close" onClick={onClose} aria-label="Cerrar y volver a la fuente" title="Volver a la fuente"><X size={16} /></button>
    </header>
    {tab === "graph" ? <div className="lv-overlay-graph"><GraphWorkspace focusVideoId={video.id} collections={collections ?? []} tags={catalog} onOpenVideo={onOpen} /></div> : <div className="lv-overlay-body">
      {items.length ? <>
        <p className="lv-overlay-lead">{items.length === 1 ? "Una fuente de tu biblioteca" : `${items.length} fuentes de tu biblioteca`} tiene{items.length === 1 ? "" : "n"} algo en común con «{video.title}».</p>
        <div className="lv-overlay-filters">
          <button className={!filter ? "on" : ""} onClick={() => setFilter("")}>Todas <b>{items.length}</b></button>
          {reasons.slice(0, 10).map((reason) => <button key={reason.key} className={filter === reason.key ? "on" : ""} onClick={() => setFilter(filter === reason.key ? "" : reason.key)}>{reason.kind === "author" ? "Mismo autor" : reason.kind === "collection" ? `Colección ${reason.label}` : reason.label} <b>{reason.count}</b></button>)}
        </div>
        {active && active.kind === "tag" && onSearch && <button className="lv-overlay-more" onClick={() => onSearch(`#${queryValue(active.label)}`)}>Ver todo lo de #{active.label} en tu biblioteca <ArrowRight size={13} /></button>}
        <div className="lv-overlay-grid">{visible.map((item) => {
          const Icon = TYPE_CHIPS[item.sourceType]?.Icon ?? Globe;
          return <button key={item.id} className="lv-overlay-card" onClick={() => onOpen(item.id)}>
            <span className="lv-overlay-thumb" style={item.thumbnailUrl ? { backgroundImage: `url(${item.thumbnailUrl})` } : undefined}>{!item.thumbnailUrl && <Icon size={22} />}<i><Icon size={11} /> {TYPE_CHIPS[item.sourceType]?.label ?? "Fuente"}</i></span>
            <span className="lv-overlay-copy">
              <em className={`lv-strength s${item.score >= 9 ? 3 : item.score >= 5 ? 2 : 1}`}>{strength(item.score)}</em>
              <strong>{item.title}</strong>
              <span className="lv-overlay-why">{whyText(item)}</span>
            </span>
          </button>;
        })}</div>
      </> : <div className="lv-overlay-empty"><Link2 size={24} /><strong>Aún no hay otra fuente conectada</strong><p>Cuando otra fuente comparta etiquetas, colecciones o autor con esta, aparecerá aquí con el motivo.</p></div>}
    </div>}
  </section>;
}

// Preguntas que el lector fantasma sugiere al abrir el chat: las del quiz cuando hay resumen, y unas generales si no.
// La transcripción completa como .txt, con los minutos, para guardarla o pegarla en otro sitio.
function downloadTranscript(video: AppVideo, transcript: Array<{ startSeconds: number; text: string }>) {
  const header = `${video.title}\n${video.channel ? `${video.channel}\n` : ""}${video.url && !video.url.startsWith("local://") ? `${video.url}\n` : ""}\n`;
  const body = transcript.map((chunk) => `[${formatTimestamp(chunk.startSeconds)}] ${chunk.text.trim()}`).join("\n\n");
  const url = URL.createObjectURL(new Blob([header + body + "\n"], { type: "text/plain;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: `${video.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 90) || "transcripcion"} — transcripción.txt` });
  link.click();
  URL.revokeObjectURL(url);
}

function ghostSuggestions(video: AppVideo) {
  const summary = video.summary;
  const kind = video.sourceType === "youtube" ? "este video" : video.sourceType === "audio" ? "este audio" : video.sourceType === "pdf" ? "este documento" : "este texto";
  if (!canQuiz(video) || !summary) return [`¿Cuál es la idea principal de ${kind}?`, "Explícamelo en palabras simples", "¿Qué puedo aplicar de esto?"];
  return [
    `¿Cuál es la idea central de ${kind}?`,
    ...(summary.chapters ?? []).slice(0, 4).map((chapter) => `¿Qué explica «${chapter.title}»?`),
    ...(summary.chapters?.length ? [] : (summary.sections ?? []).slice(0, 4).map((section) => `¿Qué se dice sobre «${section.title}»?`)),
    "¿Qué conclusión conviene recordar?",
    "¿Qué idea puedo poner en práctica?",
  ].slice(0, 5);
}

function GhostSection({ entries, context, onClearContext, onAsk, onRetry, onDismiss, onSave, inputRef, chat = false, onOpenChat, onCloseChat, suggestions = [] }: {
  entries: GhostEntry[];
  context: string;
  onClearContext: () => void;
  onAsk: (question: string) => void;
  onRetry: (entry: GhostEntry) => void;
  onDismiss: (id: number) => void;
  onSave: (entry: GhostEntry) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  chat?: boolean;
  onOpenChat?: () => void;
  onCloseChat?: () => void;
  suggestions?: string[];
}) {
  const [question, setQuestion] = useState("");
  const dictation = useDictation((text) => { onOpenChat?.(); setQuestion((current) => (current.trim() ? `${current.trim()} ${text}` : text)); });
  const send = (value = question) => { if (!value.trim()) return; onAsk(value.trim()); setQuestion(""); if (inputRef.current) inputRef.current.style.height = "auto"; };
  const threadRef = useRef<HTMLDivElement>(null);
  const asked = new Set(entries.map((entry) => entry.question));
  const pendingSuggestions = suggestions.filter((item) => !asked.has(item));
  useEffect(() => { if (chat) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [chat, entries]);
  const form = <form onSubmit={(event) => { event.preventDefault(); send(); }}>
    <textarea ref={inputRef} rows={1} value={question} onFocus={() => onOpenChat?.()} onChange={(event) => { setQuestion(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } if (event.key === "Escape" && chat) onCloseChat?.(); }} placeholder={dictation.state === "recording" ? "Escuchando… pulsa para terminar" : dictation.state === "working" ? "Pasando tu voz a texto…" : context ? "¿Qué quieres saber de este pasaje?" : "Pregúntale a este texto…"} maxLength={1000} />
    <button type="button" className={`lv-mic ${dictation.state}`} onClick={dictation.toggle} disabled={dictation.state === "working"} aria-pressed={dictation.state === "recording"} aria-label={dictation.state === "recording" ? "Terminar de dictar" : "Dictar con el micrófono"} title={dictation.state === "recording" ? "Terminar de dictar" : "Dictar"}>{dictation.state === "working" ? <LoaderCircle className="spin" size={14} /> : dictation.state === "recording" ? <Square size={12} /> : <Mic size={15} />}</button>
    <button type="submit" disabled={!question.trim()} aria-label="Preguntar"><ArrowRight size={14} /></button>
  </form>;
  const contextNote = context && <p className="lv-ghost-context"><span>{context}</span><button onClick={onClearContext} aria-label="Quitar el texto seleccionado"><X size={11} /></button></p>;
  if (!chat) return <section className="lv-ghost">
    <h3><button className="lv-ghost-open" onClick={onOpenChat} title="Abrir el chatbot"><Bot size={13} /> Chatbot{entries.length > 0 && <b>{entries.length}</b>}</button></h3>
    {contextNote}
    {form}
    {dictation.error && <p className="lv-error">{dictation.error}</p>}
  </section>;
  // Modo chat: ocupa el panel entero, con las preguntas sugeridas arriba y la conversación en orden.
  return <section className="lv-ghost lv-ghost-chat">
    <header>
      <button onClick={onCloseChat} aria-label="Volver al resumen" title="Volver al resumen (Esc)"><ArrowLeft size={15} /></button>
      <div><strong><Bot size={14} /> Chatbot</strong></div>
    </header>
    <div className="lv-ghost-thread" ref={threadRef}>
      {[...entries].reverse().map((entry) => <div key={entry.id} className="lv-ghost-turn">
        <div className="lv-ghost-me">
          {entry.selection && <blockquote>{entry.selection.slice(0, 160)}{entry.selection.length > 160 ? "…" : ""}</blockquote>}
          <p>{entry.question || GHOST_LABELS[entry.action]}</p>
        </div>
        <div className="lv-ghost-bot">
          {entry.pending ? <p className="lv-ghost-wait"><LoaderCircle className="spin" size={13} /> Leyendo…</p>
            : entry.error ? <><p className="lv-error">{entry.error}</p><button className="lv-ghost-action" onClick={() => onRetry(entry)}><RefreshCw size={12} /> Reintentar</button></>
              : <><p>{entry.answer}</p><div className="lv-ghost-tools"><button className="lv-ghost-action" onClick={() => onSave(entry)}><Plus size={12} /> Guardar en notas</button><button className="lv-ghost-action" onClick={() => onDismiss(entry.id)}><X size={12} /> Quitar</button></div></>}
        </div>
      </div>)}
      {pendingSuggestions.length > 0 && <div className="lv-ghost-suggestions">
        <small>{entries.length ? "Sigue con" : "Preguntas sugeridas"}</small>
        {pendingSuggestions.slice(0, entries.length ? 3 : 7).map((item) => <button key={item} onClick={() => send(item)}>{item}</button>)}
      </div>}
    </div>
    <div className="lv-ghost-compose">{contextNote}{form}{dictation.error && <p className="lv-error">{dictation.error}</p>}</div>
  </section>;
}

function HighlightItem({ highlight, onJump, onRemove, onNote }: {
  highlight: Highlight;
  onJump: () => void;
  onRemove: () => void;
  onNote: (note: string) => void;
}) {
  const [note, setNote] = useState(highlight.note);
  return <li className="lv-highlight">
    <button className="lv-highlight-quote" onClick={onJump} title="Ir a este pasaje">{highlight.quote}</button>
    <button className="lv-highlight-remove" onClick={onRemove} aria-label="Quitar subrayado"><X size={11} /></button>
    <input value={note} onChange={(event) => setNote(event.target.value)} onBlur={() => { if (note.trim() !== highlight.note) onNote(note.trim()); }} placeholder={highlight.origin === "clip" ? "Recorte · añade un comentario…" : "Añade un comentario…"} maxLength={5000} />
  </li>;
}

// Los guiones equivalen a espacios en el buscador, así un nombre compuesto sigue siendo un solo término.
function queryValue(value: string) {
  return value.trim().replace(/\s+/g, "-");
}

// Resumen de una imagen, como el TLDR de mymind: lo que la IA vio en ella.
function ImageSummary({ video, busy, onRegenerate }: { video: AppVideo; busy: boolean; onRegenerate: () => void }) {
  const visual = video.visual;
  return <section className="lv-tldr open">
    <div className="lv-tldr-head"><button type="button" aria-expanded><span><Sparkles size={13} /> Resumen</span></button><button className="lv-regenerate" disabled={busy} onClick={onRegenerate} title={visual?.description ? "Regenerar (vuelve a analizar la imagen)" : "Analizar la imagen"} aria-label={visual?.description ? "Regenerar" : "Analizar"}><RefreshCw size={12} /></button></div>
    {visual?.description ? <p>{visual.description}</p> : <p className="lv-provisional-copy">{busy ? "Analizando la imagen…" : visual?.error ? "No se pudo leer la imagen. Pulsa Analizar para intentarlo de nuevo." : "Aún sin resumen. Pulsa Analizar para que la IA la describa."}</p>}
  </section>;
}

// Acciones de imagen, discretas bajo el resumen: el resto (título, resumen, etiquetas) ya lo dice la IA.
function VisualSection({ video, onVibe, onPalette, busy }: { video: AppVideo; onDescribe?: () => void; busy: boolean; onSearch?: (query: string) => void; onVibe?: (video: AppVideo) => void; onPalette?: () => void }) {
  const visual = video.visual;
  const palette = onPalette && (visual?.colors ?? []).length >= 2;
  const vibe = onVibe && visual?.hasPrint;
  if (!palette && !vibe) return null;
  return <div className="lv-image-actions">
    {vibe && <button className="lv-ghost-action" onClick={() => onVibe(video)} title="Busca imágenes con un aspecto parecido. Se calcula en tu Mac."><Palette size={12} /> Misma vibra</button>}
    {palette && <button className="lv-ghost-action" disabled={busy} onClick={onPalette} title="Guarda los colores de esta imagen como una tarjeta de paleta"><Palette size={12} /> Sacar paleta</button>}
  </div>;
}

function consumeLabels(video: AppVideo) {
  if (movieOf(video)) return { pending: movieOf(video)!.kind === "series" ? "Ya la vi" : "Ya la vi", done: "Vista", Icon: Eye };
  if (video.sourceType === "youtube") return { pending: "Ya vi este video", done: "Video visto", Icon: Eye };
  if (video.sourceType === "audio") return { pending: "Ya lo escuché", done: "Escuchado", Icon: Headphones };
  if (video.sourceType === "image") return { pending: "Ya vi esta imagen", done: "Imagen vista", Icon: Eye };
  return { pending: "Ya leí esto", done: "Leído", Icon: BookOpenCheck };
}

// El quiz tiene sentido donde hay algo que aprender: videos, artículos y PDF ya analizados (no imágenes, tweets ni notas).
function canQuiz(video: AppVideo) {
  if (!video.summary?.gist) return false;
  if (video.sourceType === "youtube" || video.sourceType === "audio" || video.sourceType === "pdf") return true;
  return video.sourceType === "web" && !productOf(video) && !movieOf(video);
}

function InsightPanel({ minutesOpen, onToggleMinutes, quizOpen, onToggleQuiz, relatedOpen, onToggleRelated, relatedCount, graphOpen, onToggleGraph, chatMode = false, onChatMode, video, catalog, collections, spaces, connections, onOpenLink, onNavigate, onNoteReplaced, onSearch, onVibe, ghost, onChanged, onOpenFull, onAsk, onJumpToHighlight, onRemoveHighlight, onHighlightNote, onArchived }: {
  onArchived?: () => void;
  video: AppVideo;
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  spaces?: SmartSpace[];
  connections?: DetailPayload["connections"];
  onOpenLink: (title: string) => void;
  onNavigate: (id: string) => void;
  onNoteReplaced: () => void;
  onSearch?: (query: string) => void;
  onVibe?: (video: AppVideo) => void;
  ghost: { entries: GhostEntry[]; context: string; inputRef: React.RefObject<HTMLTextAreaElement | null>; onClearContext: () => void; onAsk: (question: string) => void; onRetry: (entry: GhostEntry) => void; onDismiss: (id: number) => void };
  onJumpToHighlight: (id: string) => void;
  onRemoveHighlight: (id: string) => void;
  onHighlightNote: (id: string, note: string) => void;
  onChanged: () => Promise<void>;
  onOpenFull?: (id: string) => void;
  minutesOpen?: boolean;
  onToggleMinutes?: () => void;
  quizOpen?: boolean;
  onToggleQuiz?: () => void;
  relatedOpen?: boolean;
  onToggleRelated?: () => void;
  relatedCount?: number;
  graphOpen?: boolean;
  onToggleGraph?: () => void;
  chatMode?: boolean;
  onChatMode?: (open: boolean) => void;
  onAsk?: (id: string) => void;
}) {
  const [note, setNote] = useState(video.note?.content || "");
  const [expanded, setExpanded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const [freeTags, setFreeTags] = useState<LibraryTag[]>([]);
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    readJson<{ tags: LibraryTag[] }>("/api/tags").then((result) => { if (!cancelled) setFreeTags(result.tags); }).catch(() => {});
    return () => { cancelled = true; };
  }, [pickerOpen]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [newSpace, setNewSpace] = useState("");
  const inSomeSpace = (spaces ?? []).some((space) => space.itemIds.includes(video.id) || spaceQueryMatches(space.query, video, catalog));
  const [copied, setCopied] = useState(false);
  // Las notas se pueden plegar; se recuerda la preferencia.
  const [notesOpen, setNotesOpen] = useState(() => { try { return window.localStorage.getItem("lumina-notes-open") !== "0"; } catch { return true; } });
  const toggleNotes = () => setNotesOpen((current) => { try { window.localStorage.setItem("lumina-notes-open", current ? "0" : "1"); } catch { /* sin almacenamiento */ } return !current; });
  const isImage = video.sourceType === "image";
  const isPalette = video.sourceType === "palette";
  const isNote = video.sourceType === "note";
  const isPdf = video.sourceType === "pdf";
  const isLocal = video.url.startsWith("local://");
  const consume = consumeLabels(video);
  const copyLink = async () => { await navigator.clipboard.writeText(video.url); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const summary = video.summary;
  const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const normalizedQuery = fold(tagQuery.replace(/^#/, ""));
  const tagLimit = (level: LibraryTag["level"]) => (level === "primary" ? 3 : level === "free" ? 12 : 2);
  const available = [...catalog, ...freeTags].filter((tag) => {
    if (video.tags.some((item) => item.id === tag.id)) return false;
    if (video.tags.filter((item) => item.level === tag.level).length >= tagLimit(tag.level)) return false;
    return !normalizedQuery || fold(tag.name).includes(normalizedQuery);
  }).sort((a, b) => Number(normalizedQuery && !fold(a.name).startsWith(normalizedQuery)) - Number(normalizedQuery && !fold(b.name).startsWith(normalizedQuery))).slice(0, 10);
  const exactTag = [...catalog, ...freeTags, ...video.tags].some((tag) => fold(tag.name) === normalizedQuery);
  const createTag = async () => {
    const name = tagQuery.replace(/^#/, "").trim();
    if (!name) return;
    setTagQuery("");
    await act(async () => {
      const tag = await readJson<LibraryTag>("/api/tags", { method: "POST", body: JSON.stringify({ name }) });
      await readJson(`/api/videos/${video.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: [...video.tags.map((item) => item.id), tag.id] }) });
      setFreeTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, { ...tag, parentIds: [], active: true }]);
    });
  };

  async function act(task: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await task(); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { setBusy(false); }
  }
  // Sugerencias de etiquetas a pedido (por si las puestas no convencen): se añaden con un clic.
  const [tagSuggestions, setTagSuggestions] = useState<Array<{ id: string; name: string; level: string; color: string }> | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const suggestTags = async () => {
    setSuggesting(true);
    try { setTagSuggestions((await readJson<{ tags: Array<{ id: string; name: string; level: string; color: string }> }>(`/api/videos/${video.id}/tags`, { method: "POST" })).tags); }
    catch { setTagSuggestions([]); }
    finally { setSuggesting(false); }
  };
  const setTags = (tagIds: string[]) => act(() => readJson(`/api/videos/${video.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds }) }));
  const saveNote = () => { if (note !== (video.note?.content || "")) void act(() => readJson(`/api/videos/${video.id}/note`, { method: "PUT", body: JSON.stringify({ content: note }) })); };
  const patch = (action: string) => act(() => readJson(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ action }) }));
  const saveGhostAnswer = (entry: GhostEntry) => {
    const block = [entry.selection && entry.selection.split(/\n+/).map((line) => `> ${line}`).join("\n"), entry.question, entry.answer].filter(Boolean).join("\n\n");
    const content = note.trim() ? `${note.trim()}\n\n${block}` : block;
    setNote(content);
    void act(() => readJson(`/api/videos/${video.id}/note`, { method: "PUT", body: JSON.stringify({ content }) })).then(() => { if (isNote) onNoteReplaced(); });
  };
  // Los recortes que no aparecen en el texto ya se ven en la lectura, bajo el título: aquí solo van los subrayados del texto.
  const bodyTexts = [...video.sourceItems.map((item) => item.text), video.description];
  const highlights = (video.highlights ?? []).filter((highlight) => video.sourceType === "youtube" || bodyTexts.some((text) => text && findHighlightRanges(text, [highlight]).length));

  const ghostProps = { ...ghost, onSave: saveGhostAnswer, chat: chatMode, onOpenChat: () => onChatMode?.(true), onCloseChat: () => onChatMode?.(false), suggestions: ghostSuggestions(video) };
  const footer = <footer className="lv-actions"><div className="lv-actions-inner">
      {collectionsOpen && collections && <div className="lv-collection-picker" role="menu">
        {spaces && <>
          <strong>Espacios</strong>
          {!spaces.length && <small>Aún no tienes espacios.</small>}
          {spaces.map((space) => {
            const byQuery = spaceQueryMatches(space.query, video, catalog);
            const added = space.itemIds.includes(video.id);
            return <button key={space.id} role="menuitemcheckbox" aria-checked={byQuery || added} disabled={busy || byQuery} title={byQuery ? `Está aquí porque cumple la regla: ${space.query}` : undefined} onClick={() => void act(() => readJson(`/api/spaces/${space.id}/items/${video.id}`, { method: added ? "DELETE" : "PUT" }))}><i style={{ borderColor: space.color, background: byQuery || added ? space.color : "transparent" }} />{space.name}{byQuery ? <small>por regla ✦</small> : added && <Check size={13} />}</button>;
          })}
          <form className="lv-new-space" onSubmit={(event) => { event.preventDefault(); const name = newSpace.trim(); if (!name) return; setNewSpace(""); void act(() => readJson("/api/spaces", { method: "POST", body: JSON.stringify({ name, videoId: video.id }) })); }}>
            <Plus size={13} /><input value={newSpace} maxLength={60} onChange={(event) => setNewSpace(event.target.value)} placeholder="Nuevo espacio…" aria-label="Nombre de la nuevo espacio" />
          </form>
        </>}
      </div>}
      <div className="lv-bubbles">{!isNote && !isImage && !isPalette && <button className={`lv-consume-bubble ${video.consumedAt ? "on" : ""}`} disabled={busy} aria-pressed={Boolean(video.consumedAt)} onClick={() => { if (!video.consumedAt) playSound("done"); void patch(video.consumedAt ? "unconsume" : "consume"); }} title={video.consumedAt ? `${consume.done} · pulsa para desmarcar` : consume.pending} aria-label={video.consumedAt ? consume.done : consume.pending}><Check size={16} /></button>}
      {onToggleMinutes && (video.sourceType === "youtube" || video.sourceType === "audio") && <button className={minutesOpen ? "on" : ""} aria-pressed={minutesOpen} onClick={onToggleMinutes} title="Resumen minuto a minuto" aria-label="Resumen minuto a minuto"><ListOrdered size={16} /></button>}
      
      {onToggleRelated && <button className={relatedOpen ? "on" : ""} aria-pressed={relatedOpen} onClick={onToggleRelated} title={`Conexiones y grafo${relatedCount ? ` · ${relatedCount}` : ""}`} aria-label="Conexiones y grafo"><Link2 size={16} /></button>}
      {isImage && <a href={video.thumbnailUrl} download title="Descargar" aria-label="Descargar imagen"><ArrowDown size={16} /></a>}
      {isPdf && <a href={`/api/media/${video.id}.pdf`} download={`${video.title.slice(0, 80)}.pdf`} title="Descargar PDF" aria-label="Descargar PDF"><ArrowDown size={16} /></a>}
      {collections && <button className={video.collections.length || inSomeSpace ? "on" : ""} onClick={() => setCollectionsOpen((current) => !current)} title="Espacios" aria-label="Espacios" aria-expanded={collectionsOpen}><Circle size={16} /></button>}
      <button className={video.topPosition !== null && video.topPosition !== undefined ? "on" : ""} disabled={busy} aria-pressed={video.topPosition !== null && video.topPosition !== undefined} onClick={() => { if (video.topPosition === null || video.topPosition === undefined) playSound("pin"); void patch(video.topPosition !== null && video.topPosition !== undefined ? "unpin" : "pin"); }} title={video.topPosition !== null && video.topPosition !== undefined ? "Quitar de En mente" : "Poner en En mente"} aria-label={video.topPosition !== null && video.topPosition !== undefined ? "Quitar de En mente" : "Poner en En mente"}><Pin size={16} /></button>
      {!isLocal && <button onClick={() => void copyLink()} title={copied ? "Enlace copiado" : "Copiar enlace"} aria-label="Copiar enlace">{copied ? <Check size={16} /> : <Copy size={16} />}</button>}
      {!isLocal && <a href={video.url} target="_blank" rel="noreferrer" title="Abrir original" aria-label="Abrir original"><ExternalLink size={16} /></a>}
      {video.archivedAt
        ? <button disabled={busy} onClick={() => void patch("unarchive")} title="Restaurar" aria-label="Restaurar"><RotateCcw size={16} /></button>
        : <button disabled={busy} onClick={() => { playSound("remove"); void patch("archive").then(() => onArchived?.()); }} title="Archivar (se puede restaurar)" aria-label="Archivar"><Trash2 size={16} /></button>}
  </div></div></footer>;
  if (chatMode && !isPalette && !isImage) return <aside className="lv-insight chat"><GhostSection {...ghostProps} />{footer}</aside>;
  return <aside className="lv-insight">
    <header>
      <strong>{video.title}</strong>
      <small>{savedAgo(video.createdAt)}{!video.url.startsWith("local://") && <> · <a href={video.url} target="_blank" rel="noreferrer">{sourceHost(video)}</a></>}{!isNote && !isPalette && <> · <button className="lv-retitle" disabled={busy} onClick={() => void patch("retitle")} title="Otro título (la IA escribe uno nuevo)" aria-label="Otro título"><RefreshCw size={12} /></button></>}</small>
    </header>
    {isImage ? <ImageSummary video={video} busy={busy} onRegenerate={() => void patch("retry")} /> : isNote || isPalette ? null : summary ? <section className={`lv-tldr ${expanded ? "open" : ""}`}>
      <div className="lv-tldr-head"><button onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}><span><Sparkles size={13} /> Resumen</span><ChevronDown size={14} /></button><button className="lv-regenerate" disabled={busy} onClick={() => void patch("retry")} title="Regenerar el resumen y las etiquetas" aria-label="Regenerar"><RefreshCw size={12} /></button></div>
      {isProvisionalSummary(summary.takeaways) && <small className="lv-provisional">Resumen provisional: la IA no respondió al guardarlo. Pulsa ↻ para regenerarlo.</small>}
      <p onClick={() => setExpanded((current) => !current)} title={expanded ? "Ver menos" : "Ver más"}>{(summary.cardSummary || "").length > summary.gist.length ? summary.cardSummary : summary.gist}</p>
      {expanded && <>
        {summary.keyPoints.length > 0 && <ul>{summary.keyPoints.map((point, index) => <li key={index}>{point.text}</li>)}</ul>}
      </>}
    </section> : video.status === "failed" ? <section className="lv-pending"><p>{video.error || "El análisis no terminó."}</p><button disabled={busy} onClick={() => void patch("retry")}><RefreshCw size={14} /> Reintentar</button></section>
      : video.status === "saved" || video.status === "needs_transcript" ? <section className="lv-pending"><p>{isPdf ? "Guardado y buscable en tu Mac. Analizarlo envía su texto a tu proveedor de IA." : "Aún no tiene resumen."}</p><button disabled={busy || video.status !== "saved"} onClick={() => void patch("retry")}><Sparkles size={14} /> Analizar con IA</button></section>
        : <section className="lv-pending"><p><LoaderCircle className="spin" size={14} /> Lúmina está analizando esta fuente…</p></section>}
    <NoteConnections backlinks={connections?.backlinks ?? []} outgoing={connections?.outgoing ?? []} onOpenLink={onOpenLink} onOpen={onNavigate} />
    {isImage && sourceArtwork(video) && <VisualSection onPalette={() => void act(async () => { const result = await readJson<{ id: string }>(`/api/videos/${video.id}/palette`, { method: "POST" }); onNavigate?.(result.id); })} video={video} busy={busy} onSearch={onSearch} onVibe={onVibe} onDescribe={() => void act(() => readJson(`/api/videos/${video.id}/vision`, { method: "POST" }))} />}
    {!isPalette && !isImage && <GhostSection {...ghostProps} />}
    {highlights.length > 0 && <section>
      <h3>Subrayados · {highlights.length}</h3>
      <ul className="lv-highlights">{highlights.map((highlight) => <HighlightItem key={highlight.id} highlight={highlight} onJump={() => onJumpToHighlight(highlight.id)} onRemove={() => onRemoveHighlight(highlight.id)} onNote={(value) => onHighlightNote(highlight.id, value)} />)}</ul>
    </section>}
    <section>
      <h3 className="lv-tags-head">Etiquetas <button className="lv-retitle" disabled={suggesting || busy} onClick={() => void suggestTags()} title="Sugerir etiquetas (la IA vuelve a leer la fuente)" aria-label="Sugerir etiquetas"><RefreshCw size={12} className={suggesting ? "spin" : ""} /></button></h3>
      {tagSuggestions && <div className="lv-tag-suggestions">{tagSuggestions.length ? tagSuggestions.filter((tag) => !video.tags.some((item) => item.id === tag.id)).map((tag) => <button key={tag.id} disabled={busy} onClick={() => void setTags([...video.tags.map((item) => item.id), tag.id])} title="Añadir esta etiqueta"><Plus size={11} /><i style={{ background: tag.color }} />{tag.name}</button>) : <small>No hay más etiquetas que sugerir: las que tiene ya encajan.</small>}</div>}
      <div className="lv-tags">
        <TypeChip video={video} onSearch={onSearch} />
        {video.tags.map((tag) => <span key={tag.id} className={`lv-tag ${tag.level}`}>{onSearch ? <button className="lv-tag-name" onClick={() => onSearch(`#${queryValue(tag.name)}`)} title={`Ver todo lo etiquetado ${tag.name}`}>{tag.level !== "free" && <CatalogTagIcon tag={tag} catalog={catalog} />}{tag.name}</button> : <>{tag.level !== "free" && <CatalogTagIcon tag={tag} catalog={catalog} />}{tag.name}</>}<button disabled={busy} onClick={() => void setTags(video.tags.filter((item) => item.id !== tag.id).map((item) => item.id))} aria-label={`Quitar ${tag.name}`}><X size={11} /></button></span>)}
        <button className="lv-tag-add" onClick={() => setPickerOpen((current) => !current)} aria-expanded={pickerOpen} aria-label="Añadir etiqueta" title="Añadir etiqueta"><Plus size={14} /></button>
      </div>
      {pickerOpen && <div className="lv-tag-picker">
        <label><Search size={13} /><input autoFocus value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (available[0] && (exactTag || !normalizedQuery)) { setTagQuery(""); void setTags([...video.tags.map((item) => item.id), available[0].id]); }
          else void createTag();
        }} placeholder="Escribe para buscar o crear…" /></label>
        <div>
          {available.map((tag) => <button key={tag.id} className={tag.level} disabled={busy} onClick={() => { setTagQuery(""); void setTags([...video.tags.map((item) => item.id), tag.id]); }}>{tag.level !== "free" ? <i style={{ background: tag.color }} /> : <span className="lv-tag-hash">#</span>}{tag.name}{tag.level === "primary" && <small>tema</small>}</button>)}
          {normalizedQuery && !exactTag && <button className="lv-tag-create" disabled={busy} onClick={() => void createTag()}><Plus size={12} /> Crear «{tagQuery.replace(/^#/, "").trim()}»</button>}
          {!available.length && !normalizedQuery && <small>Ya alcanzó el límite de etiquetas.</small>}
        </div>
      </div>}
    </section>
    {!isNote && <section className={`lv-notes-section ${notesOpen ? "" : "collapsed"}`}>
      <h3><button className="lv-notes-toggle" onClick={() => toggleNotes()} aria-expanded={notesOpen} title={notesOpen ? "Ocultar notas" : "Mostrar notas"}>Notas{!notesOpen && note.trim() ? <small> · {note.trim().split(/\s+/).length} palabras</small> : null}<ChevronDown size={14} /></button></h3>
      <textarea className="lv-note-input" value={note} onChange={(event) => { setNote(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }} onFocus={(event) => { event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }} onBlur={saveNote} placeholder="Escribe aquí una nota…" rows={1} />
    </section>}
    {isNote && <NoteHistory videoId={video.id} onRestored={onNoteReplaced} />}
    {error && <p className="lv-error">{error}</p>}
    {footer}
  </aside>;
}

type SelectionToolbar = { text: string; highlightId?: string; x: number; y: number; below: boolean };

export function SourceDetail({ videoId, onNavigate, catalog, collections, spaces, onSearch, onVibe, onChanged, onOpenFull, onAsk, onArchived }: {
  videoId: string;
  onNavigate?: (id: string) => void;
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  spaces?: SmartSpace[];
  onSearch?: (query: string) => void;
  onVibe?: (video: AppVideo) => void;
  onChanged?: () => Promise<void>;
  onOpenFull?: (id: string) => void;
  onAsk?: (id: string) => void;
  onArchived?: () => void;
}) {
  const [editingQuote, setEditingQuote] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [overlay, setOverlay] = useState<OverlayTab | null>(null);
  const [chatMode, setChatMode] = useState(false);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState("");
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);
  const [ghostEntries, setGhostEntries] = useState<GhostEntry[]>([]);
  const [ghostContext, setGhostContext] = useState("");
  const [actionError, setActionError] = useState("");
  const [noteRevision, setNoteRevision] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const ghostInputRef = useRef<HTMLTextAreaElement>(null);
  const ghostCounter = useRef(0);
  const load = useCallback(async () => {
    try { setDetail(await readJson<DetailPayload>(`/api/videos/${videoId}`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos abrir esta fuente."); }
  }, [videoId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  // Mientras se analiza, el detalle abierto se mantiene al día hasta que termine.
  const processing = Boolean(detail && ["queued", "extracting", "indexing", "summarizing"].includes(detail.video.status));
  useEffect(() => {
    if (!processing) return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, processing]);
  if (error) return <div className="lv-detail-state"><p>{error}</p></div>;
  if (!detail || detail.video.id !== videoId) return <div className="lv-detail-state"><LoaderCircle className="spin" size={22} /></div>;

  const refresh = async () => { await load(); await onChanged?.(); };
  const openLink = async (title: string) => {
    setActionError("");
    try {
      const { target } = await readJson<{ target: { id: string } | null }>(`/api/notes?title=${encodeURIComponent(title)}`);
      const id = target?.id ?? (await readJson<{ id: string }>("/api/notes", { method: "POST", body: JSON.stringify({ content: `# ${title}` }) })).id;
      if (!target) await onChanged?.();
      onNavigate?.(id);
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : "No se pudo abrir el enlace."); }
  };
  const place = (rect: DOMRect): Pick<SelectionToolbar, "x" | "y" | "below"> => {
    const below = rect.top < 70;
    return { x: Math.max(150, Math.min(window.innerWidth - 150, rect.left + rect.width / 2)), y: below ? rect.bottom + 8 : rect.top - 8, below };
  };
  const readSelection = (target: EventTarget | null) => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || "";
      if (selection && !selection.isCollapsed && text.length >= 2 && contentRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        setToolbar({ text, ...place(selection.getRangeAt(0).getBoundingClientRect()) });
        return;
      }
      const mark = (target as HTMLElement | null)?.closest?.("mark[data-highlight-id]") as HTMLElement | null;
      setToolbar(mark ? { text: mark.textContent || "", highlightId: mark.dataset.highlightId, ...place(mark.getBoundingClientRect()) } : null);
    }, 0);
  };
  const dismissToolbar = () => { setToolbar(null); window.getSelection()?.removeAllRanges(); };
  const guard = async (task: () => Promise<unknown>) => {
    setActionError("");
    try { await task(); await refresh(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
  };
  const addHighlight = (quote: string) => { dismissToolbar(); void guard(() => readJson(`/api/videos/${videoId}/highlights`, { method: "POST", body: JSON.stringify({ quote }) })); };
  const removeHighlight = (id: string) => { dismissToolbar(); void guard(() => readJson(`/api/videos/${videoId}/highlights/${id}`, { method: "DELETE" })); };
  const noteHighlight = (id: string, note: string) => { void guard(() => readJson(`/api/videos/${videoId}/highlights/${id}`, { method: "PATCH", body: JSON.stringify({ note }) })); };
  const jumpToHighlight = (id: string) => {
    const mark = contentRef.current?.querySelector(`mark[data-highlight-id="${CSS.escape(id)}"]`);
    if (!mark) { setActionError("Este pasaje no aparece en el texto guardado."); return; }
    setActionError("");
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.animate([{ backgroundColor: "#f7a982", boxShadow: "0 0 0 4px #f7a982" }, { backgroundColor: "#f7a982", boxShadow: "0 0 0 4px #f7a982", offset: 0.4 }, { backgroundColor: "#fbe58a", boxShadow: "0 0 0 1px #fbe58a" }], { duration: 1100, easing: "ease-out" });
  };
  const runGhost = async (entry: GhostEntry) => {
    setGhostEntries((current) => [{ ...entry, pending: true, error: "", answer: "" }, ...current.filter((item) => item.id !== entry.id)]);
    window.requestAnimationFrame(() => ghostInputRef.current?.closest(".lv-ghost")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    const update = (patch: Partial<GhostEntry>) => setGhostEntries((current) => current.map((item) => item.id === entry.id ? { ...item, ...patch, pending: false } : item));
    try {
      const { answer } = await readJson<{ answer: string }>(`/api/videos/${videoId}/ghost`, { method: "POST", body: JSON.stringify({ action: entry.action, selection: entry.selection, question: entry.question }) });
      update({ answer });
    } catch (cause) { update({ error: cause instanceof Error ? cause.message : "No se pudo consultar a la IA." }); }
  };
  const startGhost = (action: GhostAction, selection: string, question = "") => {
    ghostCounter.current += 1;
    setChatMode(true);
    void runGhost({ id: ghostCounter.current, action, selection, question, answer: "", error: "", pending: true });
  };

  return <div className="lv-detail">
    <div className="lv-detail-content" ref={contentRef} onMouseUp={(event) => readSelection(event.target)} onTouchEnd={(event) => readSelection(event.target)} onScroll={() => setToolbar(null)}>{overlay ? <ConnectionsOverlay tab={overlay} onTab={setOverlay} onClose={() => setOverlay(null)} items={detail.related ?? []} video={detail.video} catalog={catalog} collections={collections} onSearch={onSearch} onOpen={(id) => { setOverlay(null); onNavigate?.(id); }} /> : detail.video.sourceType === "note" && quoteFromNote(detail.video.note?.content || "") && !editingQuote ? <QuoteBody quote={quoteFromNote(detail.video.note?.content || "")!} onEdit={() => setEditingQuote(true)} /> : detail.video.sourceType === "note" ? <NoteBody key={`${detail.video.id}-${noteRevision}`} video={detail.video} onSaved={load} onSettled={refresh} onOpenLink={(title) => void openLink(title)} /> : <SourceBody key={detail.video.id} {...detail} minutesOpen={minutesOpen} onCoverChanged={() => { void load(); void refresh(); }} />}</div>
    {toolbar && <div className={`lv-selection-bar ${toolbar.below ? "below" : ""}`} style={{ left: toolbar.x, top: toolbar.y }} onMouseDown={(event) => event.preventDefault()} role="toolbar" aria-label="Acciones sobre el texto seleccionado">
      {toolbar.highlightId
        ? <button onClick={() => removeHighlight(toolbar.highlightId!)}><X size={14} /> Quitar</button>
        : <button className="primary" onClick={() => addHighlight(toolbar.text)}><Highlighter size={14} /> Subrayar</button>}
      <i />
      <button onClick={() => { setGhostContext(toolbar.text); dismissToolbar(); setChatMode(true); window.requestAnimationFrame(() => ghostInputRef.current?.focus()); }}><MessageCircle size={14} /> Preguntar</button>
      <button onClick={() => { const text = toolbar.text; dismissToolbar(); startGhost("explain", text); }}><Lightbulb size={14} /> Explicar</button>
      <button onClick={() => { const text = toolbar.text; dismissToolbar(); startGhost("define", text); }}><BookA size={14} /> Definir</button>
      <button onClick={() => { const text = toolbar.text; dismissToolbar(); startGhost("simplify", text); }}><WandSparkles size={14} /> Simplificar</button>
    </div>}
    <InsightPanel onArchived={onArchived} chatMode={chatMode} onChatMode={(open) => { setChatMode(open); if (open) window.requestAnimationFrame(() => ghostInputRef.current?.focus()); }} relatedOpen={overlay === "related"} relatedCount={detail.related?.length ?? 0} onToggleRelated={() => { setOverlay((current) => current === "related" ? null : "related"); contentRef.current?.scrollTo({ top: 0 }); }} graphOpen={overlay === "graph"} onToggleGraph={() => { setOverlay((current) => current === "graph" ? null : "graph"); contentRef.current?.scrollTo({ top: 0 }); }} quizOpen={chatMode} onToggleQuiz={() => setChatMode((current) => !current)} minutesOpen={minutesOpen} onToggleMinutes={() => { setMinutesOpen((current) => !current); window.setTimeout(() => contentRef.current?.querySelector("#lv-minutes")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }} key={`${detail.video.id}-${detail.video.note?.updatedAt || ""}`} connections={detail.connections} onOpenLink={(title) => void openLink(title)} onNavigate={(id) => onNavigate?.(id)} onNoteReplaced={() => { void load().then(() => setNoteRevision((current) => current + 1)); void onChanged?.(); }} video={detail.video} catalog={catalog} collections={collections} spaces={spaces} onSearch={onSearch} onVibe={onVibe} onOpenFull={onOpenFull} onAsk={onAsk} onChanged={refresh} onJumpToHighlight={jumpToHighlight} onRemoveHighlight={removeHighlight} onHighlightNote={noteHighlight} ghost={{
      entries: ghostEntries,
      context: ghostContext,
      inputRef: ghostInputRef,
      onClearContext: () => setGhostContext(""),
      onAsk: (question) => { startGhost("ask", ghostContext, question); setGhostContext(""); },
      onRetry: (entry) => void runGhost(entry),
      onDismiss: (id) => setGhostEntries((current) => current.filter((item) => item.id !== id)),
    }} />
    {actionError && <div className="lv-toast lv-detail-toast">{actionError}</div>}
  </div>;
}

export function DetailModal({ videoId: initialVideoId, sequence = [], catalog, collections, spaces, onSearch, onVibe, onClose, onChanged, onOpenFull, onAsk }: {
  videoId: string;
  sequence?: string[];
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  spaces?: SmartSpace[];
  onSearch?: (query: string) => void;
  onVibe?: (video: AppVideo) => void;
  onClose: () => void;
  onChanged?: () => Promise<void>;
  onOpenFull?: (id: string) => void;
  onAsk?: (id: string) => void;
}) {
  const [videoId, setVideoId] = useState(initialVideoId);
  // Con ← y → se pasa al elemento de al lado en el mosaico, como en mymind o Pinterest.
  const index = sequence.indexOf(videoId);
  const previous = index > 0 ? sequence[index - 1] : null;
  const next = index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]") || window.getSelection()?.toString()) return;
      const destination = event.key === "ArrowLeft" ? previous : next;
      if (destination) { event.preventDefault(); setVideoId(destination); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previous, next]);
  const [awake, setAwake] = useState(true);
  const sleepTimer = useRef<number | undefined>(undefined);
  const wake = () => { setAwake(true); window.clearTimeout(sleepTimer.current); sleepTimer.current = window.setTimeout(() => setAwake(false), 2200); };
  useEffect(() => { sleepTimer.current = window.setTimeout(() => setAwake(false), 2200); return () => window.clearTimeout(sleepTimer.current); }, []);
  return <div className={`lv-modal ${awake ? "awake" : ""}`} role="dialog" aria-modal="true" onMouseMove={wake} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    {/* Como en mymind: sin X; arriba aparece «ESC para cerrar» al mover el ratón, y también se puede pulsar. */}
    <button className="lv-modal-esc" onClick={onClose}><ArrowDown size={13} /> ESC para cerrar</button>
    <div className="lv-modal-card">
      <button className="lv-modal-close" onClick={onClose} aria-label="Cerrar"><X size={17} /></button>
      <SourceDetail key={videoId} videoId={videoId} onNavigate={setVideoId} catalog={catalog} collections={collections} spaces={spaces} onSearch={onSearch} onVibe={onVibe} onChanged={onChanged} onOpenFull={onOpenFull} onAsk={onAsk} onArchived={onClose} />
    </div>
  </div>;
}

function ReaderRow({ video, active, onSelect }: { video: AppVideo; active: boolean; onSelect: () => void }) {
  const [artFailed, setArtFailed] = useState(false);
  const artwork = artFailed ? "" : sourceArtwork(video);
  return <button id={`lv-row-${video.id}`} className={`lv-row ${active ? "active" : ""}`} onClick={onSelect}>
    <span className={`lv-row-thumb ${artwork ? "" : "empty"}`}>{artwork ? <img src={artwork} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setArtFailed(true)} /> : <SiteIcon video={video} />}</span>
    <span className="lv-row-copy">
      <strong>{video.title}</strong>
      <small className="lv-row-preview">{sourcePreview(video)}</small>
      <small className="lv-row-meta"><SiteIcon video={video} />{video.consumedAt && <span className="lv-row-done"><Check size={11} /></span>}{video.tags.slice(0, 2).map((tag) => <em key={tag.id}>{tag.name}</em>)}</small>
    </span>
  </button>;
}

export function ReaderSplit({ videos, catalog, collections, spaces, onSearch, onVibe, onChanged, onOpenFull, onAsk }: {
  videos: AppVideo[];
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  spaces?: SmartSpace[];
  onSearch?: (query: string) => void;
  onVibe?: (video: AppVideo) => void;
  onChanged: () => Promise<void>;
  onOpenFull?: (id: string) => void;
  onAsk: (id: string) => void;
}) {
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [listWidth, setListWidth] = useState(360);
  const splitRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => { const saved = Number(window.localStorage.getItem("lumina-reader-list-width")); if (saved >= 240 && saved <= 720) setListWidth(saved); }, 0); return () => window.clearTimeout(timer); }, []);
  // La división entre la lista y el lector se arrastra; el ancho elegido se recuerda.
  const beginResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const left = splitRef.current?.getBoundingClientRect().left ?? 0;
    let latest = listWidth;
    const move = (pointer: PointerEvent) => { latest = Math.max(240, Math.min(720, pointer.clientX - left)); setListWidth(latest); };
    const finish = () => { window.localStorage.setItem("lumina-reader-list-width", String(Math.round(latest))); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  const selectedId = videos.some((video) => video.id === requestedId) ? requestedId : videos[0]?.id ?? null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (!["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) return;
      event.preventDefault();
      const index = videos.findIndex((video) => video.id === selectedId);
      const next = videos[Math.max(0, Math.min(videos.length - 1, index + (event.key === "ArrowDown" || event.key === "j" ? 1 : -1)))];
      if (next) { setRequestedId(next.id); document.getElementById(`lv-row-${next.id}`)?.scrollIntoView({ block: "nearest" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, videos]);
  return <div ref={splitRef} className={`lv-split ${mobileOpen ? "reading" : ""}`} style={{ "--lv-list-width": `${listWidth}px` } as React.CSSProperties}>
    <button className="lv-split-resizer" style={{ left: listWidth - 4 }} onPointerDown={beginResize} onDoubleClick={() => { setListWidth(360); window.localStorage.removeItem("lumina-reader-list-width"); }} aria-label="Cambiar ancho de la lista" title="Arrastra para cambiar el ancho · doble clic para restablecer" />
    <div className="lv-split-list">{videos.map((video) => <ReaderRow key={video.id} video={video} active={video.id === selectedId} onSelect={() => { setRequestedId(video.id); setMobileOpen(true); }} />)}</div>
    <div className="lv-split-detail">
      <button className="lv-split-back" onClick={() => setMobileOpen(false)}><ArrowLeft size={16} /> Volver a la lista</button>
      {selectedId ? <SourceDetail key={selectedId} videoId={selectedId} onNavigate={setRequestedId} catalog={catalog} collections={collections} spaces={spaces} onSearch={onSearch} onVibe={onVibe} onChanged={onChanged} onOpenFull={onOpenFull} onAsk={onAsk} /> : <div className="lv-detail-state"><p>Nada que mostrar con estos filtros.</p></div>}
    </div>
  </div>;
}

function ShelfArt({ video }: { video: AppVideo }) {
  const [failed, setFailed] = useState(false);
  const artwork = failed ? "" : sourceArtwork(video);
  return artwork ? <img src={artwork} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <em>{sourceHost(video)}</em>;
}

// Orden por arrastre: se previsualiza al pasar por encima y se guarda al soltar.
function useDragOrder(ids: string[], onCommit: (ids: string[]) => Promise<void>) {
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const order = draftIds && draftIds.length === ids.length && draftIds.every((id) => ids.includes(id)) ? draftIds : ids;
  function moveOver(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const next = [...order];
    const destination = next.indexOf(targetId);
    next.splice(next.indexOf(dragId), 1);
    next.splice(destination, 0, dragId);
    setDraftIds(next);
  }
  async function commit() {
    setDragId(null);
    try { if (draftIds && draftIds.join() !== ids.join()) await onCommit(draftIds); }
    finally { setDraftIds(null); }
  }
  const dragProps = (id: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-lumina-order", id); setDragId(id); },
    onDragEnter: () => moveOver(id),
    onDragOver: (event: React.DragEvent) => { if (dragId) event.preventDefault(); },
    onDrop: (event: React.DragEvent) => { if (dragId) event.preventDefault(); },
    onDragEnd: () => void commit(),
  });
  return { order, dragId, dragProps };
}

// Firefox no inicia un arrastre desde un <button>: lo pulsable dentro de lo arrastrable es un div con rol de botón.
function pressable(onPress: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPress(); } },
  };
}

// Repisa pequeña con lo prioritario: se reordena arrastrando y el servidor limita cuántas fuentes admite.
export function ShelfRow({ videos, onOpen, onChanged }: { videos: AppVideo[]; onOpen: (id: string) => void; onChanged: () => Promise<void> }) {
  const [error, setError] = useState("");
  const byId = new Map(videos.map((video) => [video.id, video]));
  const { order, dragId, dragProps } = useDragOrder(videos.map((video) => video.id), async (ids) => {
    setError("");
    try { await readJson("/api/shelf", { method: "PUT", body: JSON.stringify({ ids }) }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo reordenar."); }
  });
  if (!videos.length) return null;
  async function remove(id: string) {
    setError("");
    try { await readJson(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify({ action: "unpin" }) }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo quitar."); }
  }
  return <section className="lv-shelf" aria-label="En mente">
    <h2><Pin size={13} /> En mente</h2>
    <div className="lv-shelf-row">{order.map((id) => {
      const video = byId.get(id)!;
      return <article key={id} className={dragId === id ? "dragging" : ""} {...dragProps(id)}>
        <div className="lv-shelf-open" title={video.title} {...pressable(() => onOpen(id))}><span><ShelfArt video={video} /></span><small>{video.title}</small></div>
        <button className="lv-shelf-remove" onClick={() => void remove(id)} aria-label={`Quitar ${video.title} de En mente`} title="Quitar de En mente"><X size={11} /></button>
      </article>;
    })}</div>
    {error && <p className="lv-error">{error}</p>}
  </section>;
}

// Marca de cada fuente, como en mymind: un borde de color y su ícono en las tarjetas de texto.
function sourceAccent(video: AppVideo): { key: string; label: string } {
  if (video.sourceType === "x") return { key: "x", label: "𝕏" };
  if (video.sourceType === "reddit") return { key: "reddit", label: "r/" };
  if (video.sourceType === "youtube") return { key: "youtube", label: "▶" };
  if (video.sourceType === "audio") return { key: "audio", label: "♪" };
  if (video.sourceType === "note") return { key: "note", label: "" };
  if (video.sourceType === "palette") return { key: "palette", label: "" };
  if (video.sourceType === "pdf") return { key: "pdf", label: "PDF" };
  const host = sourceHost(video);
  if (host.includes("github.com")) return { key: "github", label: "GitHub" };
  if (host.includes("wikipedia.org")) return { key: "wikipedia", label: "W" };
  if (host.includes("substack.com") || video.sourceItems.some((item) => item.metadata?.sourceKind === "substack")) return { key: "substack", label: "" };
  return { key: "web", label: "" };
}

export type BoardSaver = { boards: LibraryCollection[]; boardId: string; onPickBoard: (id: string) => void; onSave: (video: AppVideo, boardId: string) => Promise<void> };

function BoardSave({ video, saver }: { video: AppVideo; saver: BoardSaver }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const board = saver.boards.find((item) => item.id === saver.boardId) ?? saver.boards[0];
  if (!board) return null;
  const inBoard = video.collections.some((item) => item.id === board.id);
  const save = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (inBoard || state === "saving") return;
    setState("saving");
    try { await saver.onSave(video, board.id); setState("done"); } catch { setState("idle"); }
  };
  return <span className="lv-board-save" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <button type="button" className="lv-board-pick" aria-haspopup="listbox" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }}>{board.name}<ChevronDown size={12} /></button>
    <button type="button" className={`lv-board-go ${inBoard || state === "done" ? "done" : ""}`} disabled={state === "saving"} onClick={(event) => void save(event)}>{inBoard || state === "done" ? <><Check size={13} /> Guardado</> : state === "saving" ? "…" : "Guardar"}</button>
    {open && <span className="lv-board-list" role="listbox" aria-label="Elegir espacio">{saver.boards.map((item) => <button type="button" role="option" aria-selected={item.id === board.id} key={item.id} onClick={(event) => { event.stopPropagation(); saver.onPickBoard(item.id); setOpen(false); setState("idle"); }}><i style={{ background: item.color }} />{item.name}{video.collections.some((entry) => entry.id === item.id) && <Check size={12} />}</button>)}</span>}
  </span>;
}

export function MosaicCard({ video, onOpen, selected = false, selecting = false, onToggleSelect, onMenu, saver, onVibe, onCoverChanged }: {
  onCoverChanged?: () => void;
  video: AppVideo;
  onOpen: () => void;
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: () => void;
  onMenu?: (x: number, y: number) => void;
  saver?: BoardSaver;
  onVibe?: (video: AppVideo) => void;
}) {
  const [artFailed, setArtFailed] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);
  const [slide, setSlide] = useState(0);
  const gallery = galleryOf(video);
  const artwork = artFailed ? "" : gallery.length ? gallery[slide % gallery.length] : sourceArtwork(video);
  // Miniatura WebP guardada en el Mac (rápida y a salvo de enlaces rotos); si falla, la imagen original.
  const tileImage = !gallery.length && artwork && artwork === video.thumbnailUrl && !useOriginal ? `/api/thumb/${video.id}?w=640&v=${encodeURIComponent(artwork.slice(-24))}` : artwork;
  const text = sourceText(video);
  const isQuote = !artwork && (video.sourceType === "x" || video.sourceType === "reddit") && Boolean(text);
  const accent = sourceAccent(video);
  const press = () => { if (onToggleSelect && selecting) onToggleSelect(); else onOpen(); };
  return <div className={`lv-tile src-${accent.key} ${artwork ? "has-art" : isQuote ? "is-quote" : "is-text"} ${selected ? "selected" : ""}`} aria-pressed={selecting ? selected : undefined}
    {...pressable(press)}
    onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
    onClick={(event) => { if (onToggleSelect && (event.shiftKey || selecting)) onToggleSelect(); else onOpen(); }}
    onContextMenu={(event) => { if (!onMenu) return; event.preventDefault(); onMenu(event.clientX, event.clientY); }}
    onDragOver={(event) => { if (productOf(video) && event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add("drop-target"); } }}
    onDragLeave={(event) => event.currentTarget.classList.remove("drop-target")}
    onDrop={(event) => {
      if (!productOf(video)) return;
      const file = [...event.dataTransfer.files].find((item) => item.type.startsWith("image/"));
      if (!file) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove("drop-target");
      void replaceCover(video.id, file).then(() => onCoverChanged?.()).catch(() => undefined);
    }}>
    {(selecting || selected) && <i className="lv-tile-check" aria-hidden>{selected && <Check size={13} />}</i>}
    {video.sourceType === "note" && quoteFromNote(video.note?.content || "") ? <span className="lv-tile-quote-card"><b aria-hidden>“</b>{(() => { const quote = quoteFromNote(video.note?.content || "")!; return <>{quote.text.length > 280 ? `${quote.text.slice(0, 277)}…` : quote.text}<b aria-hidden>”</b>{quote.author && <small>{quote.author}</small>}</>; })()}</span>
      : video.sourceType === "palette" ? <span className="lv-tile-palette">{(video.visual?.colors ?? []).map((swatch) => <i key={swatch.hex} style={{ background: swatch.hex, flexGrow: Math.max(swatch.share, 0.08) }}><b>{swatch.hex.toUpperCase()}</b></i>)}</span>
      : artwork ? <span className="lv-tile-art"><img src={tileImage} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => { if (tileImage !== artwork) setUseOriginal(true); else setArtFailed(true); }} /><TileKind video={video} />
      {gallery.length > 0 && <>
        <span className="lv-tile-count">{slide + 1}/{gallery.length}</span>
        <span className="lv-tile-dots-row" aria-hidden>{gallery.map((_, index) => <i key={index} className={index === slide ? "on" : ""} />)}</span>
        <button type="button" className="lv-tile-step prev" aria-label="Foto anterior" onClick={(event) => { event.stopPropagation(); setSlide((current) => (current - 1 + gallery.length) % gallery.length); }}>‹</button>
        <button type="button" className="lv-tile-step next" aria-label="Foto siguiente" onClick={(event) => { event.stopPropagation(); setSlide((current) => (current + 1) % gallery.length); }}>›</button>
      </>}
      {movieOf(video) && <button type="button" className={`lv-tile-watch ${video.consumedAt ? "on" : ""}`} onClick={(event) => { event.stopPropagation(); void toggleWatched(video).then(() => onCoverChanged?.()); }} title={video.consumedAt ? "Marcar como por ver" : "Marcar como vista"}>{video.consumedAt ? "✓ Vista" : "Por ver"}</button>}
      {productOf(video)?.price && <span className="lv-tile-price">{formatPrice(productOf(video)!.price, productOf(video)!.currency)}{productOf(video)!.brand ? ` · ${productOf(video)!.brand}` : ""}</span>}
      {!selecting && video.title && <span className="lv-tile-hover-title" aria-hidden>{video.title}</span>}
      {!selecting && <span className="lv-tile-hover">
        {onMenu && <button type="button" className="lv-tile-corner-dots" aria-label={`Más acciones para ${video.title}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); onMenu(box.right - 200, box.bottom + 4); }}><MoreHorizontal size={15} /></button>}
        {onVibe && video.sourceType === "image" && video.visual?.hasPrint && <button type="button" className="lv-tile-more" title="Más como esto: imágenes que se ven parecidas" aria-label="Más como esto" onClick={(event) => { event.stopPropagation(); onVibe(video); }}><Palette size={14} /></button>}
      </span>}</span>
      : isQuote ? <span className="lv-tile-quote">{accent.label && <b className={`lv-tile-mark ${video.summary?.headline ? "with-title" : ""}`}>{video.summary?.headline ? <span>{video.summary.headline}</span> : <em>{accent.label}</em>}</b>}<span className="lv-tile-quote-text">{text.slice(0, 420)}</span></span>
        : <span className="lv-tile-title"><small>{accent.label && <b className="lv-tile-mark">{accent.label}</b>}{sourceHost(video)}</small><strong>{video.title}</strong><span>{sourcePreview(video).slice(0, 150)}</span></span>}
    <span className="lv-tile-caption"><span>{artwork || isQuote ? video.title : sourceHost(video)}</span>{onMenu && <button type="button" className="lv-tile-dots" aria-label={`Más acciones para ${video.title}`} onClick={(event) => { event.stopPropagation(); const box = event.currentTarget.getBoundingClientRect(); onMenu(box.left, box.bottom + 4); }}><MoreHorizontal size={15} /></button>}</span>
  </div>;
}

// Botón para tomar de nuevo la captura de una web (por si salió en blanco o la página cambió).
function RegenerateCover({ video, onDone }: { video: AppVideo; onDone?: () => void | Promise<void> }) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const regenerate = async () => {
    setState("busy");
    try { await readJson(`/api/videos/${video.id}/cover`, { method: "PUT" }); playSound("done"); setState("idle"); await onDone?.(); }
    catch { setState("error"); window.setTimeout(() => setState("idle"), 2500); }
  };
  return <button type="button" className={`lv-browser-regen ${state}`} disabled={state === "busy"} onClick={() => void regenerate()} title={state === "error" ? "No se pudo tomar una nueva captura" : "Regenerar portada"} aria-label="Regenerar portada">{state === "busy" ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}</button>;
}

// Icono pequeño que dice qué es cada tarjeta (video, web, imagen, PDF…).
function TileKind({ video }: { video: AppVideo }) {
  let host = "";
  try { host = new URL(video.url).hostname; } catch { host = ""; }
  const label = host.includes("github.com") ? "GitHub" : video.sourceType === "x" ? "Publicación de X" : video.sourceType === "reddit" ? "Reddit" : TYPE_CHIPS[video.sourceType]?.label || "Fuente";
  const content = host.includes("github.com") ? <Github size={11} />
    : video.sourceType === "x" ? <b>𝕏</b>
    : video.sourceType === "reddit" ? <b>r/</b>
    : video.sourceType === "youtube" ? <Play size={10} fill="currentColor" />
    : (() => { const Icon = TYPE_CHIPS[video.sourceType]?.Icon || Globe; return <Icon size={11} />; })();
  return <i className={`lv-tile-kind kind-${video.sourceType}`} title={label} aria-label={label}>{content}</i>;
}

async function copyImageToClipboard(url: string) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("png")), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

type TileMenuState = { video: AppVideo; x: number; y: number };

function TileMenu({ menu, catalog, spaces, onClose, onChanged, onOpen, onVibe, onNotice }: {
  menu: TileMenuState;
  catalog: LibraryTag[];
  spaces: SmartSpace[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
  onVibe?: (video: AppVideo) => void;
  onNotice: (text: string, undoId?: string) => void;
}) {
  const { video } = menu;
  const [view, setView] = useState<"root" | "tags" | "spaces">("root");
  const [filter, setFilter] = useState("");
  const [newSpace, setNewSpace] = useState("");
  const [position, setPosition] = useState({ left: menu.x, top: menu.y });
  const ref = useRef<HTMLDivElement>(null);
  const pinned = video.topPosition !== null && video.topPosition !== undefined;
  const text = sourceText(video);
  const isLocal = video.url.startsWith("local://");
  const labels = consumeLabels(video);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setPosition({ left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)) });
  }, [menu.x, menu.y, view]);
  useEffect(() => {
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    const scroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    return () => { window.removeEventListener("mousedown", outside); window.removeEventListener("keydown", key, true); window.removeEventListener("scroll", scroll, true); };
  }, [onClose]);
  useEffect(() => { ref.current?.querySelector<HTMLElement>(view === "tags" ? "input" : "[role^=menuitem]")?.focus(); }, [view]);

  // Las acciones que cambian datos cierran el menú; los errores aparecen en el aviso del mosaico.
  async function run(task: () => Promise<unknown>, done?: string, undoId?: string) {
    onClose();
    try { await task(); await onChanged(); if (done) onNotice(done, undoId); }
    catch (cause) { onNotice(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
  }
  const patch = (action: string) => readJson(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ action }) });
  const copy = (task: () => Promise<void>, done: string) => { onClose(); task().then(() => onNotice(done)).catch(() => onNotice("Tu navegador no permitió copiar.")); };
  const normalized = filter.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const matchesFilter = (name: string) => !normalized || name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().includes(normalized);
  const atLimit = (level: LibraryTag["level"]) => video.tags.filter((tag) => tag.level === level).length >= (level === "primary" ? 3 : 2);

  return <div ref={ref} className="lv-tile-menu" role="menu" aria-label={`Acciones de ${video.title}`} style={position} onContextMenu={(event) => event.preventDefault()}>
    {view === "root" && <>
      <button role="menuitem" onClick={() => { onClose(); onOpen(video.id); }}><Maximize2 size={14} /> Abrir</button>
      {onVibe && video.visual?.hasPrint && <button role="menuitem" onClick={() => { onClose(); onVibe(video); }}><Palette size={14} /> Misma vibra</button>}
      <hr />
      <button role="menuitem" onClick={() => setView("tags")}><Tag size={14} /> Etiquetas<ChevronRight size={13} /></button>
      <button role="menuitem" onClick={() => setView("spaces")}><Folder size={14} /> Espacios<ChevronRight size={13} /></button>
      <button role="menuitem" onClick={() => { if (!pinned) playSound("pin"); void run(() => patch(pinned ? "unpin" : "pin")); }}><Pin size={14} /> {pinned ? "Quitar de En mente" : "Poner en En mente"}</button>
      <button role="menuitem" onClick={() => { if (!video.consumedAt) playSound("done"); void run(() => patch(video.consumedAt ? "unconsume" : "consume")); }}><Check size={14} /> {video.consumedAt ? "Marcar como pendiente" : labels.pending}</button>
      <hr />
      {video.sourceType === "image" && (video.visual?.colors ?? []).length >= 2 && <button role="menuitem" onClick={() => void run(() => readJson(`/api/videos/${video.id}/palette`, { method: "POST" }), "Paleta guardada.")}><Palette size={14} /> Sacar paleta</button>}
      {video.sourceType === "image" && <button role="menuitem" onClick={() => copy(() => copyImageToClipboard(video.thumbnailUrl), "Imagen copiada.")}><Copy size={14} /> Copiar imagen</button>}
      {text && <button role="menuitem" onClick={() => copy(() => navigator.clipboard.writeText(text), "Texto copiado.")}><Copy size={14} /> Copiar texto</button>}
      {!isLocal && <button role="menuitem" onClick={() => copy(() => navigator.clipboard.writeText(video.url), "Enlace copiado.")}><Copy size={14} /> Copiar enlace</button>}
      {!isLocal && <a role="menuitem" href={video.url} target="_blank" rel="noreferrer" onClick={onClose}><ExternalLink size={14} /> Abrir original</a>}
      <hr />
      <button role="menuitem" className="danger" onClick={() => { playSound("remove"); void run(() => patch("archive"), "Archivada.", video.id); }}><Trash2 size={14} /> Archivar</button>
    </>}
    {view === "tags" && <>
      <button className="lv-tile-menu-back" onClick={() => { setView("root"); setFilter(""); }}><ArrowLeft size={13} /> Etiquetas</button>
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar etiqueta…" aria-label="Buscar etiqueta" />
      <div className="lv-tile-menu-list">{catalog.filter((tag) => matchesFilter(tag.name)).slice(0, 40).map((tag) => {
        const selected = video.tags.some((item) => item.id === tag.id);
        return <button key={tag.id} role="menuitemcheckbox" aria-checked={selected} disabled={!selected && atLimit(tag.level)} title={!selected && atLimit(tag.level) ? "Ya alcanzó el límite de etiquetas de este nivel" : undefined} onClick={() => void run(() => readJson(`/api/videos/${video.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: selected ? video.tags.filter((item) => item.id !== tag.id).map((item) => item.id) : [...video.tags.map((item) => item.id), tag.id] }) }))}><i style={{ background: tag.color }} />{tag.name}{selected && <Check size={13} />}</button>;
      })}</div>
    </>}
    {view === "spaces" && <>
      <button className="lv-tile-menu-back" onClick={() => setView("root")}><ArrowLeft size={13} /> Espacios</button>
      <div className="lv-tile-menu-list">{spaces.map((space) => {
        const byQuery = spaceQueryMatches(space.query, video, catalog);
        const added = space.itemIds.includes(video.id);
        return <button key={space.id} role="menuitemcheckbox" aria-checked={byQuery || added} disabled={byQuery} title={byQuery ? `Está aquí porque cumple la regla: ${space.query}` : undefined} onClick={() => void run(() => readJson(`/api/spaces/${space.id}/items/${video.id}`, { method: added ? "DELETE" : "PUT" }))}><i className="ring" style={{ borderColor: space.color, background: byQuery || added ? space.color : "transparent" }} />{space.name}{byQuery ? <small>por regla ✦</small> : added && <Check size={13} />}</button>;
      })}</div>
      <form onSubmit={(event) => { event.preventDefault(); const name = newSpace.trim(); if (name) void run(() => readJson("/api/spaces", { method: "POST", body: JSON.stringify({ name, videoId: video.id }) }), `Añadida a ${name}.`); }}>
        <input value={newSpace} maxLength={60} onChange={(event) => setNewSpace(event.target.value)} placeholder="Nuevo espacio…" aria-label="Nombre de la nuevo espacio" />
      </form>
    </>}
  </div>;
}

export function MosaicGrid({ videos, onOpen, selection, onToggleSelect, catalog = [], spaces = [], onChanged, onVibe, quickNote = false, saver }: {
  saver?: BoardSaver;
  videos: AppVideo[];
  onOpen: (id: string) => void;
  selection?: Set<string>;
  onToggleSelect?: (id: string) => void;
  catalog?: LibraryTag[];
  spaces?: SmartSpace[];
  onChanged?: () => Promise<void>;
  onVibe?: (video: AppVideo) => void;
  quickNote?: boolean;
}) {
  const [menu, setMenu] = useState<TileMenuState | null>(null);
  const [notice, setNotice] = useState<{ text: string; undoId?: string } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), notice.undoId ? 6000 : 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const selecting = Boolean(selection?.size);
  // El menú guarda su fuente al abrirse; se busca la versión actual por si los datos ya cambiaron.
  const menuVideo = menu && (videos.find((video) => video.id === menu.video.id) ?? menu.video);
  return <>
    <div className="lv-mosaic">{quickNote && onChanged && <QuickNote onCreated={onChanged} />}{videos.map((video) => <MosaicCard key={video.id} video={video} onOpen={() => onOpen(video.id)} selected={selection?.has(video.id)} selecting={selecting} onToggleSelect={onToggleSelect && (() => onToggleSelect(video.id))} onMenu={onChanged && ((x, y) => setMenu({ video, x, y }))} saver={saver} onVibe={onVibe} onCoverChanged={onChanged && (() => void onChanged())} />)}</div>
    {menu && menuVideo && onChanged && <TileMenu key={menu.video.id} menu={{ ...menu, video: menuVideo }} catalog={catalog} spaces={spaces} onClose={closeMenu} onChanged={onChanged} onOpen={onOpen} onVibe={onVibe} onNotice={(text, undoId) => setNotice({ text, undoId })} />}
    {notice && <div className="lv-toast lv-grid-toast" role="status">{notice.text}{notice.undoId && <button onClick={() => { const id = notice.undoId!; setNotice(null); void readJson(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify({ action: "unarchive" }) }).then(() => onChanged?.()); }}>Deshacer</button>}</div>}
  </>;
}

const SPACE_COLORS = ["#e75e3a", "#e0912f", "#d8b52b", "#8aa63a", "#3f9d6c", "#2f9c9c", "#3d86c6", "#5a6fd1", "#8560c9", "#c056a8", "#d9537a", "#24231f"];

export function SaveSpaceModal({ query, onClose, onSaved }: { query: string; onClose: () => void; onSaved: (space: SmartSpace) => void }) {
  const [step, setStep] = useState<"name" | "color">("name");
  const [name, setName] = useState("");
  const [terms, setTerms] = useState(() => libraryQueryTerms(query));
  const [termDraft, setTermDraft] = useState("");
  const [color, setColor] = useState(SPACE_COLORS[6]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hasTerms = terms.length > 0 || Boolean(termDraft.trim());
  function addDraftTerms() {
    const added = libraryQueryTerms(termDraft);
    if (added.length) setTerms((current) => [...new Set([...current, ...added])]);
    setTermDraft("");
  }
  function next() { addDraftTerms(); setStep("color"); }
  async function save() {
    setBusy(true); setError("");
    try {
      const { space } = await readJson<{ space: SmartSpace }>("/api/spaces", { method: "POST", body: JSON.stringify({ name, color, query: terms.join(" ") }) });
      onSaved(space);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear el espacio."); setStep("name"); }
    finally { setBusy(false); }
  }
  return <div className="lv-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="lv-space-modal">
      {step === "name" ? <>
        <span className="lv-space-mark" aria-hidden><i /><i /><i /><i /></span>
        <h2>Nuevo espacio</h2>
        <p>Mete cosas a mano o, si le pones una regla, se llena sola con todo lo que coincida, ahora y en el futuro.</p>
        <div className="lv-space-terms">
          {terms.map((term) => <span key={term}>{term}<button onClick={() => setTerms((current) => current.filter((item) => item !== term))} aria-label={`Quitar ${term}`}><X size={11} /></button></span>)}
          <input autoFocus={!terms.length} value={termDraft} onChange={(event) => setTermDraft(event.target.value)} onBlur={addDraftTerms} onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addDraftTerms(); }
            if (event.key === "Backspace" && !termDraft) setTerms((current) => current.slice(0, -1));
          }} placeholder={terms.length ? "Añadir otro término…" : "Regla opcional: #etiqueta, tipo:imagen, nubes…"} />
        </div>
        <input className="lv-space-name" autoFocus={terms.length > 0} value={name} maxLength={60} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) next(); }} placeholder="Nombre del espacio" />
        {error && <p className="lv-error">{error}</p>}
        <div className="lv-space-actions"><button onClick={onClose}>Cancelar</button><button className="primary" disabled={!name.trim()} onClick={next}>Siguiente paso</button></div>
      </> : <>
        <h2>Elige un color</h2>
        <p>Te ayuda a reconocer el espacio de un vistazo.</p>
        <div className="lv-color-ring">{SPACE_COLORS.map((item, index) => {
          const angle = (index / SPACE_COLORS.length) * Math.PI * 2 - Math.PI / 2;
          return <button key={item} className={item === color ? "active" : ""} style={{ left: `calc(50% + ${Math.cos(angle) * 68}px)`, top: `calc(50% + ${Math.sin(angle) * 68}px)`, borderColor: item }} onClick={() => setColor(item)} aria-label={`Color ${index + 1}`} aria-pressed={item === color} />;
        })}<span style={{ background: color }} /></div>
        <div className="lv-space-actions"><button onClick={() => setStep("name")}>Atrás</button><button className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Crear espacio"}</button></div>
      </>}
    </div>
  </div>;
}

export function spaceVideos(space: SmartSpace, videos: AppVideo[], tags: LibraryTag[]) {
  const manual = new Set(space.itemIds);
  return videos.filter((video) => manual.has(video.id) || spaceQueryMatches(space.query, video, tags));
}

export function SpacesWorkspace({ spaces, videos, tags, onOpenSpace, onChanged, onChat, onOpenSource }: {
  onChat?: (space: SmartSpace) => void;
  onOpenSource?: (id: string) => void;
  spaces: SmartSpace[];
  videos: AppVideo[];
  tags: LibraryTag[];
  onOpenSpace: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [docSpace, setDocSpace] = useState<SmartSpace | null>(null);
  const [timelineSpace, setTimelineSpace] = useState<SmartSpace | null>(null);
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const { order, dragId, dragProps } = useDragOrder(spaces.map((space) => space.id), async (ids) => {
    setError("");
    try { await readJson("/api/spaces", { method: "PUT", body: JSON.stringify({ ids }) }); await onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo reordenar."); }
  });
  return <main className="lv-spaces">
    <header><div><h1>Espacios inteligentes</h1><p>Lo que metes a mano y, si tienen regla ✦, todo lo que coincide. Arrástralos para ordenarlos.</p></div><button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo espacio</button></header>
    {spaces.length ? <div className="lv-boards lv-space-boards">{order.map((id) => {
      const space = byId.get(id)!;
      const matches = spaceVideos(space, videos, tags);
      // Como tablero: portada de tres imágenes, nombre y cuántas cosas tiene; arriba, un atajo para chatear con el espacio.
      const art = matches.map((video) => sourceArtwork(video)).filter(Boolean).slice(0, 3);
      return <article key={id} className={`lv-board lv-space-board ${dragId === id ? "dragging" : ""}`} {...dragProps(id)} {...pressable(() => onOpenSpace(id))}>
        <span className="lv-board-cover">{[0, 1, 2].map((index) => <span key={index}>{art[index] && <img src={art[index]} alt="" draggable={false} loading="lazy" referrerPolicy="no-referrer" />}</span>)}</span>
        {matches.length > 0 && <span className="lv-space-actions">
          {onChat && <button type="button" className="lv-space-chat" title={`Chatear con «${space.name}»`} aria-label={`Chatear con ${space.name}`} onClick={(event) => { event.stopPropagation(); onChat(space); }}><MessageCircle size={15} /></button>}
          <button type="button" className="lv-space-chat" title="Crear un documento con citas" aria-label={`Crear documento de ${space.name}`} onClick={(event) => { event.stopPropagation(); setDocSpace(space); }}><FileText size={15} /></button>
          <button type="button" className="lv-space-chat" title="Línea de tiempo" aria-label={`Línea de tiempo de ${space.name}`} onClick={(event) => { event.stopPropagation(); setTimelineSpace(space); }}><CalendarRange size={15} /></button>
        </span>}
        <strong><i style={{ borderColor: space.color }} />{space.name}{space.query && <em className="lv-rule-mark" title={`Regla: ${space.query}`}>✦</em>}</strong>
        <small>{matches.length} {matches.length === 1 ? "elemento" : "elementos"}</small>
      </article>;
    })}</div> : <div className="lv-empty-state"><Layers size={26} /><strong>Aún no tienes espacios</strong><p>Crea una y mete cosas a mano, o busca algo como <code>#Inteligencia tipo:x</code> y guárdalo como espacio inteligente.</p></div>}
    {error && <p className="lv-error">{error}</p>}
    {docSpace && <SpaceDocumentModal spaceId={docSpace.id} spaceName={docSpace.name} onClose={() => setDocSpace(null)} onSaved={() => void onChanged()} />}
    {timelineSpace && <TimelineModal title={timelineSpace.name} videos={spaceVideos(timelineSpace, videos, tags)} onClose={() => setTimelineSpace(null)} onOpen={(id) => { setTimelineSpace(null); onOpenSource?.(id); }} />}
    {creating && <SaveSpaceModal query="" onClose={() => setCreating(false)} onSaved={(space) => { setCreating(false); void onChanged().then(() => onOpenSpace(space.id)); }} />}
  </main>;
}

const DECK_SIZE = 15;
const CLOSING_LINE = "Lo que vuelves a mirar es lo que de verdad se queda.";

function buildDeck(videos: AppVideo[]) {
  const shuffled = videos.map((video) => ({ video, order: Math.random() }));
  return shuffled.sort((a, b) => Number(Boolean(a.video.resurfacedAt)) - Number(Boolean(b.video.resurfacedAt)) || a.order - b.order).slice(0, DECK_SIZE).map((item) => item.video);
}

function SerendipityFace({ video }: { video: AppVideo }) {
  const [artFailed, setArtFailed] = useState(false);
  const artwork = artFailed ? "" : sourceArtwork(video);
  if (artwork) return <img src={artwork} alt="" referrerPolicy="no-referrer" onError={() => setArtFailed(true)} />;
  const text = sourcePreview(video);
  return <span className="lv-card-text"><small>{sourceHost(video)}</small><strong>{video.title}</strong>{text && <span>{text.slice(0, 220)}{text.length > 220 ? "…" : ""}</span>}</span>;
}

// Música ambiental opcional para la limpieza: acordes suaves generados en el navegador, sin archivos ni red.
function useAmbientMusic() {
  const [playing, setPlaying] = useState(false);
  const engine = useRef<{ context: AudioContext; stop: () => void } | null>(null);
  const toggle = useCallback(() => {
    if (engine.current) { engine.current.stop(); engine.current = null; setPlaying(false); return; }
    const context = new AudioContext();
    const master = context.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.05, context.currentTime + 2.5);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass"; filter.frequency.value = 900;
    filter.connect(master); master.connect(context.destination);
    const chords = [[220, 277.18, 329.63, 415.3], [196, 246.94, 293.66, 369.99], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 392]];
    let voices: OscillatorNode[] = [];
    let index = 0;
    const play = () => {
      const now = context.currentTime;
      voices.forEach((voice) => { try { voice.stop(now + 3); } catch { /* ya detenida */ } });
      voices = chords[index % chords.length].map((frequency, voiceIndex) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = voiceIndex % 2 ? "triangle" : "sine";
        oscillator.frequency.value = frequency;
        oscillator.detune.value = (voiceIndex - 1.5) * 4;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.22, now + 3);
        gain.gain.linearRampToValueAtTime(0, now + 9.5);
        oscillator.connect(gain); gain.connect(filter);
        oscillator.start(now); oscillator.stop(now + 10);
        return oscillator;
      });
      index += 1;
    };
    play();
    const timer = window.setInterval(play, 7000);
    engine.current = { context, stop: () => { window.clearInterval(timer); master.gain.linearRampToValueAtTime(0, context.currentTime + 1.2); window.setTimeout(() => void context.close(), 1400); } };
    setPlaying(true);
  }, []);
  useEffect(() => () => { engine.current?.stop(); engine.current = null; }, []);
  return { playing, toggle };
}

export function SerendipityWorkspace({ videos, catalog, collections, spaces, onSearch, onVibe, onChanged, onExit, onOpenFull, onAsk }: {
  videos: AppVideo[];
  catalog: LibraryTag[];
  collections?: LibraryCollection[];
  spaces?: SmartSpace[];
  onSearch?: (query: string) => void;
  onVibe?: (video: AppVideo) => void;
  onChanged: () => Promise<void>;
  onExit: () => void;
  onOpenFull?: (id: string) => void;
  onAsk: (id: string) => void;
}) {
  const [deck, setDeck] = useState<AppVideo[]>(() => buildDeck(videos));
  const [position, setPosition] = useState(0);
  const [undo, setUndo] = useState<AppVideo | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [quick, setQuick] = useState<"" | "note" | "space">("");
  const [noteDraft, setNoteDraft] = useState("");
  const noteDictation = useDictation((text) => setNoteDraft((current) => (current.trim() ? `${current.trim()} ${text}` : text)));
  const [flash, setFlash] = useState("");
  const music = useAmbientMusic();
  const current = deck[position];
  const closing = useMemo(() => {
    const seen = deck.filter((video) => video.summary?.takeaways.length);
    const source = seen[position % Math.max(1, seen.length)];
    return source ? { text: source.summary!.takeaways[0], from: source.title } : { text: CLOSING_LINE, from: "" };
  }, [deck, position]);
  const background = useMemo(() => {
    const others = deck.length > 1 ? deck.filter((video) => video.id !== current?.id) : [];
    const slots = [[6, 8], [78, 6], [4, 58], [84, 52], [20, 76], [68, 78], [38, 2], [58, 88]];
    return slots.map((slot, index) => ({ slot, video: others[index % Math.max(1, others.length)] })).filter((item) => item.video);
  }, [deck, current?.id]);

  const decide = useCallback(async (action: "keep" | "forget") => {
    if (!current) return;
    setError("");
    setUndo(action === "forget" ? current : null);
    setPosition((value) => value + 1);
    try { await readJson(`/api/videos/${current.id}`, { method: "PATCH", body: JSON.stringify({ action: action === "forget" ? "archive" : "keep" }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar tu decisión."); }
  }, [current]);

  async function undoForget() {
    if (!undo) return;
    const restored = undo;
    setUndo(null);
    setPosition((value) => Math.max(0, value - 1));
    await readJson(`/api/videos/${restored.id}`, { method: "PATCH", body: JSON.stringify({ action: "unarchive" }) });
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (openId || quick) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); void decide("forget"); }
      if (event.key === "ArrowRight") { event.preventDefault(); void decide("keep"); }
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, onExit, openId, quick]);
  const say = (text: string) => { setFlash(text); window.setTimeout(() => setFlash(""), 1800); };
  async function saveQuickNote() {
    if (!current || !noteDraft.trim()) return;
    const previous = current.note?.content?.trim() || "";
    try {
      await readJson(`/api/videos/${current.id}/note`, { method: "PUT", body: JSON.stringify({ content: previous ? `${previous}\n\n${noteDraft.trim()}` : noteDraft.trim() }) });
      setNoteDraft(""); setQuick(""); say("Nota guardada.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la nota."); }
  }
  async function addToSpace(space: SmartSpace) {
    if (!current) return;
    try { await readJson(`/api/spaces/${space.id}/items/${current.id}`, { method: "PUT" }); setQuick(""); say(`Añadida a ${space.name}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo añadir al espacio."); }
  }

  if (!deck.length) return <main className="lv-serendipity end"><div className="lv-closing"><blockquote>Aún no hay suficientes fuentes para redescubrir.</blockquote><button onClick={onExit}>Volver a mi biblioteca</button></div></main>;
  if (!current) return <main className="lv-serendipity end">
    <div className="lv-closing">
      <blockquote>“{closing.text}”</blockquote>
      {closing.from && <small>De: {closing.from}</small>}
      <button onClick={() => { void onChanged().catch(() => undefined); setDeck(buildDeck(videos)); setPosition(0); setUndo(null); }}><Shuffle size={15} /> Otra vez</button>
      <button className="plain" onClick={() => { void onChanged().catch(() => undefined); onExit(); }}>Volver a mi biblioteca</button>
    </div>
  </main>;
  return <main className="lv-serendipity">
    <button className="lv-serendipity-close" onClick={() => { void onChanged().catch(() => undefined); onExit(); }} aria-label="Salir de Limpieza inteligente"><X size={17} /></button>
    <button className={`lv-serendipity-music ${music.playing ? "on" : ""}`} onClick={music.toggle} aria-pressed={music.playing} title={music.playing ? "Apagar música ambiental" : "Música ambiental"}>{music.playing ? "♪ Música" : "♪"}</button>
    <div className="lv-serendipity-bg" aria-hidden>{background.map(({ slot, video }, index) => <span key={`${video.id}-${index}`} style={{ left: `${slot[0]}%`, top: `${slot[1]}%` }}><SerendipityFace video={video} /></span>)}</div>
    <div className="lv-serendipity-stage" key={current.id}>
      <button className="lv-serendipity-card" onClick={() => setOpenId(current.id)} aria-label={`Abrir ${current.title}`}><SerendipityFace video={current} /></button>
      <p>{current.title}</p>
      <div className="lv-serendipity-actions">
        <button onClick={() => void decide("forget")}><ArrowLeft size={14} /> Olvidar</button>
        <button className="keep" onClick={() => void decide("keep")}>Conservar <ArrowRight size={14} /></button>
      </div>
      <div className="lv-serendipity-quick">
        <button className={quick === "note" ? "on" : ""} onClick={() => setQuick(quick === "note" ? "" : "note")}><StickyNote size={13} /> Nota</button>
        {(spaces ?? []).length > 0 && <button className={quick === "space" ? "on" : ""} onClick={() => setQuick(quick === "space" ? "" : "space")}><Folder size={13} /> Espacio</button>}
      </div>
      {quick === "note" && <form className="lv-serendipity-note" onSubmit={(event) => { event.preventDefault(); void saveQuickNote(); }}><textarea autoFocus rows={2} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void saveQuickNote(); if (event.key === "Escape") setQuick(""); }} placeholder={noteDictation.state === "recording" ? "Escuchando… pulsa para terminar" : noteDictation.state === "working" ? "Pasando tu voz a texto…" : "¿Por qué vale la pena conservarlo?"} /><button type="button" className={`lv-note-mic ${noteDictation.state}`} onClick={noteDictation.toggle} disabled={noteDictation.state === "working"} aria-label={noteDictation.state === "recording" ? "Terminar de dictar" : "Dictar la nota"} title="Dictar">{noteDictation.state === "working" ? <LoaderCircle className="spin" size={14} /> : noteDictation.state === "recording" ? <Square size={12} /> : <Mic size={15} />}</button>{noteDictation.error && <p className="lv-error">{noteDictation.error}</p>}<button type="submit">Guardar</button></form>}
      {quick === "space" && <div className="lv-serendipity-spaces">{(spaces ?? []).map((space) => <button key={space.id} onClick={() => void addToSpace(space)}><i style={{ borderColor: space.color }} />{space.name}</button>)}</div>}
      {flash && <small className="lv-serendipity-flash">{flash}</small>}
      <small>{position + 1} de {deck.length} · usa las flechas ← →</small>
      {error && <small className="lv-error">{error}</small>}
    </div>
    {undo && <div className="lv-toast"><Trash2 size={14} /> Archivada. <button onClick={() => void undoForget()}>Deshacer</button></div>}
    {openId && <DetailModal videoId={openId} catalog={catalog} collections={collections} spaces={spaces} onSearch={onSearch} onVibe={onVibe} onClose={() => setOpenId(null)} onOpenFull={onOpenFull} onAsk={onAsk} />}
  </main>;
}
