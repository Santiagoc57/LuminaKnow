"use client";

import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  CircleAlert,
  Download,
  Folder,
  Github,
  Globe2,
  Grid2X2,
  ImagePlus,
  HelpCircle,
  ExternalLink,
  FolderInput,
  Languages,
  Layers,
  Link2,
  LayoutGrid,
  Lock,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Save,
  SlidersHorizontal,
  Tag,
  Trash2,
  Unlock,
  X,
  WandSparkles,
  Sparkles,
  Mic,
  Square,
} from "lucide-react";
import type { AppVideo, AvailableModel, ChatScopeType, ChatSourceSelection, GraphEdgeData, GraphNodeData, LibraryCollection, LibraryTag, SmartSpace } from "@/lib/types";
import { formatTimestamp, titleCaseTag } from "@/lib/utils";
import { matchesLibraryQuery, parseLibraryQuery } from "@/lib/library-query";
import { quotedText } from "@/lib/note-text";
import { KnowledgeGraphCanvas } from "./KnowledgeGraphCanvas";
import { UnifiedChatWorkspace } from "./UnifiedChat";
import { MosaicGrid, ReaderSplit, SaveSpaceModal, ShelfRow, sourceArtwork, useDictation, type BoardSaver } from "./DiscoverViews";

type Collection = LibraryCollection;
type TagItem = LibraryTag;
type HomeView = "mosaic" | "reader" | "cards";

function previewWords(value: string, limit = 200) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  return { text: words.slice(0, limit).join(" "), truncated: words.length > limit };
}

type VisualPlatform = "youtube" | "x" | "reddit" | "tiktok" | "instagram" | "facebook" | "linkedin" | "web";

function visualPlatform(video: AppVideo): VisualPlatform {
  if (video.sourceType === "youtube" || video.sourceType === "x" || video.sourceType === "reddit") return video.sourceType;
  try {
    const hostname = new URL(video.url).hostname.toLocaleLowerCase();
    if (hostname.includes("tiktok.com")) return "tiktok";
    if (hostname.includes("instagram.com")) return "instagram";
    if (hostname.includes("facebook.com") || hostname.includes("fb.watch")) return "facebook";
    if (hostname.includes("linkedin.com")) return "linkedin";
  } catch { /* Conservamos el estado web genérico como respaldo. */ }
  return "web";
}

function platformMark(platform: VisualPlatform) {
  return platform === "x" ? "𝕏" : platform === "reddit" ? "r/" : platform === "tiktok" ? "♪" : platform === "instagram" ? "◎" : platform === "facebook" ? "f" : platform === "linkedin" ? "in" : platform === "web" ? "Aa" : "▶";
}

function LazyCardArtwork({ src, alt = "", className = "" }: { src: string; alt?: string; className?: string }) {
  return <img className={`visual-card-artwork ${className}`} src={src} alt={alt} loading="lazy" decoding="async" fetchPriority="low" referrerPolicy="no-referrer" />;
}

function cleanSocialText(value: string) {
  return value
    .replace(/https?:\/\/(?:pic\.)?twitter\.com\/\S+/giu, "")
    .replace(/\bpic\.twitter\.com\/\S+/giu, "")
    .replace(/https?:\/\/t\.co\/\S+/giu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function spanishSummaryPreview(video: AppVideo) {
  const translated = cleanSocialText(video.summary?.sourceTranslation || "");
  const candidate = cleanSocialText(translated || video.summary?.gist || video.description || "");
  if (!candidate) return video.status === "saved"
    ? "Este enlace está guardado como favorito y todavía no se ha analizado con IA."
    : "Lúmina está preparando el resumen de esta fuente.";
  const normalized = ` ${candidate.toLocaleLowerCase()} `;
  const englishSignals = [" the ", " and ", " with ", " from ", " website ", " explore ", " purpose ", " structure ", " typography ", " similarity "].filter((word) => normalized.includes(word)).length;
  const spanishSignals = [" el ", " la ", " los ", " las ", " para ", " con ", " desde ", " sobre ", " sitio ", " página ", " propósito "].filter((word) => normalized.includes(word)).length;
  if (englishSignals > Math.max(2, spanishSignals + 1)) return `Referencia web guardada sobre “${video.title}”. Abre la fuente para consultar el contenido completo.`;
  return candidate;
}

function cardSummaryPreview(video: AppVideo) {
  const generated = cleanSocialText(video.summary?.cardSummary || "");
  if (generated) return previewWords(generated, 34).text;

  const candidates = [
    cleanSocialText(video.summary?.gist || ""),
    ...(video.summary?.sections ?? []).flatMap((section) => section.points.map((point) => cleanSocialText(point.text))),
  ].filter(Boolean);
  const unique = candidates.filter((candidate, index) => candidates.findIndex((other) => other.toLocaleLowerCase("es") === candidate.toLocaleLowerCase("es")) === index);
  const combined = unique.join(" ").trim();
  return previewWords(combined || spanishSummaryPreview(video), 34).text;
}

function cleanWebsiteName(rawName: string, hostname: string) {
  const domainLabel = hostname.split(".")[0] || "Página web";
  const candidate = (rawName.split("·").map((part) => part.trim()).filter(Boolean).at(-1) || domainLabel)
    .replace(/^admin@/i, "")
    .replace(/^@/, "")
    .replace(/\.(?:com|co|io|ai|org|net)$/i, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-záéíóúñ])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return candidate.replace(/^Ai\b/i, "AI") || "Página web";
}

function isSubstackSource(video: AppVideo) {
  return video.sourceItems.some((item) => item.metadata?.sourceKind === "substack") || video.transcriptSource.startsWith("substack");
}

function isGithubSource(video: AppVideo) {
  if (video.sourceType !== "web") return false;
  try {
    const hostname = new URL(video.url).hostname.toLocaleLowerCase();
    return hostname === "github.com" || hostname.endsWith(".github.com");
  } catch { return false; }
}

function AdaptiveTagList({ tags, className, onExpand, onTagClick, onAdd, showAllWhenFits = false }: {
  tags: AppVideo["tags"];
  className: string;
  onExpand?: () => void;
  onTagClick?: (tagId: string) => void;
  onAdd?: () => void;
  showAllWhenFits?: boolean;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const maximumVisible = Math.min(showAllWhenFits ? tags.length : 3, tags.length);
  const hasAdd = Boolean(onAdd);
  const [visibleCount, setVisibleCount] = useState(maximumVisible);
  const [showHidden, setShowHidden] = useState(false);
  // El desplegable de «+N» se dibuja fuera de la tarjeta para que no lo recorte.
  const [popoverAt, setPopoverAt] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showHidden) return;
    const close = (event: Event) => { if (!popoverRef.current?.contains(event.target as Node)) setShowHidden(false); };
    const closeNow = () => setShowHidden(false);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", closeNow, true);
    window.addEventListener("resize", closeNow);
    return () => { document.removeEventListener("pointerdown", close, true); window.removeEventListener("scroll", closeNow, true); window.removeEventListener("resize", closeNow); };
  }, [showHidden]);
  const tagKey = tags.map((tag) => `${tag.id}:${tag.name}`).join("|");

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const available = container.getBoundingClientRect().width || container.parentElement?.getBoundingClientRect().width || 0;
      const chips = [...container.querySelectorAll<HTMLElement>("[data-measure-tag]")];
      const overflow = container.querySelector<HTMLElement>("[data-measure-overflow]");
      const add = container.querySelector<HTMLElement>("[data-measure-add]");
      let fitting = 0;
      for (let count = maximumVisible; count >= 0; count -= 1) {
        const hasHidden = tags.length > count;
        const chipWidth = chips.slice(0, count).reduce((total, chip) => total + chip.getBoundingClientRect().width, 0);
        const itemCount = count + (hasHidden ? 1 : 0) + (hasAdd ? 1 : 0);
        const required = chipWidth + Math.max(0, itemCount - 1) * 5 + (hasHidden ? overflow?.getBoundingClientRect().width || 36 : 0) + (hasAdd ? add?.getBoundingClientRect().width || 22 : 0);
        if (required <= available + 1) {
          fitting = count;
          break;
        }
      }
      setVisibleCount(fitting);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasAdd, maximumVisible, tagKey, tags]);

  if (!tags.length && !onAdd) return null;
  const hiddenTags = tags.slice(visibleCount);
  // Todas las etiquetas con el mismo estilo: gris, redondo y del mismo tamaño en todas las vistas.
  const tagChip = (tag: AppVideo["tags"][number]) => onTagClick
    ? <button key={tag.id} type="button" className="adaptive-clickable-tag" onClick={(event) => { event.stopPropagation(); onTagClick(tag.id); }} aria-label={`Filtrar por ${tag.name}`}>{titleCaseTag(tag.name)}</button>
    : <i key={tag.id}>{titleCaseTag(tag.name)}</i>;
  return <span ref={containerRef} className={`${className} adaptive-tag-list`}>
    {tags.slice(0, visibleCount).map(tagChip)}
    {hiddenTags.length > 0 && <button type="button" className="tag-overflow-button" onClick={(event) => { event.stopPropagation(); onExpand?.(); const rect = event.currentTarget.getBoundingClientRect(); setPopoverAt({ top: rect.bottom + 6, left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)) }); setShowHidden((current) => !current); }} aria-expanded={showHidden} aria-label={`Mostrar ${hiddenTags.length} etiquetas más`}>+{hiddenTags.length}</button>}
    {onAdd && <button type="button" className="tag-add-button" onClick={(event) => { event.stopPropagation(); onExpand?.(); onAdd(); }} aria-label="Añadir etiqueta"><Plus size={12} strokeWidth={2.4} /></button>}
    {showHidden && popoverAt && createPortal(<span ref={popoverRef} className="tag-overflow-popover tag-overflow-floating adaptive-tag-list" style={{ top: popoverAt.top, left: popoverAt.left }} onClick={(event) => event.stopPropagation()}>{hiddenTags.map(tagChip)}</span>, document.body)}
    <span className="adaptive-tag-measure" aria-hidden="true">{tags.slice(0, maximumVisible).map((tag) => <i data-measure-tag key={`measure-${tag.id}`}>{titleCaseTag(tag.name)}</i>)}<button data-measure-overflow className="tag-overflow-button" type="button">+{tags.length}</button>{onAdd && <button data-measure-add className="tag-add-button" type="button"><Plus size={12} /></button>}</span>
  </span>;
}

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "No se pudo completar la operación.");
  return body as T;
}

type TagSuggestion = { videoId: string; tags: Array<{ tagId: string; level: "primary" | "secondary"; confidence: number }> };

export function BulkTaggingModal({ videoIds, videos, tags, models, replaceExisting = false, onClose, onDone }: { videoIds: string[]; videos: AppVideo[]; tags: TagItem[]; models: AvailableModel[]; replaceExisting?: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [interests, setInterests] = useState("");
  const [modelId, setModelId] = useState(models[0]?.id || "auto");
  const [jobId, setJobId] = useState("");
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [estimatedUnits, setEstimatedUnits] = useState(0);
  const [status, setStatus] = useState<"setup" | "preview" | "running" | "complete">("setup");
  const [processed, setProcessed] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sourceById = new Map(videos.map((video) => [video.id, video]));

  async function createPreview() {
    setLoading(true); setError("");
    try {
      const result = await readJson<{ id: string; suggestions: TagSuggestion[]; estimatedUnits: number }>("/api/tagging-jobs/preview", { method: "POST", body: JSON.stringify({ videoIds, interests, modelId, replaceExisting }) });
      setJobId(result.id); setSuggestions(result.suggestions); setEstimatedUnits(result.estimatedUnits); setStatus("preview");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo generar la muestra."); }
    finally { setLoading(false); }
  }

  function updateTag(videoId: string, index: number, tagId: string) {
    setSuggestions((current) => current.map((source) => source.videoId === videoId ? { ...source, tags: source.tags.map((tag, tagIndex) => tagIndex === index ? { ...tag, tagId } : tag) } : source));
  }

  async function apply() {
    setLoading(true); setError("");
    try {
      await readJson("/api/tagging-jobs", { method: "POST", body: JSON.stringify({ previewJobId: jobId, approved: suggestions }) });
      setStatus("running");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo iniciar el etiquetado."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (status !== "running" || !jobId) return;
    const timer = window.setInterval(async () => {
      try {
        const job = await readJson<{ status: string; processedCount: number; error: string }>(`/api/tagging-jobs/${jobId}`);
        setProcessed(job.processedCount || 0);
        if (job.status === "complete") { window.clearInterval(timer); setStatus("complete"); await onDone(); }
        if (job.status === "failed") { window.clearInterval(timer); setError(job.error || "El lote no pudo completarse."); setStatus("preview"); }
      } catch { /* El siguiente intervalo volverá a consultar. */ }
    }, 1_200);
    return () => window.clearInterval(timer);
  }, [jobId, onDone, status]);

  async function undo() {
    await readJson(`/api/tagging-jobs/${jobId}/undo`, { method: "POST" });
    await onDone(); onClose();
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal-card bulk-tag-modal">
    <button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
    <p className="eyebrow">Organización con IA</p><h2>{replaceExisting ? "Migrar" : "Etiquetar"} {videoIds.length} fuentes</h2>
    {status === "setup" && <><p>{replaceExisting ? "Lúmina reclasificará todas las fuentes con el catálogo cerrado. Revisarás cada propuesta antes de reemplazar las etiquetas actuales." : "Lúmina propondrá etiquetas del catálogo cerrado para una muestra revisable."}</p><label>Prioridades opcionales<textarea value={interests} onChange={(event) => setInterests(event.target.value)} placeholder="Ej.: prioriza diseño, política y herramientas de IA…" /></label><label>Modelo<select value={modelId} onChange={(event) => setModelId(event.target.value as "auto" | "gemini" | "openai")}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label><button className="primary-button wide" onClick={() => void createPreview()} disabled={loading || models.length <= 1}>{loading ? <LoaderCircle className="spin" size={17} /> : <WandSparkles size={17} />} Generar vista previa</button>{models.length <= 1 && <p className="form-error">Configura Gemini u OpenAI para usar esta función.</p>}</>}
    {status === "preview" && <><div className="bulk-tag-estimate"><span>{replaceExisting ? "Migración completa revisable" : "Muestra revisable"}</span><span>≈ {estimatedUnits.toLocaleString("es-CO")} unidades de entrada</span></div><div className="bulk-tag-review">{suggestions.map((source) => { const video = sourceById.get(source.videoId); return <article key={source.videoId}><strong>{video?.title || "Fuente"}</strong>{replaceExisting && <p className="previous-tags"><span>Antes</span>{video?.tags.length ? video.tags.map((tag) => <i key={tag.id}>{tag.name}</i>) : <small>Sin etiquetas</small>}</p>}<div>{source.tags.map((tag, index) => <label key={`${source.videoId}-${index}`} className={`tag-suggestion ${tag.level}`}><select value={tag.tagId} onChange={(event) => updateTag(source.videoId, index, event.target.value)}>{tags.filter((option) => option.level === tag.level && !source.tags.some((selected, selectedIndex) => selectedIndex !== index && selected.tagId === option.catalogKey)).map((option) => <option key={option.id} value={option.catalogKey}>{option.name}</option>)}</select><small>{tag.level === "primary" ? "Principal" : "Subetiqueta"}</small></label>)}</div></article>; })}</div><button className="primary-button wide" onClick={() => void apply()} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Aprobar y {replaceExisting ? "migrar" : "aplicar"}</button></>}
    {status === "running" && <div className="bulk-tag-progress"><LoaderCircle className="spin" size={24} /><strong>Organizando la biblioteca…</strong><span>{processed} de {videoIds.length} fuentes</span></div>}
    {status === "complete" && <div className="bulk-tag-progress complete"><Check size={24} /><strong>{replaceExisting ? "Migración aplicada" : "Etiquetas aplicadas"}</strong><span>{replaceExisting ? "La instantánea anterior quedó guardada y puede restaurarse exactamente." : "Puedes deshacer las etiquetas añadidas por este lote."}</span><div><button className="secondary-button" onClick={() => void undo()}>Deshacer lote</button><button className="primary-button" onClick={onClose}>Listo</button></div></div>}
    {error && <p className="form-error"><CircleAlert size={15} />{error}</p>}
  </section></div>;
}

export function ScopedChatWorkspace({
  scopeType,
  scopeId,
  videos,
  models,
  initialVideoIds,
  collections = [],
  tags = [],
  onOpenConversation,
  onConversationChanged,
  compact = false,
  starter = false,
}: {
  scopeType: ChatScopeType;
  scopeId: string;
  videos: AppVideo[];
  models: AvailableModel[];
  initialVideoIds: string[];
  collections?: Collection[];
  tags?: TagItem[];
  onOpenConversation: (id: string) => void;
  onConversationChanged: () => void;
  compact?: boolean;
  starter?: boolean;
}) {
  const initialSelection: ChatSourceSelection = scopeType === "collection"
    ? { collectionIds: [scopeId], tagIds: [], videoIds: [], excludedVideoIds: videos.filter((video) => video.status === "ready" && video.collections.some((item) => item.id === scopeId) && !initialVideoIds.includes(video.id)).map((video) => video.id) }
    : scopeType === "tag"
      ? { collectionIds: [], tagIds: [scopeId], videoIds: [], excludedVideoIds: videos.filter((video) => video.status === "ready" && video.tags.some((item) => item.id === scopeId) && !initialVideoIds.includes(video.id)).map((video) => video.id) }
      : { collectionIds: [], tagIds: [], videoIds: initialVideoIds, excludedVideoIds: [] };
  return <UnifiedChatWorkspace videos={videos} collections={collections} tags={tags} models={models} initialSelection={initialSelection} onOpenConversation={onOpenConversation} onConversationChanged={onConversationChanged} compact={compact} starter={starter} />;
}

function HomeVideoCard({ video, collections, tags, onOpen, onChanged, onTagFilter, selected, onToggleSelection }: {
  video: AppVideo;
  collections: Collection[];
  tags: TagItem[];
  onOpen: () => void;
  onChanged: () => Promise<void>;
  onTagFilter?: (tagId: string) => void;
  selected: boolean;
  onToggleSelection: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [quickTagOpen, setQuickTagOpen] = useState(false);
  const [quickTagQuery, setQuickTagQuery] = useState("");
  const hoverTimer = useRef<number | null>(null);
  const isX = video.sourceType === "x";
  const isReddit = video.sourceType === "reddit";
  const isWeb = video.sourceType === "web";
  const isBookmark = isX || isReddit || isWeb;
  const platform = visualPlatform(video);
  const isSubstack = isWeb && isSubstackSource(video);
  const isGenericWeb = isWeb && !isSubstack && platform === "web";
  const firstSourceItem = video.sourceItems[0];
  const channelParts = video.channel.split("·").map((part) => part.trim()).filter(Boolean);
  const rawAuthorName = firstSourceItem?.authorName || channelParts.find((part) => isReddit ? part.startsWith("u/") : !part.startsWith("@")) || (isReddit ? "Publicación de Reddit" : isWeb ? new URL(video.url).hostname.replace(/^www\./, "") : "Publicación de X");
  const sourceAuthorName = isX ? rawAuthorName.split("·")[0].trim() : rawAuthorName;
  const rawHandle = firstSourceItem?.authorHandle || channelParts.find((part) => isReddit ? part.startsWith("u/") : part.startsWith("@")) || "";
  const normalizedHandle = rawHandle ? isReddit ? (rawHandle.startsWith("u/") ? rawHandle : `u/${rawHandle}`) : (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`) : "";
  const sourceAuthorHandle = sourceAuthorName.replace(/^[@]|^u\//, "").toLocaleLowerCase() === normalizedHandle.replace(/^[@]|^u\//, "").toLocaleLowerCase() ? "" : normalizedHandle;
  const originalXText = cleanSocialText(video.sourceItems.slice(0, 3).map((item) => item.text.trim()).filter(Boolean).join("\n\n") || video.description || video.title);
  const socialText = cleanSocialText(video.summary?.sourceTranslation || (isWeb ? video.description || originalXText : originalXText));
  const socialPreview = previewWords(socialText);
  const xDate = firstSourceItem?.publishedAt || video.sourcePublishedAt || video.createdAt;
  const organization = video.collections[0]?.name || "Sin clasificar";
  const capturedDate = new Date(video.createdAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" });
  const avatarInitials = sourceAuthorName.replace(/^u\//, "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase() || (isReddit ? "R" : "X");
  const avatarTone = [...(sourceAuthorHandle || sourceAuthorName)].reduce((total, character) => total + character.charCodeAt(0), 0) % 5;
  const avatarUrl = firstSourceItem?.metadata?.avatarUrl || "";
  const summaryPreview = spanishSummaryPreview(video);
  const visualCardSummary = cardSummaryPreview(video);
  const articleReadMinutes = Math.max(1, Math.ceil(video.sourceItems.reduce((total, item) => total + item.text.trim().split(/\s+/).filter(Boolean).length, 0) / 220));
  const webHostname = (() => { try { return new URL(video.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const articleSiteName = cleanWebsiteName(firstSourceItem?.metadata?.siteName || channelParts.at(-1) || "", webHostname);
  const hasWebArtwork = Boolean(firstSourceItem?.previewUrl || video.thumbnailUrl);
  const visualArtwork = firstSourceItem?.previewUrl || video.thumbnailUrl || "/visual-cards/web-card.jpg";
  const normalizedQuickTagQuery = quickTagQuery.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim();
  const quickTagMatches = tags.filter((tag) => tag.active !== false && !video.tags.some((selectedTag) => selectedTag.id === tag.id) && (!normalizedQuickTagQuery || tag.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().includes(normalizedQuickTagQuery))).slice(0, 7);

  function clearPreviewTimer() {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }

  function startPreviewTimer() {
    if (menuOpen) return;
    clearPreviewTimer();
    hoverTimer.current = window.setTimeout(() => setPreviewOpen(true), 2200);
  }

  useEffect(() => () => clearPreviewTimer(), []);

  async function rename() {
    const title = window.prompt("Nuevo título de la fuente", video.title)?.trim();
    if (!title || title === video.title) return;
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      await onChanged();
      setMenuOpen(false);
    } finally { setBusy(false); }
  }

  async function moveTo(collectionId: string) {
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}/collections`, { method: "PUT", body: JSON.stringify({ collectionIds: collectionId ? [collectionId] : [] }) });
      await onChanged();
      setMenuOpen(false);
      setMoveOpen(false);
    } finally { setBusy(false); }
  }

  async function toggleTag(tagId: string) {
    const selected = video.tags.some((tag) => tag.id === tagId);
    const tagIds = selected ? video.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) : [...video.tags.map((tag) => tag.id), tagId];
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds }) });
      await onChanged();
    } finally { setBusy(false); }
  }

  async function addQuickTag(tagId: string) {
    await toggleTag(tagId);
    setQuickTagOpen(false);
    setQuickTagQuery("");
  }

  async function clearTags() {
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}/tags`, { method: "PUT", body: JSON.stringify({ tagIds: [] }) });
      await onChanged();
    } finally { setBusy(false); }
  }

  async function analyze() {
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ action: video.status === "saved" ? "retry" : "regenerate_metadata" }) });
      await onChanged();
      setMenuOpen(false);
    } finally { setBusy(false); }
  }

  function openMoveMenu(event: React.MouseEvent) {
    event.stopPropagation();
    clearPreviewTimer();
    setPreviewOpen(false);
    setMenuOpen(true);
    setMoveOpen(true);
    setTagsOpen(false);
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar “${video.title}”? Se borrarán su análisis, notas y conexiones locales.`)) return;
    setBusy(true);
    try {
      await readJson(`/api/videos/${video.id}`, { method: "DELETE" });
      await onChanged();
    } finally { setBusy(false); }
  }

  return <article draggable className={`home-video-card ${isBookmark ? "x-bookmark-card social-bookmark-card" : ""} ${isReddit ? "reddit-bookmark-card reddit-visual-card" : ""} ${isWeb ? "web-bookmark-card" : ""} ${isSubstack ? "substack-visual-card" : ""} ${isGenericWeb ? "web-page-card web-visual-card" : ""} ${menuOpen ? "menu-open" : ""} ${selected ? "selected" : ""}`} onDragStart={(event) => { event.dataTransfer.effectAllowed = "copyMove"; event.dataTransfer.setData("application/x-lumina-source", video.id); event.dataTransfer.setData("text/plain", video.id); }} onMouseEnter={startPreviewTimer} onMouseLeave={() => { clearPreviewTimer(); setPreviewOpen(false); if (!busy) { setMenuOpen(false); setMoveOpen(false); setTagsOpen(false); setQuickTagOpen(false); setQuickTagQuery(""); } }}>
    <button className="home-video-select" onClick={(event) => { event.stopPropagation(); onToggleSelection(); }} aria-label={selected ? `Quitar ${video.title} de la selección` : `Seleccionar ${video.title}`} aria-pressed={selected}>{selected ? <CheckSquare size={16} /> : <span />}</button>
    {isSubstack ? <div className="home-video-card-main substack-visual-main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <LazyCardArtwork src="/visual-cards/substack-card.webp" />
      <span className="substack-visual-shade" />
      <span className="substack-visual-badge"><img src="/substack.svg" alt="" />Substack</span>
      <span className="substack-visual-copy">
        <small>{sourceAuthorName} · {articleReadMinutes} min de lectura</small>
        <strong>{video.title}</strong>
        <p>{visualCardSummary}</p>
      </span>
      <AdaptiveTagList tags={video.tags} className="social-card-tags substack-visual-tags" onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} />
      <span className="substack-visual-footer"><button className="card-organization-button" type="button" onClick={openMoveMenu}><Folder size={13} />{organization}</button><span><CalendarDays size={13} />{capturedDate}</span></span>
    </div> : isReddit ? <div className="home-video-card-main reddit-visual-main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <LazyCardArtwork src="/visual-cards/reddit-card.webp" />
      <span className="reddit-visual-shade" />
      <span className="reddit-visual-badge"><b>r/</b>Reddit</span>
      <span className="reddit-visual-copy">
        <small>{sourceAuthorName}</small>
        <strong>{video.title}</strong>
        <p>{visualCardSummary || socialPreview.text}</p>
      </span>
      <AdaptiveTagList tags={video.tags} className="social-card-tags reddit-visual-tags" onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} />
      <span className="reddit-visual-footer"><button className="card-organization-button" type="button" onClick={openMoveMenu}><Folder size={13} />{organization}</button><span><CalendarDays size={13} />{capturedDate}</span></span>
    </div> : isWeb && !isGenericWeb ? <div className="home-video-card-main web-article-main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <span className={`web-article-cover poster-tone-${avatarTone}`} role="img" aria-label={`Portada de ${video.title}`}><strong>{video.title}</strong></span>
      <span className="web-article-body">
        <span className="web-article-author"><span className={`x-bookmark-avatar tone-${avatarTone}`}>{avatarInitials}</span><span><strong>{sourceAuthorName}</strong><small>{articleReadMinutes} min de lectura</small></span></span>
        <span className="web-article-summary">{video.summary?.gist || socialPreview.text}</span>
        <AdaptiveTagList tags={video.tags} className="social-card-tags web-article-tags" onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} />
        <span className="web-article-meta"><button className="card-organization-button" type="button" onClick={openMoveMenu}><Folder size={14} />{organization}</button><span className="web-article-source" title={isSubstack ? "Substack" : articleSiteName} aria-label={isSubstack ? "Substack" : articleSiteName}>{isSubstack ? <img src="/substack.svg" alt="" /> : <Globe2 size={14} />}</span><span><CalendarDays size={14} />{capturedDate}</span></span>
      </span>
    </div> : isGenericWeb ? <div className={`home-video-card-main web-visual-main ${hasWebArtwork ? "has-web-artwork" : "uses-default-artwork"}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <span className="web-visual-media">
        <LazyCardArtwork src={hasWebArtwork ? visualArtwork : "/visual-cards/web-card.webp"} alt={hasWebArtwork ? `Vista previa de ${video.title}` : ""} />
        <span className="web-visual-shade" />
      </span>
      <span className="web-visual-copy">
        <strong>{video.title}</strong>
      </span>
      <span className="web-visual-footer"><AdaptiveTagList tags={video.tags} className="social-card-tags web-visual-tags web-visual-footer-tags" showAllWhenFits onTagClick={onTagFilter} onAdd={() => { setQuickTagOpen((current) => !current); setQuickTagQuery(""); }} onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} /><span><CalendarDays size={13} />{capturedDate}</span></span>
      {quickTagOpen && <span className="web-quick-tag-picker" onClick={(event) => event.stopPropagation()}>
        <label><Search size={13} /><input autoFocus value={quickTagQuery} onChange={(event) => setQuickTagQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setQuickTagOpen(false); setQuickTagQuery(""); } }} placeholder="Buscar etiqueta…" /></label>
        <span className="web-quick-tag-results">{quickTagMatches.map((tag) => { const selectedAtLevel = video.tags.filter((item) => item.level === tag.level).length; const atLimit = selectedAtLevel >= (tag.level === "primary" ? 3 : 2); return <button key={tag.id} type="button" disabled={busy || atLimit} onClick={() => void addQuickTag(tag.id)}><span className="tag-dot" style={{ backgroundColor: tag.color }} />{tag.name}{atLimit && <small>Límite</small>}</button>; })}{!quickTagMatches.length && <small>No hay coincidencias.</small>}</span>
      </span>}
    </div> : isBookmark ? <div className="home-video-card-main x-bookmark-main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <span className="x-bookmark-author"><span className={`x-bookmark-avatar tone-${avatarTone}`}>{avatarUrl && !avatarFailed ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setAvatarFailed(true)} /> : avatarInitials}</span><span><strong>{sourceAuthorName}</strong>{sourceAuthorHandle && <small>{sourceAuthorHandle}</small>}</span></span>
      <strong className="x-bookmark-title">{video.title}</strong>
      <span className="x-bookmark-text">{expanded || !socialPreview.truncated ? socialText : `${socialPreview.text}…`}</span>
      {socialPreview.truncated && <button className="social-read-more" onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current); }}>{expanded ? "Ver menos" : "Ver más"}</button>}
      {(firstSourceItem?.previewUrl || video.thumbnailUrl) ? <span className="x-bookmark-media" role="img" aria-label={`Vista previa de ${video.title}`}><LazyCardArtwork src={firstSourceItem?.previewUrl || video.thumbnailUrl} alt="" /></span> : <span className={`x-bookmark-media source-placeholder source-placeholder-${platform}`} role="img" aria-label={`Publicación de ${platformMark(platform)}`}><strong>{platformMark(platform)}</strong></span>}
      {video.sourceItems.length > 1 && <span className="x-bookmark-thread">{isReddit ? `${video.sourceItems.length - 1} comentarios guardados` : `Hilo de ${video.sourceItems.length} publicaciones`}</span>}
      <AdaptiveTagList tags={video.tags} className="social-card-tags" onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} />
      <span className="x-bookmark-meta"><button className="card-organization-button" type="button" onClick={openMoveMenu}><Folder size={14} />{organization}</button><span aria-label={isReddit ? "Reddit" : isX ? "X" : articleSiteName}><b className={isReddit ? "reddit-source-mark" : ""}>{platformMark(platform)}</b></span><span><CalendarDays size={14} />{new Date(xDate).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}</span></span>
    </div> : <div className="home-video-card-main" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpen(); }}>
      <span className={`home-card-thumb ${video.thumbnailUrl ? "" : `source-placeholder source-placeholder-${platform}`}`}>{video.thumbnailUrl ? <><LazyCardArtwork src={video.thumbnailUrl} alt="" />{video.sourceType === "youtube" && <Play size={16} fill="currentColor" />}</> : platform === "youtube" ? <img src="/youtube.svg" alt="" /> : <strong>{platformMark(platform)}</strong>}</span>
      <span className="home-card-copy"><strong>{video.title}</strong><small>{video.channel || (video.status === "saved" ? "Enlace guardado" : "Procesando…")}</small><AdaptiveTagList tags={video.tags} className="home-card-tags" onExpand={() => { clearPreviewTimer(); setPreviewOpen(false); }} /><span className="home-card-meta"><button className="card-organization-button" type="button" onClick={openMoveMenu}><Folder size={14} />{organization}</button>{video.sourceType === "youtube" && <span aria-label="YouTube"><img className="source-platform-logo" src="/youtube.svg" alt="" /></span>}<span><CalendarDays size={14} />{capturedDate}</span></span></span>
    </div>}
    <button className="home-video-more" onClick={() => { clearPreviewTimer(); setPreviewOpen(false); setMenuOpen((current) => !current); setMoveOpen(false); setTagsOpen(false); }} aria-label={`Opciones de ${video.title}`} aria-expanded={menuOpen}><MoreHorizontal size={17} /></button>
    {previewOpen && !menuOpen && <aside className="home-video-preview"><strong>Resumen</strong><p>{summaryPreview}</p></aside>}
    {menuOpen && <div className="home-video-menu">
      {moveOpen ? <><header><button onClick={() => setMoveOpen(false)}>‹</button><strong>Mover a colección</strong></header><button onClick={() => void moveTo("")} disabled={busy}><Folder size={15} /> Sin colección</button>{collections.map((collection) => <button key={collection.id} onClick={() => void moveTo(collection.id)} disabled={busy} className={video.collections.length === 1 && video.collections[0].id === collection.id ? "current" : ""}><Folder size={15} style={{ color: collection.color }} />{collection.name}{video.collections.length === 1 && video.collections[0].id === collection.id && <Check size={13} />}</button>)}{!collections.length && <p>Aún no hay colecciones.</p>}</> : tagsOpen ? <><header><button onClick={() => setTagsOpen(false)}>‹</button><strong>Etiquetas</strong></header>{tags.map((tag) => { const selected = video.tags.some((item) => item.id === tag.id); const selectedAtLevel = video.tags.filter((item) => item.level === tag.level).length; const atLimit = !selected && selectedAtLevel >= (tag.level === "primary" ? 3 : 2); return <button key={tag.id} onClick={() => void toggleTag(tag.id)} disabled={busy || atLimit} className={selected ? "current" : ""}><span className="tag-dot" style={{ background: tag.color }} />{tag.name}{selected && <Check size={13} />}</button>; })}{video.tags.length > 0 && <button onClick={() => void clearTags()} disabled={busy}><X size={15} /> Quitar todas</button>}{!tags.length && <p>Aún no hay etiquetas creadas.</p>}</> : <>
        <button onClick={onOpen}><ArrowUpRight size={15} /> Abrir en Lúmina</button>
        {!video.url.startsWith("local://") && <a href={video.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> {isBookmark ? "Abrir URL" : "Abrir en YouTube"}</a>}
        <button onClick={() => void rename()} disabled={busy}><Pencil size={15} /> Renombrar</button>
        <button onClick={() => setMoveOpen(true)} disabled={busy}><FolderInput size={15} /> Mover a colección</button>
        <button onClick={() => setTagsOpen(true)} disabled={busy}><Tag size={15} /> Añadir etiquetas</button>
        {!video.url.startsWith("local://") && <button onClick={() => void analyze()} disabled={busy}><RefreshCw size={15} /> {video.status === "saved" ? "Analizar con IA" : "Regenerar título y etiquetas"}</button>}
        {isBookmark && video.status === "ready" && !video.summary?.sourceTranslation && <button onClick={() => void analyze()} disabled={busy}><Languages size={15} /> Traducir al español</button>}
        <hr />
        <button className="danger" onClick={() => void remove()} disabled={busy}><Trash2 size={15} /> Eliminar</button>
      </>}
    </div>}
  </article>;
}

const SEARCH_COLORS = [["rojo", "#e2483d"], ["naranja", "#f08a2c"], ["amarillo", "#f2c94c"], ["verde", "#4caf6a"], ["azul", "#3d7fd9"], ["morado", "#8a5cd1"], ["rosa", "#ee7fb0"], ["marron", "#8b5a3c"], ["negro", "#1f1f1f"], ["gris", "#9a9a9a"], ["blanco", "#ffffff"]] as const;

// Panel visual bajo el buscador: tipo y color con un clic, sin tener que recordar «tipo:» o «color:».
// Lo que se reconoce en el buscador se muestra como píldora: tipo, color, #etiqueta u otro filtro.
const PILL_LABELS: Record<string, string> = { video: "Videos", x: "Tweets", reddit: "Reddit", web: "Web", articulo: "Artículos", imagen: "Imágenes", captura: "Capturas", nota: "Notas", cita: "Citas", producto: "Productos", pelicula: "Películas", pdf: "PDF", paleta: "Paletas" };
function queryPills(query: string) {
  const pills: Array<{ token: string; label: string; swatch?: string }> = [];
  const rest: string[] = [];
  const words = query.split(/(\s+)/);
  const trailingSpace = /\s$/.test(query);
  words.forEach((word, index) => {
    if (!word.trim()) return;
    const last = index === words.length - 1 && !trailingSpace;
    const match = word.match(/^([a-zñáéíóú]+):(\S+)$/i);
    if (!last && match) {
      const key = match[1].toLocaleLowerCase("es");
      const value = match[2].toLocaleLowerCase("es");
      const swatch = key === "color" ? SEARCH_COLORS.find(([name]) => name === value)?.[1] : undefined;
      pills.push({ token: word, label: key === "tipo" ? PILL_LABELS[value] || value : key === "estado" ? ({ pendiente: "Por ver", visto: "Vistas", leido: "Leídos" } as Record<string, string>)[value] || value : key === "color" ? value.charAt(0).toUpperCase() + value.slice(1) : `${key}: ${match[2]}`, swatch });
    } else if (!last && word.startsWith("#") && word.length > 1) pills.push({ token: word, label: word });
    else rest.push(word);
  });
  return { pills, text: rest.join(" ") + (trailingSpace && rest.length ? " " : "") };
}

const FOLDER_COLORS = ["#e75e3a", "#e0912f", "#8aa63a", "#3f9d6c", "#2f9c9c", "#3d86c6", "#5a6fd1", "#8560c9", "#c056a8", "#d9537a"];


// Tableros al estilo Pinterest: portada de collage (una grande y dos pequeñas), nombre, cantidad y última vez.
function BoardsGrid({ boards, collections, videos, onOpen }: { boards: Collection[]; collections: Collection[]; videos: AppVideo[]; onOpen: (id: string) => void }) {
  const descendants = (id: string): Set<string> => {
    const ids = new Set([id]);
    let grew = true;
    while (grew) { grew = false; collections.forEach((item) => { if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); grew = true; } }); }
    return ids;
  };
  const [now] = useState(() => Date.now());
  const ago = (value: string) => {
    const days = Math.floor((now - new Date(value).getTime()) / 86_400_000);
    return !Number.isFinite(days) ? "" : days < 1 ? "hoy" : days < 30 ? `${days} d` : days < 365 ? `${Math.floor(days / 30)} m` : `${Math.floor(days / 365)} a`;
  };
  const cards = [{ id: "", name: "Todo", items: videos }, ...boards.map((board) => { const ids = descendants(board.id); return { id: board.id, name: board.name, items: videos.filter((video) => video.collections.some((item) => ids.has(item.id))) }; })];
  return <div className="lv-boards">{cards.map((card) => {
    const sorted = [...card.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const art = sorted.map((video) => sourceArtwork(video)).filter(Boolean).slice(0, 3);
    return <button key={card.id || "all"} className="lv-board" onClick={() => onOpen(card.id)}>
      <span className="lv-board-cover">{[0, 1, 2].map((index) => <span key={index}>{art[index] && <img src={art[index]} alt="" loading="lazy" referrerPolicy="no-referrer" />}</span>)}</span>
      <strong>{card.name}</strong>
      <small>{card.items.length} {card.items.length === 1 ? "elemento" : "elementos"}{sorted[0] ? ` · ${ago(sorted[0].createdAt)}` : ""}</small>
    </button>;
  })}</div>;
}

export function KnowledgeHome({ onClearSpace, scopeActive, profileId, videos, collections, tags, models, libraryNavigation, initialTagId, initialMode = "overview", spaces = [], activeSpace = null, shelf = [], initialQuery = "", vibe = null, onVibe, onClearVibe, onSearchQuery, onOpenSpace, onDeleteSpace, onSpaceCreated, onPreview, onAskSource, onModeChange, onAdd, onOpenVideo, onOpenConversation, onConversationChanged, onRefresh }: {
  profileId: string;
  videos: AppVideo[];
  collections: Collection[];
  tags: TagItem[];
  models: AvailableModel[];
  libraryNavigation?: React.ReactNode;
  initialTagId?: string | null;
  initialMode?: "overview" | "ask";
  spaces?: SmartSpace[];
  activeSpace?: SmartSpace | null;
  shelf?: AppVideo[];
  initialQuery?: string;
  vibe?: { title: string; artwork: string; ids: string[] } | null;
  onVibe?: (video: AppVideo) => void;
  onClearVibe?: () => void;
  onSearchQuery?: (query: string) => void;
  onOpenSpace?: (id: string) => void;
  onDeleteSpace?: (id: string) => void;
  onSpaceCreated?: (space: SmartSpace) => void;
  onClearSpace?: () => void;
  scopeActive?: boolean;
  onPreview?: (id: string, sequence?: string[]) => void;
  onAskSource?: (id: string) => void;
  onModeChange?: (mode: "overview" | "ask") => void;
  onAdd: () => void;
  onOpenVideo: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onConversationChanged: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"overview" | "ask">(initialMode);
  const [view, setView] = useState<HomeView>("mosaic");
  const [savingSpace, setSavingSpace] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderMenuId, setFolderMenuId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const editFolder = async (folder: SmartSpace, field: "name" | "query") => {
    const value = window.prompt(field === "name" ? "Nuevo nombre de la carpeta" : "Regla de la carpeta (por ejemplo #Política tipo:video). Déjala vacía para que sea una carpeta normal.", field === "name" ? folder.name : folder.query);
    if (value === null) return;
    try { await readJson(`/api/spaces/${folder.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value.trim() }) }); await onRefresh(); }
    catch (cause) { window.alert(cause instanceof Error ? cause.message : "No se pudo cambiar la carpeta."); }
  };
  const [dropping, setDropping] = useState(false);
  const [upload, setUpload] = useState<{ text: string; error: boolean } | null>(null);
  const [dateBasis, setDateBasis] = useState<"saved" | "published">("saved");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month" | "year">("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "youtube" | "x" | "reddit" | "github" | "web" | "image" | "note" | "pdf">("all");
  const [tagFilter, setTagFilter] = useState(initialTagId || "");
  const [collectionFilter, setCollectionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [contentFilter, setContentFilter] = useState<"all" | "notes" | "summary">("all");
  const [threadFilter, setThreadFilter] = useState<"all" | "thread" | "single">("all");
  const [sort, setSort] = useState<"recent" | "oldest" | "title" | "author">("recent");
  const [query, setQuery] = useState(initialQuery);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [articlesCollapsed, setArticlesCollapsed] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [bulkTagId, setBulkTagId] = useState("");
  const [bulkSpaceId, setBulkSpaceId] = useState("");
  const [taggingOpen, setTaggingOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [cardSize, setCardSize] = useState<"l" | "m" | "s">("m");
  const [searchPanel, setSearchPanel] = useState(false);
  // Por defecto, bajo el buscador salen las carpetas; los tipos (Videos, Web…) solo al pulsar el buscador o si hay uno activo.
  const searchActive = searchPanel || Boolean(query.trim()) || Boolean(scopeActive);
  const [addMenu, setAddMenu] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [saveBoardId, setSaveBoardId] = useState("");
  const [pagination, setPagination] = useState({ key: "", count: 30 });
  const loadSentinelRef = useRef<HTMLDivElement>(null);
  const deferredQuery = useDeferredValue(query);
  const parsedDeferredQuery = useMemo(() => parseLibraryQuery(deferredQuery), [deferredQuery]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedView = window.localStorage.getItem(`lumina-home-view-${profileId}`);
      const savedSize = window.localStorage.getItem(`lumina-card-size-${profileId}`);
      setSaveBoardId(window.localStorage.getItem(`lumina-save-board-${profileId}`) || "");
      if (savedSize === "l" || savedSize === "m" || savedSize === "s") setCardSize(savedSize);
      if (savedView === "cards" || savedView === "reader" || savedView === "mosaic") setView(savedView);
      else if (savedView === "list") { setView("reader"); window.localStorage.setItem(`lumina-home-view-${profileId}`, "reader"); }
      else if (savedView === "visual") window.localStorage.setItem(`lumina-home-view-${profileId}`, "cards");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [profileId]);
  const changeMode = (next: "overview" | "ask") => { setMode(next); onModeChange?.(next); };
  // Al escribir «#» se sugieren etiquetas, las más usadas primero (como en mymind).
  const tagFrequency = useMemo(() => {
    const counts = new Map<string, { name: string; count: number; level: string }>();
    videos.forEach((video) => video.tags.forEach((tag) => { const entry = counts.get(tag.id) ?? { name: tag.name, count: 0, level: tag.level }; entry.count += 1; counts.set(tag.id, entry); }));
    tags.forEach((tag) => { if (!counts.has(tag.id)) counts.set(tag.id, { name: tag.name, count: 0, level: tag.level }); });
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));
  }, [videos, tags]);
  const hashFragment = (queryPills(query).text.match(/(?:^|\s)#([^\s#]*)$/) || [])[1];
  const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const tagSuggestions = hashFragment === undefined ? [] : tagFrequency
    .filter((tag) => !hashFragment || fold(tag.name).replace(/\s+/g, "-").includes(fold(hashFragment)))
    .sort((a, b) => Number(Boolean(hashFragment) && !fold(a.name).startsWith(fold(hashFragment))) - Number(Boolean(hashFragment) && !fold(b.name).startsWith(fold(hashFragment))))
    .slice(0, 8);
  // Como mymind: al escribir (con o sin «#») aparecen como bolitas las etiquetas que empiezan así.
  const wordFragment = hashFragment ?? (queryPills(query).text.match(/(?:^|\s)([^\s#:]+)$/) || [])[1];
  const tagChips = !wordFragment ? [] : tagFrequency
    .filter((tag) => fold(tag.name).replace(/\s+/g, "-").includes(fold(wordFragment)))
    .sort((a, b) => Number(!fold(a.name).startsWith(fold(wordFragment))) - Number(!fold(b.name).startsWith(fold(wordFragment))))
    .slice(0, 10);
  const [tagCursor, setTagCursor] = useState(0);
  const dictation = useDictation((text) => { setQuery((current) => `${current.trim()} ${text}`.trim()); changeMode("overview"); });
  const chooseTag = (name: string) => {
    const parts = queryPills(query);
    const text = parts.text.replace(/#?[^\s#]*$/, `#${name.trim().replace(/\s+/g, "-")} `);
    setQuery([...parts.pills.map((pill) => pill.token), text].join(" ").replace(/^\s+/, ""));
    setTagCursor(0);
    changeMode("overview");
  };
  const topBoards = useMemo(() => collections.filter((item) => !item.parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "es")), [collections]);
  const boardSaver: BoardSaver = {
    boards: [...collections].sort((a, b) => a.name.localeCompare(b.name, "es")),
    boardId: saveBoardId,
    onPickBoard: (id) => { setSaveBoardId(id); window.localStorage.setItem(`lumina-save-board-${profileId}`, id); },
    onSave: async (video, boardId) => {
      const response = await fetch(`/api/videos/${video.id}/collections`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collectionIds: [...new Set([...video.collections.map((item) => item.id), boardId])] }) });
      if (!response.ok) throw new Error("No se pudo guardar en la carpeta.");
      await onRefresh();
    },
  };
  const changeCardSize = (next: "l" | "m" | "s") => { setCardSize(next); window.localStorage.setItem(`lumina-card-size-${profileId}`, next); };
  const changeView = (next: HomeView) => { setView(next); window.localStorage.setItem(`lumina-home-view-${profileId}`, next); };
  const startToday = useMemo(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(); }, []);
  const collectionIds = useMemo(() => {
    if (!collectionFilter) return null;
    const ids = new Set<string>([collectionFilter]);
    let changed = true;
    while (changed) { changed = false; collections.forEach((collection) => { if (collection.parentId && ids.has(collection.parentId) && !ids.has(collection.id)) { ids.add(collection.id); changed = true; } }); }
    return ids;
  }, [collectionFilter, collections]);
  const [pdfHits, setPdfHits] = useState<{ query: string; ids: string[] }>({ query: "", ids: [] });
  const pdfSearchText = parsedDeferredQuery.text;
  useEffect(() => {
    if (!pdfSearchText) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/pdfs?q=${encodeURIComponent(pdfSearchText)}`, { signal: controller.signal }).then((response) => response.ok ? response.json() : { ids: [] }).then((payload: { ids: string[] }) => setPdfHits({ query: pdfSearchText, ids: payload.ids })).catch(() => undefined);
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pdfSearchText]);
  const pdfTextMatches = useMemo(() => new Set(pdfHits.query === pdfSearchText ? pdfHits.ids : []), [pdfHits, pdfSearchText]);
  // Búsqueda híbrida: además de las palabras exactas, lo que se parece en significado (con una pausa para no gastar).
  const [semanticHits, setSemanticHits] = useState<{ query: string; scores: Map<string, number> }>({ query: "", scores: new Map() });
  useEffect(() => {
    if (pdfSearchText.trim().length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/search/semantic?q=${encodeURIComponent(pdfSearchText)}`, { signal: controller.signal }).then((response) => response.ok ? response.json() : { hits: [] }).then((payload: { hits: Array<{ id: string; score: number }> }) => setSemanticHits({ query: pdfSearchText, scores: new Map(payload.hits.map((hit) => [hit.id, hit.score])) })).catch(() => undefined);
    }, 650);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [pdfSearchText]);
  const semanticMatches = useMemo(() => semanticHits.query === pdfSearchText ? semanticHits.scores : new Map<string, number>(), [semanticHits, pdfSearchText]);
  const vibeOrder = useMemo(() => vibe ? new Map(vibe.ids.map((id, index) => [id, index])) : null, [vibe]);
  const filteredVideos = useMemo(() => videos.filter((video) => {
    if (deferredQuery.trim() && !matchesLibraryQuery(video, parsedDeferredQuery, tags) && !((pdfTextMatches.has(video.id) || semanticMatches.has(video.id)) && matchesLibraryQuery(video, { ...parsedDeferredQuery, text: "" }, tags))) return false;
    if (sourceFilter === "github" && !isGithubSource(video)) return false;
    if (sourceFilter === "web" && (video.sourceType !== "web" || isGithubSource(video))) return false;
    if (!['all', 'github', 'web'].includes(sourceFilter) && video.sourceType !== sourceFilter) return false;
    if (tagFilter) {
      const acceptedTagIds = new Set([tagFilter, ...tags.filter((tag) => tag.parentIds.includes(tagFilter)).map((tag) => tag.id)]);
      if (!video.tags.some((tag) => acceptedTagIds.has(tag.id))) return false;
    }
    if (collectionIds && !video.collections.some((collection) => collectionIds.has(collection.id))) return false;
    if (statusFilter && video.status !== statusFilter) return false;
    if (authorFilter && video.channel !== authorFilter) return false;
    if (contentFilter === "notes" && !video.note?.content.trim()) return false;
    if (contentFilter === "summary" && !video.summary) return false;
    if (threadFilter !== "all" && video.sourceType !== "x" && video.sourceType !== "reddit") return false;
    if (threadFilter === "thread" && video.sourceItems.length <= 1) return false;
    if (threadFilter === "single" && video.sourceItems.length > 1) return false;
    const created = new Date(dateBasis === "published" ? video.sourcePublishedAt || video.createdAt : video.createdAt).getTime();
    if (dateFilter === "today" && created < startToday) return false;
    if (dateFilter === "week" && created < startToday - 6 * 86_400_000) return false;
    if (dateFilter === "month" && created < startToday - 29 * 86_400_000) return false;
    if (dateFilter === "year" && created < new Date(new Date(startToday).getFullYear(), 0, 1).getTime()) return false;
    return true;
  }).sort((a, b) => {
    // Primero lo que coincide en palabras; después, lo relacionado por significado, del más al menos parecido.
    if (parsedDeferredQuery.text && semanticMatches.size) {
      const exactA = matchesLibraryQuery(a, parsedDeferredQuery, tags) ? 1 : 0;
      const exactB = matchesLibraryQuery(b, parsedDeferredQuery, tags) ? 1 : 0;
      if (exactA !== exactB) return exactB - exactA;
      if (!exactA) return (semanticMatches.get(b.id) ?? 0) - (semanticMatches.get(a.id) ?? 0);
    }
    return vibeOrder ? (vibeOrder.get(a.id) ?? 0) - (vibeOrder.get(b.id) ?? 0) : sort === "oldest" ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() : sort === "title" ? a.title.localeCompare(b.title, "es") : sort === "author" ? a.channel.localeCompare(b.channel, "es") : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }), [authorFilter, collectionIds, contentFilter, dateBasis, dateFilter, deferredQuery, parsedDeferredQuery, pdfTextMatches, semanticMatches, sort, sourceFilter, startToday, statusFilter, tagFilter, tags, threadFilter, vibeOrder, videos]);
  const semanticOnly = useMemo(() => parsedDeferredQuery.text && semanticMatches.size ? filteredVideos.filter((video) => semanticMatches.has(video.id) && !matchesLibraryQuery(video, parsedDeferredQuery, tags)).length : 0, [filteredVideos, parsedDeferredQuery, semanticMatches, tags]);
  const authors = useMemo(() => [...new Set(videos.map((video) => video.channel).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es")), [videos]);
  const selection = useMemo(() => new Set(selectedIds), [selectedIds]);
  const renderFilterKey = [dateBasis, dateFilter, sourceFilter, tagFilter, collectionFilter, statusFilter, authorFilter, contentFilter, threadFilter, sort, deferredQuery, view].join("|");
  const visibleCount = pagination.key === renderFilterKey ? pagination.count : 30;
  useEffect(() => {
    const target = loadSentinelRef.current;
    if (!target || visibleCount >= filteredVideos.length) return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setPagination((current) => ({ key: renderFilterKey, count: Math.min((current.key === renderFilterKey ? current.count : 30) + 30, filteredVideos.length) })); }, { rootMargin: "500px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredVideos.length, renderFilterKey, visibleCount]);
  const activeFilterCount = [dateFilter !== "all", dateBasis !== "saved", sourceFilter !== "all", Boolean(tagFilter), Boolean(collectionFilter), Boolean(statusFilter), Boolean(authorFilter), contentFilter !== "all", threadFilter !== "all", sort !== "recent"].filter(Boolean).length;
  const clearFilters = () => { setDateBasis("saved"); setDateFilter("all"); setSourceFilter("all"); setTagFilter(""); setCollectionFilter(""); setStatusFilter(""); setAuthorFilter(""); setContentFilter("all"); setThreadFilter("all"); setSort("recent"); };
  const searchedDate = parsedDeferredQuery.dateRange;
  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(searchedDate ? [{ key: "searched-date", label: `Guardado: ${searchedDate.phrase}`, clear: () => setQuery((current) => current.replace(searchedDate.phrase, "").replace(/\s+/g, " ").trim()) }] : []),
    ...(dateBasis === "published" ? [{ key: "date-basis", label: "Fecha publicada", clear: () => setDateBasis("saved") }] : []),
    ...(dateFilter !== "all" ? [{ key: "date", label: ({ today: "Hoy", week: "Últimos 7 días", month: "Últimos 30 días", year: "Este año" } as Record<string, string>)[dateFilter] || "Fecha", clear: () => setDateFilter("all") }] : []),
    ...(sourceFilter !== "all" ? [{ key: "source", label: sourceFilter === "x" ? "X" : sourceFilter === "reddit" ? "Reddit" : sourceFilter === "github" ? "GitHub" : sourceFilter === "web" ? "Páginas web" : sourceFilter === "image" ? "Imágenes" : sourceFilter === "note" ? "Notas" : sourceFilter === "pdf" ? "PDF" : "YouTube", clear: () => setSourceFilter("all") }] : []),
    ...(collectionFilter ? [{ key: "folder", label: collections.find((item) => item.id === collectionFilter)?.name || "Carpeta", clear: () => setCollectionFilter("") }] : []),
    ...(tagFilter ? [{ key: "tag", label: tags.find((item) => item.id === tagFilter)?.name || "Etiqueta", clear: () => setTagFilter("") }] : []),
    ...(statusFilter ? [{ key: "status", label: statusFilter, clear: () => setStatusFilter("") }] : []),
    ...(authorFilter ? [{ key: "author", label: authorFilter, clear: () => setAuthorFilter("") }] : []),
    ...(contentFilter !== "all" ? [{ key: "content", label: contentFilter === "notes" ? "Con notas" : "Con resumen", clear: () => setContentFilter("all") }] : []),
    ...(threadFilter !== "all" ? [{ key: "thread", label: threadFilter === "thread" ? "Hilos" : "Publicaciones", clear: () => setThreadFilter("all") }] : []),
    ...(sort !== "recent" ? [{ key: "sort", label: sort === "oldest" ? "Más antiguas" : sort === "title" ? "Por título" : "Por autor", clear: () => setSort("recent") }] : []),
  ];

  const uploadImages = useCallback(async (files: File[]) => {
    const markdown = files.filter((file) => /\.(md|markdown)$/i.test(file.name));
    let imported = 0;
    for (const file of markdown) {
      try {
        await readJson("/api/notes", { method: "POST", body: JSON.stringify({ content: await file.text() }) });
        imported += 1;
      } catch { setUpload({ text: `No se pudo importar ${file.name}.`, error: true }); }
    }
    const pdfs = files.filter((file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name));
    let lastPdf = "";
    for (const [index, file] of pdfs.entries()) {
      setUpload({ text: pdfs.length > 1 ? `Leyendo PDF ${index + 1} de ${pdfs.length}…` : "Leyendo PDF…", error: false });
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch("/api/pdfs", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "No se pudo guardar el PDF.");
        lastPdf = payload.id;
        imported += 1;
        setUpload(null);
      } catch (cause) { setUpload({ text: `${file.name}: ${cause instanceof Error ? cause.message : "No se pudo guardar."}`, error: true }); }
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      if (imported) await onRefresh();
      if (lastPdf && files.length === 1) onPreview?.(lastPdf);
      else if (!markdown.length && !pdfs.length) setUpload({ text: "Ese archivo no es una imagen, un PDF ni un Markdown.", error: true });
      return;
    }
    let lastId = "";
    let failed = "";
    for (const [index, file] of images.entries()) {
      setUpload({ text: images.length > 1 ? `Analizando imagen ${index + 1} de ${images.length}…` : "Analizando imagen…", error: false });
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch("/api/images", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "No se pudo guardar la imagen.");
        lastId = payload.id;
      } catch (cause) { failed = cause instanceof Error ? cause.message : "No se pudo guardar la imagen."; }
    }
    await onRefresh();
    setUpload(failed ? { text: failed, error: true } : null);
    if (lastId && images.length === 1) onPreview?.(lastId);
  }, [onPreview, onRefresh]);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); void uploadImages(files); return; }
      // Como mymind: pegar un enlace lo guarda; pegar texto crea una nota (o una cita si va entre comillas).
      const text = event.clipboardData?.getData("text/plain")?.trim() || "";
      if (!text) return;
      event.preventDefault();
      void (async () => {
        try {
          if (/^https?:\/\/\S+$/i.test(text)) {
            setUpload({ text: "Guardando enlace…", error: false });
            const result = await readJson<{ id?: string }>("/api/videos", { method: "POST", body: JSON.stringify({ url: text, mode: "process" }) });
            setUpload({ text: "Enlace guardado.", error: false });
            await onRefresh();
            if (result.id) onPreview?.(result.id);
          } else {
            const content = quotedText(text) ?? text;
            await readJson("/api/notes", { method: "POST", body: JSON.stringify({ content }) });
            setUpload({ text: content.startsWith(">") ? "Cita guardada." : "Nota guardada.", error: false });
            await onRefresh();
          }
          window.setTimeout(() => setUpload(null), 2200);
        } catch (cause) { setUpload({ text: cause instanceof Error ? cause.message : "No se pudo guardar lo pegado.", error: true }); }
      })();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [uploadImages, onRefresh, onPreview]);
  useEffect(() => {
    if (!upload?.error) return;
    const timer = window.setTimeout(() => setUpload(null), 5000);
    return () => window.clearTimeout(timer);
  }, [upload]);

  useEffect(() => {
    if (!selectedIds.length) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector(".lv-modal")) setSelectedIds([]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.length]);
  async function addSelectionToNewSpace() {
    const name = window.prompt(`Nombre de la nueva carpeta para ${selectedIds.length} ${selectedIds.length === 1 ? "fuente" : "fuentes"}`)?.trim();
    if (!name) return;
    setBulkBusy(true); setBulkError("");
    try {
      const { space } = await readJson<{ space: SmartSpace }>("/api/spaces", { method: "POST", body: JSON.stringify({ name, videoId: selectedIds[0] }) });
      if (selectedIds.length > 1) await readJson("/api/videos/bulk", { method: "POST", body: JSON.stringify({ videoIds: selectedIds, action: "add_space", spaceId: space.id }) });
      setSelectedIds([]);
      await onRefresh();
    } catch (cause) { setBulkError(cause instanceof Error ? cause.message : "No se pudo crear la carpeta."); }
    finally { setBulkBusy(false); }
  }
  async function bulkAction(action: string, extras: Record<string, unknown> = {}) {
    if (!selectedIds.length) return;
    if (action === "delete" && !window.confirm(`¿Eliminar ${selectedIds.length} fuentes y todo su análisis local?`)) return;
    setBulkBusy(true); setBulkError("");
    try {
      const result = await readJson<{ failed: Array<{ id: string; error: string }> }>("/api/videos/bulk", { method: "POST", body: JSON.stringify({ videoIds: selectedIds, action, ...extras }) });
      if (result.failed.length) setBulkError(`${result.failed.length} fuentes no pudieron modificarse.`);
      else setSelectedIds([]);
      await onRefresh();
    } catch (cause) { setBulkError(cause instanceof Error ? cause.message : "No se pudo completar la acción."); }
    finally { setBulkBusy(false); }
  }
  const videoSources = filteredVideos.filter((video) => video.sourceType === "youtube");
  const imageSources = filteredVideos.filter((video) => video.sourceType === "image");
  const pdfSources = filteredVideos.filter((video) => video.sourceType === "pdf");
  const noteSources = filteredVideos.filter((video) => video.sourceType === "note");
  const articleSources = filteredVideos.filter((video) => video.sourceType === "web" && isSubstackSource(video));
  const githubSources = filteredVideos.filter(isGithubSource);
  const webSources = filteredVideos.filter((video) => video.sourceType === "web" && !isSubstackSource(video) && !isGithubSource(video) && visualPlatform(video) === "web");
  const socialSources = filteredVideos.filter((video) => video.sourceType === "x" || video.sourceType === "reddit" || (video.sourceType === "web" && !isSubstackSource(video) && visualPlatform(video) !== "web"));
  const orderedForRender = [...noteSources, ...videoSources, ...pdfSources, ...imageSources, ...socialSources, ...articleSources, ...githubSources, ...webSources];
  const renderedIds = new Set(orderedForRender.slice(0, visibleCount).map((video) => video.id));
  const renderedVideoSources = videoSources.filter((video) => renderedIds.has(video.id));
  const renderedNoteSources = noteSources.filter((video) => renderedIds.has(video.id));
  const renderedPdfSources = pdfSources.filter((video) => renderedIds.has(video.id));
  const renderedImageSources = imageSources.filter((video) => renderedIds.has(video.id));
  const renderedSocialSources = socialSources.filter((video) => renderedIds.has(video.id));
  const renderedArticleSources = articleSources.filter((video) => renderedIds.has(video.id));
  const renderedGithubSources = githubSources.filter((video) => renderedIds.has(video.id));
  const renderedWebSources = webSources.filter((video) => renderedIds.has(video.id));
  const shownView: HomeView = vibe ? "mosaic" : view;
  const renderSourceCard = (video: AppVideo) => {
    const opensInternally = video.sourceType === "youtube" || (video.sourceType === "web" && isSubstackSource(video));
    return <HomeVideoCard key={video.id} video={video} collections={collections} tags={tags} selected={selection.has(video.id)} onTagFilter={(tagId) => { setTagFilter(tagId); changeMode("overview"); }} onToggleSelection={() => setSelectedIds((current) => current.includes(video.id) ? current.filter((id) => id !== video.id) : [...current, video.id])} onOpen={() => onPreview ? onPreview(video.id) : opensInternally ? onOpenVideo(video.id) : window.open(video.url, "_blank", "noopener,noreferrer")} onChanged={onRefresh} />;
  };

  return <main className={`knowledge-home mode-${mode} ${mode === "overview" ? `view-${shownView}` : ""} ${dropping ? "lv-dropping" : ""}`} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDropping(true); } }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDropping(false); }} onDrop={(event) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); setDropping(false); void uploadImages([...event.dataTransfer.files]); }}>
    <header className={`home-library-toolbar ${filtersOpen ? "filters-open" : ""}`}>
      {/* Al abrir una carpeta nada cambia de sitio: el buscador sigue aquí y su bolita se pone negra. */}
      <>
      <div className="home-toolbar-main"><div className="lv-search-wrap"><label className="library-query"><Search size={15} />{queryPills(query).pills.map((pill) => <span key={pill.token} className="lv-query-pill" onMouseDown={(event) => event.preventDefault()}>{pill.swatch && <i style={{ background: pill.swatch }} />}{pill.label}<button type="button" aria-label={`Quitar ${pill.label}`} onClick={() => { setQuery(queryPills(query).pills.filter((item) => item.token !== pill.token).map((item) => item.token).concat(queryPills(query).text ? [queryPills(query).text] : []).join(" ")); changeMode("overview"); }}><X size={11} /></button></span>)}<input value={queryPills(query).text} onFocus={() => setSearchPanel(true)} onBlur={() => setSearchPanel(false)} onKeyDown={(event) => {
          if (tagSuggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setTagCursor((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + tagSuggestions.length) % tagSuggestions.length); return; }
          if (tagSuggestions.length && (event.key === "Enter" || event.key === "Tab")) { event.preventDefault(); chooseTag(tagSuggestions[Math.min(tagCursor, tagSuggestions.length - 1)].name); return; }
          if (event.key === "Escape") (event.target as HTMLInputElement).blur();
          const parts = queryPills(query);
          if (event.key === "Backspace" && !parts.text && parts.pills.length) { event.preventDefault(); setQuery(parts.pills.slice(0, -1).map((item) => item.token).join(" ")); }
        }} onChange={(event) => { const parts = queryPills(query); setQuery([...parts.pills.map((item) => item.token), event.target.value].join(" ").replace(/^\s+/, "")); changeMode("overview"); }} placeholder={queryPills(query).pills.length ? "" : dictation.state === "recording" ? "Escuchando…" : dictation.state === "working" ? "Pasando tu voz a texto…" : activeSpace ? `Busca en ${activeSpace.name}…` : "Busca en tu Lúmina…"} /><button type="button" className={`lv-search-mic ${dictation.state}`} onClick={dictation.toggle} disabled={dictation.state === "working"} aria-pressed={dictation.state === "recording"} aria-label={dictation.state === "recording" ? "Terminar de dictar" : "Buscar con la voz"} title={dictation.state === "recording" ? "Terminar de dictar" : "Buscar con la voz"}>{dictation.state === "working" ? <LoaderCircle className="spin" size={17} /> : dictation.state === "recording" ? <Square size={14} /> : <Mic size={18} />}</button><kbd>⌘ K</kbd></label></div>{deferredQuery.trim() && !activeSpace && <button className="lv-save-space" onClick={() => setSavingSpace(true)}><Layers size={14} /> Guardar como carpeta inteligente</button>}</div>
      </>
      <div className="home-toolbar-actions"><div className="home-view-toggle"><button className={view === "mosaic" ? "active" : ""} onClick={() => { changeMode("overview"); changeView("mosaic"); }} title="Mosaico" aria-label="Mosaico"><LayoutGrid size={15} /></button><button className={view === "reader" ? "active" : ""} onClick={() => { changeMode("overview"); changeView("reader"); }} title="Lista y lector" aria-label="Lista y lector"><BookOpen size={15} /></button><button className={view === "cards" ? "active" : ""} onClick={() => { changeMode("overview"); changeView("cards"); }} title="Tarjetas" aria-label="Tarjetas"><Grid2X2 size={15} /></button></div><div className="lv-add-menu"><button className="primary-button home-add-button lv-round-add" onClick={() => setAddMenu((current) => !current)} aria-expanded={addMenu} aria-haspopup="menu" aria-label="Agregar" title="Agregar"><Plus size={20} /></button>
        {addMenu && <div className="lv-add-options" role="menu" onMouseLeave={() => setAddMenu(false)}>
          <button role="menuitem" onClick={() => { setAddMenu(false); onAdd(); }}><Link2 size={15} /><span><strong>Enlace</strong><small>YouTube, X, Reddit, web, PDF…</small></span></button>
          <label role="menuitem"><ImagePlus size={15} /><span><strong>Archivo</strong><small>Imágenes, PDF o Markdown</small></span><input type="file" accept="image/jpeg,image/png,image/gif,image/webp,.md,.markdown,.pdf,application/pdf" multiple onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; setAddMenu(false); if (files.length) void uploadImages(files); }} /></label>
          <p>También puedes arrastrar archivos a la ventana o pegar con ⌘V.</p>
        </div>}
      </div></div>
      {/* Una sola fila: carpetas (o tipos / etiquetas al buscar) a la izquierda; seleccionar, tableros, fecha, tamaño y resultados a la derecha. */}
      {mode !== "ask" && <div className="lv-header-row"><div className="lv-header-left">
      {/* Como en mymind: los filtros por tipo, pegados al buscador. */}
      {!vibe && searchActive && tagChips.length > 0 && <div className="lv-tag-chips" role="listbox" aria-label="Etiquetas" onMouseDown={(event) => event.preventDefault()}>{tagChips.map((tag, index) => <button key={tag.name} role="option" aria-selected={hashFragment !== undefined && index === tagCursor} className={hashFragment !== undefined && index === tagCursor ? "active" : ""} onClick={() => chooseTag(tag.name)}><span>#</span>{tag.name}</button>)}</div>}
      {!vibe && libraryNavigation && searchActive && !tagChips.length && <div className="home-search-filters" onMouseDown={(event) => event.preventDefault()}>{libraryNavigation}</div>}
      {/* Carpetas como bolitas (el aspecto de los espacios inteligentes): se abren, reciben tarjetas arrastradas y se crean con +. */}
      {!vibe && !searchActive && <div className="lv-space-chips lv-folder-chips" aria-label="Carpetas">
        {spaces.map((space) => <span key={space.id} className={`lv-folder-chip ${activeSpace?.id === space.id ? "active" : ""} ${folderMenuId === space.id ? "editing" : ""}`}><button className={dropFolderId === space.id ? "drop-target" : ""} onClick={() => activeSpace?.id === space.id ? onClearSpace?.() : onOpenSpace?.(space.id)} title={activeSpace?.id === space.id ? "Volver a todo" : space.query ? `Carpeta inteligente · ${space.query}` : "Carpeta"} aria-pressed={activeSpace?.id === space.id}
          onDragOver={(event) => { if (!event.dataTransfer.types.includes("application/x-lumina-source")) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDropFolderId(space.id); }}
          onDragLeave={() => setDropFolderId((current) => current === space.id ? null : current)}
          onDrop={(event) => { event.preventDefault(); setDropFolderId(null); const videoId = event.dataTransfer.getData("application/x-lumina-source"); if (videoId) void readJson(`/api/spaces/${space.id}/items/${videoId}`, { method: "PUT" }).then(onRefresh); }}>
          <i style={{ borderColor: space.color, background: activeSpace?.id === space.id ? space.color : undefined }} />{space.name}{space.query && <em className="lv-rule-mark">✦</em>}</button>
          <button className="lv-folder-edit" onClick={() => setFolderMenuId((current) => current === space.id ? null : space.id)} aria-label={`Editar la carpeta ${space.name}`} title="Editar carpeta"><Pencil size={12} /></button>
          {folderMenuId === space.id && <><div className="rail-popover-scrim" onMouseDown={() => setFolderMenuId(null)} /><div className="lv-folder-menu" role="menu">
            <div className="lv-folder-colors" aria-label="Cambiar color">{FOLDER_COLORS.map((color) => <button key={color} role="menuitemradio" aria-checked={color === space.color} className={color === space.color ? "active" : ""} style={{ background: color }} aria-label={`Color ${color}`} onClick={() => void readJson(`/api/spaces/${space.id}`, { method: "PATCH", body: JSON.stringify({ color }) }).then(onRefresh)} />)}</div>
            <button role="menuitem" onClick={() => { setFolderMenuId(null); void editFolder(space, "name"); }}><Pencil size={14} /> Cambiar nombre</button>
            <button role="menuitem" onClick={() => { setFolderMenuId(null); void editFolder(space, "query"); }}><Sparkles size={14} /> {space.query ? "Cambiar la regla" : "Añadir una regla"}</button>
            <button role="menuitem" className="danger" onClick={() => { setFolderMenuId(null); onDeleteSpace?.(space.id); }}>Eliminar carpeta</button>
          </div></>}
        </span>)}
        <button className="lv-folder-new" onClick={() => setNewFolderOpen(true)} title="Nueva carpeta" aria-label="Nueva carpeta"><Plus size={14} /></button>
      </div>}
      </div>
      <div className="library-selection-head"><button onClick={() => setSelectedIds(selectedIds.length === filteredVideos.length ? [] : filteredVideos.map((video) => video.id))}><CheckSquare size={15} />{selectedIds.length === filteredVideos.length && filteredVideos.length ? "Quitar selección" : "Seleccionar todo"}</button><span className="lv-results-meta">{!vibe && !activeSpace && topBoards.length > 0 && <button className={`lv-board-tabs-all ${boardsOpen ? "active" : ""}`} onClick={() => setBoardsOpen((current) => !current)} aria-pressed={boardsOpen}><LayoutGrid size={13} /> Tableros</button>}<label className="lv-date-filter"><CalendarDays size={13} /><select aria-label="Fecha" value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Cualquier fecha</option><option value="today">Hoy</option><option value="week">Últimos 7 días</option><option value="month">Últimos 30 días</option><option value="year">Este año</option></select></label>{shownView === "mosaic" && <span className="lv-card-size" role="radiogroup" aria-label="Tamaño de las tarjetas">{([["l", "Tarjetas grandes", 2], ["m", "Tarjetas medianas", 3], ["s", "Tarjetas pequeñas", 4]] as const).map(([size, label, cells]) => <button key={size} role="radio" aria-checked={cardSize === size} className={cardSize === size ? "active" : ""} title={label} aria-label={label} onClick={() => changeCardSize(size)}><i style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }}>{Array.from({ length: cells * cells }, (_, index) => <b key={index} />)}</i></button>)}</span>}{filteredVideos.length} resultados{semanticOnly > 0 && <em className="lv-semantic-count" title="Encontrados por significado aunque no contengan esas palabras"> · {semanticOnly} por significado</em>}</span></div>
      </div>}
      {dictation.error && <p className="lv-error lv-search-error">{dictation.error}</p>}
      {filtersOpen && <div className="home-filter-row advanced"><label><CalendarDays size={14} /><select value={dateBasis} onChange={(event) => setDateBasis(event.target.value as typeof dateBasis)}><option value="saved">Fecha guardada</option><option value="published">Fecha publicada</option></select></label><label><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">Cualquier fecha</option><option value="today">Hoy</option><option value="week">Últimos 7 días</option></select></label><label><Bookmark size={13} /><select aria-label="Fuente" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}><option value="all">Todas las fuentes</option><option value="youtube">YouTube</option><option value="x">X</option><option value="reddit">Reddit</option><option value="github">GitHub</option><option value="web">Páginas web</option><option value="image">Imágenes</option><option value="note">Notas</option><option value="pdf">PDF</option></select></label><label><Folder size={14} /><select value={collectionFilter} onChange={(event) => setCollectionFilter(event.target.value)}><option value="">Todas las carpetas</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label><label><Tag size={14} /><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Todas las etiquetas</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Cualquier estado</option><option value="saved">Solo guardadas</option><option value="queued">En cola</option><option value="extracting">Extrayendo</option><option value="indexing">Indexando</option><option value="summarizing">Resumiendo</option><option value="ready">Listas</option><option value="failed">Con error</option><option value="needs_transcript">Sin transcripción</option></select></label><label><select value={authorFilter} onChange={(event) => setAuthorFilter(event.target.value)}><option value="">Todos los autores</option>{authors.map((author) => <option key={author} value={author}>{author}</option>)}</select></label><label><select value={contentFilter} onChange={(event) => setContentFilter(event.target.value as typeof contentFilter)}><option value="all">Cualquier contenido</option><option value="notes">Con notas</option><option value="summary">Con resumen</option></select></label><label><select value={threadFilter} onChange={(event) => setThreadFilter(event.target.value as typeof threadFilter)}><option value="all">Publicaciones e hilos</option><option value="thread">Solo hilos</option><option value="single">Solo individuales</option></select></label><label><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="recent">Más recientes</option><option value="oldest">Más antiguas</option><option value="title">Por título</option><option value="author">Por autor</option></select></label>{activeFilterCount > 0 && <button className="clear-filters" onClick={clearFilters}><X size={13} /> Limpiar filtros</button>}</div>}
      {filterChips.length > 0 && <div className="active-filter-chips">{filterChips.map((chip) => <button key={chip.key} onClick={chip.clear}>{chip.label}<X size={11} /></button>)}</div>}
    </header>
    <div className="home-inner">
      {mode === "ask" ? <div className="home-ask-composition"><header className="home-hero"><span><MessageCircle size={17} /> Chat con Lúmina</span><h1>Pregunta a lo que has aprendido.</h1></header><ScopedChatWorkspace scopeType={initialTagId ? "tag" : "selection"} scopeId={initialTagId || `home-${profileId}`} videos={videos} collections={collections} tags={tags} models={models} initialVideoIds={initialTagId ? videos.filter((video) => video.status === "ready").map((video) => video.id) : []} onOpenConversation={onOpenConversation} onConversationChanged={onConversationChanged} compact starter /></div> : <div className="home-overview">
        {!vibe && !activeSpace && !deferredQuery.trim() && shownView !== "reader" && <ShelfRow videos={shelf} onOpen={(id) => onPreview ? onPreview(id) : onOpenVideo(id)} onChanged={onRefresh} />}
        {vibe ? <div className="lv-space-heading lv-vibe-heading">{vibe.artwork && <img src={vibe.artwork} alt="" referrerPolicy="no-referrer" />}<div><h1>Misma vibra</h1><small>Con un aspecto parecido a: {vibe.title}</small></div><button onClick={onClearVibe} title="Salir de Misma vibra" aria-label="Salir de Misma vibra"><X size={15} /></button></div> : null}
        {boardsOpen && !vibe && !activeSpace ? <BoardsGrid boards={topBoards} collections={collections} videos={videos} onOpen={(id) => { setBoardsOpen(false); if (onOpenSpace) onOpenSpace(id); else setCollectionFilter(id); }} /> : <>
        {vibe && filteredVideos.length <= 1 && <p className="lv-vibe-empty">Todavía no encuentro nada con un aspecto parecido. Mientras más imágenes guardes, mejor funcionará.</p>}
        {shownView === "reader" ? <ReaderSplit videos={filteredVideos} catalog={tags} collections={collections} spaces={spaces} onSearch={onSearchQuery} onVibe={onVibe} onChanged={onRefresh} onOpenFull={onOpenVideo} onAsk={(id) => onAskSource?.(id)} /> : shownView === "mosaic" ? <div className={`lv-size-${cardSize}`}><MosaicGrid saver={boardSaver} videos={filteredVideos.slice(0, visibleCount)} onOpen={(id) => onPreview ? onPreview(id, filteredVideos.map((video) => video.id)) : onOpenVideo(id)} selection={selection} onToggleSelect={(id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} catalog={tags} spaces={spaces} onChanged={onRefresh} onVibe={onVibe} quickNote={!vibe && !activeSpace && !deferredQuery.trim()} /></div> : shownView === "cards" ? <>
          <section className="home-date-group home-source-section"><header><h2>Videos</h2><span>{videoSources.length}</span></header><div className="home-video-cards"><button className="home-add-tile" onClick={onAdd}><Plus size={23} /><strong>Agregar fuente</strong><small>YouTube, X, Reddit, GitHub o web</small></button>{renderedVideoSources.map(renderSourceCard)}</div></section>
          {renderedNoteSources.length > 0 && <section className="home-date-group home-source-section"><header><h2>Notas</h2><span>{noteSources.length}</span></header><div className="home-video-cards">{renderedNoteSources.map(renderSourceCard)}</div></section>}
          {renderedPdfSources.length > 0 && <section className="home-date-group home-source-section"><header><h2>PDF</h2><span>{pdfSources.length}</span></header><div className="home-video-cards">{renderedPdfSources.map(renderSourceCard)}</div></section>}
          {renderedImageSources.length > 0 && <section className="home-date-group home-source-section"><header><h2>Imágenes</h2><span>{imageSources.length}</span></header><div className="home-video-cards">{renderedImageSources.map(renderSourceCard)}</div></section>}
          {renderedSocialSources.length > 0 && <section className="home-date-group home-source-section social-source-section"><header><h2>Publicaciones</h2><span>{socialSources.length}</span></header><div className="social-bookmark-masonry">{renderedSocialSources.map(renderSourceCard)}</div></section>}
          {renderedArticleSources.length > 0 && <section className={`home-date-group home-source-section article-source-section ${articlesCollapsed ? "collapsed" : ""}`}><header><button className="source-section-toggle" type="button" onClick={() => setArticlesCollapsed((current) => !current)} aria-expanded={!articlesCollapsed} aria-label={articlesCollapsed ? "Mostrar artículos" : "Ocultar artículos"}><ChevronDown size={17} /></button><h2>Artículos</h2><span>{articleSources.length}</span></header>{!articlesCollapsed && <div className="social-bookmark-masonry article-bookmark-masonry">{renderedArticleSources.map(renderSourceCard)}</div>}</section>}
          {renderedGithubSources.length > 0 && <section className="home-date-group home-source-section github-source-section"><header><Github size={19} /><h2>GitHub</h2><span>{githubSources.length}</span></header><div className="web-page-grid">{renderedGithubSources.map(renderSourceCard)}</div></section>}
          {renderedWebSources.length > 0 && <section className="home-date-group home-source-section web-source-section"><header><h2>Web</h2><span>{webSources.length}</span></header><div className="web-page-grid">{renderedWebSources.map(renderSourceCard)}</div></section>}
        </> : null}
        {!filteredVideos.length && <div className="home-overview-empty"><Search size={24} /><strong>No encontramos fuentes</strong><p>Prueba otros filtros o agrega una nueva fuente.</p></div>}
        {filteredVideos.length > 0 && <div ref={loadSentinelRef} className="library-load-sentinel">{visibleCount < filteredVideos.length ? `Cargando más… ${Math.min(visibleCount, filteredVideos.length)} de ${filteredVideos.length}` : `${filteredVideos.length} fuentes visibles`}</div>}
        </>}
      </div>}
    </div>
    {selectedIds.length > 0 && mode === "overview" && <aside className="bulk-action-bar"><strong>{selectedIds.length} {selectedIds.length === 1 ? "seleccionada" : "seleccionadas"}</strong><label><Folder size={14} /><select value={bulkFolderId} onChange={(event) => setBulkFolderId(event.target.value)}><option value="">Carpeta de destino…</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select><button disabled={!bulkFolderId || bulkBusy} onClick={() => void bulkAction("add_collection", { collectionId: bulkFolderId })}>Añadir</button>{collectionFilter && <button disabled={!bulkFolderId || bulkFolderId === collectionFilter || bulkBusy} onClick={() => void bulkAction("move_collection", { collectionId: bulkFolderId, fromCollectionId: collectionFilter })}>Mover</button>}</label><label><Tag size={14} /><select value={bulkTagId} onChange={(event) => setBulkTagId(event.target.value)}><option value="">Etiqueta…</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button disabled={!bulkTagId || bulkBusy} onClick={() => void bulkAction("add_tags", { tagIds: [bulkTagId] })}>Añadir</button><button disabled={!bulkTagId || bulkBusy} onClick={() => void bulkAction("remove_tags", { tagIds: [bulkTagId] })}>Quitar</button></label><label><Layers size={14} /><select aria-label="Carpeta de destino" value={bulkSpaceId} onChange={(event) => setBulkSpaceId(event.target.value)}><option value="">Espacio…</option>{spaces.map((space) => <option key={space.id} value={space.id}>{space.name}</option>)}</select><button disabled={!bulkSpaceId || bulkBusy} onClick={() => void bulkAction("add_space", { spaceId: bulkSpaceId })}>Añadir</button><button disabled={bulkBusy} onClick={() => void addSelectionToNewSpace()} title="Crear una carpeta con esta selección">Nuevo</button></label><button onClick={() => setTaggingOpen(true)} disabled={bulkBusy}><WandSparkles size={15} /> IA por lote</button><button onClick={() => void bulkAction("process")} disabled={bulkBusy}><RefreshCw size={15} /> Procesar</button><a href={`/api/export?format=csv&videoIds=${selectedIds.join(",")}`}><Download size={15} /> CSV</a><a href={`/api/export?format=pdf&videoIds=${selectedIds.join(",")}`}><Download size={15} /> PDF</a><a href={`/api/export?format=markdown&videoIds=${selectedIds.join(",")}`}><Download size={15} /> MD</a><a href={`/api/export?format=json&videoIds=${selectedIds.join(",")}`}><Download size={15} /> JSON</a><button onClick={() => void bulkAction("archive")} disabled={bulkBusy} title="Archivar (se puede restaurar)"><Archive size={15} /> Archivar</button><button className="danger" onClick={() => void bulkAction("delete")} disabled={bulkBusy} title="Eliminar definitivamente" aria-label="Eliminar definitivamente"><Trash2 size={15} /></button><button className="close-selection" onClick={() => setSelectedIds([])}><X size={15} /></button>{bulkError && <span className="bulk-error">{bulkError}</span>}</aside>}
    {taggingOpen && <BulkTaggingModal videoIds={selectedIds} videos={videos} tags={tags} models={models} onClose={() => setTaggingOpen(false)} onDone={onRefresh} />}
    {upload && <div className={`lv-upload-status ${upload.error ? "error" : ""}`}>{upload.text}</div>}
    {savingSpace && <SaveSpaceModal query={query} onClose={() => setSavingSpace(false)} onSaved={(space) => { setSavingSpace(false); onSpaceCreated?.(space); }} />}
    {newFolderOpen && <SaveSpaceModal query="" onClose={() => setNewFolderOpen(false)} onSaved={(space) => { setNewFolderOpen(false); onSpaceCreated?.(space); }} />}
  </main>;
}

function CollectionManager({ collection, videos, allVideos, collections, onClose, onRefresh, onDeleted }: {
  collection: Collection;
  videos: AppVideo[];
  allVideos: AppVideo[];
  collections: Collection[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description || "");
  const [parentId, setParentId] = useState(collection.parentId || "");
  const [sortOrder, setSortOrder] = useState(collection.sortOrder);
  const [selectedIds, setSelectedIds] = useState(videos.map((video) => video.id));
  const [moveIds, setMoveIds] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const [newCollectionName, setNewCollectionName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setLoading(true); setError("");
    try {
      await readJson(`/api/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ name, description, parentId: parentId || null, sortOrder }) });
      await readJson(`/api/collections/${collection.id}/videos`, { method: "PUT", body: JSON.stringify({ videoIds: selectedIds }) });
      await onRefresh();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la colección."); }
    finally { setLoading(false); }
  }

  async function move() {
    if (!moveIds.length || (!destination && !newCollectionName.trim())) return;
    setLoading(true); setError("");
    try {
      let destinationCollectionId = destination;
      if (destination === "new") {
        const created = await readJson<Collection>("/api/collections", { method: "POST", body: JSON.stringify({ name: newCollectionName }) });
        destinationCollectionId = created.id;
      }
      await readJson(`/api/collections/${collection.id}/move`, { method: "POST", body: JSON.stringify({ videoIds: moveIds, destinationCollectionId }) });
      await onRefresh();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron mover las fuentes."); }
    finally { setLoading(false); }
  }

  async function remove() {
    const confirmed = window.confirm(`¿Eliminar la colección “${collection.name}”?\n\nLas fuentes, notas, etiquetas y chats individuales se conservarán. Se eliminará el chat propio de esta colección.`);
    if (!confirmed) return;
    setLoading(true); setError("");
    try {
      await readJson(`/api/collections/${collection.id}`, { method: "DELETE" });
      await onRefresh();
      onDeleted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar la colección."); setLoading(false); }
  }

  return <div className="modal-backdrop collection-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="modal-card collection-manager">
      <button className="icon-button modal-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
      <div className="modal-icon"><Pencil size={20} /></div><p className="eyebrow">Organización</p><h2>Gestionar colección</h2>
      <div className="collection-manager-section collection-fields"><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} maxLength={48} /></label><label>Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} placeholder="¿Qué conocimiento reúne esta carpeta?" /></label><div className="collection-location-fields"><label>Carpeta superior<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Nivel principal</option>{collections.filter((item) => item.id !== collection.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Orden<input type="number" min="0" value={sortOrder} onChange={(event) => setSortOrder(Math.max(0, Number(event.target.value) || 0))} /></label></div><small>Lúmina impedirá que una carpeta se mueva dentro de una de sus propias subcarpetas.</small></div>
      <div className="collection-manager-section"><div className="manager-section-heading"><div><strong>Fuentes de la colección</strong><small>Añade o quita fuentes sin afectar sus otras colecciones.</small></div><span>{selectedIds.length}</span></div><div className="manager-video-list">{allVideos.map((video) => <label key={video.id}><input type="checkbox" checked={selectedIds.includes(video.id)} onChange={() => setSelectedIds((current) => current.includes(video.id) ? current.filter((id) => id !== video.id) : [...current, video.id])} /><span className={`source-thumb ${video.sourceType !== "youtube" ? "x-source-mini" : ""}`} style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined}>{video.thumbnailUrl ? null : video.sourceType === "x" ? "𝕏" : video.sourceType === "reddit" ? "r/" : video.sourceType === "web" ? "Aa" : null}</span><span><strong>{video.title}</strong><small>{video.channel || "Procesando…"}</small></span></label>)}</div></div>
      {!!videos.length && <div className="collection-manager-section move-section"><div className="manager-section-heading"><div><strong>Mover a otra colección</strong><small>Se conserva cualquier tercera pertenencia de la fuente.</small></div></div><div className="move-video-options">{videos.map((video) => <label key={video.id}><input type="checkbox" checked={moveIds.includes(video.id)} onChange={() => setMoveIds((current) => current.includes(video.id) ? current.filter((id) => id !== video.id) : [...current, video.id])} />{video.title}</label>)}</div><select value={destination} onChange={(event) => setDestination(event.target.value)}><option value="">Elige destino…</option>{collections.filter((item) => item.id !== collection.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="new">+ Nueva colección</option></select>{destination === "new" && <input value={newCollectionName} onChange={(event) => setNewCollectionName(event.target.value)} placeholder="Nombre de la nueva colección" maxLength={48} />}<button className="secondary-button" disabled={loading || !moveIds.length || !destination || (destination === "new" && !newCollectionName.trim())} onClick={() => void move()}><MoveRight size={15} /> Mover {moveIds.length || ""}</button></div>}
      {error && <p className="form-error"><CircleAlert size={15} />{error}</p>}
      <div className="collection-manager-actions"><button className="delete-collection" onClick={() => void remove()} disabled={loading}><Trash2 size={15} /> Eliminar colección</button><button className="primary-button" onClick={() => void save()} disabled={loading || !name.trim()}>{loading ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Guardar cambios</button></div>
    </section>
  </div>;
}

export function CollectionWorkspace({ collection, videos, allVideos, collections, tags, models, onOpenVideo, onOpenConversation, onConversationChanged, onRefresh, onDeleted }: {
  collection: Collection;
  videos: AppVideo[];
  allVideos: AppVideo[];
  collections: Collection[];
  tags: TagItem[];
  models: AvailableModel[];
  onOpenVideo: (id: string) => void;
  onOpenConversation: (id: string) => void;
  onConversationChanged: () => void;
  onRefresh: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [managerOpen, setManagerOpen] = useState(false);
  const readyIds = useMemo(() => videos.filter((video) => video.status === "ready").map((video) => video.id), [videos]);
  const directVideos = useMemo(() => allVideos.filter((video) => video.collections.some((item) => item.id === collection.id)), [allVideos, collection.id]);
  return <main className="collection-workspace">
    <div className="collection-split">
      <section className="collection-source-pane"><div className="collection-source-scroll">
      <header className="collection-header"><div><span className="collection-big-icon" style={{ color: collection.color }}><Folder size={25} /></span><div className="collection-title-line"><h1>{collection.name}</h1><button className="collection-edit" onClick={() => setManagerOpen(true)} aria-label="Gestionar colección" title="Gestionar colección"><Pencil size={12} /></button></div></div></header>
      <section className="collection-library">
        <div className="collection-library-head"><div><p className="eyebrow">Fuentes</p><h2>{videos.length} {videos.length === 1 ? "fuente" : "fuentes"}</h2></div></div>
        <div className="collection-video-cards">{videos.map((video) => <button key={video.id} onClick={() => onOpenVideo(video.id)}><span className={`collection-video-thumb ${video.sourceType !== "youtube" ? "x-source-mini" : ""}`} style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined}>{video.thumbnailUrl ? null : video.sourceType === "x" ? "𝕏" : video.sourceType === "reddit" ? "r/" : video.sourceType === "web" ? "Aa" : <Play size={16} fill="currentColor" />}</span><div><strong>{video.title}</strong><p>{video.summary?.gist || (video.status === "saved" ? "Guardado como favorito, sin procesar con IA." : "Lúmina está preparando esta fuente.")}</p><small>{video.channel || (video.status === "saved" ? "Enlace guardado" : "Procesando…")}{video.sourceType === "youtube" && video.durationSeconds ? ` · ${formatTimestamp(video.durationSeconds)}` : ""}</small></div><span className={`collection-video-status ${video.status}`}>{video.status === "ready" ? <Check size={12} /> : video.status === "saved" ? <Bookmark size={12} /> : <LoaderCircle size={12} />}{video.status === "ready" ? "Lista" : video.status === "saved" ? "Guardado" : "Procesando"}</span><ArrowUpRight size={16} /></button>)}</div>
      </section></div></section>
      <aside className="collection-chat-pane"><header><MessageCircle size={17} /><div><strong>Conversar con {collection.name}</strong><small>{readyIds.length} fuentes listas</small></div></header><ScopedChatWorkspace key={collection.id} scopeType="collection" scopeId={collection.id} videos={allVideos} collections={collections} tags={tags} models={models} initialVideoIds={readyIds} onOpenConversation={onOpenConversation} onConversationChanged={onConversationChanged} /></aside>
    </div>
    {managerOpen && <CollectionManager collection={collection} videos={directVideos} allVideos={allVideos} collections={collections} onClose={() => setManagerOpen(false)} onRefresh={onRefresh} onDeleted={onDeleted} />}
  </main>;
}

const graphTypes: Array<{ id: GraphNodeData["nodeType"]; label: string }> = [
  { id: "video", label: "Fuentes" }, { id: "collection", label: "Colecciones" }, { id: "tag", label: "Etiquetas" }, { id: "person", label: "Personas" }, { id: "organization", label: "Organizaciones" }, { id: "tool", label: "Herramientas" }, { id: "place", label: "Lugares" }, { id: "concept", label: "Conceptos" }, { id: "idea", label: "Ideas" },
];

export function GraphWorkspace({ onOpenVideo, focusVideoId, collections = [], tags = [] }: { onOpenVideo: (id: string) => void; focusVideoId?: string; collections?: Collection[]; tags?: TagItem[] }) {
  const graphRootRef = useRef<HTMLElement>(null);
  const [nodes, setNodes] = useState<GraphNodeData[]>([]);
  const [edges, setEdges] = useState<GraphEdgeData[]>([]);
  const [selected, setSelected] = useState<GraphNodeData | null>(null);
  const [search, setSearch] = useState("");
  const [depth, setDepth] = useState(focusVideoId ? 1 : 2);
  const [types, setTypes] = useState(graphTypes.map((item) => item.id));
  const [showSuggested, setShowSuggested] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0);
  const [collectionId, setCollectionId] = useState("");
  const [tagId, setTagId] = useState("");
  const [pathStart, setPathStart] = useState<GraphNodeData | null>(null);
  const [shortestPath, setShortestPath] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDisconnected, setShowDisconnected] = useState(false);
  const [showLeaves, setShowLeaves] = useState(true);
  const [locked, setLocked] = useState(false);
  const [settingsCollapsed, setSettingsCollapsed] = useState(false);
  // En el grafo de una sola fuente hay menos espacio: los nodos se separan más y los nombres salen al acercar.
  const [nodeSpacing, setNodeSpacing] = useState(focusVideoId ? 110 : 58);
  const [linkDistance, setLinkDistance] = useState(focusVideoId ? 120 : 68);
  const [fitRequest, setFitRequest] = useState(0);
  const [presetSaved, setPresetSaved] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const typesKey = types.join(",");
  const loadGraph = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ depth: String(depth), types: typesKey, statuses: showSuggested ? "confirmed,suggested" : "confirmed", minConfidence: String(minConfidence) });
    if (collectionId) params.set("collectionId", collectionId);
    if (tagId) params.set("tagId", tagId);
    if (focusVideoId) { params.set("focusType", "video"); params.set("focusId", focusVideoId); }
    try {
      const result = await readJson<{ nodes: GraphNodeData[]; edges: GraphEdgeData[] }>(`/api/graph?${params}`);
      setNodes(result.nodes);
      setEdges(result.edges);
      setSelected((current) => current && result.nodes.some((node) => node.id === current.id) ? current : null);
    } finally { setLoading(false); }
  }, [collectionId, depth, focusVideoId, minConfidence, showSuggested, tagId, typesKey]);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadGraph(), 0);
    return () => window.clearTimeout(timer);
  }, [loadGraph]);

  useEffect(() => {
    if (focusVideoId) return;
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(window.localStorage.getItem("lumina-graph-preset") || "null") as null | { depth?: number; showSuggested?: boolean; showDisconnected?: boolean; showLeaves?: boolean; minConfidence?: number; nodeSpacing?: number; linkDistance?: number };
        if (!saved) return;
        if (typeof saved.depth === "number") setDepth(saved.depth);
        if (typeof saved.showSuggested === "boolean") setShowSuggested(saved.showSuggested);
        if (typeof saved.showDisconnected === "boolean") setShowDisconnected(saved.showDisconnected);
        if (typeof saved.showLeaves === "boolean") setShowLeaves(saved.showLeaves);
        if (typeof saved.minConfidence === "number") setMinConfidence(saved.minConfidence);
        if (typeof saved.nodeSpacing === "number") setNodeSpacing(saved.nodeSpacing);
        if (typeof saved.linkDistance === "number") setLinkDistance(saved.linkDistance);
      } catch { /* Una preferencia inválida no debe bloquear el grafo. */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusVideoId]);

  useEffect(() => {
    const update = () => setIsFullscreen(document.fullscreenElement === graphRootRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const visibleGraph = useMemo(() => {
    const degree = new Map<string, number>();
    edges.forEach((edge) => {
      const source = typeof edge.source === "string" ? edge.source : (edge.source as GraphNodeData).id;
      const target = typeof edge.target === "string" ? edge.target : (edge.target as GraphNodeData).id;
      degree.set(source, (degree.get(source) || 0) + 1);
      degree.set(target, (degree.get(target) || 0) + 1);
    });
    const filteredNodes = nodes.filter((node) => (showDisconnected || (degree.get(node.id) || 0) > 0) && (showLeaves || (degree.get(node.id) || 0) > 1 || node.id === selected?.id));
    const ids = new Set(filteredNodes.map((node) => node.id));
    return { nodes: filteredNodes, edges: edges.filter((edge) => ids.has(typeof edge.source === "string" ? edge.source : (edge.source as GraphNodeData).id) && ids.has(typeof edge.target === "string" ? edge.target : (edge.target as GraphNodeData).id)) };
  }, [edges, nodes, selected?.id, showDisconnected, showLeaves]);

  const selectedEdges = selected ? edges.filter((edge) => edge.source === selected.id || edge.target === selected.id) : [];
  async function changeEdge(edgeId: string, status: "confirmed" | "hidden") {
    await readJson(`/api/graph/edges/${edgeId}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await loadGraph();
  }
  async function findPath(target: GraphNodeData) {
    if (!pathStart || pathStart.id === target.id) { setPathStart(target); setShortestPath([]); return; }
    const params = new URLSearchParams({ depth: String(depth), types: typesKey, statuses: showSuggested ? "confirmed,suggested" : "confirmed", minConfidence: String(minConfidence), from: pathStart.id, to: target.id });
    if (collectionId) params.set("collectionId", collectionId);
    if (tagId) params.set("tagId", tagId);
    if (focusVideoId) { params.set("focusType", "video"); params.set("focusId", focusVideoId); }
    const result = await readJson<{ shortestPath: string[] }>(`/api/graph?${params}`);
    setShortestPath(result.shortestPath);
  }
  function savePreset() {
    window.localStorage.setItem("lumina-graph-preset", JSON.stringify({ depth, showSuggested, showDisconnected, showLeaves, minConfidence, nodeSpacing, linkDistance }));
    setPresetSaved(true);
    window.setTimeout(() => setPresetSaved(false), 1800);
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await graphRootRef.current?.requestFullscreen();
  }

  const details = <aside className={selected ? "graph-detail open" : "graph-detail"}>{selected ? <><button className="graph-detail-close" onClick={() => setSelected(null)}><X size={16} /></button><span className={`node-kind ${selected.nodeType}`}>{selected.nodeType}</span><h2>{selected.label}</h2><p>{selected.description || "Este nodo forma parte del conocimiento extraído de tu biblioteca."}</p><div className="node-actions">{selected.nodeType === "video" && selected.refId && <button className="primary-button" onClick={() => onOpenVideo(selected.refId!)}>Abrir video <ArrowUpRight size={15} /></button>}<button className="secondary-button" onClick={() => void findPath(selected)}>{pathStart && pathStart.id !== selected.id ? `Ruta desde ${pathStart.label}` : "Usar como origen"}</button></div>{shortestPath.length > 0 && <div className="shortest-path"><strong>Camino más corto</strong><p>{shortestPath.map((id) => nodes.find((node) => node.id === id)?.label || id).join(" → ")}</p></div>}{pathStart && shortestPath.length === 0 && pathStart.id !== selected.id && <p className="path-hint">Calcula la ruta para comprobar cómo se conectan ambos nodos.</p>}<div className="edge-list"><h3>{selectedEdges.length} conexiones</h3>{selectedEdges.map((edge) => { const sourceId = typeof edge.source === "string" ? edge.source : (edge.source as GraphNodeData).id; const targetId = typeof edge.target === "string" ? edge.target : (edge.target as GraphNodeData).id; const otherId = sourceId === selected.id ? targetId : sourceId; const other = nodes.find((node) => node.id === otherId); return <article key={edge.id}><div><strong>{other?.label || "Nodo relacionado"}</strong><small>{edge.relationType.replaceAll("_", " ")} · {Math.round(edge.confidence * 100)}%</small></div><p>{edge.explanation}</p>{edge.status === "suggested" && <div><button onClick={() => void changeEdge(edge.id, "confirmed")}><Check size={12} /> Confirmar</button><button onClick={() => void changeEdge(edge.id, "hidden")}><X size={12} /> Ocultar</button></div>}</article>; })}</div></> : null}</aside>;

  return <main ref={graphRootRef} className={`global-graph recall-graph ${focusVideoId ? "focused-graph" : ""} ${settingsCollapsed ? "settings-collapsed" : ""}`}>
    {!focusVideoId && <aside className="graph-settings-panel">
      <header><strong>{settingsCollapsed ? "" : "Configuración del gráfico"}</strong><button onClick={() => setSettingsCollapsed((value) => !value)} aria-label={settingsCollapsed ? "Abrir configuración" : "Cerrar configuración"}><SlidersHorizontal size={16} /></button></header>
      {!settingsCollapsed && <div className="graph-settings-scroll">
        <section><div className="graph-setting-title"><h2>Preajustes</h2><HelpCircle size={13} /></div><p>Guarda esta disposición para volver rápidamente a tu vista preferida.</p><button className="graph-preset-button" onClick={savePreset}><Save size={14} /> {presetSaved ? "Preajuste guardado" : "Guardar como preajuste"}</button></section>
        <section><div className="graph-setting-title"><h2>Filtros</h2><ChevronDown size={14} /></div><label className="graph-filter-input"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Etiqueta, fuente o nombre" /></label>{collections.length > 0 && <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}><option value="">Todas las colecciones</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select>}{tags.length > 0 && <select value={tagId} onChange={(event) => setTagId(event.target.value)}><option value="">Todas las etiquetas</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}<label className="graph-range"><span>Profundidad de conexión <strong>{depth}</strong></span><input type="range" min="0" max="3" value={depth} onChange={(event) => setDepth(Number(event.target.value))} /></label><label className="graph-switch"><span>Mostrar desconectados</span><input type="checkbox" checked={showDisconnected} onChange={(event) => setShowDisconnected(event.target.checked)} /></label><label className="graph-switch"><span>Mostrar nodos hoja</span><input type="checkbox" checked={showLeaves} onChange={(event) => setShowLeaves(event.target.checked)} /></label><label className="graph-switch"><span>Conexiones sugeridas</span><input type="checkbox" checked={showSuggested} onChange={(event) => setShowSuggested(event.target.checked)} /></label></section>
        <section><div className="graph-setting-title"><h2>Grupos</h2><ChevronDown size={14} /></div><p>Elige qué tipos de conocimiento aparecen.</p><div className="graph-type-list">{graphTypes.map((type) => <label key={type.id}><input type="checkbox" checked={types.includes(type.id)} onChange={() => setTypes((current) => current.includes(type.id) ? current.filter((id) => id !== type.id) : [...current, type.id])} /><span className={`graph-type-dot ${type.id}`} />{type.label}</label>)}</div></section>
        <section><div className="graph-setting-title"><h2>Disposición</h2><ChevronDown size={14} /></div><label className="graph-range"><span>Espacio entre nodos <strong>{nodeSpacing}</strong></span><input type="range" min="30" max="110" value={nodeSpacing} onChange={(event) => setNodeSpacing(Number(event.target.value))} /></label><label className="graph-range"><span>Longitud del enlace <strong>{linkDistance}</strong></span><input type="range" min="35" max="140" value={linkDistance} onChange={(event) => setLinkDistance(Number(event.target.value))} /></label><label className="graph-range"><span>Confianza mínima <strong>{Math.round(minConfidence * 100)}%</strong></span><input type="range" min="0" max="0.9" step="0.1" value={minConfidence} onChange={(event) => setMinConfidence(Number(event.target.value))} /></label></section>
      </div>}
    </aside>}
    <section className="graph-canvas-panel">
      <header className="graph-canvas-toolbar"><span>{visibleGraph.nodes.length} nodos · {visibleGraph.edges.length} enlaces</span><div><label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título" /></label><button onClick={() => setFitRequest((value) => value + 1)} aria-label="Ajustar a pantalla" title="Ajustar a pantalla"><Maximize2 size={16} /></button><button onClick={() => setLocked((value) => !value)} aria-label={locked ? "Desbloquear disposición" : "Bloquear disposición"} title={locked ? "Desbloquear disposición" : "Bloquear disposición"}>{locked ? <Lock size={16} /> : <Unlock size={16} />}</button><button onClick={() => void toggleFullscreen()} aria-label="Pantalla completa" title="Pantalla completa"><Maximize2 size={16} className={isFullscreen ? "fullscreen-active" : ""} /></button></div></header>
      <div className="graph-stage">{loading ? <div className="graph-loading"><LoaderCircle className="spin" size={22} /></div> : <KnowledgeGraphCanvas nodes={visibleGraph.nodes} edges={visibleGraph.edges} selectedId={selected?.id || null} search={search} onSelect={setSelected} nodeSpacing={nodeSpacing} linkDistance={linkDistance} paused={locked} fitRequest={fitRequest} showLabels={!focusVideoId} calm />}{details}</div>
    </section>
  </main>;
}
