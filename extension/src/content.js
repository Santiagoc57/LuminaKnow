(function () {
  if (!location.href.startsWith("http://") && !location.href.startsWith("https://")) return;
  if (globalThis.__luminaContent) return;
  globalThis.__luminaContent = true;
  const api = globalThis.browser || globalThis.chrome;
  const send = (message) => api.runtime.sendMessage(message);

  // Resurgir: avisa al icono si ya tienes cosas relacionadas con esta página.
  window.setTimeout(() => {
    const metadata = globalThis.LuminaShared.pageMetadata(document, location);
    send({ type: "LUMINA_PAGE_CONTEXT", metadata, tags: globalThis.LuminaShared.proposeTags(metadata) }).catch?.(() => {});
  }, 800);

  const host = location.hostname.replace(/^www\./, "");
  const isYouTube = host === "youtube.com" || host === "m.youtube.com";
  const isX = host === "x.com" || host === "twitter.com";
  const isReddit = /(^|\.)reddit\.com$/.test(host);
  const isInstagram = host === "instagram.com" || host.endsWith(".instagram.com");
  function mark() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    for (const [r, attributes] of [[8.5, { fill: "none", stroke: "currentColor", "stroke-width": "2" }], [3.6, { fill: "#e75e3a" }]]) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", String(r));
      Object.entries(attributes).forEach(([name, value]) => circle.setAttribute(name, value));
      svg.append(circle);
    }
    return svg;
  }
  function textNode(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }

  // Todo lo que dibuja la extensión vive en un Shadow DOM: la página no puede romper sus estilos ni leerlo.
  const shell = document.createElement("lumina-companion");
  shell.style.cssText = "all: initial; position: fixed; inset: 0 auto auto 0; z-index: 2147483646; pointer-events: none;";
  const shadow = shell.attachShadow({ mode: "closed" });
  shadow.innerHTML = `<style>
    :host, .float, .toast, .toast *, .importer, .importer *, .picker, .picker *, button, textarea, input, label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .toast, .importer { font-size: 13px; line-height: 1.35; color: #2b2723; }
    .float { position: fixed; display: none; align-items: center; gap: 6px; height: 32px; padding: 0 13px 0 8px; border: 0; border-radius: 999px; background: #e75e3a; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.22); cursor: pointer; pointer-events: auto; font-size: 13px; font-weight: 700; line-height: 1; }
    .float svg circle:first-child { stroke: #fff; } .float svg circle:last-child { fill: #fff; }
    .float.show { display: inline-flex; }
    .float:hover { background: #d4502f; box-shadow: 0 3px 14px rgba(0,0,0,.28); }
    .float svg { width: 18px; height: 18px; }
    .float.busy { opacity: .7; cursor: progress; }
    .float.done { background: #2b2723; }
    .picker { position: fixed; width: 300px; max-height: min(520px, calc(100vh - 24px)); display: none; flex-direction: column; overflow: hidden; border-radius: 18px; background: #fff; color: #2b2723; box-shadow: 0 12px 40px rgba(0,0,0,.28); pointer-events: auto; font-size: 13px; }
    .picker.show { display: flex; }
    .picker header { padding: 14px 14px 6px; display: grid; grid-template-columns: 22px 1fr 22px; align-items: center; }
    .picker header svg { width: 20px; height: 20px; }
    .picker header strong { text-align: center; font-size: 14px; }
    .picker header button { border: 0; background: none; font-size: 18px; cursor: pointer; color: #2b2723; }
    .picker .search { margin: 6px 14px 4px; height: 38px; padding: 0 14px; border: 1px solid #e5e1db; border-radius: 99px; font-size: 13px; outline: none; }
    .picker .search:focus { border-color: #c9b9ac; }
    .picker .list { flex: 1; overflow-y: auto; padding: 4px 8px 8px; }
    .picker h4 { margin: 10px 8px 4px; font-size: 11.5px; font-weight: 600; color: #6d655d; }
    .picker .board { width: 100%; min-height: 50px; padding: 5px 6px; display: flex; align-items: center; gap: 10px; border: 0; border-radius: 12px; background: none; color: #2b2723; cursor: pointer; text-align: left; font-size: 13.5px; font-weight: 600; }
    .picker .board:hover, .picker .board:focus-visible { background: #f2efeb; outline: none; }
    .picker .board .cover { width: 40px; height: 40px; flex: none; border-radius: 9px; background: #ece8e2 center / cover no-repeat; }
    .picker .board .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .picker .board .go { display: none; padding: 9px 14px; border-radius: 99px; background: #e75e3a; color: #fff; font-size: 12.5px; font-weight: 700; }
    .picker .board:hover .go, .picker .board:focus-visible .go { display: inline-block; }
    .picker .board.plain .cover { display: grid; place-items: center; font-size: 18px; color: #8a8178; }
    .picker footer { padding: 8px; border-top: 1px solid #f0ece6; }
    .picker footer .board .cover { display: grid; place-items: center; font-size: 22px; font-weight: 400; color: #2b2723; }
    .picker footer input { flex: 1; height: 34px; padding: 0 10px; border: 1px solid #e5e1db; border-radius: 9px; font-size: 13px; outline: none; }
    .picker .empty { padding: 10px; color: #8a8178; font-size: 12px; }
    .toast { position: fixed; right: 18px; bottom: 18px; width: 350px; padding: 12px 14px; border-radius: 14px; background: #fffdfa; box-shadow: 0 8px 30px rgba(0,0,0,.22); pointer-events: auto; display: none; }
    .toast.show { display: block; }
    .toast header { display: flex; align-items: center; gap: 8px; font-weight: 650; }
    .toast header svg { width: 18px; height: 18px; flex: none; }
    .toast header span { flex: 1; }
    .toast header button { border: 0; background: none; font-size: 16px; color: #8a8178; cursor: pointer; }
    .toast p { margin: 6px 0 0; color: #6d655d; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .toast .error { color: #b23a1d; white-space: normal; }
    .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
    .tags span { padding: 3px 8px; border-radius: 999px; background: #f1ece6; font-size: 11px; }
    .tags span.pending { color: #8d887f; background: transparent; border: 1px dashed #d8d2c9; animation: lumina-pulse 1.4s ease-in-out infinite; }
    @keyframes lumina-pulse { 50% { opacity: .45; } }
    textarea { box-sizing: border-box; width: 100%; margin-top: 9px; padding: 8px; border: 1px solid #e3dcd4; border-radius: 9px; font-size: 12px; line-height: 1.4; resize: vertical; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; }
    .row button { border: 0; border-radius: 999px; padding: 7px 12px; white-space: nowrap; max-width: 170px; overflow: hidden; text-overflow: ellipsis; cursor: pointer; font-size: 12px; font-weight: 600; line-height: 1; }
    .row .primary { background: #e75e3a; color: #fff; }
    .row .ghost { background: #f1ece6; color: #2b2723; }
    .importer { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); width: min(460px, calc(100vw - 32px)); padding: 14px 16px; display: grid; grid-template-columns: 20px 1fr; gap: 4px 10px; align-items: center; border-radius: 16px; background: #fffdfa; box-shadow: 0 10px 34px rgba(0,0,0,.25); pointer-events: auto; }
    .importer svg { width: 20px; height: 20px; }
    .importer .status { grid-column: 2; color: #6d655d; font-size: 12px; }
    .importer .row { grid-column: 1 / -1; align-items: center; margin-top: 6px; }
    .importer label { flex: 1; font-size: 12px; color: #4b4540; display: flex; align-items: center; gap: 4px; }
  </style>
  <button class="float" type="button"></button>
  <button class="float gallery-float" type="button"></button>
  <section class="picker" role="dialog" aria-label="Elegir carpeta"></section>
  <section class="toast" role="status"><header></header><p class="detail"></p><div class="tags"></div><div class="note"></div></section>`;
  document.documentElement.append(shell);
  const floating = shadow.querySelector(".float:not(.gallery-float)");
  const galleryFloating = shadow.querySelector(".gallery-float");
  const toast = shadow.querySelector(".toast");
  const picker = shadow.querySelector(".picker");
  let current = null;
  let hideTimer = 0;
  let toastTimer = 0;

  function label(target) {
    return target.kind === "image" ? "Guardar imagen" : target.kind === "comment" ? "Guardar comentario" : target.kind === "video" ? "Guardar video" : "Guardar";
  }

  // Instagram: si la imagen es parte de un carrusel, aparece también «Galería» para guardar todas las fotos.
  function carouselOf(image) {
    if (!isInstagram || !image) return null;
    const container = image.closest("article, div[role='dialog'], main");
    const list = image.closest("ul");
    if (!container || !list || list.querySelectorAll("li img").length < 2) return null;
    return { container, list };
  }

  function showFloating(target, rect) {
    const carousel = target.kind === "image" ? carouselOf(target.element) : null;
    if (carousel) {
      galleryFloating.className = "float gallery-float show";
      galleryFloating.replaceChildren(mark(), textNode("span", "Galería"));
      galleryFloating.title = "Guardar todas las fotos del carrusel en Lúmina";
      galleryFloating.style.top = `${Math.max(6, Math.min(window.innerHeight - 38, rect.top + 10))}px`;
      galleryFloating.style.left = `${Math.max(6, Math.min(window.innerWidth - 110, rect.left + 112))}px`;
      currentGallery = { ...carousel, title: target.title };
    } else { galleryFloating.className = "float gallery-float"; currentGallery = null; }
    current = target;
    floating.className = "float show";
    // Como Pinterest: una píldora pequeña «Guardar» arriba a la izquierda; al pulsarla se elige la carpeta.
    floating.replaceChildren(mark(), textNode("span", "Guardar"));
    floating.title = `${label(target)} en Lúmina`;
    floating.setAttribute("aria-label", `${label(target)} en Lúmina`);
    floating.style.top = `${Math.max(6, Math.min(window.innerHeight - 38, rect.top + 10))}px`;
    floating.style.left = `${Math.max(6, Math.min(window.innerWidth - 110, rect.left + 10))}px`;
  }

  let currentGallery = null;
  function scheduleHide() {
    window.clearTimeout(hideTimer);
    window.setTimeout(() => { if (!floating.classList.contains("show")) galleryFloating.className = "float gallery-float"; }, 300);
    hideTimer = window.setTimeout(() => { if (!floating.matches(":hover") && !floating.classList.contains("busy") && !picker.classList.contains("show")) { floating.className = "float"; current = null; } }, 260);
  }

  function youtubeVideoLink(element) {
    const anchor = element.closest('a[href*="/watch?v="], a[href*="/shorts/"]');
    if (!anchor) return null;
    const card = anchor.closest("ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model, ytd-reel-item-renderer") || anchor;
    const title = card.querySelector("#video-title, h3, [title]")?.textContent?.trim() || anchor.getAttribute("title") || "";
    return { kind: "video", url: new URL(anchor.getAttribute("href"), location.origin).href, title };
  }

  function targetFor(element) {
    if (!(element instanceof Element) || shell.contains(element)) return null;
    if (isYouTube && location.pathname === "/watch") {
      const player = element.closest("#movie_player");
      if (player) return { target: { kind: "page" }, box: player, label: "Guardar video" };
    }
    if (isReddit) {
      const comment = element.closest("shreddit-comment");
      if (comment) {
        const body = comment.querySelector(':scope > [slot="comment"]');
        if (body && (body.contains(element) || comment.querySelector(':scope > [slot="commentMeta"]')?.contains(element))) return { target: { kind: "comment", element: comment }, box: body };
      }
    }
    const image = element.closest("img") || (element.matches?.("a, div") ? element.querySelector?.(":scope > img") : null);
    if (image && !(isX && image.closest('[data-testid="Tweet-User-Avatar"]'))) {
      const rect = image.getBoundingClientRect();
      if (rect.width >= 140 && rect.height >= 100) {
        if (isYouTube) { const video = youtubeVideoLink(image); if (video) return { target: video, box: image }; }
        const src = image.currentSrc || image.src;
        if (src && !src.startsWith("blob:")) return { target: { kind: "image", src, title: image.alt || document.title, element: image }, box: image };
      }
    }
    return null;
  }

  document.addEventListener("mouseover", (event) => {
    if (!buttonsEnabled || picker.classList.contains("show")) return;
    const found = targetFor(event.target);
    if (!found) { if (current) scheduleHide(); return; }
    window.clearTimeout(hideTimer);
    if (floating.classList.contains("busy")) return;
    showFloating(found.target, found.box.getBoundingClientRect());
  }, { passive: true });
  window.addEventListener("scroll", () => { if (current && !floating.classList.contains("busy") && !picker.classList.contains("show")) { floating.className = "float"; current = null; } }, { passive: true });
  floating.addEventListener("mouseleave", scheduleHide);
  galleryFloating.addEventListener("mouseleave", scheduleHide);
  galleryFloating.addEventListener("mouseenter", () => window.clearTimeout(hideTimer));

  // Recorre el carrusel con su botón «Siguiente» para reunir todas las fotos (Instagram solo carga las vecinas).
  async function collectGallery(gallery) {
    const urls = [];
    const add = () => gallery.list.querySelectorAll("li img").forEach((image) => { const src = image.currentSrc || image.src; if (src && !src.startsWith("blob:") && !urls.includes(src)) urls.push(src); });
    add();
    for (let step = 0; step < 20; step += 1) {
      const next = gallery.container.querySelector('button[aria-label="Next"], button[aria-label="Siguiente"], button[aria-label="Sig."]');
      if (!next) break;
      next.click();
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const before = urls.length;
      add();
      if (urls.length === before && !gallery.container.querySelector('button[aria-label="Next"], button[aria-label="Siguiente"]')) break;
    }
    return urls.slice(0, 20);
  }

  galleryFloating.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!currentGallery) return;
    const gallery = currentGallery;
    void openPicker(galleryFloating.getBoundingClientRect(), async (boardId) => {
      galleryFloating.classList.add("busy");
      const urls = await collectGallery(gallery);
      const author = (gallery.container.querySelector("header a[href^='/'] span, header a[role='link']")?.textContent || "").trim();
      const result = await send({ type: "LUMINA_SAVE_GALLERY", urls, pageUrl: location.href, title: gallery.title || document.title, author, boardId: boardId || "" }).catch((error) => ({ error: error?.message }));
      galleryFloating.classList.remove("busy");
      showToast(result?.error ? result : { ...result, title: `Galería de ${urls.length} fotos` });
    });
  });

  function payloadFor(target) {
    if (target.kind === "comment") return { type: "LUMINA_SAVE_STRUCTURED", data: globalThis.LuminaPage.readRedditComment(target.element, document) };
    if (target.kind === "tweet") return { type: "LUMINA_SAVE_STRUCTURED", data: globalThis.LuminaPage.readTweet(target.element) };
    if (target.kind === "image") return { type: "LUMINA_SAVE_IMAGE", srcUrl: target.src, pageUrl: location.href, title: target.title };
    if (target.kind === "video") return { type: "LUMINA_SAVE_LINK", url: target.url, title: target.title };
    return { type: "LUMINA_SAVE_PAGE" };
  }

  async function save(target, button, boardId) {
    const payload = { ...payloadFor(target), boardId: boardId || "" };
    if (payload.type === "LUMINA_SAVE_STRUCTURED" && !payload.data) { showToast({ error: "No encontramos texto para guardar aquí." }); return; }
    button?.classList.add("busy");
    const result = await send(payload).catch((error) => ({ error: error?.message || "Lúmina no respondió." }));
    button?.classList.remove("busy");
    if (!result?.error && button) { button.classList.add("done"); window.setTimeout(() => button.classList.remove("done"), 1600); }
    showToast(result);
  }

  floating.addEventListener("click", (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!current) return;
    const target = current;
    void openPicker(floating.getBoundingClientRect(), (boardId) => save(target, floating, boardId).finally(scheduleHide));
  });

  // ---------- Selector de carpeta (como «Seleccionar tablero» de Pinterest) ----------
  let pickerOutside = null;
  function closePicker() {
    picker.classList.remove("show");
    picker.replaceChildren();
    if (pickerOutside) { document.removeEventListener("mousedown", pickerOutside, true); pickerOutside = null; }
    scheduleHide();
  }

  function boardRow(board, actionLabel, onChoose) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "board";
    const cover = document.createElement("span");
    cover.className = "cover";
    if (board.cover) cover.style.backgroundImage = `url("${board.cover.replace(/"/g, "%22")}")`;
    else cover.style.background = board.color || "#ece8e2";
    row.append(cover, textNode("span", board.name, "name"), textNode("span", actionLabel, "go"));
    row.addEventListener("click", (event) => { event.stopPropagation(); onChoose(); });
    return row;
  }

  async function openPicker(anchor, onChoose) {
    window.clearTimeout(hideTimer);
    const close = textNode("button", "×");
    close.type = "button"; close.setAttribute("aria-label", "Cerrar");
    close.addEventListener("click", (event) => { event.stopPropagation(); closePicker(); });
    const header = document.createElement("header");
    header.append(mark(), textNode("strong", "Guardar en…"), close);
    const search = document.createElement("input");
    search.className = "search"; search.placeholder = "Buscar carpeta"; search.type = "search";
    const list = document.createElement("div");
    list.className = "list";
    list.append(textNode("p", "Cargando carpetas…", "empty"));
    const footer = document.createElement("footer");
    picker.replaceChildren(header, search, list, footer);
    picker.classList.add("show");
    const width = 300;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left));
    const top = Math.max(8, Math.min(window.innerHeight - 420, anchor.bottom + 8));
    picker.style.left = `${left}px`; picker.style.top = `${top}px`;
    search.addEventListener("keydown", (event) => { event.stopPropagation(); if (event.key === "Escape") closePicker(); });
    // El Shadow DOM es cerrado: desde la página solo se ve el contenedor de la extensión, no el selector.
    pickerOutside = (event) => { if (!event.composedPath().includes(shell)) closePicker(); };
    document.addEventListener("mousedown", pickerOutside, true);
    const choose = (boardId) => { closePicker(); void onChoose(boardId); };
    const result = await send({ type: "LUMINA_BOARDS" }).catch((error) => ({ error: error?.message }));
    if (!picker.classList.contains("show")) return;
    if (result?.error) { list.replaceChildren(textNode("p", result.error, "empty")); return; }
    const boards = result.boards || [];
    const recent = (result.recentIds || []).map((id) => boards.find((board) => board.id === id)).filter(Boolean).slice(0, 3);
    const render = () => {
      const query = search.value.trim().toLocaleLowerCase("es");
      const matching = boards.filter((board) => !query || board.name.toLocaleLowerCase("es").includes(query));
      const nodes = [];
      if (!query) nodes.push(boardRow({ name: "Sin carpeta", color: "#f2efeb" }, "Guardar", () => choose("")));
      if (!query && recent.length) { nodes.push(textNode("h4", "Recientes")); recent.forEach((board) => nodes.push(boardRow(board, "Guardar", () => choose(board.id)))); }
      if (matching.length) { nodes.push(textNode("h4", query ? "Carpetas" : "Todas las carpetas")); matching.forEach((board) => nodes.push(boardRow(board, "Guardar", () => choose(board.id)))); }
      if (!matching.length && query) nodes.push(textNode("p", "Ninguna carpeta se llama así. Créala abajo.", "empty"));
      list.replaceChildren(...nodes);
    };
    search.addEventListener("input", render);
    render();
    const create = boardRow({ name: "Crear carpeta", color: "#f2efeb" }, "", () => {
      const form = document.createElement("form");
      form.className = "board";
      const input = document.createElement("input");
      input.placeholder = "Nombre de la carpeta"; input.value = search.value.trim(); input.maxLength = 48;
      const ok = textNode("button", "Crear", "go");
      ok.type = "submit"; ok.style.display = "inline-block"; ok.style.border = "0"; ok.style.cursor = "pointer";
      form.append(input, ok);
      input.addEventListener("keydown", (event) => event.stopPropagation());
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        ok.disabled = true;
        const board = await send({ type: "LUMINA_CREATE_BOARD", name }).catch((error) => ({ error: error?.message }));
        if (board?.error || !board?.id) { ok.disabled = false; input.value = board?.error || "No se pudo crear"; return; }
        choose(board.id);
      });
      footer.replaceChildren(form);
      input.focus();
    });
    create.querySelector(".cover").textContent = "+";
    footer.replaceChildren(create);
    search.focus();
  }

  // ---------- Tarjeta de confirmación (con nota opcional) ----------
  function showToast(result) {
    window.clearTimeout(toastTimer);
    const header = toast.querySelector("header");
    const detail = toast.querySelector(".detail");
    const tags = toast.querySelector(".tags");
    const noteArea = toast.querySelector(".note");
    const close = textNode("button", "×");
    close.type = "button"; close.setAttribute("aria-label", "Cerrar");
    close.addEventListener("click", () => toast.classList.remove("show"));
    header.replaceChildren(mark(), textNode("span", ""), close);
    tags.replaceChildren();
    noteArea.replaceChildren();
    if (result?.error) {
      header.querySelector("span").textContent = "No se pudo guardar";
      detail.className = "detail error";
      detail.textContent = result.error;
    } else {
      header.querySelector("span").textContent = result.duplicate ? "Ya estaba en Lúmina" : "Guardado en Lúmina";
      detail.className = "detail";
      detail.textContent = result.title || "";
      // Etiquetas reales de LUMINA; si la IA aún está leyendo la fuente, se espera y se vuelven a pedir.
      const renderTags = (list, analyzing) => {
        tags.replaceChildren(...(list || []).map((tag) => { const chip = document.createElement("span"); chip.textContent = tag.name; return chip; }));
        if (analyzing && !(list || []).length) { const chip = document.createElement("span"); chip.className = "pending"; chip.textContent = "Etiquetando…"; tags.append(chip); }
      };
      renderTags(result.tags, result.analyzing);
      if (result.analyzing && result.id) {
        let tries = 0;
        const poll = async () => {
          tries += 1;
          const state = await send({ type: "LUMINA_ITEM", id: result.id }).catch(() => null);
          if (!state || !toast.classList.contains("show")) return;
          renderTags(state.tags, state.analyzing);
          if (state.analyzing && tries < 20) { window.setTimeout(poll, 2500); return; }
          // Ya llegaron las etiquetas: el aviso se cierra solo un momento después (salvo que estés escribiendo una nota).
          if (!result.askNote) { window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { if (!toast.matches(":hover") && !toast.querySelector("textarea")) toast.classList.remove("show"); }, 3500); }
        };
        window.setTimeout(poll, 2500);
      }
      const row = document.createElement("div");
      row.className = "row";
      const open = document.createElement("button");
      open.className = "ghost"; open.type = "button"; open.textContent = "Abrir";
      open.addEventListener("click", () => send({ type: "LUMINA_OPEN", path: result.luminaUrl }));
      const addNote = document.createElement("button");
      addNote.className = "primary"; addNote.type = "button"; addNote.textContent = "Nota";
      const editor = () => {
        window.clearTimeout(toastTimer);
        const area = document.createElement("textarea");
        area.rows = 3; area.placeholder = "¿Por qué lo guardas?";
        const saveRow = document.createElement("div");
        saveRow.className = "row";
        const saveNote = document.createElement("button");
        saveNote.className = "primary"; saveNote.type = "button"; saveNote.textContent = "Guardar nota";
        saveNote.addEventListener("click", async () => {
          if (!area.value.trim()) return;
          saveNote.disabled = true;
          const outcome = await send({ type: "LUMINA_ADD_NOTE", id: result.id, note: area.value.trim() });
          if (outcome?.error) { saveNote.disabled = false; detail.className = "detail error"; detail.textContent = outcome.error; return; }
          noteArea.replaceChildren(); detail.className = "detail"; detail.textContent = "Nota guardada.";
          toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1800);
        });
        area.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) saveNote.click(); event.stopPropagation(); });
        saveRow.append(open, saveNote);
        noteArea.replaceChildren(area, saveRow);
        area.focus();
      };
      addNote.addEventListener("click", editor);
      const folder = document.createElement("button");
      folder.className = "ghost"; folder.type = "button"; folder.textContent = result.board ? `📁 ${result.board}` : "📁 Carpeta";
      folder.addEventListener("click", () => {
        window.clearTimeout(toastTimer);
        void openPicker(folder.getBoundingClientRect(), async (boardId) => {
          if (!boardId) return;
          const outcome = await send({ type: "LUMINA_COLLECT", id: result.id, collectionId: boardId }).catch((error) => ({ error: error?.message }));
          folder.textContent = outcome?.error ? "No se pudo" : `📁 ${outcome.board}`;
        });
      });
      row.append(open, folder, addNote);
      noteArea.append(row);
      if (result.askNote) editor();
    }
    toast.classList.add("show");
    if (!result?.askNote || result?.error) toastTimer = window.setTimeout(() => { if (!toast.matches(":hover") && !toast.querySelector("textarea")) toast.classList.remove("show"); }, result?.error ? 6000 : result?.analyzing ? 30000 : 4000);
  }
  toast.addEventListener("mouseleave", () => { if (!toast.querySelector("textarea")) toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2500); });

  // ---------- Botón dentro de la barra de acciones de cada tweet ----------
  function decorateTweets() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach((article) => {
      const bar = [...article.querySelectorAll('[role="group"]')].pop();
      if (!bar || bar.querySelector(".lumina-tweet-save")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lumina-tweet-save";
      button.title = "Guardar en Lúmina";
      button.setAttribute("aria-label", "Guardar en Lúmina");
      button.append(mark());
      button.style.cssText = "all: unset; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 999px; color: rgb(113,118,123); cursor: pointer;";
      button.firstElementChild.style.cssText = "width: 19px; height: 19px;";
      button.addEventListener("mouseenter", () => { button.style.background = "rgba(231,94,58,.12)"; button.style.color = "#e75e3a"; });
      button.addEventListener("mouseleave", () => { button.style.background = "transparent"; button.style.color = "rgb(113,118,123)"; });
      button.addEventListener("click", (event) => {
        event.preventDefault(); event.stopPropagation();
        button.style.opacity = ".5";
        void openPicker(button.getBoundingClientRect(), (boardId) => save({ kind: "tweet", element: article }, null, boardId).finally(() => { button.style.opacity = "1"; button.style.color = "#e75e3a"; }));
      });
      bar.append(button);
    });
  }

  // ---------- Importar «Guardados» de X: recorre la página de marcadores y guarda cada tweet ----------
  const importer = { bar: null, running: false, stop: false, sent: new Set(), saved: 0, skipped: 0 };

  function importerBar() {
    if (importer.bar) return importer.bar;
    const bar = document.createElement("section");
    bar.className = "importer";
    const title = textNode("strong", "Importar tus guardados de X a Lúmina");
    const status = textNode("span", "Se recorrerá esta página y se guardará cada tweet.", "status");
    const analyzeLabel = document.createElement("label");
    const analyze = document.createElement("input");
    analyze.type = "checkbox";
    analyzeLabel.append(analyze, textNode("span", " Analizar con IA (resumen y etiquetas; tarda más)"));
    const start = textNode("button", "Importar", "primary");
    const close = textNode("button", "×", "ghost");
    start.type = "button"; close.type = "button";
    close.addEventListener("click", () => { importer.stop = true; bar.remove(); importer.bar = null; });
    start.addEventListener("click", () => {
      if (importer.running) { importer.stop = true; start.textContent = "Deteniendo…"; return; }
      void runImport(analyze.checked, status, start);
    });
    const row = document.createElement("div");
    row.className = "row";
    row.append(analyzeLabel, start, close);
    bar.append(mark(), title, status, row);
    shadow.append(bar);
    importer.bar = bar;
    return bar;
  }

  async function runImport(analyze, status, button) {
    importer.running = true; importer.stop = false;
    button.textContent = "Detener";
    let idle = 0;
    while (!importer.stop && idle < 5) {
      const fresh = [...document.querySelectorAll('article[data-testid="tweet"]')].map((article) => globalThis.LuminaPage.readTweet(article)).filter((data) => data && !importer.sent.has(data.url));
      if (!fresh.length) idle += 1; else idle = 0;
      for (const data of fresh) {
        if (importer.stop) break;
        importer.sent.add(data.url);
        const result = await send({ type: "LUMINA_SAVE_STRUCTURED", data, analyze, quiet: true }).catch((error) => ({ error: error?.message }));
        if (result?.error) { status.textContent = result.error; importer.stop = true; break; }
        if (result?.duplicate) importer.skipped += 1; else importer.saved += 1;
        status.textContent = `${importer.saved} nuevos · ${importer.skipped} ya estaban`;
      }
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: "smooth" });
      await new Promise((resolve) => window.setTimeout(resolve, 1400));
    }
    importer.running = false;
    button.textContent = "Importar";
    status.textContent = `Listo: ${importer.saved} nuevos · ${importer.skipped} ya estaban.${idle >= 5 ? "" : " (detenido)"}`;
  }

  if (isX) window.setInterval(() => {
    const onBookmarks = location.pathname.startsWith("/i/bookmarks");
    if (onBookmarks && buttonsEnabled && !importer.bar) importerBar();
    if (!onBookmarks && importer.bar && !importer.running) { importer.bar.remove(); importer.bar = null; }
  }, 1000);

  let buttonsEnabled = true;
  api.storage.local.get({ floatingButtons: true }).then((config) => {
    buttonsEnabled = config.floatingButtons !== false;
    if (!buttonsEnabled) return;
    if (isX) {
      decorateTweets();
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; window.requestAnimationFrame(() => { queued = false; decorateTweets(); }); }).observe(document.body, { childList: true, subtree: true });
    }
  });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LUMINA_TOAST") showToast(message.result);
    if (message?.type === "LUMINA_READ_PAGE") sendResponse(globalThis.LuminaPage.readStructuredPage(document));
    return false;
  });
})();
