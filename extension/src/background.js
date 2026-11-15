if (typeof globalThis.LuminaShared === "undefined" && typeof importScripts === "function") importScripts("common.js");

const extensionApi = globalThis.browser || globalThis.chrome;
const DEFAULTS = { serverUrl: "http://localhost:3000", token: "", resurface: true, defaultMode: "process", floatingButtons: true, askNote: false };

async function settings() {
  const values = await extensionApi.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...values, serverUrl: String(values.serverUrl || DEFAULTS.serverUrl).replace(/\/$/, "") };
}

async function activeTab() {
  const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function collectTabMetadata(tab) {
  if (!tab?.id || !/^https?:/.test(tab.url || "")) throw new Error("Esta página no se puede guardar.");
  try {
    const [result] = await extensionApi.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.LuminaShared?.pageMetadata(document, location) || {
      url: location.href,
      title: document.querySelector('meta[property="og:title"]')?.content || document.title,
      description: document.querySelector('meta[property="og:description"]')?.content || document.querySelector('meta[name="description"]')?.content || "",
      imageUrl: document.querySelector('meta[property="og:image"]')?.content || "",
      author: document.querySelector('meta[name="author"]')?.content || "",
      siteName: document.querySelector('meta[property="og:site_name"]')?.content || location.hostname.replace(/^www\./, ""),
      publishedAt: document.querySelector('meta[property="article:published_time"]')?.content || "",
      keywords: document.querySelector('meta[name="keywords"]')?.content || "",
    } });
    return result?.result || { url: tab.url, title: tab.title || tab.url, description: "", imageUrl: "", author: "", siteName: new URL(tab.url).hostname, publishedAt: "", keywords: "" };
  } catch {
    return { url: tab.url, title: tab.title || tab.url, description: "", imageUrl: "", author: "", siteName: new URL(tab.url).hostname, publishedAt: "", keywords: "" };
  }
}

async function request(path, body) {
  const config = await settings();
  if (!config.token) throw new Error("Vincula la extensión con Lúmina en Ajustes.");
  const response = await fetch(`${config.serverUrl}${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Lúmina no respondió.");
  return payload;
}

async function showSaved() {
  await extensionApi.action.setBadgeBackgroundColor({ color: "#e75e3a" });
  await extensionApi.action.setBadgeText({ text: "✓" });
  setTimeout(() => extensionApi.action.setBadgeText({ text: "" }), 1800);
}

async function showFailure() {
  await extensionApi.action.setBadgeBackgroundColor({ color: "#b23a1d" });
  await extensionApi.action.setBadgeText({ text: "!" });
  setTimeout(() => extensionApi.action.setBadgeText({ text: "" }), 4000);
}

function quietly(task) {
  task.catch(() => showFailure());
}

// Reddit y X se leen desde la pestaña abierta; el resto de páginas se envían con sus metadatos.
async function readStructured(tab) {
  if (!tab?.id) return null;
  try {
    const [result] = await extensionApi.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.LuminaPage?.readStructuredPage(document) || null });
    return result?.result || null;
  } catch {
    return null;
  }
}

async function remember(result, title) {
  await extensionApi.storage.local.set({ lastCapture: { ...result, title, at: Date.now() } });
  await showSaved();
}

async function captureStructured(data, options = {}) {
  const config = await settings();
  const tags = options.tags || globalThis.LuminaShared.proposeTags({ url: data.url, title: data.parentTitle || data.title, description: data.description });
  const analyze = options.mode ? options.mode === "process" : config.defaultMode !== "save";
  const result = await request("/api/extension/structured", { ...data, tagCatalogKeys: tags.map((tag) => tag.key), analyze, clip: options.clip || "" });
  await remember(result, data.title);
  // El aviso muestra las etiquetas reales de LUMINA (las propuestas locales son solo una pista para el servidor).
  return { ...result, title: data.title, tags: result.tags || [], askNote: config.askNote };
}

async function capture(metadata, mode, options = {}) {
  const config = await settings();
  const tags = options.tags || globalThis.LuminaShared.proposeTags(metadata);
  const result = await request("/api/extension/capture", { ...metadata, tagCatalogKeys: tags.map((tag) => tag.key), mode: mode || config.defaultMode, clip: options.clip || "" });
  await remember(result, metadata.title);
  return { ...result, title: metadata.title, tags: result.tags || [], askNote: config.askNote };
}

async function captureTab(tab, options = {}) {
  const structured = await readStructured(tab);
  if (structured?.items?.length) return captureStructured(structured, options);
  return capture(await collectTabMetadata(tab), options.mode, options);
}

// Carpetas para el selector: las portadas que viven en Lúmina se piden con la dirección completa.
async function boardsForPicker() {
  const config = await settings();
  const result = await request("/api/extension/boards");
  const { boardUses = {} } = await extensionApi.storage.local.get("boardUses");
  const boards = (result.boards || []).map((board) => ({ ...board, cover: board.cover && board.cover.startsWith("/") ? `${config.serverUrl}${board.cover}` : board.cover || "" }));
  const recentIds = Object.entries(boardUses).sort((a, b) => b[1] - a[1]).map(([id]) => id).filter((id) => boards.some((board) => board.id === id));
  return { boards, recentIds };
}

async function collect(id, collectionId) {
  const result = await request("/api/extension/collect", { id, collectionId });
  const { boardUses = {} } = await extensionApi.storage.local.get("boardUses");
  await extensionApi.storage.local.set({ boardUses: { ...boardUses, [collectionId]: Date.now() } });
  return result;
}

async function intoBoard(task, boardId) {
  const result = await task;
  if (!boardId || !result?.id) return result;
  const outcome = await collect(result.id, boardId);
  return { ...result, board: outcome.board };
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

// La imagen se descarga desde Firefox (con su caché y sesión); si no se puede, Lúmina la pide por su cuenta.
async function saveImage(srcUrl, pageUrl, title) {
  const config = await settings();
  let bytesBase64 = "";
  try {
    const response = await fetch(srcUrl, { credentials: "include" });
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength <= 20 * 1024 * 1024) bytesBase64 = toBase64(buffer);
    }
  } catch { /* se intenta desde el servidor */ }
  if (!bytesBase64 && !/^https?:/.test(srcUrl)) throw new Error("No se pudo leer esa imagen.");
  const result = await request("/api/extension/image", { srcUrl: /^https?:/.test(srcUrl) ? srcUrl : "", bytesBase64, pageUrl, title });
  await remember(result, title || "Imagen");
  return { ...result, title: title || "Imagen", tags: [], askNote: config.askNote };
}

// Carrusel: cada foto se descarga desde Firefox y se envía junta para crear una sola tarjeta.
async function saveGallery(message) {
  const config = await settings();
  const images = [];
  for (const url of message.urls || []) {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) continue;
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength <= 20 * 1024 * 1024) images.push(toBase64(buffer));
    } catch { /* una foto que no se pudo leer no frena las demás */ }
  }
  if (!images.length) throw new Error("No se pudieron leer las fotos de la galería.");
  const result = await request("/api/extension/gallery", { images, pageUrl: message.pageUrl, title: message.title, author: message.author });
  await remember(result, message.title || "Galería");
  return { ...result, tags: [], askNote: config.askNote };
}

function linkMetadata(url, title) {
  return { url, title: title || url, description: "", imageUrl: "", author: "", siteName: new URL(url).hostname.replace(/^www\./, ""), publishedAt: "", keywords: "" };
}

// Tras guardar desde el menú, un atajo o un botón, la página muestra la confirmación (y la nota si así lo pides).
function report(tab, task) {
  task.then((result) => {
    if (tab?.id) extensionApi.tabs.sendMessage(tab.id, { type: "LUMINA_TOAST", result }).catch?.(() => {});
  }).catch((error) => {
    showFailure();
    if (tab?.id) extensionApi.tabs.sendMessage(tab.id, { type: "LUMINA_TOAST", result: { error: error instanceof Error ? error.message : "No se pudo guardar." } }).catch?.(() => {});
  });
}

async function resurface(metadata, suppliedTags) {
  const config = await settings();
  if (!config.token || !config.resurface) { await extensionApi.action.setBadgeText({ text: "" }); return { items: [] }; }
  const tags = suppliedTags?.length ? suppliedTags : globalThis.LuminaShared.proposeTags(metadata);
  const result = await request("/api/extension/resurface", { url: metadata.url, title: metadata.title, description: metadata.description, tagCatalogKeys: tags.map((tag) => tag.key) });
  await extensionApi.storage.local.set({ lastRelated: { url: metadata.url, items: result.items || [], at: Date.now() } });
  await extensionApi.action.setBadgeBackgroundColor({ color: "#6f7f55" });
  await extensionApi.action.setBadgeText({ text: result.items?.length ? String(result.items.length) : "" });
  return result;
}

async function captureCurrent(mode) {
  return captureTab(await activeTab(), { mode });
}

extensionApi.runtime.onInstalled.addListener(() => {
  extensionApi.contextMenus.removeAll().then?.(() => {
    extensionApi.contextMenus.create({ id: "lumina-save-page", title: "Guardar en Lúmina", contexts: ["page"] });
    extensionApi.contextMenus.create({ id: "lumina-save-link", title: "Guardar enlace en Lúmina", contexts: ["link"] });
    extensionApi.contextMenus.create({ id: "lumina-save-clip", title: "Guardar recorte en Lúmina", contexts: ["selection"] });
    extensionApi.contextMenus.create({ id: "lumina-save-image", title: "Guardar imagen en Lúmina", contexts: ["image"] });
  });
});

extensionApi.commands.onCommand.addListener(async (command) => {
  if (command !== "save-current") return;
  const tab = await activeTab();
  report(tab, captureTab(tab));
});

extensionApi.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "lumina-save-link" && info.linkUrl) return report(tab, capture(linkMetadata(info.linkUrl, info.linkText), undefined));
  if (info.menuItemId === "lumina-save-image" && info.srcUrl) return report(tab, saveImage(info.srcUrl, info.pageUrl || "", tab?.title || ""));
  if (info.menuItemId === "lumina-save-clip" && tab) return report(tab, captureTab(tab, { clip: info.selectionText || "" }));
  if (tab) report(tab, captureTab(tab));
});

extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "LUMINA_GET_CONTEXT") {
      const metadata = await collectTabMetadata(await activeTab());
      const tags = globalThis.LuminaShared.proposeTags(metadata);
      const config = await settings();
      const related = await extensionApi.storage.local.get("lastRelated");
      return { metadata, tags, config: { serverUrl: config.serverUrl, connected: Boolean(config.token), defaultMode: config.defaultMode, askNote: config.askNote }, related: related.lastRelated?.url === metadata.url ? related.lastRelated.items || [] : [] };
    }
    if (message.type === "LUMINA_CAPTURE") return captureTab(await activeTab(), { mode: message.mode, tags: message.tags });
    if (message.type === "LUMINA_SAVE_STRUCTURED") return intoBoard(captureStructured(message.data, typeof message.analyze === "boolean" ? { mode: message.analyze ? "process" : "save" } : {}), message.boardId);
    if (message.type === "LUMINA_SAVE_IMAGE") return intoBoard(saveImage(message.srcUrl, message.pageUrl, message.title), message.boardId);
    if (message.type === "LUMINA_SAVE_LINK") return intoBoard(capture(linkMetadata(message.url, message.title), undefined), message.boardId);
    if (message.type === "LUMINA_SAVE_PAGE") return intoBoard(captureTab(sender.tab), message.boardId);
    if (message.type === "LUMINA_SAVE_GALLERY") return intoBoard(saveGallery(message), message.boardId);
    if (message.type === "LUMINA_BOARDS") return boardsForPicker();
    if (message.type === "LUMINA_CREATE_BOARD") return request("/api/extension/boards", { name: message.name });
    if (message.type === "LUMINA_COLLECT") return collect(message.id, message.collectionId);
    if (message.type === "LUMINA_ITEM") return request(`/api/extension/item?id=${encodeURIComponent(message.id)}`);
    if (message.type === "LUMINA_ADD_NOTE") return request("/api/extension/note", { id: message.id, note: message.note });
    if (message.type === "LUMINA_OPEN") { const config = await settings(); await extensionApi.tabs.create({ url: `${config.serverUrl}${message.path || "/"}` }); return { ok: true }; }
    if (message.type === "LUMINA_PAGE_CONTEXT") return resurface(message.metadata, message.tags);
    return { ok: false };
  })().then(sendResponse).catch((error) => sendResponse({ error: error instanceof Error ? error.message : "No se pudo completar la acción." }));
  return true;
});
