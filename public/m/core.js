/* Lógica compartida entre la página y el service worker de LUMINA en el celular.
   Lo compartido se guarda primero aquí, en el celular (IndexedDB), y se envía a la Mac cuando está al alcance. */
(function (scope) {
  const DB_NAME = "lumina-mobile";
  let dbPromise = null;

  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        const has = (name) => database.objectStoreNames.contains(name);
        if (!has("queue")) database.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
        if (!has("sent")) database.createObjectStore("sent", { keyPath: "id", autoIncrement: true });
        if (!has("meta")) database.createObjectStore("meta");
        // Copia de la biblioteca para leer sin conexión, sus miniaturas y los cambios hechos fuera de casa.
        if (!has("thumbs")) database.createObjectStore("thumbs");
        if (!has("ops")) database.createObjectStore("ops", { keyPath: "id", autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }

  async function run(store, mode, action) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const result = action(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  const getMeta = (key) => run("meta", "readonly", (store) => store.get(key));
  const setMeta = (key, value) => run("meta", "readwrite", (store) => value === null || value === undefined ? store.delete(key) : store.put(value, key));
  const list = (store) => run(store, "readonly", (objects) => objects.getAll());
  const remove = (store, id) => run(store, "readwrite", (objects) => objects.delete(id));
  const put = (store, value) => run(store, "readwrite", (objects) => objects.put(value));
  const add = (store, value) => run(store, "readwrite", (objects) => objects.add(value));
  const getOne = (store, key) => run(store, "readonly", (objects) => objects.get(key));
  const putKey = (store, key, value) => run(store, "readwrite", (objects) => objects.put(value, key));
  const keys = (store) => run(store, "readonly", (objects) => objects.getAllKeys());
  const clear = (store) => run(store, "readwrite", (objects) => objects.clear());

  function firstUrl(text) {
    const match = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
    return match ? match[0].replace(/[),.;!?]+$/, "") : "";
  }

  // Convierte lo que llega por «Compartir» en elementos de la bandeja: cada imagen por separado, o un enlace, o una nota.
  async function enqueueShare({ title = "", text = "", url = "", files = [] }) {
    const now = Date.now();
    let count = 0;
    for (const file of files) {
      if (!file || !file.size || !/^image\//.test(file.type)) continue;
      await add("queue", { kind: "image", blob: file, name: file.name || "imagen", type: file.type, title: (title || "").slice(0, 200), createdAt: now, attempts: 0, error: "" });
      count += 1;
    }
    if (!count) {
      const link = url || firstUrl(text) || firstUrl(title);
      if (link) {
        const clean = String(text || "").replace(link, "").trim();
        await add("queue", { kind: "url", url: link, title: (title || "").slice(0, 240), text: clean.slice(0, 2000), createdAt: now, attempts: 0, error: "" });
        count = 1;
      } else if ((text || title).trim()) {
        await add("queue", { kind: "text", text: [title, text].filter(Boolean).join("\n\n").trim(), createdAt: now, attempts: 0, error: "" });
        count = 1;
      }
    }
    return count;
  }

  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 0x8000));
    return btoa(binary);
  }

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new TypeError("timeout")), ms))]);
  }

  async function request(path, token, body, ms = 60000) {
    return withTimeout(fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }), ms);
  }

  // ¿Está la Mac al alcance? (en casa, con LUMINA encendida)
  async function ping() {
    const token = await getMeta("token");
    if (!token) return { state: "unpaired" };
    try {
      const response = await withTimeout(fetch("/api/extension/ping", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }), 4000);
      if (response.status === 401) return { state: "revoked" };
      if (!response.ok) return { state: "away" };
      const data = await response.json();
      return { state: "online", name: data.profile && data.profile.name };
    } catch { return { state: "away" }; }
  }

  let flushing = null;
  let again = false;
  async function flushOnce() {
    const token = await getMeta("token");
    if (!token) return { sent: 0, pending: (await list("queue")).length, state: "unpaired" };
    const items = (await list("queue")).sort((a, b) => a.id - b.id);
    let sent = 0;
    for (const item of items) {
      let response;
      try {
        if (item.kind === "image") response = await request("/api/extension/image", token, { bytesBase64: await toBase64(item.blob), title: item.title || "" }, 120000);
        else if (item.kind === "url") response = await request("/api/extension/capture", token, { url: item.url, title: item.title || "", description: item.text || "", mode: "process" });
        else response = await request("/api/mobile/note", token, { text: item.text });
      } catch {
        // La Mac no está al alcance: todo queda en la bandeja para el próximo intento.
        return { sent, pending: items.length - sent, state: "away" };
      }
      if (response.status === 401) return { sent, pending: items.length - sent, state: "revoked" };
      let data = {};
      try { data = await response.json(); } catch { data = {}; }
      if (response.ok) {
        await remove("queue", item.id);
        const label = item.kind === "image" ? (item.title || (item.name || "").replace(/\.[a-z0-9]+$/i, "") || "Imagen") : item.kind === "url" ? (data.title || item.title || item.url) : item.text.slice(0, 80);
        await add("sent", { kind: item.kind, label, luminaUrl: data.luminaUrl || "", sentAt: Date.now(), duplicate: Boolean(data.duplicate) });
        sent += 1;
      } else {
        await put("queue", { ...item, attempts: (item.attempts || 0) + 1, error: data.error || `Error ${response.status}` });
      }
    }
    // Se guardan solo los últimos 30 enviados.
    const history = (await list("sent")).sort((a, b) => b.sentAt - a.sentAt);
    for (const old of history.slice(30)) await remove("sent", old.id);
    return { sent, pending: (await list("queue")).length, state: "online" };
  }

  // Cambio hecho en el celular: se aplica ya en la copia local y se envía a la Mac en cuanto esté al alcance.
  async function applyLocal(op) {
    const library = await getMeta("library");
    if (!library) return;
    const item = library.items.find((entry) => entry.id === op.itemId);
    if (!item) return;
    if (op.action === "consume") item.consumedAt = new Date().toISOString();
    if (op.action === "unconsume") item.consumedAt = null;
    if (op.action === "pin") item.pinned = true;
    if (op.action === "unpin") item.pinned = false;
    if (op.action === "note") item.note = op.content.trim() ? { content: op.content, updatedAt: item.note ? item.note.updatedAt : "" } : null;
    await setMeta("library", library);
  }

  async function queueOp(op) {
    const ops = await list("ops");
    // Para la nota y los interruptores basta con el último cambio pendiente de cada fuente.
    const family = (action) => action === "note" ? "note" : action.replace(/^un/, "");
    const previous = ops.find((entry) => entry.itemId === op.itemId && family(entry.action) === family(op.action));
    if (previous) {
      await remove("ops", previous.id);
      if (op.action !== "note" && previous.action !== op.action) { await applyLocal(op); return; }
      if (op.action === "note") op.baseUpdatedAt = previous.baseUpdatedAt;
    }
    await add("ops", { ...op, createdAt: Date.now() });
    await applyLocal(op);
  }

  async function flushOps(token) {
    const ops = (await list("ops")).sort((a, b) => a.id - b.id);
    for (const op of ops) {
      let response;
      try { response = await request("/api/mobile/action", token, { action: op.action, id: op.itemId, content: op.content, baseUpdatedAt: op.baseUpdatedAt }); }
      catch { return "away"; }
      if (response.status === 401) return "revoked";
      // Aceptado, o la fuente ya no existe: en ambos casos sale de la lista. Otros errores se reintentan luego.
      if (response.ok || response.status === 404) await remove("ops", op.id);
      else { let data = {}; try { data = await response.json(); } catch { data = {}; } await put("ops", { ...op, error: data.error || `Error ${response.status}` }); }
    }
    return "online";
  }

  async function syncLibrary() {
    const token = await getMeta("token");
    if (!token) return { state: "unpaired" };
    const opsState = await flushOps(token);
    if (opsState !== "online") return { state: opsState };
    let library;
    try {
      const response = await withTimeout(fetch("/api/mobile/library", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }), 30000);
      if (response.status === 401) return { state: "revoked" };
      if (!response.ok) return { state: "away" };
      library = await response.json();
    } catch { return { state: "away" }; }
    // Lo que se cambió en el celular mientras bajaba la copia sigue mandando.
    for (const op of (await list("ops")).sort((a, b) => a.id - b.id)) {
      const item = library.items.find((entry) => entry.id === op.itemId);
      if (!item) continue;
      if (op.action === "consume") item.consumedAt = item.consumedAt || new Date().toISOString();
      if (op.action === "unconsume") item.consumedAt = null;
      if (op.action === "pin" || op.action === "unpin") item.pinned = op.action === "pin";
      if (op.action === "note") item.note = op.content.trim() ? { content: op.content, updatedAt: item.note ? item.note.updatedAt : "" } : null;
    }
    await setMeta("library", library);
    await setMeta("libraryAt", Date.now());
    void syncThumbs(token, library.items);
    return { state: "online", count: library.items.length };
  }

  let thumbing = null;
  function syncThumbs(token, items) {
    if (thumbing) return thumbing;
    thumbing = (async () => {
      const wanted = new Map(items.filter((item) => item.thumb).map((item) => [item.id, item.thumb]));
      for (const key of await keys("thumbs")) if (!wanted.has(key)) await remove("thumbs", key);
      const missing = [];
      for (const [id, version] of wanted) { const stored = await getOne("thumbs", id); if (!stored || stored.version !== version) missing.push([id, version]); }
      const worker = async () => {
        while (missing.length) {
          const [id, version] = missing.shift();
          try {
            const response = await withTimeout(fetch(`/api/mobile/thumb/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }), 20000);
            if (response.ok) await putKey("thumbs", id, { version, blob: await response.blob() });
            else if (response.status === 404) await putKey("thumbs", id, { version, blob: null });
          } catch { return; }
          notifyThumb(id);
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
    })().finally(() => { thumbing = null; });
    return thumbing;
  }
  let thumbListener = null;
  function notifyThumb(id) { if (thumbListener) thumbListener(id); }
  function onThumb(listener) { thumbListener = listener; }
  const getThumb = (id) => getOne("thumbs", id);

  // Al desvincular, la copia sale del celular.
  async function forget() {
    await setMeta("token", null);
    await setMeta("library", null);
    await setMeta("libraryAt", null);
    await clear("thumbs");
    await clear("ops");
  }

  // Si llega algo nuevo mientras se envía, se manda en la misma tanda.
  function flush() {
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      let total = 0;
      let last;
      do { again = false; last = await flushOnce(); total += last.sent; } while (again && last.state === "online");
      if (last.state === "online") { const token = await getMeta("token"); if (token) await flushOps(token); }
      return { ...last, sent: total };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  scope.LuminaCore = { getMeta, setMeta, list, remove, put, enqueueShare, flush, ping, firstUrl, queueOp, syncLibrary, getThumb, onThumb, forget };
})(self);
