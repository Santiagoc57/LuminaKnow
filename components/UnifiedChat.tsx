"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { ArrowUpRight, AtSign, Bookmark, Check, ChevronDown, CircleAlert, ExternalLink, Folder, Hash, Library, LoaderCircle, MessageCircle, Play, RotateCcw, Sparkles, X } from "lucide-react";
import type { AppVideo, AvailableModel, ChatSourceSelection, Citation, ConversationMessage, ConversationTurn } from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";

type Taxonomy = { id: string; name: string; color: string; parentId?: string | null; sortOrder?: number };
type ConversationDetail = {
  conversation: { id: string; title: string; scopeType: string; updatedAt: string };
  selection: ChatSourceSelection;
  messages: ConversationMessage[];
  turns: ConversationTurn[];
  sources: Array<{ id: string; title: string; channel: string; thumbnailUrl: string }>;
};
type MentionOption = { id: string; kind: "collection" | "tag" | "video"; label: string; detail: string; selected: boolean };

const emptySelection = (): ChatSourceSelection => ({ collectionIds: [], tagIds: [], videoIds: [], excludedVideoIds: [] });

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || "No se pudo completar la operación.");
  return body as T;
}

function citationHref(citation: Citation) {
  if (citation.sourceItemUrl) return citation.sourceItemUrl;
  if (!citation.videoUrl) return "#";
  if (citation.sourceType !== "youtube") return citation.sourceItemUrl || citation.videoUrl;
  return `${citation.videoUrl}${citation.videoUrl.includes("?") ? "&" : "?"}t=${Math.floor(citation.startSeconds)}s`;
}

function effectiveVideoIds(selection: ChatSourceSelection, videos: AppVideo[], collections: Taxonomy[]) {
  const result = new Set(selection.videoIds);
  const collectionIds = new Set(selection.collectionIds);
  let changed = true;
  while (changed) {
    changed = false;
    collections.forEach((collection) => {
      if (collection.parentId && collectionIds.has(collection.parentId) && !collectionIds.has(collection.id)) {
        collectionIds.add(collection.id);
        changed = true;
      }
    });
  }
  videos.forEach((video) => {
    if (video.status !== "ready") return;
    if (video.collections.some((item) => collectionIds.has(item.id))) result.add(video.id);
    if (video.tags.some((item) => selection.tagIds.includes(item.id))) result.add(video.id);
  });
  selection.excludedVideoIds.forEach((id) => result.delete(id));
  return [...result].filter((id) => videos.some((video) => video.id === id && video.status === "ready"));
}

function toggle(values: string[], id: string) {
  return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function normalizeMention(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function SourcePicker({ selection, onChange, videos, collections, tags, disabled = false, draft = false }: {
  selection: ChatSourceSelection;
  onChange: (selection: ChatSourceSelection) => void;
  videos: AppVideo[];
  collections: Taxonomy[];
  tags: Taxonomy[];
  disabled?: boolean;
  draft?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"collections" | "tags" | "videos">("collections");
  const selectedIds = effectiveVideoIds(selection, videos, collections);
  // Un solo espacio o etiqueta elegidos: se ve su nombre («Batalla Cultural · 3») en vez de «3 fuentes».
  const only = selection.videoIds.length === 0 ? (selection.collectionIds.length === 1 && !selection.tagIds.length ? collections.find((item) => item.id === selection.collectionIds[0])?.name : selection.tagIds.length === 1 && !selection.collectionIds.length ? `#${tags.find((item) => item.id === selection.tagIds[0])?.name ?? ""}` : "") : "";
  return <div className="unified-source-picker">
    <button className={`source-selector ${draft ? "draft" : ""}`} type="button" disabled={disabled} onClick={() => setOpen((value) => !value)}><span>{draft ? <AtSign size={15} /> : <Library size={16} />}{only ? `${only}${selectedIds.length ? ` · ${selectedIds.length}` : ""}` : selectedIds.length ? `${selectedIds.length} ${selectedIds.length === 1 ? "fuente" : "fuentes"}` : "Toda la biblioteca"}</span><ChevronDown size={15} /></button>
    {open && <div className="unified-source-popover">
      <header><div><strong>Fuentes del chat</strong><small>Puedes combinar espacios, etiquetas y fuentes.</small></div><button type="button" onClick={() => setOpen(false)} aria-label="Cerrar"><X size={16} /></button></header>
      <nav><button type="button" className={tab === "collections" ? "active" : ""} onClick={() => setTab("collections")}><Folder size={14} /> Espacios</button><button type="button" className={tab === "tags" ? "active" : ""} onClick={() => setTab("tags")}><Hash size={14} /> Etiquetas</button><button type="button" className={tab === "videos" ? "active" : ""} onClick={() => setTab("videos")}><Bookmark size={14} /> Fuentes</button></nav>
      <div className="unified-source-options">
        {tab === "collections" && collections.map((item) => <label key={item.id}><input type="checkbox" checked={selection.collectionIds.includes(item.id)} onChange={() => onChange({ ...selection, collectionIds: toggle(selection.collectionIds, item.id) })} /><Folder size={16} style={{ color: item.color }} /><span><strong>{item.name}</strong><small>{videos.filter((video) => video.status === "ready" && video.collections.some((candidate) => candidate.id === item.id)).length} fuentes listas</small></span></label>)}
        {tab === "videos" && videos.filter((video) => video.status === "ready").map((video) => {
          const inherited = selectedIds.includes(video.id) && !selection.videoIds.includes(video.id) || video.tags.some((item) => selection.tagIds.includes(item.id));
          const checked = selection.videoIds.includes(video.id) || (inherited && !selection.excludedVideoIds.includes(video.id));
          return <label key={video.id}><input type="checkbox" checked={checked} onChange={() => {
            if (inherited) onChange({ ...selection, excludedVideoIds: toggle(selection.excludedVideoIds, video.id), videoIds: selection.videoIds.filter((id) => id !== video.id) });
            else onChange({ ...selection, videoIds: toggle(selection.videoIds, video.id), excludedVideoIds: selection.excludedVideoIds.filter((id) => id !== video.id) });
          }} /><span className={`source-thumb ${video.sourceType !== "youtube" ? "x-source-mini" : ""}`} style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined}>{video.thumbnailUrl ? null : video.sourceType === "x" ? "𝕏" : video.sourceType === "reddit" ? "r/" : video.sourceType === "web" ? "Aa" : null}</span><span><strong>{video.title}</strong><small>{inherited ? "Incluido por grupo" : video.channel}</small></span></label>;
        })}
        {((tab === "collections" && !collections.length) || (tab === "tags" && !tags.length) || (tab === "videos" && !videos.some((video) => video.status === "ready"))) && <p>No hay opciones disponibles todavía.</p>}
      </div>
    </div>}
  </div>;
}

export function UnifiedChatWorkspace({ conversationId, videos, collections, tags, models, initialSelection, initialTitle = "", onOpenConversation, onConversationChanged, compact = false, starter = false }: {
  conversationId?: string | null;
  videos: AppVideo[];
  collections: Taxonomy[];
  tags: Taxonomy[];
  models: AvailableModel[];
  initialSelection?: ChatSourceSelection;
  initialTitle?: string;
  onOpenConversation: (id: string) => void;
  onConversationChanged: () => void;
  compact?: boolean;
  starter?: boolean;
}) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [selection, setSelection] = useState<ChatSourceSelection>(initialSelection || emptySelection());
  const [question, setQuestion] = useState("");
  const [draftTitle, setDraftTitle] = useState(initialTitle);
  const [modelId, setModelId] = useState<AvailableModel["id"]>(() => {
    // Si llega un modelo pedido (p. ej. Luna para relacionar fuentes), se queda elegido para seguir la conversación.
    try { const wanted = !conversationId && typeof window !== "undefined" ? window.sessionStorage.getItem("lumina-new-chat-model") : ""; const found = models.find((item) => item.id === wanted); if (found) return found.id; } catch { /* sin almacenamiento */ }
    return models[0]?.id || "auto";
  });
  const [loading, setLoading] = useState(Boolean(conversationId));
  const [generatingTurn, setGeneratingTurn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [mention, setMention] = useState<{ query: string; start: number; end: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const activeIds = useMemo(() => effectiveVideoIds(selection, videos, collections), [selection, videos, collections]);
  const mentionOptions = useMemo(() => {
    if (!mention) return [];
    const query = normalizeMention(mention.query);
    const options: MentionOption[] = [
      ...collections.map((item) => ({ id: item.id, kind: "collection" as const, label: item.name, detail: "Colección", selected: selection.collectionIds.includes(item.id) })),
      ...tags.map((item) => ({ id: item.id, kind: "tag" as const, label: item.name, detail: "Etiqueta", selected: selection.tagIds.includes(item.id) })),
      ...videos.filter((video) => video.status === "ready").map((video) => ({ id: video.id, kind: "video" as const, label: video.title, detail: video.channel || (video.sourceType === "x" ? "Publicación de X" : video.sourceType === "reddit" ? "Publicación de Reddit" : video.sourceType === "web" ? "Artículo web" : "Video de YouTube"), selected: activeIds.includes(video.id) })),
    ];
    return options.filter((option) => !query || normalizeMention(`${option.label} ${option.detail}`).includes(query)).slice(0, 8);
  }, [activeIds, collections, mention, selection.collectionIds, selection.tagIds, tags, videos]);

  const loadConversation = useCallback(async () => {
    if (!conversationId) { setDetail(null); setLoading(false); return null; }
    const result = await readJson<ConversationDetail>(`/api/conversations/${conversationId}`);
    setDetail(result); setSelection(result.selection); setLoading(false);
    // Las preguntas siguientes usan el mismo modelo que la última.
    const lastModel = [...result.messages].reverse().find((message) => message.role === "user")?.modelId;
    if (lastModel && models.some((item) => item.id === lastModel)) setModelId(lastModel);
    try { window.sessionStorage.removeItem("lumina-new-chat-model"); } catch { /* sin almacenamiento */ }
    return result;
  }, [conversationId, models]);

  const generate = useCallback(async (id: string, turnId: string) => {
    if (generatingTurn === turnId) return;
    setGeneratingTurn(turnId); setError("");
    try {
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: id, turnId }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || "No se pudo responder."); }
      await response.text();
      await loadConversation();
      onConversationChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo responder.");
      await loadConversation().catch(() => null);
    } finally { setGeneratingTurn(null); }
  }, [generatingTurn, loadConversation, onConversationChanged]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConversation().then((result) => {
      const queued = result?.turns.find((turn) => turn.status === "queued");
      if (queued && conversationId) void generate(conversationId, queued.id);
    }).catch((cause) => { setLoading(false); setError(cause instanceof Error ? cause.message : "No pudimos abrir esta conversación."); }); }, 0);
    return () => window.clearTimeout(timer);
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [detail?.messages, generatingTurn]);

  async function saveSelection(next: ChatSourceSelection) {
    setSelection(next);
    if (!conversationId) return;
    try {
      const result = await readJson<ConversationDetail>(`/api/conversations/${conversationId}/sources`, { method: "PUT", body: JSON.stringify(next) });
      setDetail(result); onConversationChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudieron guardar las fuentes."); }
  }

  // Pregunta que llega lista desde otra pantalla (p. ej. «Relacionar con IA» en la selección): se envía sola una vez.
  const autoAsked = useRef(false);
  useEffect(() => {
    if (conversationId || autoAsked.current) return;
    let pending = "";
    let model = "";
    try {
      pending = window.sessionStorage.getItem("lumina-new-chat-question") || ""; window.sessionStorage.removeItem("lumina-new-chat-question");
      model = window.sessionStorage.getItem("lumina-new-chat-model") || ""; window.sessionStorage.removeItem("lumina-new-chat-model");
    } catch { pending = ""; }
    if (!pending) return;
    autoAsked.current = true;
    const chosen = models.find((item) => item.id === model)?.id;
    window.setTimeout(() => void ask(pending, chosen), 0);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(value = question, modelOverride?: AvailableModel["id"]) {
    const model = modelOverride || modelId;
    const prompt = value.trim();
    if (!prompt || generatingTurn) return;
    setQuestion(""); setError("");
    try {
      if (!conversationId) {
        const created = await readJson<{ conversationId: string }>("/api/conversations", { method: "POST", body: JSON.stringify({ question: prompt, title: draftTitle.trim() || undefined, sourceSelection: selection, modelId: model }) });
        onConversationChanged(); onOpenConversation(created.conversationId);
        return;
      }
      const created = await readJson<{ turnId: string }>(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ question: prompt, modelId: model }) });
      await loadConversation(); onConversationChanged();
      await generate(conversationId, created.turnId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la pregunta."); }
  }

  function updateQuestion(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const match = beforeCursor.match(/(^|\s)@([^\s@]*)$/);
    setQuestion(value);
    if (!match) { setMention(null); return; }
    const start = cursor - match[2].length - 1;
    setMention({ query: match[2], start, end: cursor });
    setMentionIndex(0);
  }

  function chooseMention(option: MentionOption) {
    if (!mention) return;
    let next = selection;
    if (option.kind === "collection" && !selection.collectionIds.includes(option.id)) next = { ...selection, collectionIds: [...selection.collectionIds, option.id] };
    if (option.kind === "tag" && !selection.tagIds.includes(option.id)) next = { ...selection, tagIds: [...selection.tagIds, option.id] };
    if (option.kind === "video" && !activeIds.includes(option.id)) next = { ...selection, videoIds: [...selection.videoIds, option.id], excludedVideoIds: selection.excludedVideoIds.filter((id) => id !== option.id) };
    const nextQuestion = `${question.slice(0, mention.start)}${question.slice(mention.end)}`;
    const cursor = mention.start;
    setQuestion(nextQuestion);
    setMention(null);
    setMentionIndex(0);
    void saveSelection(next);
    window.requestAnimationFrame(() => {
      questionRef.current?.focus();
      questionRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function handleQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention) {
      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((index) => mentionOptions.length ? (index + 1) % mentionOptions.length : 0); return; }
      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((index) => mentionOptions.length ? (index - 1 + mentionOptions.length) % mentionOptions.length : 0); return; }
      if (event.key === "Escape") { event.preventDefault(); setMention(null); return; }
      if (event.key === "Enter") { event.preventDefault(); if (mentionOptions[mentionIndex]) chooseMention(mentionOptions[mentionIndex]); return; }
    }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void ask(); }
  }

  const mentionMenu = mention && <div className="context-mention-menu" role="listbox" aria-label="Agregar contexto">
    <header><AtSign size={14} /><span>Agregar contexto</span><small>Escribe para filtrar</small></header>
    <div>{mentionOptions.map((option, index) => <button key={`${option.kind}-${option.id}`} type="button" role="option" aria-selected={index === mentionIndex} className={index === mentionIndex ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseMention(option)}>
      <span>{option.kind === "collection" ? <Folder size={15} /> : option.kind === "tag" ? <Hash size={15} /> : <Play size={14} />}</span>
      <span><strong>{option.label}</strong><small>{option.detail}</small></span>
      {option.selected && <Check size={15} />}
    </button>)}{!mentionOptions.length && <p>No encontramos una fuente con ese nombre.</p>}</div>
  </div>;

  const failedTurns = detail?.turns.filter((turn) => turn.status === "failed") || [];
  const isDraft = !conversationId && (!compact || starter);
  return <main className={`unified-chat-workspace ${compact ? "compact" : ""} ${isDraft ? "is-draft" : ""}`}>
    {!compact && !isDraft && <header className="unified-chat-header"><div><MessageCircle size={19} /><div><strong>{detail?.conversation.title || "Nuevo chat"}</strong><small>{activeIds.length ? `${activeIds.length} ${activeIds.length === 1 ? "fuente activa" : "fuentes activas"}` : "Toda tu biblioteca"}</small></div></div></header>}
    <section className="unified-chat-card">
      {isDraft ? <div className="recall-new-chat">
        <span className="new-chat-mark"><MessageCircle size={17} /> Chat con Lúmina</span>
        <h1>Habla con tus conocimientos</h1>
        <form className="recall-draft-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
          {mentionMenu}
          <input className="conversation-title-input" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} maxLength={72} placeholder="Título de la conversación (opcional)" aria-label="Título de la conversación" />
          <textarea ref={questionRef} value={question} onChange={updateQuestion} onKeyDown={handleQuestionKeyDown} placeholder={activeIds.length ? "Pregunta a tus fuentes…" : "Pregunta a toda tu biblioteca… o escribe @ para elegir fuentes"} aria-label="Pregunta" />
          <footer><SourcePicker draft selection={selection} onChange={(next) => void saveSelection(next)} videos={videos} collections={collections} tags={tags} /><div><select aria-label="Modelo" value={modelId} onChange={(event) => setModelId(event.target.value as AvailableModel["id"])}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select><button disabled={!question.trim()} aria-label="Enviar pregunta"><ArrowUpRight size={19} /></button></div></footer>
        </form>
        {error && <p className="unified-chat-error"><CircleAlert size={15} />{error}</p>}
      </div> : <>
        <div className="unified-chat-toolbar"><SourcePicker selection={selection} onChange={(next) => void saveSelection(next)} videos={videos} collections={collections} tags={tags} /><select aria-label="Modelo" value={modelId} onChange={(event) => setModelId(event.target.value as AvailableModel["id"])}>{models.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></div>
        <div className="unified-active-sources">{videos.filter((video) => activeIds.includes(video.id)).slice(0, 6).map((video) => <span key={video.id}><i className={video.sourceType !== "youtube" ? "x-source-mini" : ""} style={video.thumbnailUrl ? { backgroundImage: `url(${video.thumbnailUrl})` } : undefined}>{video.thumbnailUrl ? null : video.sourceType === "x" ? "𝕏" : video.sourceType === "reddit" ? "r/" : video.sourceType === "web" ? "Aa" : null}</i>{video.title}</span>)}{activeIds.length > 6 && <small>+{activeIds.length - 6}</small>}</div>
        <div className="unified-chat-messages" ref={scrollRef}>
          {loading && <LoaderCircle className="spin" size={22} />}
          {!loading && !detail?.messages.length && <div className="unified-chat-empty"><span><Sparkles size={25} /></span><h1>{activeIds.length ? "Habla con tus conocimientos" : "Pregunta a toda tu biblioteca"}</h1><p>{activeIds.length ? "Pregunta, compara y encuentra relaciones. Cada respuesta conservará las fuentes exactas utilizadas." : "Busco en todo lo que has guardado y cito cada tarjeta. Si prefieres, elige fuentes con @."}</p>{activeIds.length > 0 && <div><button onClick={() => void ask("Resume las ideas más importantes de estas fuentes")}>Resumir ideas</button><button onClick={() => void ask("¿Qué relaciones existen entre estas fuentes?")}>Encontrar relaciones</button><button onClick={() => void ask("Compara los puntos de vista de estas fuentes")}>Comparar perspectivas</button></div>}{!activeIds.length && <div><button onClick={() => void ask("¿De qué temas he guardado más cosas últimamente?")}>Mis temas recientes</button><button onClick={() => void ask("¿Qué he guardado sobre inteligencia artificial local?")}>IA local</button><button onClick={() => void ask("¿Qué ideas se repiten entre mis fuentes?")}>Ideas que se repiten</button></div>}</div>}
          {detail?.messages.map((message) => <article key={message.id} className={`unified-message ${message.role}`}><span>{message.role === "assistant" ? <Sparkles size={15} /> : "Tú"}</span><div>{message.role === "assistant" ? <AnswerText content={message.content} citations={message.citations} /> : <p>{message.content}</p>}{message.role === "assistant" && <SaveAnswer message={message} question={detail.messages[detail.messages.indexOf(message) - 1]?.content || ""} />}{message.citations.length > 0 && <div className="unified-citations">{message.citations.map((citation, index) => <a key={`${citation.videoId}-${citation.startSeconds}-${index}`} href={citationHref(citation)} target="_blank" rel="noreferrer"><b className="cite-num">{index + 1}</b>{citation.sourceType !== "youtube" ? <ExternalLink size={11} /> : <Play size={11} fill="currentColor" />}<span>{citation.videoTitle || citation.label}</span><small>{citation.sourceKind === "note" ? "Nota" : citation.sourceKind === "summary" ? "Resumen" : citation.sourceType === "web" ? "Sección" : citation.sourceType !== "youtube" ? "Publicación" : formatTimestamp(citation.startSeconds)}</small></a>)}</div>}</div></article>)}
          {generatingTurn && <article className="unified-message assistant"><span><Sparkles size={15} /></span><div><i className="scope-typing"><b /><b /><b /></i></div></article>}
          {failedTurns.map((turn) => <button key={turn.id} className="chat-retry" onClick={() => conversationId && void generate(conversationId, turn.id)}><RotateCcw size={14} /> Reintentar respuesta</button>)}
        </div>
        {error && <p className="unified-chat-error"><CircleAlert size={15} />{error}</p>}
        <form className="unified-composer" onSubmit={(event) => { event.preventDefault(); void ask(); }}>{mentionMenu}<textarea ref={questionRef} value={question} onChange={updateQuestion} onKeyDown={handleQuestionKeyDown} placeholder={activeIds.length ? "Pregunta, compara o conecta estas fuentes…" : "Pregunta a toda tu biblioteca… o escribe @ para elegir fuentes"} /><button disabled={!question.trim() || Boolean(generatingTurn)} aria-label="Enviar pregunta">{generatingTurn ? <LoaderCircle className="spin" size={19} /> : <ArrowUpRight size={20} />}</button></form>
      </>}
    </section>
  </main>;
}

// Respuesta de la IA con formato: párrafos, **negritas** y citas [S n] como números que llevan a su fuente.
function AnswerText({ content, citations }: { content: string; citations: Citation[] }) {
  // Respuestas antiguas no guardan el número [S n] de cada cita: se deduce por orden de aparición (así se guardaron).
  const hasRefs = citations.some((citation) => citation.ref);
  const order = [...new Set([...content.matchAll(/\[S(\d+)/g)].map((match) => Number(match[1])))];
  const numberOf = (ref: number) => {
    const index = hasRefs ? citations.findIndex((citation) => citation.ref === ref) : order.indexOf(ref);
    return index >= 0 && index < citations.length ? index : null;
  };
  const inline = (text: string, key: string) => text.split(/(\*\*[^*]+\*\*|(?:\[S\d+[^\]]*\])+)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${index}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("[S")) {
      const numbers = [...new Set([...part.matchAll(/\[S(\d+)/g)].map((match) => numberOf(Number(match[1]))).filter((value): value is number => value !== null))];
      return <span key={`${key}-${index}`} className="cite-group">{numbers.map((number) => <a key={number} className="cite-num" href={citationHref(citations[number])} target="_blank" rel="noreferrer" title={citations[number].videoTitle || citations[number].label}>{number + 1}</a>)}</span>;
    }
    return part;
  });
  return <div className="answer-text">{content.split(/\n{2,}/).map((block, index) => {
    const lines = block.split("\n");
    const heading = lines[0].match(/^#{1,4}\s+(.*)$/);
    if (heading && lines.length === 1) return <h4 key={index}>{inline(heading[1], `${index}`)}</h4>;
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) return <ol key={index} start={Number(lines[0].match(/\d+/)?.[0] || 1)}>{lines.map((line, item) => <li key={item}>{inline(line.replace(/^\s*\d+[.)]\s+/, ""), `${index}-${item}`)}</li>)}</ol>;
    if (heading) return <div key={index}><h4>{inline(heading[1], `${index}`)}</h4><p>{lines.slice(1).map((line, item) => <span key={item}>{item > 0 && <br />}{inline(line, `${index}-${item}`)}</span>)}</p></div>;
    if (lines.every((line) => /^\s*[-•*]\s+/.test(line))) return <ul key={index}>{lines.map((line, item) => <li key={item}>{inline(line.replace(/^\s*[-•*]\s+/, ""), `${index}-${item}`)}</li>)}</ul>;
    return <p key={index}>{lines.map((line, item) => <span key={item}>{item > 0 && <br />}{inline(line, `${index}-${item}`)}</span>)}</p>;
  })}</div>;
}

// Guarda una respuesta como nota en tu biblioteca, con sus fuentes al final.
function SaveAnswer({ message, question }: { message: ConversationMessage; question: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const save = async () => {
    setState("busy");
    const titles = [...new Set(message.citations.map((citation) => citation.videoTitle || citation.label))];
    const title = titles.length >= 2 ? `Relación: ${titles.slice(0, 3).map((item) => { const clean = item.split(/\s[|:·-]\s|[|:]/)[0].trim(); return clean.length > 36 ? `${clean.slice(0, 36).replace(/\s+\S*$/, "")}…` : clean; }).join(" × ")}` : (question || "Respuesta de LUMINA").slice(0, 90);
    const body = message.content.replace(/\[S(\d+)[^\]]*\]/g, (_, ref) => { const index = message.citations.findIndex((citation) => citation.ref === Number(ref)); return index >= 0 ? `[${index + 1}]` : ""; });
    const sources = message.citations.map((citation, index) => `${index + 1}. ${citation.videoTitle || citation.label}${citation.videoUrl ? ` — ${citation.videoUrl}` : ""}`).join("\n");
    const content = `# ${title}\n\n${question ? `> ${question}\n\n` : ""}${body}${sources ? `\n\n## Fuentes\n${sources}` : ""}`;
    try { await readJson("/api/notes", { method: "POST", body: JSON.stringify({ content }) }); setState("done"); }
    catch { setState("error"); }
  };
  return <button className={`answer-save ${state}`} disabled={state === "busy" || state === "done"} onClick={() => void save()} title="Guardar esta respuesta como nota en tu biblioteca">
    {state === "done" ? <><Check size={12} /> Guardada en tu biblioteca</> : state === "busy" ? <><LoaderCircle className="spin" size={12} /> Guardando…</> : state === "error" ? "No se pudo guardar · reintentar" : <><Bookmark size={12} /> Guardar como nota</>}
  </button>;
}
