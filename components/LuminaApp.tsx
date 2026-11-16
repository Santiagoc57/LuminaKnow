"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  CalendarDays,
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GraduationCap,
  Github,
  Globe2,
  Hash,
  House,
  ImageIcon,
  Eye,
  Library,
  Link2,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  MoreHorizontal,
  Network,
  NotebookPen,
  Pencil,
  Pin,
  Play,
  Plus,
  Puzzle,
  Smartphone,
  RefreshCw,
  Search,
  Settings,
  Moon,
  Sun,
  WandSparkles,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { AppVideo, AvailableModel, ChatSourceSelection, Citation, ConversationSummary, LibraryCollection, LibraryTag, SmartSpace } from "@/lib/types";
import { canSelectCatalogTag, matchingCatalogTags } from "@/lib/tag-picker";
import { parseRedditUrl, parseSourceUrl, parseXUrl } from "@/lib/utils";
import { matchesLibraryQuery, parseLibraryQuery } from "@/lib/library-query";
import { isProvisionalSummary } from "@/lib/summary";
import { BulkTaggingModal, GraphWorkspace, KnowledgeHome } from "./ConnectedWorkspaces";
import { DailyReview } from "./ReviewViews";
import { DetailModal, SerendipityWorkspace, SpacesWorkspace, spaceVideos } from "./DiscoverViews";
import { UnifiedChatWorkspace } from "./UnifiedChat";

type Profile = { id: string; name: string; avatarColor: string };
type Bootstrap = {
  aiLastError?: string;
  profile: Profile;
  videos: AppVideo[];
  archived: AppVideo[];
  spaces: SmartSpace[];
  collections: LibraryCollection[];
  tags: LibraryTag[];
  usage: { cost: number; budget: number };
  hasAiKey: boolean;
  aiProvider: "gemini" | "openai" | "none";
  hasGeminiKey?: boolean;
  hasOpenAIKey: boolean;
  extensionConnected?: boolean;
  models: AvailableModel[];
};
type AppSurface = "home" | "ask" | "video" | "collection" | "graph" | "chat" | "learning" | "spaces" | "serendipity";
type TranscriptChunk = { id: number; ordinal: number; startSeconds: number; endSeconds: number; text: string };
type ChatMessage = { id?: string; role: "user" | "assistant"; content: string; citations?: Citation[]; pending?: boolean };
type Detail = { video: AppVideo; transcript: TranscriptChunk[]; messages: ChatMessage[] };
type LibraryScope = "all" | "notes" | "pdfs" | "youtube" | "images" | "social" | "article" | "github" | "web" | "unsorted" | "archived" | null;




function sourceVisual(video: AppVideo) {
  if (video.sourceType !== "web") return video.sourceType;
  try {
    const hostname = new URL(video.url).hostname.toLocaleLowerCase();
    if (hostname.includes("tiktok.com")) return "tiktok";
    if (hostname.includes("instagram.com")) return "instagram";
    if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) return "facebook";
    if (hostname.includes("linkedin.com")) return "linkedin";
  } catch { /* Se conserva el marcador web genérico. */ }
  return "web";
}

function isSubstackVideo(video: AppVideo) {
  return video.sourceItems.some((item) => item.metadata?.sourceKind === "substack") || video.transcriptSource.startsWith("substack");
}

function isSocialWebVideo(video: AppVideo) {
  return video.sourceType === "web" && !isSubstackVideo(video) && sourceVisual(video) !== "web";
}

function isGithubVideo(video: AppVideo) {
  if (video.sourceType !== "web") return false;
  try {
    const hostname = new URL(video.url).hostname.toLocaleLowerCase();
    return hostname === "github.com" || hostname.endsWith(".github.com");
  } catch { return false; }
}


function sourceDateLabel(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", year: "numeric" }).format(date).replace(".", "");
}

async function jsonRequest<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No se pudo completar la operación.");
  return body as T;
}

function Avatar({ profile, small = false }: { profile: Profile; small?: boolean }) {
  return (
    <span className={`avatar ${small ? "avatar-small" : ""}`} style={{ background: profile.avatarColor }} aria-hidden="true">
      {profile.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Logo() {
  return (
    <div className="brand" aria-label="Lúmina">
      <span className="brand-mark"><span /></span>
      <span>Lúmina</span>
    </div>
  );
}

function SetupScreen({ onReady }: { onReady: () => void }) {
  const [names, setNames] = useState(["Santiago", ""]);
  const [pins, setPins] = useState(["", ""]);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await jsonRequest("/api/setup", {
        method: "POST",
        body: JSON.stringify({ profiles: names.map((name, index) => ({ name, pin: pins[index] })), geminiApiKey: apiKey }),
      });
      onReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el espacio.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="welcome-shell">
      <section className="welcome-copy">
        <Logo />
        <p className="eyebrow">Biblioteca privada de conocimiento</p>
        <h1>Que ningún buen video vuelva a perderse.</h1>
        <p>Guárdalo una vez. Lúmina lo resume, lo ordena y te permite volver a conversar con sus ideas cuando las necesites.</p>
        <div className="welcome-features">
          <span><Sparkles size={17} /> Resúmenes en español</span>
          <span><MessageCircle size={17} /> Chat con citas al segundo</span>
          <span><Archive size={17} /> Todo permanece en tu Mac</span>
        </div>
      </section>
      <section className="setup-card">
        <div>
          <p className="step-label">Primer paso</p>
          <h2>Crea su espacio compartido</h2>
          <p>Dos perfiles, una sola biblioteca. Cada PIN puede tener entre 4 y 8 números.</p>
        </div>
        <form onSubmit={submit}>
          {[0, 1].map((index) => (
            <div className="profile-row" key={index}>
              <span className={`avatar setup-avatar avatar-${index}`}>{index + 1}</span>
              <label>
                Nombre
                <input value={names[index]} onChange={(event) => setNames((current) => current.map((value, i) => i === index ? event.target.value : value))} placeholder={index ? "Nombre de tu pareja" : "Tu nombre"} required />
              </label>
              <label className="pin-field">
                PIN
                <input value={pins[index]} onChange={(event) => setPins((current) => current.map((value, i) => i === index ? event.target.value.replace(/\D/g, "").slice(0, 8) : value))} inputMode="numeric" type="password" placeholder="••••" minLength={4} required />
              </label>
            </div>
          ))}
          <label className="api-key-field">
            Clave de Gemini <span>nivel gratuito</span>
            <input value={apiKey} onChange={(event) => setApiKey(event.target.value)} type="password" placeholder="AIza…" autoComplete="off" />
            <small>Se guarda únicamente en este Mac. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Crear clave gratuita</a></small>
          </label>
          {error && <p className="form-error"><CircleAlert size={16} /> {error}</p>}
          <button className="primary-button wide" disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}
            Crear biblioteca
          </button>
        </form>
      </section>
    </main>
  );
}

function LoginScreen({ profiles, onLogin }: { profiles: Profile[]; onLogin: (profileId: string, pin: string) => Promise<void> }) {
  const [selected, setSelected] = useState<Profile | null>(profiles[0] ?? null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      await onLogin(selected.id, pin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <Logo />
      <section className="login-card">
        <div className="login-icon"><Library size={26} /></div>
        <p className="eyebrow">Bienvenidos de vuelta</p>
        <h1>¿Quién está entrando?</h1>
        <div className="profile-picker">
          {profiles.map((profile) => (
            <button key={profile.id} className={selected?.id === profile.id ? "selected" : ""} onClick={() => { setSelected(profile); setPin(""); }}>
              <Avatar profile={profile} />
              <span>{profile.name}</span>
              {selected?.id === profile.id && <Check size={16} />}
            </button>
          ))}
        </div>
        <form onSubmit={submit}>
          <label>
            PIN de {selected?.name}
            <input className="pin-input" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} type="password" inputMode="numeric" placeholder="••••" autoFocus />
          </label>
          {error && <p className="form-error"><CircleAlert size={16} /> {error}</p>}
          <button className="primary-button wide" disabled={loading || pin.length < 4}>
            {loading ? <LoaderCircle className="spin" size={18} /> : <ArrowUpRight size={18} />}
            Entrar a la biblioteca
          </button>
        </form>
      </section>
      <p className="login-footnote"><Archive size={14} /> Los datos permanecen en el Mac anfitrión.</p>
    </main>
  );
}


function AddVideoModal({ tags, onClose, onAdded }: { tags: LibraryTag[]; onClose: () => void; onAdded: (id: string) => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [suggestedTitles, setSuggestedTitles] = useState<string[]>([]);
  const [suggestedTags, setSuggestedTags] = useState<Array<{ id: string; name: string; level: LibraryTag["level"] }>>([]);
  const [selectedSuggestedTags, setSelectedSuggestedTags] = useState<string[]>([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionNotice, setSuggestionNotice] = useState("");
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagQuery, setTagQuery] = useState("");
  const tagsEdited = useRef(false);
  const [mode, setMode] = useState<"save" | "process">("process");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [additionalUrls, setAdditionalUrls] = useState("");
  const [threadPreview, setThreadPreview] = useState<{
    status: "single" | "complete" | "partial";
    items: Array<{ postId: string; title: string; channel: string; description: string; publishedAt: string; url: string }>;
    warnings: string[];
  } | null>(null);
  const parsedSource = parseSourceUrl(url);
  const parsedSourceUrl = parsedSource?.url;
  const isX = Boolean(parseXUrl(url));
  const isReddit = Boolean(parseRedditUrl(url));
  const isWeb = parsedSource?.sourceType === "web";
  const isSubstack = isWeb && (() => { try { return new URL(parsedSource.url).hostname.endsWith(".substack.com"); } catch { return false; } })();
  const extraUrls = additionalUrls.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  const matchingTags = matchingCatalogTags(tags, selectedSuggestedTags, tagQuery);
  const tagAtLimit = (tag: { id: string }) => !canSelectCatalogTag(tags, selectedSuggestedTags, tag.id);

  useEffect(() => {
    if (!parsedSourceUrl) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSuggestionLoading(true);
      setSuggestionNotice("");
      try {
        const preview = await jsonRequest<{ title: string; titles?: string[]; usedAI: boolean; tags: Array<{ id: string; name: string; level: "primary" | "secondary" }> }>("/api/sources/preview", { method: "POST", body: JSON.stringify({ url: parsedSourceUrl }) });
        if (cancelled) return;
        const candidates = (preview.titles?.length ? preview.titles.slice(0, 3) : [preview.title]).filter(Boolean);
        setSuggestedTitles(candidates);
        setTitle((current) => current.trim() ? current : candidates[0] || "");
        if (!preview.usedAI) setSuggestionNotice("No se pudo generar el título en español. Escríbelo antes de guardar y revisa las etiquetas.");
        const tagCandidates = preview.tags.slice(0, 5);
        if (!tagsEdited.current) {
          setSuggestedTags(tagCandidates);
          setSelectedSuggestedTags(tagCandidates.map((tag) => tag.id));
        }
      } catch {
        if (!cancelled) { setSuggestedTitles([]); setSuggestionNotice("No pudimos obtener las sugerencias. Puedes escribir el título y añadir etiquetas con +."); }
      } finally {
        if (!cancelled) setSuggestionLoading(false);
      }
    }, 650);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [parsedSourceUrl]);

  function toggleSuggestedTag(tagId: string) {
    const tag = tags.find((item) => item.id === tagId) || suggestedTags.find((item) => item.id === tagId);
    if (!tag || (!selectedSuggestedTags.includes(tagId) && tagAtLimit(tag))) return;
    tagsEdited.current = true;
    setSuggestedTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
    setSelectedSuggestedTags((current) => current.includes(tagId) ? current.filter((item) => item !== tagId) : [...current, tagId]);
  }

  async function previewThread() {
    setLoading(true);
    setError("");
    try {
      const preview = await jsonRequest<NonNullable<typeof threadPreview>>("/api/x/threads/preview", {
        method: "POST",
        body: JSON.stringify({ url, additionalUrls: extraUrls }),
      });
      setThreadPreview(preview);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revisar la publicación.");
    } finally {
      setLoading(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isX && !threadPreview) {
      await previewThread();
      return;
    }
    setLoading(true);
    setError("");
    try {
      const endpoint = isX ? "/api/x/threads" : "/api/videos";
      const result = await jsonRequest<{ id: string; duplicate: boolean }>(endpoint, { method: "POST", body: JSON.stringify({ url, additionalUrls: extraUrls, mode, title: title.trim() || undefined, tagIds: selectedSuggestedTags }) });
      onAdded(result.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo agregar la fuente.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card add-modal">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2>{threadPreview ? "Revisa el hilo antes de guardarlo" : "¿Cómo quieres guardarlo?"}</h2>
        {threadPreview && <p>Lúmina conservará estas publicaciones como una sola fuente, pero cada una seguirá siendo buscable y citable.</p>}
        <form onSubmit={submit}>
          <label>
            Enlace de YouTube, X, Reddit, GitHub, Substack o una página web
            <div className="url-input">{parsedSource?.sourceType === "youtube" ? <img className="source-platform-logo input-source-logo" src="/youtube.svg" alt="YouTube" /> : isX ? <MessageSquare size={17} /> : isReddit ? <MessageCircle size={17} /> : isWeb ? isSubstack ? <img className="substack-platform-logo" src="/substack.svg" alt="Substack" /> : <Globe2 size={17} /> : <Link2 size={17} />}<input value={url} onChange={(event) => { setUrl(event.target.value); setTitle(""); setSuggestedTitles([]); setSuggestedTags([]); setSelectedSuggestedTags([]); setThreadPreview(null); setSuggestionNotice(""); setSuggestionLoading(false); setTagPickerOpen(false); setTagQuery(""); tagsEdited.current = false; }} placeholder="Pega un video, publicación, repositorio, artículo o página web" autoFocus={!threadPreview} /></div>
          </label>
          {isX && !threadPreview && <label>
            Completar el hilo <small className="optional-label">Opcional</small>
            <textarea className="thread-extra-urls" value={additionalUrls} onChange={(event) => setAdditionalUrls(event.target.value)} placeholder="Pega aquí otras URLs del mismo autor, una por línea. Lúmina también intentará encontrarlas automáticamente." />
          </label>}
          {threadPreview && <section className={`thread-preview status-${threadPreview.status}`}>
            <header><div><strong>{threadPreview.items.length > 1 ? `Hilo de ${threadPreview.items.length} publicaciones` : "Publicación individual"}</strong><span>{threadPreview.status === "complete" ? "Detección completa" : threadPreview.status === "partial" ? "Revisar: detección parcial" : "No se detectaron respuestas"}</span></div><button type="button" onClick={() => setThreadPreview(null)}>Editar enlaces</button></header>
            <div>{threadPreview.items.map((item, index) => <article key={item.postId}><span>{index + 1}</span><div><strong>{item.channel}</strong><p>{item.description}</p>{item.publishedAt && <small>{sourceDateLabel(item.publishedAt)}</small>}</div><a href={item.url} target="_blank" rel="noreferrer" aria-label="Abrir publicación en X"><ExternalLink size={14} /></a></article>)}</div>
            {threadPreview.warnings.length > 0 && <ul>{threadPreview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          </section>}
          <fieldset className="save-mode-options">
            <legend>Elige una opción</legend>
            <button type="button" className={mode === "save" ? "active" : ""} onClick={() => setMode("save")} aria-pressed={mode === "save"}>
              <span><Bookmark size={18} /></span><strong>Solo guardar</strong>{mode === "save" && <Check size={16} />}
            </button>
            <button type="button" className={mode === "process" ? "active" : ""} onClick={() => setMode("process")} aria-pressed={mode === "process"}>
              <span><Sparkles size={18} /></span><strong>Guardar y analizar</strong>{mode === "process" && <Check size={16} />}
            </button>
          </fieldset>
          <label>
            Título sugerido
            <div className="suggested-title-field"><input required className="custom-title-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder={suggestionLoading ? "Pensando un título útil…" : "Título en español"} />{suggestionLoading && <LoaderCircle className="spin" size={15} />}</div>
            {isWeb && <small className="source-suggestion-help">En herramientas web, el título explica para qué sirven.</small>}
            {suggestionNotice && <small className="source-suggestion-help" role="status">{suggestionNotice}</small>}
            {suggestedTitles.length > 1 && <div className="suggested-title-options">{suggestedTitles.map((candidate, index) => <button key={`${candidate}-${index}`} type="button" className={title === candidate ? "active" : ""} onClick={() => setTitle(candidate)}><span>{candidate}</span></button>)}</div>}
          </label>
          <div className="early-tags-field"><div><strong>Etiquetas sugeridas</strong><small>1–3 principales · 1–2 subetiquetas</small></div><div className="early-tag-chips">{suggestedTags.map((tag) => <button key={tag.id} type="button" className={selectedSuggestedTags.includes(tag.id) ? "selected" : ""} disabled={!selectedSuggestedTags.includes(tag.id) && tagAtLimit(tag)} onClick={() => toggleSuggestedTag(tag.id)} aria-pressed={selectedSuggestedTags.includes(tag.id)}>{tag.name}<small>{tag.level === "primary" ? "Principal" : "Subetiqueta"}</small>{selectedSuggestedTags.includes(tag.id) && <Check size={12} />}</button>)}<button type="button" className="early-tag-add" aria-label="Añadir etiqueta" aria-expanded={tagPickerOpen} aria-controls="early-tag-picker" onClick={() => setTagPickerOpen((current) => !current)}><Plus size={16} /></button>{suggestionLoading && <span className="early-tag-loading"><LoaderCircle className="spin" size={14} /> Clasificando…</span>}</div>
            {tagPickerOpen && <div id="early-tag-picker" className="early-tag-picker">
              <label><Search size={15} /><input autoFocus aria-label="Buscar etiqueta del catálogo" placeholder="Escribe para buscar una etiqueta…" value={tagQuery} onChange={(event) => setTagQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); if (event.key === "Escape") { event.stopPropagation(); setTagPickerOpen(false); } }} /></label>
              <div className="early-tag-results">{matchingTags.map((tag) => <button key={tag.id} type="button" disabled={tagAtLimit(tag)} onClick={() => { toggleSuggestedTag(tag.id); setTagQuery(""); setTagPickerOpen(false); }}><span>{tag.name}</span><small>{tagAtLimit(tag) ? `Máximo ${tag.level === "primary" ? "3 principales" : "2 subetiquetas"}` : tag.level === "primary" ? "Principal" : "Subetiqueta"}</small></button>)}{!matchingTags.length && <p>No hay coincidencias disponibles en el catálogo.</p>}</div>
            </div>}
          </div>
          {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
          <button className="primary-button wide" disabled={loading || suggestionLoading || !url.trim()}>
            {loading ? <LoaderCircle className="spin" size={18} /> : isX && !threadPreview ? <Eye size={18} /> : mode === "save" ? <Bookmark size={18} /> : <Sparkles size={18} />}
            {isX && !threadPreview ? "Revisar publicación o hilo" : mode === "save" ? "Guardar enlace" : "Guardar y analizar"}
          </button>
        </form>
        <p className="modal-note">Los videos no se almacenan. De X y Reddit se conserva una copia local del texto público.</p>
      </section>
    </div>
  );
}


function SettingsModal({ bootstrap, onClose, onSaved }: { bootstrap: Bootstrap; onClose: () => void; onSaved: () => void }) {
  const [geminiKey, setGeminiKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [budget, setBudget] = useState(bootstrap.usage.budget);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [extensionConnected, setExtensionConnected] = useState(Boolean(bootstrap.extensionConnected));
  const [extensionToken, setExtensionToken] = useState("");
  async function save() {
    setLoading(true);
    try {
      await jsonRequest("/api/settings", { method: "PUT", body: JSON.stringify({ geminiApiKey: geminiKey || undefined, openaiApiKey: openaiKey || undefined, monthlyBudget: budget }) });
      setMessage("Ajustes guardados.");
      onSaved();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo guardar.");
    } finally { setLoading(false); }
  }
  async function backup() {
    setMessage("Creando copia…");
    await jsonRequest("/api/backups", { method: "POST" });
    setMessage("Copia local creada correctamente.");
  }
  async function generateExtensionToken() {
    setMessage("Generando conexión segura…");
    try {
      const result = await jsonRequest<{ token: string; connected: boolean }>("/api/settings/extension-token", { method: "POST" });
      setExtensionToken(result.token); setExtensionConnected(true); setMessage("Código generado. Pégalo en la extensión; solo se muestra ahora."); onSaved();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo generar la conexión."); }
  }
  async function revokeExtension() {
    await jsonRequest("/api/settings/extension-token", { method: "DELETE" });
    setExtensionToken(""); setExtensionConnected(false); setMessage("La conexión de las extensiones fue revocada."); onSaved();
  }
  async function copyExtensionToken() {
    if (!extensionToken) return;
    await navigator.clipboard.writeText(extensionToken);
    setMessage("Código copiado. Ahora pégalo en las opciones de Lúmina Companion.");
  }
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal-card settings-modal">
        <button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <p className="eyebrow">Preferencias locales</p>
        <h2>Ajustes de Lúmina</h2>
        <div className="settings-section">
          <h3>Inteligencia artificial</h3>
          <label>Clave de Gemini <span>{bootstrap.hasGeminiKey ? (bootstrap.hasOpenAIKey ? "Configurada · respaldo y búsqueda" : "Configurada · proveedor principal") : "Opcional · respaldo gratuito"}</span>
            <input value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} type="password" placeholder={bootstrap.hasGeminiKey ? "••••••••••••••••" : "AIza…"} />
            <small><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Crear una clave gratuita en Google AI Studio</a></small>
          </label>
          <label>Clave de OpenAI <span>{bootstrap.hasOpenAIKey ? "Configurada · motor principal" : "Recomendada · resúmenes, imágenes y transcripción"}</span>
            <input value={openaiKey} onChange={(event) => setOpenaiKey(event.target.value)} type="password" placeholder={bootstrap.hasOpenAIKey ? "••••••••••••••••" : "sk-…"} />
          </label>
          <div className="budget-line"><span>Proveedor activo</span><strong>{bootstrap.aiProvider === "gemini" ? "Gemini 3.5 Flash-Lite" : bootstrap.aiProvider === "openai" ? "OpenAI · GPT-6 Luna + Nano" : "Sin configurar"}</strong></div>
          <label>Tope mensual estimado: <strong>US${budget}</strong>
            <input type="range" min="1" max="30" value={budget} onChange={(event) => setBudget(Number(event.target.value))} />
          </label>
          <div className="budget-line"><span>Consumido este mes</span><strong>US${bootstrap.usage.cost.toFixed(3)}</strong></div>
        </div>
        <div className="settings-section">
          <h3>Extensión del navegador</h3>
          <div className="extension-connection-status"><span className={extensionConnected ? "connected" : ""}><Puzzle size={16} />{extensionConnected ? "Firefox o Chrome vinculados" : "Sin extensión vinculada"}</span><small>Guarda con Alt+S y recupera fuentes relacionadas mientras navegas.</small></div>
          <div className="settings-actions extension-downloads">
            <a className="secondary-button" href="/downloads/lumina-companion-firefox.zip" download><Download size={16} /> Firefox</a>
            <a className="secondary-button" href="/downloads/lumina-companion-chrome.zip" download><Download size={16} /> Chrome</a>
          </div>
          {extensionToken && <label>Código de conexión <span>Se mostrará solamente esta vez</span><div className="extension-token-field"><input value={extensionToken} readOnly /><button className="secondary-button" onClick={() => void copyExtensionToken()}><Copy size={15} /> Copiar</button></div></label>}
          <div className="settings-actions"><button className="secondary-button" onClick={() => void generateExtensionToken()}><Puzzle size={16} />{extensionConnected ? "Generar un código nuevo" : "Vincular extensión"}</button>{extensionConnected && <button className="secondary-button danger-outline" onClick={() => void revokeExtension()}>Revocar conexión</button>}</div>
          <small className="extension-install-help">Firefox: abre <code>about:debugging</code> → Este Firefox → Cargar complemento temporal. Chrome: descomprime el ZIP y usa <code>chrome://extensions</code> → Cargar descomprimida.</small>
        </div>
        <MobileSection />
        <MaintenanceSection />
        <div className="settings-section">
          <h3>Tus datos</h3>
          <div className="settings-actions">
            <button className="secondary-button" onClick={backup}><Archive size={16} /> Crear copia ahora</button>
            <a className="secondary-button" href="/api/export?format=markdown"><Download size={16} /> Exportar Markdown</a>
            <a className="secondary-button" href="/api/export?format=json"><Download size={16} /> Exportar JSON</a>
          </div>
        </div>
        {message && <p className="settings-message">{message}</p>}
        <button className="primary-button wide" onClick={save} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Guardar ajustes</button>
      </section>
    </div>
  );
}

type CommandChoice = { id: string; label: string; detail: string; icon: React.ReactNode; run: () => void };

function CommandPalette({ data, onClose, onOpenSource, onOpenCollection, onOpenTag, onAdd, onHome, onAsk, onSettings }: {
  data: Bootstrap;
  onClose: () => void;
  onOpenSource: (id: string) => void;
  onOpenCollection: (id: string) => void;
  onOpenTag: (id: string) => void;
  onAdd: () => void;
  onHome: () => void;
  onAsk: () => void;
  onSettings: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const normalized = query.trim().toLocaleLowerCase("es");
  const closeThen = (action: () => void) => () => { onClose(); action(); };
  const baseActions: CommandChoice[] = [
    { id: "action-add", label: "Agregar una fuente", detail: "YouTube, X, Reddit, GitHub o web", icon: <Plus size={16} />, run: closeThen(onAdd) },
    { id: "action-home", label: "Ir a TODO", detail: "Ver toda la biblioteca", icon: <House size={16} />, run: closeThen(onHome) },
    { id: "action-ask", label: "Preguntar a Lúmina", detail: "Conversar con tu biblioteca", icon: <MessageCircle size={16} />, run: closeThen(onAsk) },
    { id: "action-settings", label: "Abrir ajustes", detail: "IA, extensión y copias", icon: <Settings size={16} />, run: closeThen(onSettings) },
  ];
  const parsed = parseLibraryQuery(query);
  const sourceChoices: CommandChoice[] = normalized ? data.videos.filter((video) => matchesLibraryQuery(video, parsed, data.tags)).slice(0, 9).map((video) => ({ id: `source-${video.id}`, label: video.title, detail: `${video.channel || "Fuente guardada"} · ${video.sourceType === "youtube" ? "YouTube" : video.sourceType === "x" ? "X" : video.sourceType === "reddit" ? "Reddit" : "Web"}`, icon: video.sourceType === "youtube" ? <Play size={15} /> : <Link2 size={15} />, run: closeThen(() => onOpenSource(video.id)) })) : [];
  const tagChoices: CommandChoice[] = normalized && !/[#:]/.test(query) ? data.tags.filter((tag) => tag.name.toLocaleLowerCase("es").includes(normalized)).slice(0, 5).map((tag) => ({ id: `tag-${tag.id}`, label: tag.name, detail: tag.level === "primary" ? "Etiqueta principal" : "Subetiqueta", icon: <Hash size={15} />, run: closeThen(() => onOpenTag(tag.id)) })) : [];
  const collectionChoices: CommandChoice[] = normalized && !/[#:]/.test(query) ? data.collections.filter((collection) => collection.name.toLocaleLowerCase("es").includes(normalized)).slice(0, 5).map((collection) => ({ id: `collection-${collection.id}`, label: collection.name, detail: "Carpeta", icon: <Folder size={15} />, run: closeThen(() => onOpenCollection(collection.id)) })) : [];
  const actionChoices = normalized ? baseActions.filter((action) => `${action.label} ${action.detail}`.toLocaleLowerCase("es").includes(normalized)) : baseActions;
  const choices = [...actionChoices, ...sourceChoices, ...tagChoices, ...collectionChoices];
  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Buscar y ejecutar acciones">
      <div className="command-input"><Search size={18} /><input value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }} onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, choices.length - 1)); } if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); } if (event.key === "Enter" && choices[activeIndex]) { event.preventDefault(); choices[activeIndex].run(); } }} placeholder="Busca o escribe una acción…" autoFocus /><kbd>Esc</kbd></div>
      <div className="command-hints"><span>#política</span><span>site:youtube.com</span><span>tipo:artículo</span><span>en:&quot;Carpeta&quot;</span></div>
      <div className="command-results">{choices.map((choice, index) => <button key={choice.id} className={index === activeIndex ? "active" : ""} onMouseEnter={() => setActiveIndex(index)} onClick={choice.run}><span>{choice.icon}</span><div><strong>{choice.label}</strong><small>{choice.detail}</small></div><ArrowUpRight size={14} /></button>)}{!choices.length && <div className="command-empty"><Search size={20} /><strong>No encontramos coincidencias</strong><small>Prueba otro término u operador.</small></div>}</div>
      <footer><span>↑↓ navegar</span><span>Enter abrir</span><span>Ctrl/⌘ K cerrar</span></footer>
    </section>
  </div>;
}

// Sin barra lateral ancha: todo se maneja desde este riel de iconos (la del chat se conserva para el historial).
function AppRail({ data, surface, sidebarCollapsed, tagsActive, onAdd, onHome, onChat, onGraph, onLearning, onSpaces, onSerendipity, onToggleSidebar, onSettings, onLogout, tagPanel, panels = [] }: { panels?: Array<{ key: string; label: string; icon: React.ReactNode; badge?: number; tone?: "alert"; render: (close: () => void) => React.ReactNode }>; data: Bootstrap; surface: AppSurface; sidebarCollapsed: boolean; tagsActive?: boolean; onAdd: () => void; onHome: () => void; onChat: () => void; onGraph: () => void; onLearning: () => void; onSpaces: () => void; onSerendipity: () => void; onToggleSidebar: () => void; onSettings: () => void; onLogout: () => void; tagPanel?: (close: () => void) => React.ReactNode }) {
  const [tagsOpen, setTagsOpen] = useState<DOMRect | null>(null);
  const [profileOpen, setProfileOpen] = useState<DOMRect | null>(null);
  const [panelOpen, setPanelOpen] = useState<{ key: string; rect: DOMRect } | null>(null);
  // Los menús se dibujan fuera del riel (en document.body) para no heredar el estilo de sus botones.
  const popover = (rect: DOMRect, className: string, close: () => void, content: React.ReactNode, fromBottom = false) => createPortal(<>
    <div className="rail-popover-scrim" onMouseDown={close} />
    <div className={`rail-popover ${className}`} style={fromBottom ? { left: rect.right + 10, bottom: Math.max(10, window.innerHeight - rect.bottom) } : { left: rect.right + 10, top: Math.max(10, Math.min(rect.top - 6, window.innerHeight - 420)) }}>{content}</div>
  </>, document.body);
  return <nav className="app-rail" aria-label="Navegación principal">
    {/* El logo es el inicio (ya no hay casita). En el chat, ⌘\\ sigue mostrando u ocultando el historial. */}
    <button className={`rail-brand rail-tooltip ${surface === "home" || surface === "video" || surface === "collection" ? "active" : ""}`} onClick={onHome} aria-label="Ir al inicio" data-tooltip="Inicio" data-shortcut="⌘1"><span className="brand-mark"><span /></span></button>
    <div className="rail-destinations">
      <button className={`${surface === "ask" || surface === "chat" ? "active " : ""}rail-tooltip`} onClick={onChat} aria-label="Chat con Lúmina" data-tooltip="Chat con Lúmina" data-shortcut="⌘2"><MessageCircle size={19} /></button>
      <button className={`${surface === "graph" ? "active " : ""}rail-tooltip`} onClick={onGraph} aria-label="Grafo" data-tooltip="Grafo de conocimiento" data-shortcut="⌘3"><Network size={20} /></button>
      <button className={`${surface === "learning" ? "active " : ""}rail-tooltip`} onClick={onLearning} aria-label="Revisión diaria" data-tooltip="Revisión diaria" data-shortcut="⌘4"><GraduationCap size={20} /></button>
      <button className={`${surface === "spaces" ? "active " : ""}rail-tooltip`} onClick={onSpaces} aria-label="Carpetas" data-tooltip="Carpetas" data-shortcut=""><Folder size={19} /></button>
      {tagPanel && <div className="rail-popover-anchor">
        <button className={`${tagsOpen || tagsActive ? "active " : ""}rail-tooltip`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setTagsOpen((current) => current ? null : rect); }} aria-label="Etiquetas" aria-expanded={Boolean(tagsOpen)} data-tooltip="Etiquetas" data-shortcut=""><Hash size={19} /></button>
        {tagsOpen && popover(tagsOpen, "rail-tags-popover", () => setTagsOpen(null), tagPanel(() => setTagsOpen(null)))}
      </div>}
      {panels.map((panel) => <div key={panel.key} className="rail-popover-anchor">
        <button className={`${panelOpen?.key === panel.key ? "active " : ""}rail-tooltip ${panel.tone === "alert" ? "rail-alert" : ""}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setPanelOpen((current) => current?.key === panel.key ? null : { key: panel.key, rect }); }} aria-label={panel.label} aria-expanded={panelOpen?.key === panel.key} data-tooltip={panel.label} data-shortcut="">{panel.icon}{Boolean(panel.badge) && <b className="rail-badge">{panel.badge}</b>}</button>
        {panelOpen?.key === panel.key && popover(panelOpen.rect, `rail-list-popover rail-${panel.key}-popover`, () => setPanelOpen(null), panel.render(() => setPanelOpen(null)))}
      </div>)}
      <button className={`${surface === "serendipity" ? "active " : ""}rail-tooltip`} onClick={onSerendipity} aria-label="Limpieza inteligente" data-tooltip="Limpieza inteligente · conserva u olvida" data-shortcut=""><WandSparkles size={19} /></button>
    </div>
    <ThemeToggle />
    <div className="rail-popover-anchor rail-profile-anchor">
      <button className="rail-profile rail-tooltip" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setProfileOpen((current) => current ? null : rect); }} aria-label="Perfil y ajustes" aria-expanded={Boolean(profileOpen)} data-tooltip={data.profile.name} data-shortcut=""><Avatar profile={data.profile} small /></button>
      {profileOpen && popover(profileOpen, "rail-profile-popover", () => setProfileOpen(null), <>
        <strong>{data.profile.name}</strong>
        <small>Uso de IA este mes · US${data.usage.cost.toFixed(2)}</small>
        <button role="menuitem" onClick={() => { setProfileOpen(null); onSettings(); }}><Settings size={15} /> Ajustes</button>
        <button role="menuitem" onClick={() => { setProfileOpen(null); onLogout(); }}><LogOut size={15} /> Cambiar perfil</button>
      </>, true)}
    </div>
  </nav>;
}

// Modo claro / oscuro: se recuerda en este navegador; sin elección, sigue al sistema.
const SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  { title: "En cualquier parte", items: [["?", "Mostrar u ocultar esta ayuda"], ["/", "Ir al buscador"], ["⌘ K", "Buscar y saltar a cualquier cosa"], ["A", "Agregar un enlace"], ["N", "Escribir una nota rápida"], ["⇧ D", "Modo claro u oscuro"], ["⌘ \\", "Mostrar u ocultar la barra lateral"], ["⌘ 1 – 4", "Inicio, chat, grafo y revisión diaria"]] },
  { title: "En la biblioteca", items: [["⇧ clic", "Seleccionar varias tarjetas"], ["Esc", "Quitar la selección"], ["Clic derecho", "Menú rápido de una tarjeta"], ["⌘ V", "Pegar un enlace, texto o imagen"], ["#", "Sugerencias de etiquetas en el buscador"]] },
  { title: "Con una tarjeta abierta", items: [["← →", "Anterior o siguiente"], ["Esc", "Cerrar"]] },
  { title: "Limpieza inteligente", items: [["←", "Olvidar"], ["→", "Conservar"]] },
  { title: "Revisión diaria", items: [["1", "Lo olvidé"], ["2", "Lo recuerdo"], ["3", "Muy fácil"], ["X", "Descartar"]] },
];

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal-card lv-shortcuts" role="dialog" aria-label="Atajos de teclado">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
      <h2>Atajos de teclado</h2>
      <div>{SHORTCUT_GROUPS.map((group) => <section key={group.title}><h3>{group.title}</h3><dl>{group.items.map(([keys, label]) => <div key={keys + label}><dt>{keys.split(" ").map((key, index) => <kbd key={index}>{key}</kbd>)}</dt><dd>{label}</dd></div>)}</dl></section>)}</div>
    </section>
  </div>;
}

type MaintenanceItem = { id: string; title: string; url: string; createdAt?: string; status?: string; snapshotAt?: string | null };

// Duplicados y enlaces rotos: se revisan a pedido y se archivan con un clic (se pueden restaurar).
type MobileStatus = { connected: boolean; appUrl: string; certUrl: string; https: { running: boolean; error: string; port: number; addresses: string[] } };

// Celular Android: app instalable que aparece en «Compartir» y envía a esta Mac por la Wi-Fi de casa.
function MobileSection() {
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { void jsonRequest<MobileStatus>("/api/settings/mobile").then(setStatus).catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo leer el estado.")); }, []);
  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void jsonRequest<MobileStatus>("/api/settings/mobile").then((next) => { setStatus(next); if (next.connected && !status?.connected) setCode(null); }).catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [code, status?.connected]);
  const left = code ? Math.max(0, Math.round((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  const generate = async () => { setError(""); try { const result = await jsonRequest<MobileStatus & { code: string; expiresAt: string }>("/api/settings/mobile", { method: "POST" }); setStatus(result); setCode({ code: result.code, expiresAt: result.expiresAt }); setNow(Date.now()); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar el código."); } };
  const revoke = async () => { if (!window.confirm("¿Desvincular el celular? Dejará de poder enviar a LUMINA hasta que lo vincules de nuevo.")) return; setStatus(await jsonRequest<MobileStatus>("/api/settings/mobile", { method: "DELETE" })); setCode(null); };
  return <div className="settings-section mobile-settings">
    <h3>Celular</h3>
    <div className="extension-connection-status"><span className={status?.connected ? "connected" : ""}><Smartphone size={16} />{status?.connected ? "Celular vinculado" : "Sin celular vinculado"}</span><small>Comparte fotos, capturas y enlaces desde Android. Se envían a esta Mac cuando estás en la Wi-Fi de casa.</small></div>
    {status && !status.https.running && <p className="settings-message">{status.https.error || "La conexión segura para el celular no está activa. Reinicia LUMINA."}</p>}
    {status?.appUrl && <ol className="mobile-steps">
      <li><b>Instala el certificado de casa</b> (una sola vez). En el celular, con la Wi-Fi de casa, abre en Chrome:<code>{status.certUrl}</code>Luego ve a Ajustes → Seguridad → Más ajustes de seguridad → Instalar desde el almacenamiento → <i>Certificado de CA</i>, y elige <i>lumina-casa.crt</i>.</li>
      <li><b>Abre LUMINA en Chrome:</b><code>{status.appUrl}</code>Menú ⋮ → <i>Instalar app</i> (o «Agregar a la pantalla principal»).</li>
      <li><b>Vincula</b> con el código de 6 cifras que aparece al pulsar el botón de abajo.</li>
    </ol>}
    {code && left > 0 && <div className="mobile-code"><strong>{code.code.slice(0, 3)} {code.code.slice(3)}</strong><small>Vale {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} min · escríbelo en la app del celular</small></div>}
    {error && <p className="settings-message">{error}</p>}
    <div className="settings-actions"><button className="secondary-button" onClick={() => void generate()}><Smartphone size={16} />{status?.connected ? "Vincular otro celular" : "Generar código"}</button>{status?.connected && <button className="secondary-button danger-outline" onClick={() => void revoke()}>Desvincular</button>}</div>
  </div>;
}

function MaintenanceSection() {
  const [duplicates, setDuplicates] = useState<Array<{ reason: string; items: MaintenanceItem[] }> | null>(null);
  const [broken, setBroken] = useState<MaintenanceItem[] | null>(null);
  const [busy, setBusy] = useState("");
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const findDuplicates = async () => { setBusy("dup"); try { const result = await jsonRequest<{ duplicates: Array<{ reason: string; items: MaintenanceItem[] }> }>("/api/maintenance"); setDuplicates(result.duplicates); } finally { setBusy(""); } };
  const checkLinks = async () => { setBusy("links"); try { const result = await jsonRequest<{ broken: MaintenanceItem[] }>("/api/maintenance", { method: "POST", body: JSON.stringify({ action: "check-links" }) }); setBroken(result.broken); } finally { setBusy(""); } };
  const [copies, setCopies] = useState("");
  const [retag, setRetag] = useState<{ running: boolean; total: number; done: number; changed: number; failed: number } | null>(null);
  const startRetag = async () => {
    if (!window.confirm("¿Reetiquetar toda la biblioteca con IA? Solo cambia las etiquetas que puso la IA (las tuyas se quedan). Cuesta menos de un centavo de dólar por cada 10 fuentes.")) return;
    let status = await jsonRequest<NonNullable<typeof retag>>("/api/maintenance", { method: "POST", body: JSON.stringify({ action: "retag" }) });
    setRetag(status);
    while (status.running) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = await jsonRequest<NonNullable<typeof retag>>("/api/maintenance", { method: "POST", body: JSON.stringify({ action: "retag-status" }) });
      setRetag(status);
    }
  };
  const saveCopies = async () => { setBusy("copies"); try { const result = await jsonRequest<{ saved: number; pending: number }>("/api/maintenance", { method: "POST", body: JSON.stringify({ action: "snapshots" }) }); setCopies(result.saved ? `Copias guardadas: ${result.saved}.${result.pending ? ` ${result.pending} páginas no respondieron.` : ""}` : result.pending ? `${result.pending} páginas no respondieron.` : "Todas las webs ya tenían copia."); } finally { setBusy(""); } };
  const archive = async (id: string) => { await jsonRequest(`/api/videos/${id}`, { method: "PATCH", body: JSON.stringify({ action: "archive" }) }); setArchived((current) => new Set([...current, id])); };
  const row = (item: MaintenanceItem, extra?: React.ReactNode) => <li key={item.id} className={archived.has(item.id) ? "done" : ""}>
    <a href={`/?video=${encodeURIComponent(item.id)}`}>{item.title || item.url}</a>
    <small>{item.createdAt ? new Date(item.createdAt).toLocaleDateString("es") : item.url.replace(/^https?:\/\//, "").slice(0, 48)}</small>
    {extra}
    {archived.has(item.id) ? <span>Archivado</span> : <button className="secondary-button" onClick={() => void archive(item.id)}>Archivar</button>}
  </li>;
  return <div className="settings-section lv-maintenance">
    <h3>Mantenimiento</h3>
    <div className="settings-actions">
      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void findDuplicates()}>{busy === "dup" ? "Buscando…" : "Buscar duplicados"}</button>
      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void checkLinks()}>{busy === "links" ? "Revisando enlaces… (puede tardar)" : "Revisar enlaces rotos"}</button>
      <button className="secondary-button" disabled={Boolean(busy) || Boolean(retag?.running)} onClick={() => void startRetag()}>{retag?.running ? `Reetiquetando… ${retag.done}/${retag.total}` : "Reetiquetar con IA"}</button>
      <button className="secondary-button" disabled={Boolean(busy)} onClick={() => void saveCopies()}>{busy === "copies" ? "Guardando copias…" : "Guardar copias de las webs"}</button>
    </div>
    {copies && <small>{copies}</small>}
    {retag && !retag.running && <small>Reetiquetado: {retag.total} fuentes revisadas, {retag.changed} con etiquetas nuevas{retag.failed ? `, ${retag.failed} sin respuesta de la IA` : ""}.</small>}
    {duplicates && (duplicates.length ? duplicates.map((group, index) => <div key={index} className="lv-maint-group"><strong>{group.reason}</strong><ul>{group.items.map((item) => row(item))}</ul></div>) : <small>No hay duplicados.</small>)}
    {broken && (broken.length ? <div className="lv-maint-group"><strong>Enlaces que ya no funcionan</strong><ul>{broken.map((item) => row(item, item.snapshotAt ? <a className="lv-maint-snapshot" href={`/api/snapshots/${item.id}`} target="_blank" rel="noreferrer">Ver copia guardada</a> : <em>sin copia</em>))}</ul></div> : <small>Todos los enlaces revisados responden.</small>)}
  </div>;
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setDark(document.documentElement.dataset.theme === "dark"), 0); return () => window.clearTimeout(timer); }, []);
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem("lumina-theme", next); } catch { /* sin almacenamiento */ }
    setDark(!dark);
  };
  return <button className="rail-theme rail-tooltip" onClick={toggle} aria-label={dark ? "Modo claro" : "Modo oscuro"} data-tooltip={dark ? "Modo claro" : "Modo oscuro"} data-shortcut="⇧D">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>;
}

function conversationDateLabel(updatedAt: string) {
  const value = new Date(updatedAt);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfValue = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const difference = Math.round((startOfToday.getTime() - startOfValue.getTime()) / 86_400_000);
  if (difference === 0) return "HOY";
  if (difference === 1) return "AYER";
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" }).format(value).replace(".", "").toUpperCase();
}

function ChatHistorySidebar({ conversations, activeId, onNew, onOpen, onRename, onPin, onDelete }: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest(`[data-chat-menu="${menuOpen}"]`)) setMenuOpen(null);
    };
    const closeWithEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(null); };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeWithEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeWithEscape);
    };
  }, [menuOpen]);
  const groups = conversations.reduce<Array<{ label: string; conversations: ConversationSummary[] }>>((result, conversation) => {
    const label = conversation.pinnedAt ? "FIJADOS" : conversationDateLabel(conversation.updatedAt);
    const current = result.find((group) => group.label === label);
    if (current) current.conversations.push(conversation);
    else result.push({ label, conversations: [conversation] });
    return result;
  }, []);

  return <aside className="sidebar chat-history-sidebar">
    <header><button className="new-chat-button" onClick={onNew}><Plus size={17} /> Nuevo chat</button></header>
    <div className="chat-history-list">{groups.map((group) => <section className="chat-history-group" key={group.label}>
      <h2>{group.label}</h2>
      {group.conversations.map((conversation) => <div key={conversation.id} data-chat-menu={conversation.id} className={`chat-history-item ${activeId === conversation.id ? "active" : ""} ${conversation.pinnedAt ? "pinned" : ""}`}>
        <button className="chat-history-open" onClick={() => onOpen(conversation.id)}><MessageSquare size={15} /><strong>{conversation.title}</strong></button>
        <button className="chat-history-more" onClick={() => setMenuOpen((current) => current === conversation.id ? null : conversation.id)} aria-label={`Opciones de ${conversation.title}`} aria-expanded={menuOpen === conversation.id}><MoreHorizontal size={17} /></button>
        {menuOpen === conversation.id && <div className="chat-history-menu">
          <button onClick={() => { setMenuOpen(null); const title = window.prompt("Nombre de la conversación", conversation.title); if (title?.trim()) onRename(conversation.id, title.trim()); }}><Pencil size={15} /> Rebautizar</button>
          <button onClick={() => { setMenuOpen(null); onPin(conversation.id, !conversation.pinnedAt); }}><Pin size={15} /> {conversation.pinnedAt ? "Desfijar" : "Alfiler"}</button>
          <hr />
          <button className="danger" onClick={() => { setMenuOpen(null); onDelete(conversation.id); }}><Trash2 size={15} /> Borrar</button>
        </div>}
      </div>)}
    </section>)}{!conversations.length && <div className="empty-chat-history"><MessageSquare size={25} /><strong>Aún no hay chats</strong></div>}</div>
  </aside>;
}

// Fuentes que la IA no pudo analizar (resumen de respaldo o error): se listan en un menú del riel, sin interrumpir.
function brokenSources(videos: AppVideo[]) {
  return videos.filter((video) => video.status === "failed" || (video.status === "ready" && video.summary && isProvisionalSummary(video.summary.takeaways)));
}

function AiIssuesPanel({ videos, lastError, onOpen, onRetried }: { videos: AppVideo[]; lastError: string; onOpen: (id: string) => void; onRetried: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const retry = async (list: AppVideo[]) => {
    setBusy(true);
    try { for (const video of list) await jsonRequest(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ action: "retry" }) }).catch(() => null); await onRetried(); }
    finally { setBusy(false); }
  };
  return <div className="rail-list">
    <header><strong>{videos.length === 1 ? "1 fuente sin analizar" : `${videos.length} fuentes sin analizar`}</strong><small>La IA no pudo leerlas{lastError ? `: ${lastError}` : "."}</small></header>
    <ul>{videos.map((video) => <li key={video.id}><button onClick={() => onOpen(video.id)}><span className="rail-list-thumb" style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined} /><span><strong>{video.title}</strong><small>{video.status === "failed" ? (video.error || "El análisis falló") : "Resumen provisional"}</small></span></button><button className="rail-list-retry" disabled={busy} onClick={() => void retry([video])} aria-label="Reintentar" title="Reintentar"><RefreshCw size={13} /></button></li>)}</ul>
    <button className="rail-list-main" disabled={busy} onClick={() => void retry(videos)}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} {busy ? "Reintentando…" : "Reintentar todas"}</button>
  </div>;
}

// «Tu semana»: un resumen local (sin IA, sin costo) de lo que guardaste y de lo que conviene retomar.
function WeekPanel({ videos, onOpen, onSearch }: { videos: AppVideo[]; onOpen: (id: string) => void; onSearch: (query: string) => void }) {
  const [now] = useState(() => Date.now());
  const day = 86_400_000;
  const saved = videos.filter((video) => now - new Date(video.createdAt).getTime() < 7 * day);
  const consumed = videos.filter((video) => video.consumedAt && now - new Date(video.consumedAt).getTime() < 7 * day);
  const counts = new Map<string, number>();
  saved.forEach((video) => video.tags.forEach((tag) => counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1)));
  const themes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  // Lo guardado hace un año (± 2 semanas) y lo pendiente de hace más de 2 semanas, para retomarlo.
  const yearAgo = videos.filter((video) => Math.abs(now - new Date(video.createdAt).getTime() - 365 * day) < 14 * day).slice(0, 2);
  const pending = videos.filter((video) => !video.consumedAt && now - new Date(video.createdAt).getTime() > 14 * day && video.sourceType !== "note" && video.sourceType !== "image" && video.sourceType !== "palette")
    .slice(0, 3);
  const row = (video: AppVideo, note: string) => <li key={video.id}><button onClick={() => onOpen(video.id)}><span className="rail-list-thumb" style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined} /><span><strong>{video.title}</strong><small>{note}</small></span></button></li>;
  return <div className="rail-list week-panel">
    <header><strong>Tu semana</strong><small>{saved.length === 1 ? "Guardaste 1 cosa" : `Guardaste ${saved.length} cosas`}{consumed.length ? ` y terminaste ${consumed.length}` : ""} en los últimos 7 días.</small></header>
    {themes.length > 0 && <div className="week-themes">{themes.map(([name, count]) => <button key={name} onClick={() => onSearch(`#${name.replace(/\s+/g, "-")}`)}>{name}<b>{count}</b></button>)}</div>}
    {yearAgo.length > 0 && <><h4>Hace un año</h4><ul>{yearAgo.map((video) => row(video, new Date(video.createdAt).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })))}</ul></>}
    {pending.length > 0 && <><h4>Para retomar</h4><ul>{pending.map((video) => row(video, `Guardado ${new Date(video.createdAt).toLocaleDateString("es", { day: "numeric", month: "short" })} · sin ver`))}</ul></>}
    {!saved.length && !yearAgo.length && !pending.length && <p className="rail-list-empty">Esta semana ha estado tranquila.</p>}
  </div>;
}

// «En mente»: lo que fijaste con el alfiler, como una carpeta temporal siempre a mano.
function ShelfPanel({ videos, onOpen }: { videos: AppVideo[]; onOpen: (id: string) => void }) {
  return <div className="rail-list">
    <header><strong>En mente</strong><small>Lo que fijaste con el alfiler, a mano mientras lo necesites.</small></header>
    {videos.length ? <ul>{videos.map((video) => <li key={video.id}><button onClick={() => onOpen(video.id)}><span className="rail-list-thumb" style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined} /><span><strong>{video.title}</strong><small>{video.channel || ""}</small></span></button></li>)}</ul>
      : <p className="rail-list-empty">Nada fijado todavía. Usa el alfiler de una tarjeta para tenerla aquí.</p>}
  </div>;
}

function filterByScope(videos: AppVideo[], scope: Exclude<LibraryScope, null>) {
  if (scope === "youtube") return videos.filter((video) => video.sourceType === "youtube");
  if (scope === "images") return videos.filter((video) => video.sourceType === "image");
  if (scope === "notes") return videos.filter((video) => video.sourceType === "note");
  if (scope === "pdfs") return videos.filter((video) => video.sourceType === "pdf");
  if (scope === "social") return videos.filter((video) => video.sourceType === "x" || video.sourceType === "reddit" || isSocialWebVideo(video));
  if (scope === "article") return videos.filter((video) => video.sourceType === "web" && isSubstackVideo(video));
  if (scope === "github") return videos.filter(isGithubVideo);
  if (scope === "web") return videos.filter((video) => video.sourceType === "web" && !isSubstackVideo(video) && !isSocialWebVideo(video) && !isGithubVideo(video));
  return videos;
}

function LibraryScopeNavigation({ data, libraryScope, onLibraryScope, placement = "sidebar", pool }: {
  pool?: AppVideo[];
  data: Bootstrap;
  libraryScope: LibraryScope;
  onLibraryScope: (scope: Exclude<LibraryScope, null>) => void;
  placement?: "top" | "sidebar";
}) {
  // En una carpeta, los conteos son los de la carpeta y no tienen sentido «Sin clasificar» ni «Archivados».
  const videos = pool ?? data.videos;
  const items = [
    { id: "all" as const, label: "Toda la biblioteca", icon: <Library size={15} />, count: videos.length },
    { id: "youtube" as const, label: "Videos", icon: <Play size={15} />, count: videos.filter((video) => video.sourceType === "youtube").length },
    { id: "notes" as const, label: "Notas", icon: <NotebookPen size={15} />, count: videos.filter((video) => video.sourceType === "note").length },
    { id: "pdfs" as const, label: "PDF", icon: <FileText size={15} />, count: videos.filter((video) => video.sourceType === "pdf").length },
    { id: "images" as const, label: "Imágenes", icon: <ImageIcon size={15} />, count: videos.filter((video) => video.sourceType === "image").length },
    { id: "social" as const, label: "Publicaciones", icon: <MessageSquare size={15} />, count: videos.filter((video) => video.sourceType === "x" || video.sourceType === "reddit" || isSocialWebVideo(video)).length },
    { id: "article" as const, label: "Artículos", icon: <FileText size={15} />, count: videos.filter((video) => video.sourceType === "web" && isSubstackVideo(video)).length },
    { id: "github" as const, label: "GitHub", icon: <Github size={15} />, count: videos.filter(isGithubVideo).length },
    { id: "web" as const, label: "Web", icon: <Globe2 size={15} />, count: videos.filter((video) => video.sourceType === "web" && !isSubstackVideo(video) && !isSocialWebVideo(video) && !isGithubVideo(video)).length },
    ...(pool ? [] : [{ id: "unsorted" as const, label: "Sin clasificar", icon: <Folder size={15} />, count: videos.filter((video) => !video.collections.length).length }]),
    ...(pool ? [] : [{ id: "archived" as const, label: "Archivados", icon: <Archive size={15} />, count: data.archived.length }]),
  ];
  return <nav className={`library-scope-links library-scope-${placement}`} aria-label="Categorías de la biblioteca">
    {items.filter((item) => placement !== "top" || item.count > 0 || item.id === "all" || libraryScope === item.id).map((item) => <button key={item.id} className={libraryScope === item.id ? "active" : ""} onClick={() => onLibraryScope(item.id)}>{item.icon}<strong>{item.id === "all" && placement === "top" ? "Todo" : item.label}</strong><span>{item.count}</span></button>)}
  </nav>;
}

function CanonicalTagNavigation({ data, selectedIds, open, onToggleOpen, onChange, onMigrate }: { data: Bootstrap; selectedIds: string[]; open: boolean; onToggleOpen: () => void; onChange: (ids: string[]) => void; onMigrate: () => void }) {
  const primaryTags = data.tags.filter((tag) => tag.level === "primary").sort((a, b) => a.sortOrder - b.sortOrder);
  const [expandedParents, setExpandedParents] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(window.localStorage.getItem(`lumina-expanded-tags-${data.profile.id}`) || "[]") as string[]; } catch { return []; }
  });
  const toggleSelected = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((tagId) => tagId !== id) : [...selectedIds, id]);
  const toggleParent = (id: string) => setExpandedParents((current) => {
    const next = current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id];
    window.localStorage.setItem(`lumina-expanded-tags-${data.profile.id}`, JSON.stringify(next));
    return next;
  });
  const countFor = (tag: LibraryTag) => {
    const accepted = tag.level === "primary" ? new Set([tag.id, ...data.tags.filter((child) => child.parentIds.includes(tag.id)).map((child) => child.id)]) : new Set([tag.id]);
    return data.videos.filter((video) => video.tags.some((item) => accepted.has(item.id))).length;
  };
  return <section className={`canonical-tag-navigation taxonomy-collapsible ${open ? "open" : ""}`} aria-label="Filtrar por etiquetas">
    <header><button className="taxonomy-section-toggle" onClick={onToggleOpen} aria-expanded={open}><ChevronDown size={15} /><Hash size={14} /><strong>Etiquetas</strong></button>{selectedIds.length > 0 && <button onClick={() => onChange([])}>Limpiar</button>}<button className="taxonomy-migrate" onClick={onMigrate} title="Reclasificar la biblioteca">Revisar</button></header>
    {open && <div className="canonical-tag-tree">
      {primaryTags.map((tag) => {
        const children = data.tags.filter((child) => child.level === "secondary" && child.parentIds.includes(tag.id)).sort((a, b) => a.sortOrder - b.sortOrder);
        const expanded = expandedParents.includes(tag.id);
        return <div className="canonical-tag-branch" key={tag.id}>
          <div className="canonical-tag-row"><button className="tag-disclosure" onClick={() => toggleParent(tag.id)} aria-label={expanded ? `Contraer ${tag.name}` : `Expandir ${tag.name}`}><ChevronDown size={13} className={expanded ? "" : "collapsed"} /></button><button className={selectedIds.includes(tag.id) ? "active" : ""} aria-pressed={selectedIds.includes(tag.id)} onClick={() => toggleSelected(tag.id)}><span style={{ background: tag.color }} /><strong>{tag.name}</strong><small>{countFor(tag)}</small></button></div>
          {expanded && <div className="canonical-tag-children">{children.map((child) => <button key={child.id} className={selectedIds.includes(child.id) ? "active" : ""} aria-pressed={selectedIds.includes(child.id)} onClick={() => toggleSelected(child.id)}><span /><strong>{child.name}</strong><small>{countFor(child)}</small></button>)}</div>}
        </div>;
      })}
    </div>}
    {open && selectedIds.length > 1 && <p>Coincidencia con todas las etiquetas elegidas.</p>}
  </section>;
}













export function LuminaApp({ initialSurface = "home", initialConversationId = null }: { initialSurface?: AppSurface; initialConversationId?: string | null } = {}) {
  const [phase, setPhase] = useState<"loading" | "setup" | "login" | "app">("loading");
  const [startupError, setStartupError] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [data, setData] = useState<Bootstrap | null>(null);
  const dataRef = useRef<Bootstrap | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [surface, setSurface] = useState<AppSurface>(initialSurface);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(initialConversationId);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [taxonomyMigrationOpen, setTaxonomyMigrationOpen] = useState(false);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [libraryScope, setLibraryScope] = useState<LibraryScope>("all");
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [videoChatOpen, setVideoChatOpen] = useState(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [previewSequence, setPreviewSequence] = useState<string[]>([]);
  // Todo se abre en el panel: si se llegó por un enlace directo a la antigua página completa, se redirige al panel.
  useEffect(() => {
    if (surface !== "video" || !selectedId || !data) return;
    const target = data.videos.find((video) => video.id === selectedId);
    if (!target) return;
    const timer = window.setTimeout(() => { setPreviewId(selectedId); setSelectedId(null); setSurface("home"); window.history.replaceState({}, "", "/"); }, 0);
    return () => window.clearTimeout(timer);
  }, [data, surface, selectedId]);
  const [homeSearch, setHomeSearch] = useState({ query: "", run: 0 });
  const [homeVibe, setHomeVibe] = useState<{ title: string; artwork: string; ids: string[] } | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(306);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const result = await jsonRequest<{ conversations: ConversationSummary[] }>("/api/conversations");
      setConversations(result.conversations);
      return result.conversations;
    } catch { return []; }
  }, []);

  const loadBootstrap = useCallback(async (query = "") => {
    const result = await jsonRequest<Bootstrap>(`/api/bootstrap${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    setData(result);
    setPhase("app");
    void loadConversations();
  }, [loadConversations]);

  const loadSetup = useCallback(async () => {
    const setup = await jsonRequest<{ configured: boolean; profiles: Profile[] }>("/api/setup");
    setProfiles(setup.profiles);
    if (!setup.configured) { setPhase("setup"); return; }
    try { await loadBootstrap(); } catch { setPhase("login"); }
  }, [loadBootstrap]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSetup().catch((cause) => setStartupError(cause instanceof Error ? cause.message : "No pudimos iniciar Lúmina.")), 0);
    return () => window.clearTimeout(timer);
  }, [loadSetup]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = Number(window.localStorage.getItem("lumina-sidebar-width"));
      if (Number.isFinite(saved) && saved >= 240 && saved <= 430) setSidebarWidth(saved);
      setSidebarCollapsed(window.localStorage.getItem("lumina-sidebar-collapsed") === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        setCommandOpen((current) => !current);
        return;
      }
      if (key === "\\") {
        event.preventDefault();
        setSidebarCollapsed((current) => {
          window.localStorage.setItem("lumina-sidebar-collapsed", String(!current));
          return !current;
        });
        return;
      }
      if (event.shiftKey && key === "a") {
        event.preventDefault();
        setAddOpen(true);
        return;
      }
      if (event.shiftKey || !["1", "2", "3", "4"].includes(key)) return;
      event.preventDefault();
      setActiveConversationId(null);
      setSelectedId(null);
      setActiveCollection(null);
      setActiveTag(null);
      setMobileSidebar(false);
      const destination = key === "1" ? "/" : key === "2" ? "/?view=ask" : key === "3" ? "/graph" : "/review";
      setSurface(key === "1" ? "home" : key === "2" ? "ask" : key === "3" ? "graph" : "learning");
      if (`${window.location.pathname}${window.location.search}` !== destination) window.history.pushState({}, "", destination);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);
  // Atajos de una tecla (cuando no estás escribiendo): ? ayuda, / buscar, N nota, A agregar, ⇧D modo oscuro.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key === "?") { event.preventDefault(); setHelpOpen((current) => !current); return; }
      if (document.querySelector(".lv-modal, .modal-backdrop")) return;
      if (event.key === "/") { event.preventDefault(); document.querySelector<HTMLInputElement>(".library-query input")?.focus(); return; }
      if (event.key === "n" || event.key === "N") { const note = document.querySelector<HTMLElement>(".lv-quick-note textarea, .lv-quick-note [contenteditable]"); if (note) { event.preventDefault(); note.focus(); } return; }
      if (event.key === "a" && !event.shiftKey) { event.preventDefault(); setAddOpen(true); return; }
      if (event.key === "D" && event.shiftKey) { event.preventDefault(); document.querySelector<HTMLButtonElement>(".rail-theme")?.click(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); return; }
    try { setDetail(await jsonRequest<Detail>(`/api/videos/${selectedId}`)); } catch { setDetail(null); }
  }, [selectedId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadDetail(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDetail, data]);
  useEffect(() => {
    if (!data?.videos.some((video) => video.status !== "saved" && video.status !== "ready" && video.status !== "needs_transcript" && video.status !== "failed")) return;
    const timer = window.setInterval(() => { void loadBootstrap(); }, 4000);
    return () => window.clearInterval(timer);
  }, [data, loadBootstrap]);

  useEffect(() => {
    const syncSurfaceWithLocation = () => {
      const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
      if (match) { setActiveConversationId(decodeURIComponent(match[1])); setSurface("chat"); return; }
      if (window.location.pathname === "/chat") { setActiveConversationId(null); setSurface("chat"); return; }
      if (window.location.pathname === "/graph") { setSurface("graph"); return; }
      if (window.location.pathname === "/review") { setSurface("learning"); return; }
      if (window.location.pathname === "/") {
        const params = new URLSearchParams(window.location.search);
        const videoId = params.get("video");
        const collectionId = params.get("collection");
        setActiveConversationId(null);
        setVideoChatOpen(false);
        if (videoId) {
          // Todo (videos y artículos incluidos) se abre en el panel sobre la biblioteca; ya no hay página completa.
          setPreviewId(videoId); setSelectedId(null); setActiveCollection(null); setActiveTag(null); setSurface("home"); return;
        }
        // Los enlaces antiguos a una carpeta la abren con el aspecto de carpeta inteligente.
        if (collectionId) { setActiveCollection(null); setSelectedId(null); setActiveTag(null); setLibraryScope("all"); setActiveSpaceId(collectionId); setSurface("home"); return; }
        setSelectedId(null); setActiveCollection(null); setActiveTag(null);
        const view = params.get("view");
        const spaceId = params.get("space");
        setActiveSpaceId(spaceId);
        setSurface(view === "ask" ? "ask" : view === "spaces" ? "spaces" : view === "casualidad" ? "serendipity" : "home");
      }
    };
    syncSurfaceWithLocation();
    window.addEventListener("popstate", syncSurfaceWithLocation);
    return () => window.removeEventListener("popstate", syncSurfaceWithLocation);
  }, []);

  const onSearch = useCallback((value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadBootstrap(value), 300);
  }, [loadBootstrap]);

  if (phase === "loading" && startupError) return <main className="app-loading startup-failure"><Logo /><CircleAlert size={24} /><strong>No pudimos iniciar Lúmina</strong><p>{startupError}</p><button className="primary-button" onClick={() => { setStartupError(""); void loadSetup().catch((cause) => setStartupError(cause instanceof Error ? cause.message : "No pudimos iniciar Lúmina.")); }}><RefreshCw size={16} /> Reintentar</button></main>;
  if (phase === "loading") return <main className="app-loading"><Logo /><LoaderCircle className="spin" size={24} /></main>;
  if (phase === "setup") return <SetupScreen onReady={() => void loadSetup()} />;
  if (phase === "login") return <LoginScreen profiles={profiles} onLogin={async (profileId, pin) => { await jsonRequest("/api/auth/login", { method: "POST", body: JSON.stringify({ profileId, pin }) }); await loadBootstrap(); }} />;
  if (!data) return null;

  // Todo se abre en el panel (como mymind): resumen, minuto a minuto, quiz y lector fantasma viven ahí.
  const openVideo = (id: string) => { setPreviewId(id); };
  const openLibrarySource = (id: string) => {
    setPreviewId(id);
  };
  // Las carpetas se abren con el aspecto de los espacios inteligentes.
  const openCollection = (id: string) => { openSpace(id); };
  const openConversation = (id: string) => {
    setActiveConversationId(id); setSurface("chat"); setActiveCollection(null); setActiveTag(null); setSelectedId(null); setVideoChatOpen(false); setMobileSidebar(false);
    const path = `/chat/${encodeURIComponent(id)}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  };
  const newChat = (selection?: ChatSourceSelection) => {
    setActiveConversationId(null); setSurface("chat"); setSelectedId(null); setVideoChatOpen(false); setMobileSidebar(false);
    if (selection) window.sessionStorage.setItem("lumina-new-chat-selection", JSON.stringify(selection));
    else window.sessionStorage.removeItem("lumina-new-chat-selection");
    if (window.location.pathname !== "/chat") window.history.pushState({}, "", "/chat");
  };
  const askSource = (id: string) => { setPreviewId(null); newChat({ collectionIds: [], tagIds: [], videoIds: [id], excludedVideoIds: [] }); };
  const leaveTo = (next: AppSurface, path: string) => { setHomeVibe(null); setSurface(next); setActiveSpaceId(null); setActiveConversationId(null); setSelectedId(null); setVideoChatOpen(false); setActiveCollection(null); setActiveTag(null); setMobileSidebar(false); if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, "", path); };
  const goSpaces = () => leaveTo("spaces", "/?view=spaces");
  const goSerendipity = () => leaveTo("serendipity", "/?view=casualidad");
  const openSpace = (id: string) => { leaveTo("home", `/?space=${encodeURIComponent(id)}`); setActiveSpaceId(id); setLibraryScope("all"); setActiveTagIds([]); };
  const deleteSpace = async (id: string) => { if (!window.confirm("¿Eliminar esta carpeta? Tus fuentes no se borran.")) return; await jsonRequest(`/api/spaces/${id}`, { method: "DELETE" }); await loadBootstrap(); if (activeSpaceId === id) goHome(); };
  const openVibe = async (video: AppVideo) => {
    const { similar } = await jsonRequest<{ similar: Array<{ id: string }> }>(`/api/videos/${video.id}/similar`);
    leaveTo("home", "/"); setPreviewId(null); setLibraryScope("all"); setActiveTagIds([]);
    setHomeVibe({ title: video.title, artwork: video.sourceItems[0]?.previewUrl || video.thumbnailUrl, ids: [video.id, ...similar.map((item) => item.id)] });
    setHomeSearch((current) => ({ query: "", run: current.run + 1 }));
  };
  const searchLibrary = (query: string) => { setHomeVibe(null); leaveTo("home", "/"); setPreviewId(null); setLibraryScope("all"); setActiveTagIds([]); setHomeSearch((current) => ({ query, run: current.run + 1 })); };
  const goHome = () => { setHomeVibe(null); setHomeSearch((current) => current.query ? { query: "", run: current.run + 1 } : current); setActiveSpaceId(null); setSurface("home"); setActiveConversationId(null); setSelectedId(null); setVideoChatOpen(false); setActiveCollection(null); setActiveTag(null); setActiveTagIds([]); setLibraryScope("all"); setMobileSidebar(false); if (`${window.location.pathname}${window.location.search}` !== "/") window.history.pushState({}, "", "/"); };
  const goGraph = () => { setSurface("graph"); setActiveConversationId(null); setSelectedId(null); setVideoChatOpen(false); setActiveCollection(null); setActiveTag(null); setMobileSidebar(false); if (window.location.pathname !== "/graph") window.history.pushState({}, "", "/graph"); };
  const goLearning = () => { setSurface("learning"); setActiveConversationId(null); setSelectedId(null); setVideoChatOpen(false); setActiveCollection(null); setActiveTag(null); setMobileSidebar(false); if (window.location.pathname !== "/review") window.history.pushState({}, "", "/review"); };
  const logout = async () => { await jsonRequest("/api/auth/logout", { method: "POST" }); setData(null); setConversations([]); setSurface("home"); setSelectedId(null); await loadSetup(); };
  let newChatSelection: ChatSourceSelection | undefined;
  if (typeof window !== "undefined" && surface === "chat" && !activeConversationId) {
    try { newChatSelection = JSON.parse(window.sessionStorage.getItem("lumina-new-chat-selection") || "null") || undefined; } catch { newChatSelection = undefined; }
  }
  const selectedCollection = activeCollection ? data.collections.find((collection) => collection.id === activeCollection) : null;
  const activeCollectionIds = new Set<string>();
  if (activeCollection) {
    activeCollectionIds.add(activeCollection);
    let changed = true;
    while (changed) { changed = false; data.collections.forEach((collection) => { if (collection.parentId && activeCollectionIds.has(collection.parentId) && !activeCollectionIds.has(collection.id)) { activeCollectionIds.add(collection.id); changed = true; } }); }
  }
  const collectionVideos = activeCollection ? data.videos.filter((video) => video.collections.some((collection) => activeCollectionIds.has(collection.id))) : [];
  const activeSpace = activeSpaceId ? data.spaces.find((space) => space.id === activeSpaceId) ?? null : null;
  const scopedLibraryVideos = activeTag
    ? data.videos.filter((video) => video.tags.some((tag) => tag.id === activeTag))
    : libraryScope === "archived" ? data.archived
    : libraryScope === "unsorted" ? data.videos.filter((video) => !video.collections.length)
      : libraryScope === "youtube" ? data.videos.filter((video) => video.sourceType === "youtube")
      : libraryScope === "images" ? data.videos.filter((video) => video.sourceType === "image")
      : libraryScope === "notes" ? data.videos.filter((video) => video.sourceType === "note")
      : libraryScope === "pdfs" ? data.videos.filter((video) => video.sourceType === "pdf")
        : libraryScope === "social" ? data.videos.filter((video) => video.sourceType === "x" || video.sourceType === "reddit" || isSocialWebVideo(video))
          : libraryScope === "article" ? data.videos.filter((video) => video.sourceType === "web" && isSubstackVideo(video))
            : libraryScope === "github" ? data.videos.filter(isGithubVideo)
              : libraryScope === "web" ? data.videos.filter((video) => video.sourceType === "web" && !isSubstackVideo(video) && !isSocialWebVideo(video) && !isGithubVideo(video))
              : data.videos;
  const folderVideos = activeSpace ? spaceVideos(activeSpace, data.videos, data.tags) : [];
  const folderScopedVideos = activeSpace && libraryScope && libraryScope !== "all" && libraryScope !== "archived" && libraryScope !== "unsorted" ? filterByScope(folderVideos, libraryScope) : folderVideos;
  const visibleLibraryVideos = activeTagIds.length
    ? scopedLibraryVideos.filter((video) => activeTagIds.every((tagId) => {
      const acceptedIds = new Set([tagId, ...data.tags.filter((tag) => tag.parentIds.includes(tagId)).map((tag) => tag.id)]);
      return video.tags.some((tag) => acceptedIds.has(tag.id));
    }))
    : scopedLibraryVideos;
  const railOnly = surface !== "chat";
  const toggleSidebar = () => setSidebarCollapsed((current) => {
    window.localStorage.setItem("lumina-sidebar-collapsed", String(!current));
    return !current;
  });
  const beginSidebarResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    let latest = sidebarWidth;
    const move = (pointerEvent: PointerEvent) => {
      latest = Math.max(240, Math.min(430, pointerEvent.clientX - 60));
      setSidebarWidth(latest);
    };
    const finish = () => {
      window.localStorage.setItem("lumina-sidebar-width", String(latest));
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  };
  // Dentro de una carpeta, los tipos (Videos, Publicaciones…) filtran la carpeta en vez de sacarte de ella.
  const chooseLibraryScope = (scope: Exclude<LibraryScope, null>) => {
    if (activeSpaceId && scope !== "archived" && scope !== "unsorted") { setLibraryScope(scope); return; }
    setHomeVibe(null); setActiveSpaceId(null); setLibraryScope(scope); setActiveCollection(null); setActiveTag(null); setSurface("home"); setSelectedId(null); setMobileSidebar(false);
    if (window.location.pathname !== "/" || window.location.search) window.history.pushState({}, "", "/");
  };
  return (
    <div className={`app-shell ${surface === "chat" ? "unified-chat-open" : ""} ${surface === "video" && videoChatOpen ? "video-chat-open" : ""} ${railOnly ? "rail-only" : ""} ${sidebarCollapsed && !railOnly ? "sidebar-collapsed" : ""}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}>
      <button className="mobile-menu" onClick={() => setMobileSidebar(true)} aria-label="Abrir biblioteca"><Menu size={20} /></button>
      <div className={mobileSidebar ? "mobile-sidebar-wrap open" : "mobile-sidebar-wrap"} onMouseDown={(event) => event.target === event.currentTarget && setMobileSidebar(false)}>
        <div className="navigation-shell">
          <AppRail data={data} surface={surface} sidebarCollapsed={sidebarCollapsed} onAdd={() => setAddOpen(true)} onHome={goHome} onChat={() => newChat()} onGraph={goGraph} onLearning={goLearning} onSpaces={goSpaces} onSerendipity={goSerendipity} onToggleSidebar={toggleSidebar} onSettings={() => setSettingsOpen(true)} onLogout={() => void logout()} panels={[{ key: "week", label: "Tu semana", icon: <CalendarDays size={19} />, render: (close) => <WeekPanel videos={data.videos} onOpen={(id) => { close(); setPreviewId(id); }} onSearch={(query) => { close(); searchLibrary(query); }} /> }, { key: "shelf", label: "En mente", icon: <Pin size={19} />, render: (close) => <ShelfPanel videos={data.videos.filter((video) => video.topPosition !== null && video.topPosition !== undefined).sort((a, b) => (a.topPosition ?? 0) - (b.topPosition ?? 0))} onOpen={(id) => { close(); setPreviewId(id); }} /> }, ...(brokenSources(data.videos).length ? [{ key: "issues", label: "Fuentes sin analizar", tone: "alert" as const, badge: brokenSources(data.videos).length, icon: <CircleAlert size={19} />, render: (close: () => void) => <AiIssuesPanel videos={brokenSources(data.videos)} lastError={data.aiLastError || ""} onOpen={(id) => { close(); setPreviewId(id); }} onRetried={async () => { await loadBootstrap(); }} /> }] : [])]} tagsActive={activeTagIds.length > 0} tagPanel={(close) => <CanonicalTagNavigation data={data} selectedIds={activeTagIds} open onToggleOpen={close} onChange={(ids) => { setActiveTagIds(ids); setLibraryScope("all"); setSurface("home"); setSelectedId(null); setActiveCollection(null); setActiveSpaceId(null); }} onMigrate={() => { close(); setTaxonomyMigrationOpen(true); }} />} />
          {!sidebarCollapsed && (surface === "chat" ? <ChatHistorySidebar conversations={conversations} activeId={activeConversationId} onNew={() => newChat()} onOpen={openConversation} onRename={async (id, title) => { await jsonRequest(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }); await loadConversations(); }} onPin={async (id, pinned) => { await jsonRequest(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ pinned }) }); await loadConversations(); }} onDelete={async (id) => { if (!window.confirm("¿Eliminar esta conversación? Las fuentes se conservarán.")) return; await jsonRequest(`/api/conversations/${id}`, { method: "DELETE" }); const remaining = await loadConversations(); if (id === activeConversationId) { if (remaining[0]) openConversation(remaining[0].id); else newChat(); } }} /> : null)}
          {!railOnly && !sidebarCollapsed && <button className="sidebar-resizer" onPointerDown={beginSidebarResize} aria-label="Cambiar ancho del panel izquierdo" title="Arrastra para cambiar el ancho" />}
        </div>
      </div>
      {(surface === "home" || surface === "ask") && <KnowledgeHome key={`home-${surface}-${libraryScope}-${activeSpace?.id || ""}-${homeSearch.run}`} initialQuery={homeSearch.query} onSearchQuery={searchLibrary} spaces={data.spaces} activeSpace={activeSpace} onOpenSpace={openSpace} onDeleteSpace={(id) => void deleteSpace(id)} onSpaceCreated={(space) => void loadBootstrap().then(() => openSpace(space.id))} onClearSpace={goHome} scopeActive={libraryScope !== "all" && libraryScope !== null} onPreview={(id, sequence) => { setPreviewId(id); setPreviewSequence(sequence ?? []); }} onAskSource={askSource} profileId={data.profile.id} videos={homeVibe ? data.videos.filter((video) => homeVibe.ids.includes(video.id)) : activeSpace ? folderScopedVideos : visibleLibraryVideos} shelf={libraryScope === "all" && !activeTagIds.length ? data.videos.filter((video) => video.topPosition !== null && video.topPosition !== undefined).sort((a, b) => (a.topPosition ?? 0) - (b.topPosition ?? 0)) : []} vibe={homeVibe} onVibe={(video) => void openVibe(video)} onClearVibe={goHome} collections={data.collections} tags={data.tags} models={data.models} libraryNavigation={<LibraryScopeNavigation data={data} libraryScope={libraryScope} onLibraryScope={chooseLibraryScope} placement="top" pool={activeSpace ? folderVideos : undefined} />} initialTagId={activeTag} initialMode={surface === "ask" ? "ask" : "overview"} onModeChange={(mode) => { setSurface(mode === "ask" ? "ask" : "home"); const path = mode === "ask" ? "/?view=ask" : "/"; if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState({}, "", path); }} onAdd={() => setAddOpen(true)} onOpenVideo={openVideo} onOpenConversation={openConversation} onConversationChanged={() => void loadConversations()} onRefresh={async () => { await loadBootstrap(); }} />}
      {surface === "graph" && <GraphWorkspace collections={data.collections} tags={data.tags} onOpenVideo={openLibrarySource} />}
      {surface === "learning" && <DailyReview videos={data.videos} catalog={data.tags} collections={data.collections} spaces={data.spaces} onChanged={async () => { await loadBootstrap(); }} onOpenVideo={openVideo} />}
      {surface === "spaces" && <SpacesWorkspace spaces={data.spaces} videos={data.videos} tags={data.tags} onOpenSpace={openSpace} onChanged={async () => { await loadBootstrap(); }} />}
      {surface === "serendipity" && <SerendipityWorkspace videos={data.videos} catalog={data.tags} collections={data.collections} spaces={data.spaces} onSearch={searchLibrary} onVibe={(video) => void openVibe(video)} onChanged={async () => { await loadBootstrap(); }} onExit={goHome} onAsk={askSource} />}
      {previewId && <DetailModal key={previewId} videoId={previewId} sequence={previewSequence} catalog={data.tags} collections={data.collections} spaces={data.spaces} onSearch={searchLibrary} onVibe={(video) => void openVibe(video)} onClose={() => setPreviewId(null)} onChanged={async () => { await loadBootstrap(); }} onAsk={askSource} />}
      {surface === "chat" && <UnifiedChatWorkspace key={activeConversationId || "new-chat"} conversationId={activeConversationId} videos={data.videos} collections={data.collections} tags={data.tags} models={data.models} initialSelection={newChatSelection} onOpenConversation={openConversation} onConversationChanged={() => void loadConversations()} />}
      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}
      {addOpen && <AddVideoModal tags={data.tags} onClose={() => setAddOpen(false)} onAdded={async (id) => { setAddOpen(false); openVideo(id); await loadBootstrap(); }} />}
      {settingsOpen && <SettingsModal bootstrap={data} onClose={() => setSettingsOpen(false)} onSaved={() => void loadBootstrap()} />}
      {commandOpen && <CommandPalette data={data} onClose={() => setCommandOpen(false)} onOpenSource={openLibrarySource} onOpenCollection={openCollection} onOpenTag={(id) => { setActiveTagIds([id]); setLibraryScope("all"); setActiveCollection(null); setSelectedId(null); setSurface("home"); }} onAdd={() => setAddOpen(true)} onHome={goHome} onAsk={() => newChat()} onSettings={() => setSettingsOpen(true)} />}
      {taxonomyMigrationOpen && <BulkTaggingModal videoIds={data.videos.map((video) => video.id)} videos={data.videos} tags={data.tags} models={data.models} replaceExisting onClose={() => setTaxonomyMigrationOpen(false)} onDone={async () => { await loadBootstrap(); }} />}
    </div>
  );
}
