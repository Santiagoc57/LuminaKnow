/* Página de LUMINA en el celular: tu biblioteca (también sin conexión), la bandeja y vincular. */
(function () {
  const core = self.LuminaCore;
  const app = document.getElementById("app");
  const statusEl = document.getElementById("status");
  const toastEl = document.getElementById("toast");
  const sheet = document.getElementById("sheet");
  const PAGE = 60;
  let inboxUrls = [];
  const thumbUrls = new Map();
  let connection = { state: "checking" };
  let library = null;
  let libraryAt = 0;
  let syncing = false;
  const view = { tab: "library", query: "", folder: "all", shown: PAGE, detailId: null };

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const fold = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");
  const ago = (time) => {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "ahora";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
  };
  const TYPE_LABEL = { youtube: "Video", tiktok: "Video", instagram: "Publicación", x: "Publicación", reddit: "Publicación", web: "Página", article: "Artículo", image: "Imagen", pdf: "PDF", note: "Nota", audio: "Audio" };
  const typeLabel = (type) => TYPE_LABEL[type] || "Fuente";

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function setStatus() {
    const copy = libraryAt ? ` · copia de ${ago(libraryAt)}` : "";
    const labels = {
      checking: "Comprobando tu Mac…",
      online: syncing ? "Conectado · actualizando…" : `Conectado con tu Mac${connection.name ? ` · ${connection.name}` : ""}`,
      away: `Sin conexión con tu Mac${copy}`,
      unpaired: "Sin vincular",
      revoked: "Este celular fue desvinculado",
    };
    statusEl.textContent = labels[connection.state] || "";
    statusEl.className = connection.state === "online" ? "online" : "";
  }

  async function loadLocal() {
    library = (await core.getMeta("library")) || null;
    libraryAt = (await core.getMeta("libraryAt")) || 0;
  }

  // Trae la biblioteca de la Mac (y antes manda lo pendiente). Fuera de casa no hace nada y se usa la copia.
  async function sync() {
    if (syncing || connection.state !== "online") return;
    syncing = true;
    setStatus();
    const result = await core.syncLibrary();
    syncing = false;
    if (result.state === "revoked") connection = { state: "revoked" };
    else if (result.state === "away") connection = { state: "away" };
    await loadLocal();
    await render();
  }

  async function sendNow() {
    const button = document.getElementById("send");
    if (button) { button.disabled = true; button.textContent = "Enviando…"; }
    let result;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      result = await new Promise((resolve) => {
        const onMessage = (event) => { if (event.data && event.data.type === "flushed") { navigator.serviceWorker.removeEventListener("message", onMessage); resolve(event.data.result); } };
        navigator.serviceWorker.addEventListener("message", onMessage);
        navigator.serviceWorker.controller.postMessage("flush");
        setTimeout(() => resolve(null), 150000);
      });
    } else {
      result = await core.flush();
    }
    if (result) {
      if (result.state === "away") connection = { state: "away" };
      if (result.state === "revoked") connection = { state: "revoked" };
      if (result.sent) toast(result.sent === 1 ? "Enviado a tu Mac" : `${result.sent} enviados a tu Mac`);
      else if (result.state === "away" && result.pending) toast("Tu Mac no está al alcance. Queda en la bandeja.");
    }
    await render();
    if (result && result.sent) setTimeout(() => void sync(), 1500);
  }

  function pairView() {
    app.innerHTML = `
      <section class="card">
        <p class="lead">Vincula este celular con LUMINA.</p>
        <ol class="steps muted">
          <li>En tu Mac, abre LUMINA → Ajustes → <b>Celular</b>.</li>
          <li>Pulsa <b>Generar código</b> y escribe aquí las 6 cifras.</li>
        </ol>
      </section>
      <form id="pair" class="card" style="display:grid;gap:12px">
        <input id="code" class="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" aria-label="Código de 6 cifras">
        <button type="submit">Vincular</button>
        <p id="pair-error" class="muted" role="alert"></p>
      </form>`;
    document.getElementById("pair").addEventListener("submit", async (event) => {
      event.preventDefault();
      const code = document.getElementById("code").value.replace(/\D/g, "");
      const error = document.getElementById("pair-error");
      error.textContent = "";
      try {
        const response = await fetch("/api/mobile/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo vincular.");
        await core.setMeta("token", data.token);
        connection = await core.ping();
        toast("Celular vinculado");
        await render();
        if ((await core.list("queue")).length) await sendNow();
        await sync();
      } catch (cause) {
        error.textContent = cause instanceof TypeError ? "No se pudo hablar con tu Mac. ¿Estás en la Wi-Fi de casa?" : cause.message;
      }
    });
  }

  function tabs(queueCount) {
    return `<nav class="tabs" role="tablist">
      <button role="tab" class="${view.tab === "library" ? "active" : ""}" data-tab="library" aria-selected="${view.tab === "library"}">Biblioteca</button>
      <button role="tab" class="${view.tab === "inbox" ? "active" : ""}" data-tab="inbox" aria-selected="${view.tab === "inbox"}">Bandeja${queueCount ? ` <span class="badge">${queueCount}</span>` : ""}</button>
    </nav>`;
  }

  // ---------- Biblioteca ----------

  function haystack(item) {
    if (!item._hay) item._hay = fold([item.title, item.author, item.gist, item.points.join(" "), item.takeaways.join(" "), item.imageText, item.tags.map((tag) => tag.name).join(" "), item.note ? item.note.content : "", item.highlights.map((h) => `${h.quote} ${h.note}`).join(" "), typeLabel(item.type)].join(" "));
    return item._hay;
  }

  function filtered() {
    if (!library) return [];
    let items = library.items;
    if (view.folder === "pinned") items = items.filter((item) => item.pinned);
    else if (view.folder === "pending") items = items.filter((item) => !item.consumedAt && item.type !== "note");
    else if (view.folder !== "all") items = items.filter((item) => item.folderIds.includes(view.folder));
    const terms = fold(view.query).split(/\s+/).filter(Boolean);
    if (terms.length) items = items.filter((item) => terms.every((term) => term.startsWith("#") ? item.tags.some((tag) => fold(tag.name).startsWith(term.slice(1))) : haystack(item).includes(term)));
    return items;
  }

  function card(item) {
    // Sin imagen (notas, hilos de texto): se ve el texto, como una tarjeta de lectura.
    const text = item.type === "note" ? (item.note ? item.note.content : item.title) : item.gist;
    const body = item.thumb
      ? `<span class="cover" data-thumb="${escapeHtml(item.id)}"></span>`
      : `<p class="note-text">${escapeHtml((text || typeLabel(item.type)).slice(0, 220))}</p>`;
    return `<button class="tile${item.thumb ? "" : " is-text"}${item.type === "note" ? " is-note" : ""}" data-open="${escapeHtml(item.id)}">
      ${body}
      <span class="tile-meta"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.author || typeLabel(item.type))}${item.consumedAt ? " · leído" : ""}</small></span>
    </button>`;
  }

  function libraryView(queueCount) {
    if (!library) {
      app.innerHTML = `${tabs(queueCount)}<div class="card empty">${connection.state === "online" ? "Bajando tu biblioteca…" : "Todavía no hay copia en este celular. Abre la app en casa, con tu Mac encendida, y se descarga sola."}</div>`;
      bindTabs();
      return;
    }
    const folders = [{ id: "all", name: "Todo" }, { id: "pinned", name: "En mente" }, { id: "pending", name: "Sin leer" }, ...library.folders];
    const items = filtered();
    const visible = items.slice(0, view.shown);
    app.innerHTML = `${tabs(queueCount)}
      <div class="search"><input id="q" type="search" placeholder="${view.folder !== "all" && library.folders.find((f) => f.id === view.folder) ? `Buscar en ${escapeHtml(library.folders.find((f) => f.id === view.folder).name)}…` : "Buscar en Lúmina…"}" value="${escapeHtml(view.query)}" enterkeyhint="search" autocomplete="off"></div>
      <div class="chips">${folders.map((folder) => `<button class="chip${view.folder === folder.id ? " active" : ""}" data-folder="${escapeHtml(folder.id)}">${folder.color ? `<i style="border-color:${escapeHtml(folder.color)}"></i>` : ""}${escapeHtml(folder.name)}</button>`).join("")}</div>
      ${items.length ? `<p class="count muted">${items.length === 1 ? "1 fuente" : `${items.length} fuentes`}</p><div class="grid">${visible.map(card).join("")}</div>${items.length > visible.length ? `<div class="row"><button class="soft" id="more">Ver más</button></div>` : ""}`
        : `<div class="card empty">${view.query ? "Nada coincide con esa búsqueda." : "Aquí no hay nada todavía."}</div>`}`;
    bindTabs();
    const input = document.getElementById("q");
    input.addEventListener("input", () => {
      view.query = input.value;
      view.shown = PAGE;
      clearTimeout(libraryView.timer);
      libraryView.timer = setTimeout(async () => { await render(); const again = document.getElementById("q"); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } }, 180);
    });
    app.querySelectorAll("[data-folder]").forEach((button) => button.addEventListener("click", () => { view.folder = button.dataset.folder; view.shown = PAGE; void render(); }));
    app.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.open)));
    const more = document.getElementById("more");
    if (more) more.addEventListener("click", () => { view.shown += PAGE; void render(); });
    void paintThumbs(app);
  }

  async function thumbUrl(id) {
    if (thumbUrls.has(id)) return thumbUrls.get(id);
    const stored = await core.getThumb(id);
    if (!stored || !stored.blob) return "";
    const url = URL.createObjectURL(stored.blob);
    thumbUrls.set(id, url);
    return url;
  }

  async function paintThumbs(root) {
    for (const element of root.querySelectorAll("[data-thumb]")) {
      if (element.dataset.painted) continue;
      const url = await thumbUrl(element.dataset.thumb);
      if (!url) continue;
      element.dataset.painted = "1";
      element.style.backgroundImage = `url("${url}")`;
    }
  }

  core.onThumb((id) => {
    if (thumbUrls.has(id)) { URL.revokeObjectURL(thumbUrls.get(id)); thumbUrls.delete(id); }
    document.querySelectorAll(`[data-thumb="${CSS.escape(id)}"]`).forEach((element) => { delete element.dataset.painted; });
    void paintThumbs(document);
  });

  // ---------- Ficha ----------

  function openDetail(id) {
    view.detailId = id;
    history.pushState({ detail: id }, "", `/m/index.html#${encodeURIComponent(id)}`);
    renderDetail();
  }

  function closeDetail() {
    view.detailId = null;
    sheet.hidden = true;
    sheet.innerHTML = "";
    document.body.classList.remove("has-sheet");
  }

  window.addEventListener("popstate", () => { if (view.detailId) { closeDetail(); void render(); } });

  function renderDetail() {
    const item = library && library.items.find((entry) => entry.id === view.detailId);
    if (!item) { closeDetail(); return; }
    const list = (values) => values.length ? `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>` : "";
    sheet.innerHTML = `
      <div class="sheet-bar"><button class="icon" id="back" aria-label="Volver">←</button><span class="muted">${escapeHtml(typeLabel(item.type))}</span></div>
      <article class="detail">
        ${item.type === "note" ? "" : item.thumb ? `<span class="hero" data-thumb="${escapeHtml(item.id)}"></span>` : ""}
        <h1>${escapeHtml(item.title)}</h1>
        <p class="muted">${escapeHtml(item.author || "")}${item.author ? " · " : ""}Guardado ${escapeHtml(new Date(item.createdAt).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" }))}</p>
        ${item.tags.length ? `<div class="tags">${item.tags.map((tag) => `<button class="tag" data-tag="${escapeHtml(tag.name)}">${tag.catalog ? "◆ " : ""}${escapeHtml(tag.name)}</button>`).join("")}</div>` : ""}
        <div class="row actions-row">
          ${item.url ? `<a class="button" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Abrir original</a>` : ""}
          ${item.type === "note" ? "" : `<button class="soft${item.consumedAt ? " on" : ""}" id="consume">${item.consumedAt ? "✓ Leído" : "Ya leí esto"}</button>`}
          <button class="soft${item.pinned ? " on" : ""}" id="pin">${item.pinned ? "✓ En mente" : "En mente"}</button>
        </div>
        ${item.gist ? `<section><h2>Resumen</h2><p>${escapeHtml(item.gist)}</p>${list(item.points)}</section>` : item.status !== "ready" && item.type !== "note" ? `<section><p class="muted">Aún sin resumen.</p></section>` : ""}
        ${item.takeaways.length ? `<section><h2>Para llevarte</h2>${list(item.takeaways)}</section>` : ""}
        ${item.imageText && !item.gist ? `<section><h2>En la imagen</h2><p>${escapeHtml(item.imageText)}</p></section>` : ""}
        ${item.highlights.length ? `<section><h2>Subrayados</h2>${item.highlights.map((h) => `<blockquote>${escapeHtml(h.quote)}${h.note ? `<small>${escapeHtml(h.note)}</small>` : ""}</blockquote>`).join("")}</section>` : ""}
        <section><h2>${item.type === "note" ? "Nota" : "Tus notas"}</h2>
          <textarea id="note" rows="${item.type === "note" ? 10 : 5}" placeholder="Escribe una nota…">${escapeHtml(item.note ? item.note.content : "")}</textarea>
          <div class="row"><button id="save-note" disabled>Guardar nota</button></div>
        </section>
      </article>`;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    document.body.classList.add("has-sheet");
    void paintThumbs(sheet);
    document.getElementById("back").addEventListener("click", () => history.back());
    const toggle = async (on, off, current, done) => {
      await core.queueOp({ action: current ? off : on, itemId: item.id });
      await loadLocal();
      renderDetail();
      toast(done(!current));
      void pushOps();
    };
    const consume = document.getElementById("consume");
    if (consume) consume.addEventListener("click", () => void toggle("consume", "unconsume", Boolean(item.consumedAt), (on) => on ? "Marcado como leído" : "Marcado como sin leer"));
    document.getElementById("pin").addEventListener("click", () => {
      if (!item.pinned && library.items.filter((entry) => entry.pinned).length >= 6) { toast("«En mente» admite 6. Quita una antes."); return; }
      void toggle("pin", "unpin", item.pinned, (on) => on ? "Añadido a En mente" : "Quitado de En mente");
    });
    const note = document.getElementById("note");
    const save = document.getElementById("save-note");
    note.addEventListener("input", () => { save.disabled = note.value === (item.note ? item.note.content : ""); });
    save.addEventListener("click", async () => {
      await core.queueOp({ action: "note", itemId: item.id, content: note.value, baseUpdatedAt: item.note ? item.note.updatedAt : null });
      await loadLocal();
      save.disabled = true;
      toast(connection.state === "online" ? "Nota guardada" : "Nota guardada aquí · se enviará al volver a casa");
      void pushOps();
    });
    sheet.querySelectorAll("[data-tag]").forEach((button) => button.addEventListener("click", () => {
      view.query = /\s/.test(button.dataset.tag) ? button.dataset.tag : `#${button.dataset.tag}`;
      view.folder = "all";
      view.tab = "library";
      history.back();
    }));
  }

  // Manda los cambios del celular sin esperar a la próxima sincronización.
  async function pushOps() {
    if (connection.state !== "online") return;
    const result = await core.flush();
    if (result.state === "away") { connection = { state: "away" }; setStatus(); }
  }

  // ---------- Bandeja ----------

  async function inboxView(queue) {
    inboxUrls.forEach((url) => URL.revokeObjectURL(url));
    inboxUrls = [];
    const sent = (await core.list("sent")).sort((a, b) => b.sentAt - a.sentAt).slice(0, 12);
    const pendingOps = (await core.list("ops")).length;
    const thumb = (item) => {
      if (item.kind === "image" && item.blob) { const url = URL.createObjectURL(item.blob); inboxUrls.push(url); return `<span class="thumb" style="background-image:url('${url}')"></span>`; }
      return `<span class="thumb">${item.kind === "url" ? "↗" : "✎"}</span>`;
    };
    const label = (item) => item.kind === "image" ? (item.title || item.name || "Imagen") : item.kind === "url" ? (item.title || item.url) : item.text;
    app.innerHTML = `${tabs(queue.length)}
      <section>
        ${queue.length ? `<div class="list">${queue.map((item) => `
          <div class="item">${thumb(item)}<div><strong>${escapeHtml(label(item))}</strong>
            ${item.error ? `<small class="error">${escapeHtml(item.error)}</small>` : `<small>Esperando a tu Mac · ${ago(item.createdAt)}</small>`}
            <span class="actions">${item.error ? `<button class="link" data-retry="${item.id}">Reintentar</button>` : ""}<button class="link" data-remove="${item.id}">Quitar</button></span>
          </div></div>`).join("")}</div>
          <div class="row" style="margin-top:12px"><button id="send">Enviar ahora</button></div>`
          : `<div class="card empty">Nada pendiente. Comparte una foto, una captura o un enlace y elige <b>LUMINA</b>.</div>`}
        ${pendingOps ? `<p class="muted" style="margin-top:10px">${pendingOps === 1 ? "1 cambio" : `${pendingOps} cambios`} de tu biblioteca se enviarán al volver a casa.</p>` : ""}
      </section>
      <section>
        <h2>Añadir desde aquí</h2>
        <div class="row">
          <label class="button soft">Elegir fotos<input id="pick" type="file" accept="image/*" multiple hidden></label>
          <button class="soft" id="paste">Pegar enlace</button>
        </div>
      </section>
      ${sent.length ? `<section><h2>Enviado hace poco</h2><div class="list">${sent.map((item) => `
        <div class="item"><span class="thumb">${item.kind === "image" ? "▣" : item.kind === "url" ? "↗" : "✎"}</span><div><strong>${escapeHtml(item.label)}</strong><small>${item.duplicate ? "Ya estaba en LUMINA" : "Guardado"} · ${ago(item.sentAt)}</small></div></div>`).join("")}</div></section>` : ""}
      <section class="muted" style="text-align:center">
        <button class="link" id="unpair">Desvincular este celular</button>
      </section>`;
    bindTabs();
    const sendButton = document.getElementById("send");
    if (sendButton) sendButton.addEventListener("click", () => void sendNow());
    app.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", async () => { await core.remove("queue", Number(button.dataset.remove)); await render(); }));
    app.querySelectorAll("[data-retry]").forEach((button) => button.addEventListener("click", async () => {
      const item = queue.find((entry) => entry.id === Number(button.dataset.retry));
      if (item) await core.put("queue", { ...item, error: "" });
      await sendNow();
    }));
    document.getElementById("pick").addEventListener("change", async (event) => {
      const files = [...event.target.files];
      event.target.value = "";
      const count = await core.enqueueShare({ files });
      if (count) { toast(count === 1 ? "Foto en la bandeja" : `${count} fotos en la bandeja`); await sendNow(); }
    });
    document.getElementById("paste").addEventListener("click", async () => {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch { text = ""; }
      if (!core.firstUrl(text)) text = window.prompt("Pega el enlace", text) || "";
      const count = await core.enqueueShare({ text });
      if (count) { toast("En la bandeja"); await sendNow(); } else if (text) toast("No encontré un enlace en eso.");
    });
    document.getElementById("unpair").addEventListener("click", async () => {
      if (!window.confirm("¿Desvincular este celular? Se borra la copia de tu biblioteca de este celular; lo que está en la bandeja se conserva.")) return;
      await core.forget();
      library = null;
      libraryAt = 0;
      connection = { state: "unpaired" };
      await render();
    });
  }

  function bindTabs() {
    app.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { view.tab = button.dataset.tab; void render(); }));
  }

  async function render() {
    setStatus();
    if (!window.isSecureContext) {
      app.innerHTML = `<section class="card"><p class="lead">Abre LUMINA con la dirección segura (https).</p><p class="muted">Sin ella, Android no deja instalar la app ni recibir lo que compartes. Mira la guía en Ajustes → Celular, en tu Mac.</p></section>`;
      return;
    }
    if (connection.state === "unpaired") return pairView();
    const queue = (await core.list("queue")).sort((a, b) => a.id - b.id);
    const revoked = connection.state === "revoked" ? `<section class="card"><p class="lead">Este celular ya no está vinculado.</p><p class="muted">Genera un código nuevo en tu Mac para volver a vincularlo. Lo que está en la bandeja se conserva.</p><div class="row" style="margin-top:12px"><button id="repair">Vincular de nuevo</button></div></section>` : "";
    if (view.tab === "inbox") await inboxView(queue);
    else libraryView(queue.length);
    if (revoked) {
      app.insertAdjacentHTML("afterbegin", revoked);
      document.getElementById("repair").addEventListener("click", async () => { await core.setMeta("token", null); connection = { state: "unpaired" }; await render(); });
    }
    if (view.detailId) renderDetail();
  }

  async function start() {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      try { await navigator.serviceWorker.register("/m/sw.js", { scope: "/m/" }); } catch { /* sin modo sin conexión */ }
      navigator.serviceWorker.addEventListener("message", (event) => { if (event.data && event.data.type === "flushed") void render(); });
    }
    const params = new URLSearchParams(location.search);
    const shared = Number(params.get("shared") || "0");
    if (shared) { view.tab = "inbox"; toast(shared === 1 ? "Guardado en LUMINA" : `${shared} guardados en LUMINA`); }
    if (location.search || location.hash) history.replaceState(null, "", "/m/index.html");
    await loadLocal();
    // Con copia guardada, la biblioteca aparece al instante y luego se actualiza.
    connection = library ? { state: "checking" } : connection;
    if (library || !(await core.getMeta("token"))) await render();
    connection = window.isSecureContext ? await core.ping() : { state: "away" };
    await render();
    if (connection.state === "online" && (await core.list("queue")).length) await sendNow();
    await sync();
  }

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    connection = await core.ping();
    await render();
    if (connection.state === "online" && (await core.list("queue")).length) await sendNow();
    // Una vez cada 10 minutos basta; la copia cambia poco.
    if (Date.now() - libraryAt > 10 * 60 * 1000) await sync();
  });

  void start();
})();
