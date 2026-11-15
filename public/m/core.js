/* Lógica compartida entre la página y el service worker de LUMINA en el celular.
   Lo compartido se guarda primero aquí, en el celular (IndexedDB), y se envía a la Mac cuando está al alcance. */
(function (scope) {
  const DB_NAME = "lumina-mobile";
  let dbPromise = null;

  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        database.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
        database.createObjectStore("sent", { keyPath: "id", autoIncrement: true });
        database.createObjectStore("meta");
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

  // Si llega algo nuevo mientras se envía, se manda en la misma tanda.
  function flush() {
    if (flushing) { again = true; return flushing; }
    flushing = (async () => {
      let total = 0;
      let last;
      do { again = false; last = await flushOnce(); total += last.sent; } while (again && last.state === "online");
      return { ...last, sent: total };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  scope.LuminaCore = { getMeta, setMeta, list, remove, put, enqueueShare, flush, ping, firstUrl };
})(self);
