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
  const isFacebook = host === "facebook.com" || host.endsWith(".facebook.com");
  // En Facebook las publicaciones son role="article" (los comentarios también, dentro): se toma la más externa.
  function facebookArticle(element) {
    let article = element.closest('[role="article"]');
    while (article && article.parentElement && article.parentElement.closest('[role="article"]')) article = article.parentElement.closest('[role="article"]');
    return article;
  }
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
    :host, .float, .toast, .toast *, .importer, .importer *, .picker, .picker *, .dlg, .dlg *, button, textarea, input, label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
    .toast, .importer { font-size: 13px; line-height: 1.35; color: #2b2723; }
    .float { position: fixed; display: none; align-items: center; gap: 6px; height: 32px; padding: 0 13px 0 8px; border: 0; border-radius: 999px; background: #e75e3a; color: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.22); cursor: pointer; pointer-events: auto; font-size: 13px; font-weight: 700; line-height: 1; }
    .float svg circle:first-child { stroke: #fff; } .float svg circle:last-child { fill: #fff; }
    .float.show { display: inline-flex; }
    .float:hover { background: #d4502f; box-shadow: 0 3px 14px rgba(0,0,0,.28); }
    .float svg { width: 18px; height: 18px; }
    .float.busy { opacity: .7; cursor: progress; }
    .float.done { background: #2b2723; }
    .float:not(.gallery-float) { width: 28px; height: 28px; padding: 0; justify-content: center; background: rgba(231, 94, 58, .9); }
    .float:not(.gallery-float) svg { width: 16px; height: 16px; }
    .float.show { animation: lumina-pop .16s ease-out; }
    @keyframes lumina-pop { from { opacity: 0; transform: scale(.7); } }
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
    /* Diálogo de guardado, centrado */
    .dlg-backdrop { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(28, 24, 20, .38); backdrop-filter: blur(2px); pointer-events: auto; }
    .dlg-backdrop.enter { animation: dlg-fade .14s ease-out; }
    .dlg-backdrop.enter .dlg { animation: dlg-rise .18s ease-out; }
    .dlg-backdrop.show { display: flex; }
    @keyframes dlg-fade { from { opacity: 0; } }
    @keyframes dlg-rise { from { transform: translateY(10px) scale(.98); opacity: 0; } }
    .dlg { box-sizing: border-box; width: min(520px, calc(100vw - 32px)); max-height: calc(100vh - 40px); display: flex; flex-direction: column; overflow: hidden; border-radius: 22px; background: #fffdfa; color: #2b2723; box-shadow: 0 24px 70px rgba(0,0,0,.32); font-size: 13.5px; line-height: 1.4; }
    .dlg * { box-sizing: border-box; }
    .dlg-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 6px; }
    .dlg-head svg { width: 22px; height: 22px; flex: none; }
    .dlg-head strong { flex: 1; font-size: 14.5px; }
    .dlg-head button { width: 30px; height: 30px; border: 0; border-radius: 50%; background: #f2eee8; color: #6d655d; font-size: 16px; cursor: pointer; }
    .dlg-body { flex: 1; overflow-y: auto; padding: 6px 18px 14px; display: grid; gap: 14px; }
    .dlg-preview { display: grid; grid-template-columns: 76px 1fr; gap: 12px; align-items: center; padding: 10px; border-radius: 14px; background: #f5f1eb; }
    .dlg-preview.no-image { grid-template-columns: 1fr; }
    .dlg-preview img { width: 76px; height: 76px; border-radius: 10px; object-fit: cover; background: #e9e4dd; }
    .dlg-preview small { display: block; color: #e75e3a; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .dlg .dlg-title { display: block; width: 100%; min-height: 0; margin: 2px 0 0; padding: 4px 6px; border: 1px solid transparent; border-radius: 8px; background: transparent; font: 650 15px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #2b2723; resize: none; }
    .dlg .dlg-title:hover { border-color: #e5e0d8; background: #fff; }
    .dlg .dlg-title:focus { outline: none; border-color: #c9b9ac; background: #fff; }
    .dlg-preview b { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 15px; line-height: 1.3; }
    .dlg-similar { display: grid; gap: 4px; padding: 10px 12px; border-radius: 12px; background: #fff6e8; border: 1px solid #f3dfbf; }
    .dlg-similar strong { font-size: 12px; color: #8a5a12; }
    .dlg-similar-item { padding: 2px 0; border: 0; background: none; color: #2b2723; font-size: 12.5px; text-align: left; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dlg-similar-item::before { content: "↗ "; color: #c0841f; }
    .dlg-similar-item:hover { color: #e75e3a; }
    .dlg-notice { padding: 9px 12px; border-radius: 12px; background: #eef6f0; color: #2f6f47; font-size: 12.5px; }
    .dlg h3 { margin: 0 0 7px; font-size: 11.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #8a8178; display: flex; justify-content: space-between; }
    .dlg h3 em { font-style: normal; font-weight: 500; text-transform: none; letter-spacing: 0; }
    .dlg-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .dlg-chip { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1px solid #e5e0d8; border-radius: 99px; background: #fff; color: #2b2723; font-size: 12.5px; font-weight: 500; cursor: pointer; }
    .dlg-chip i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .dlg-chip.on { background: #2b2723; border-color: #2b2723; color: #fff; }
    .dlg-chip.sub { font-size: 12px; }
    .dlg-chip.loading { color: #a39a90; border-style: dashed; animation: lumina-pulse 1.4s ease-in-out infinite; cursor: default; }
    .dlg-add { position: relative; }
    .dlg-add input { width: 100%; height: 34px; padding: 0 12px; border: 1px solid #e5e0d8; border-radius: 99px; font-size: 12.5px; outline: none; background: #fff; }
    .dlg-add input:focus { border-color: #c9b9ac; }
    .dlg-menu { position: absolute; left: 0; right: 0; top: 38px; z-index: 2; max-height: 200px; overflow-y: auto; padding: 4px; border-radius: 12px; background: #fff; box-shadow: 0 8px 24px rgba(0,0,0,.18); display: none; }
    .dlg-menu.show { display: block; }
    .dlg-menu button { width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 0; border-radius: 8px; background: none; text-align: left; font-size: 12.5px; color: #2b2723; cursor: pointer; }
    .dlg-menu button small { margin-left: auto; color: #a39a90; }
    .dlg-menu button:hover, .dlg-menu button.active { background: #f2eee8; }
    .dlg-menu button i { width: 8px; height: 8px; border-radius: 50%; }
    .dlg textarea { margin: 0; min-height: 64px; padding: 10px 12px; border: 1px solid #e5e0d8; border-radius: 12px; font-size: 13px; background: #fff; }
    .dlg-foot { display: flex; align-items: center; gap: 12px; padding: 12px 18px 16px; border-top: 1px solid #efe9e2; }
    .dlg-foot label { flex: 1; display: flex; align-items: center; gap: 7px; color: #4b4540; font-size: 12.5px; cursor: pointer; }
    .dlg-foot input { width: 16px; height: 16px; accent-color: #e75e3a; }
    .dlg-save { display: inline-flex; align-items: center; gap: 10px; height: 44px; padding: 0 22px; border: 0; border-radius: 99px; background: #e75e3a; color: #fff; font-size: 14.5px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(231,94,58,.35); }
    .dlg-save:hover { background: #d4502f; }
    .dlg-save:disabled { opacity: .6; cursor: progress; }
    .dlg-save kbd { padding: 2px 6px; border-radius: 6px; background: rgba(255,255,255,.22); font: 600 11px -apple-system, sans-serif; }
    .dlg-link { border: 0; background: none; color: #e75e3a; font-weight: 600; font-size: 12.5px; cursor: pointer; padding: 0; }
    .dlg-error { color: #b23a1d; font-size: 12.5px; }
    /* Más compacto y limpio */
    .dlg { width: min(440px, calc(100vw - 32px)); border-radius: 18px; }
    .dlg-head { padding: 12px 14px 4px; gap: 8px; }
    .dlg-head svg { width: 18px; height: 18px; }
    .dlg-head strong { font-size: 13px; font-weight: 600; }
    .dlg-head button { width: 26px; height: 26px; font-size: 14px; }
    .dlg-body { padding: 4px 14px 10px; gap: 10px; }
    .dlg-preview { grid-template-columns: 56px 1fr; gap: 10px; padding: 8px; border-radius: 12px; }
    .dlg-preview img { width: 56px; height: 56px; border-radius: 8px; }
    .dlg-preview small { font-size: 10px; }
    .dlg .dlg-title { font-size: 13.5px; }
    .dlg h3 { margin: 0 0 5px; font-size: 10.5px; font-weight: 600; }
    .dlg h3 em { font-size: 10.5px; }
    .dlg-chips { gap: 4px; }
    .dlg-chip { height: 24px; padding: 0 9px; gap: 5px; font-size: 11.5px; }
    .dlg-chip.sub { font-size: 11.5px; }
    .dlg-chip i { width: 6px; height: 6px; }
    .dlg-chip.suggest { border-style: dashed; color: #6d655d; background: transparent; }
    .dlg-chip .x { margin-left: 2px; margin-right: -4px; width: 15px; height: 15px; display: inline-grid; place-items: center; border-radius: 50%; font-size: 11px; line-height: 1; opacity: .65; }
    .dlg-chip .x:hover { opacity: 1; background: rgba(255,255,255,.2); }
    .dlg-add input { height: 28px; font-size: 11.5px; }
    .dlg-menu { top: 32px; }
    .dlg textarea { min-height: 44px; padding: 8px 10px; font-size: 12px; border-radius: 10px; }
    .dlg-foot { padding: 10px 14px 12px; gap: 10px; }
    .dlg-foot label { font-size: 11.5px; }
    .dlg-foot input { width: 14px; height: 14px; }
    .dlg-save { height: 34px; padding: 0 16px; gap: 8px; font-size: 13px; font-weight: 650; box-shadow: none; }
    .dlg-save kbd { font-size: 10px; }

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
    return target.kind === "image" ? "Guardar imagen" : target.kind === "facebook" ? "Guardar publicación" : target.kind === "comment" ? "Guardar comentario" : target.kind === "video" ? "Guardar video" : "Guardar";
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
      galleryFloating.style.top = `${Math.max(6, Math.min(window.innerHeight - 34, rect.top + 8))}px`;
      galleryFloating.style.left = `${Math.max(6, Math.min(window.innerWidth - 110, rect.left + 42))}px`;
      currentGallery = { ...carousel, title: target.title };
    } else { galleryFloating.className = "float gallery-float"; currentGallery = null; }
    current = target;
    floating.className = "float show";
    // Discreto: solo el icono, pequeño, arriba a la izquierda.
    floating.replaceChildren(mark());
    floating.title = `${label(target)} en Lúmina`;
    floating.setAttribute("aria-label", `${label(target)} en Lúmina`);
    floating.style.top = `${Math.max(6, Math.min(window.innerHeight - 34, rect.top + 8))}px`;
    floating.style.left = `${Math.max(6, Math.min(window.innerWidth - 34, rect.left + 8))}px`;
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
    if (isFacebook) {
      const article = facebookArticle(element);
      if (article && article.getBoundingClientRect().height >= 120) return { target: { kind: "facebook", element: article }, box: article };
    }
    // Webs hechas con video o animación (sin imágenes normales): se ofrece guardar la página.
    const media = element.closest("video, canvas");
    if (media && !isYouTube && !isX) { const box = media.getBoundingClientRect(); if (box.width >= 240 && box.height >= 160) return { target: { kind: "page" }, box: media, label: "Guardar página" }; }
    const image = element.closest("img") || (element.matches?.("a, div, picture") ? element.querySelector?.(":scope > img, :scope > picture > img") : null);
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

  // El botón solo aparece si dejas el ratón quieto unos segundos sobre la imagen o publicación: no estorba al navegar.
  const HOVER_DELAY = 5000;
  let hoverTimer = 0;
  let hoverBox = null;
  document.addEventListener("mouseover", (event) => {
    if (!buttonsEnabled || picker.classList.contains("show")) return;
    const found = targetFor(event.target);
    if (!found) { window.clearTimeout(hoverTimer); hoverBox = null; if (current) scheduleHide(); return; }
    window.clearTimeout(hideTimer);
    if (floating.classList.contains("busy")) return;
    if (current && found.box === hoverBox) return;
    if (found.box === hoverBox) return;
    hoverBox = found.box;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { if (hoverBox === found.box && found.box.isConnected && found.box.matches(":hover")) showFloating(found.target, found.box.getBoundingClientRect()); }, HOVER_DELAY);
  }, { passive: true });
  window.addEventListener("scroll", () => { window.clearTimeout(hoverTimer); hoverBox = null; if (current && !floating.classList.contains("busy") && !picker.classList.contains("show")) { floating.className = "float"; current = null; } }, { passive: true });
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
    if (target.kind === "facebook") return { type: "LUMINA_SAVE_STRUCTURED", data: globalThis.LuminaPage.readFacebookPost(target.element) };
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
    scheduleHide();
    void openSaveDialog(target);
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
        area.rows = 3; area.placeholder = result.clip ? "¿Por qué guardas este recorte?" : "¿Por qué lo guardas?";
        const saveRow = document.createElement("div");
        saveRow.className = "row";
        const saveNote = document.createElement("button");
        saveNote.className = "primary"; saveNote.type = "button"; saveNote.textContent = "Guardar nota";
        saveNote.addEventListener("click", async () => {
          if (!area.value.trim()) return;
          saveNote.disabled = true;
          // En un recorte, la nota va pegada a ese subrayado; si no, a la fuente.
          const outcome = await send(result.clip ? { type: "LUMINA_CLIP_NOTE", id: result.id, quote: result.clip, note: area.value.trim() } : { type: "LUMINA_ADD_NOTE", id: result.id, note: area.value.trim() });
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
        void openSaveDialog({ kind: "tweet", element: article });
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
  let insideLumina = false;
  // Dentro de la propia Lúmina no tiene sentido «guardar en Lúmina».
  // (por su dirección o, si se abre desde otra dirección de la casa, por el título de la página de Lúmina).
  if (/^Lúmina —|^LUMINA$/.test(document.title)) { insideLumina = true; buttonsEnabled = false; }
  send({ type: "LUMINA_IS_LUMINA", origin: location.origin }).then((result) => { if (result?.lumina) { insideLumina = true; buttonsEnabled = false; } }).catch?.(() => {});
  api.storage.local.get({ floatingButtons: true }).then((config) => {
    buttonsEnabled = config.floatingButtons !== false && !insideLumina;
    if (!buttonsEnabled) return;
    if (isX) {
      decorateTweets();
      let queued = false;
      new MutationObserver(() => { if (queued) return; queued = true; window.requestAnimationFrame(() => { queued = false; decorateTweets(); }); }).observe(document.body, { childList: true, subtree: true });
    }
  });

  // Tus recortes de esta página, resaltados al volver (sin tocar el contenido: CSS Custom Highlight API).
  const highlightSupported = typeof CSS !== "undefined" && CSS.highlights && typeof Highlight === "function";
  function rangesFor(quotes) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/.test(parent.tagName) || parent.closest("#lumina-toast-host")) return NodeFilter.FILTER_REJECT;
      return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    } });
    const nodes = [];
    let text = "";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) { nodes.push({ node, start: text.length }); text += node.nodeValue + " "; }
    const locate = (offset) => {
      let low = 0;
      let high = nodes.length - 1;
      while (low < high) { const mid = (low + high + 1) >> 1; if (nodes[mid].start <= offset) low = mid; else high = mid - 1; }
      const entry = nodes[low];
      return { node: entry.node, offset: Math.min(offset - entry.start, entry.node.nodeValue.length) };
    };
    const ranges = [];
    for (const quote of quotes) {
      const words = quote.split(/\s+/).filter(Boolean).slice(0, 60);
      if (!words.length) continue;
      const pattern = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
      const match = pattern.exec(text);
      if (!match) continue;
      try {
        const start = locate(match.index);
        const end = locate(match.index + match[0].length);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        ranges.push(range);
      } catch { /* el texto cambió mientras tanto */ }
    }
    return ranges;
  }
  async function markSavedClips() {
    if (!highlightSupported || window.top !== window) return;
    const result = await send({ type: "LUMINA_PAGE_HIGHLIGHTS", url: location.href }).catch(() => null);
    if (!result || !Array.isArray(result.quotes) || !result.quotes.length) { CSS.highlights.delete("lumina-clip"); return; }
    const ranges = rangesFor(result.quotes);
    if (!ranges.length) return;
    CSS.highlights.set("lumina-clip", new Highlight(...ranges));
    if (!document.getElementById("lumina-clip-style")) {
      const style = document.createElement("style");
      style.id = "lumina-clip-style";
      style.textContent = "::highlight(lumina-clip) { background-color: rgba(255, 196, 70, .45); color: inherit; }";
      (document.head || document.documentElement).appendChild(style);
    }
  }
  window.setTimeout(() => void markSavedClips(), 1500);


  // ---------- Diálogo de guardado (al pulsar el icono de la extensión) ----------
  const dialogRoot = document.createElement("div");
  dialogRoot.className = "dlg-backdrop";
  shadow.append(dialogRoot);
  const isMacKeys = /Mac/i.test(navigator.platform);
  let dialogState = null;

  function pageText() {
    const main = document.querySelector("article, main, [role='main']") || document.body;
    return (main?.innerText || "").replace(/\s+\n/g, "\n").slice(0, 5000);
  }
  function closeDialog() { dialogRoot.className = "dlg-backdrop"; dialogRoot.replaceChildren(); dialogState = null; }
  function chip(label, { on = false, color = "", sub = false, suggest = false, onClick, onRemove } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `dlg-chip${on ? " on" : ""}${sub ? " sub" : ""}${suggest ? " suggest" : ""}`;
    if (color) { const dot = document.createElement("i"); dot.style.background = color; button.append(dot); }
    button.append(document.createTextNode(label));
    if (onRemove) { const x = textNode("span", "×", "x"); x.title = "Quitar etiqueta"; x.addEventListener("click", (event) => { event.stopPropagation(); onRemove(); }); button.append(x); }
    if (onClick) button.addEventListener("click", onClick);
    return button;
  }

  // Lo que se guarda cuando el diálogo se abre desde un botón (un tweet, un video, una imagen) y no desde la página.
  function itemFor(target) {
    if (!target) return null;
    const payload = payloadFor(target);
    if (payload.type === "LUMINA_SAVE_STRUCTURED") {
      const data = payload.data;
      if (!data) return null;
      const text = (data.items || []).map((item) => item.text).join("\n\n");
      return { payload, url: data.url || location.href, title: data.title || "", text, author: data.channel || "", imageUrl: data.thumbnailUrl || data.items?.[0]?.previewUrl || data.items?.[0]?.avatarUrl || "", siteName: location.hostname.replace(/^www\./, "") };
    }
    if (payload.type === "LUMINA_SAVE_IMAGE") return { payload, url: target.src, title: target.title || document.title, text: "", imageUrl: target.src, siteName: location.hostname.replace(/^www\./, "") };
    if (payload.type === "LUMINA_SAVE_LINK") { let site = ""; try { site = new URL(target.url).hostname.replace(/^www\./, ""); } catch { site = ""; } return { payload, url: target.url, title: target.title || target.url, text: "", imageUrl: target.thumb || "", siteName: site }; }
    return null;
  }

  async function openSaveDialog(target) {
    if (dialogState) { closeDialog(); return; }
    if (insideLumina) { showToast({ error: "Ya estás en Lúmina: aquí no hace falta guardar." }); return; }
    const item = itemFor(target);
    if (target && !item && payloadFor(target).type !== "LUMINA_SAVE_PAGE") { showToast({ error: "No encontramos qué guardar aquí." }); return; }
    const metadata = item ? { url: item.url, title: item.title, imageUrl: item.imageUrl, siteName: item.siteName, description: "" } : globalThis.LuminaShared.pageMetadata(document, location);
    dialogState = { item, selected: new Set(), suggested: [], catalog: [], boardId: "", boards: [], loading: true, existing: null, analyze: true, metadata, title: metadata.title || document.title, titleEdited: false, suggestedSpace: null };
    renderDialog();
    dialogRoot.className = "dlg-backdrop show enter";
    setTimeout(() => dialogRoot.classList.remove("enter"), 250);
    const [context, boards] = await Promise.all([
      send({ type: "LUMINA_DIALOG_CONTEXT", pageText: pageText(), item: item ? { url: item.url, title: item.title, text: item.text, author: item.author, imageUrl: item.imageUrl, siteName: item.siteName } : null }).catch((error) => ({ error: error?.message })),
      send({ type: "LUMINA_BOARDS" }).catch(() => ({ boards: [] })),
    ]);
    if (!dialogState) return;
    dialogState.loading = false;
    if (!context || context.error) { dialogState.error = context?.error || "No se pudo hablar con Lúmina. ¿Está abierta?"; renderDialog(); return; }
    if (context.connected === false) { dialogState.error = "Vincula la extensión con Lúmina en sus ajustes."; renderDialog(); return; }
    Object.assign(dialogState, { metadata: context.metadata || metadata, catalog: context.catalog || [], suggested: context.suggested || [], existing: context.existing, analyze: context.defaultMode !== "save", boards: (boards?.boards || []).slice(0, 30), recentIds: boards?.recentIds || [], suggestedSpace: context.suggestedSpace || null, similar: context.similar || [] });
    // Título: el que ya tiene en Lúmina o el que propone la IA (las webs y los tweets no traen uno útil). Editable.
    if (!dialogState.titleEdited) dialogState.title = context.existing?.title || context.suggestedTitle || dialogState.title;
    // Para algo nuevo, las sugeridas vienen marcadas; para algo ya guardado, solo se proponen (las añades tú).
    if (!context.existing) dialogState.suggested.forEach((tag) => dialogState.selected.add(tag.key));
    if (dialogState.suggestedSpace && dialogState.boards.some((board) => board.id === dialogState.suggestedSpace.id)) dialogState.boardId = dialogState.suggestedSpace.id;
    renderDialog();
  }

  function renderDialog() {
    const state = dialogState;
    if (!state) return;
    const dialog = document.createElement("div");
    dialog.className = "dlg";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Guardar en Lúmina");
    const head = document.createElement("div");
    head.className = "dlg-head";
    const close = textNode("button", "×");
    close.title = "Cerrar (Esc)";
    close.addEventListener("click", closeDialog);
    head.append(mark(), textNode("strong", state.existing ? "Ya está en tu Lúmina" : "Guardar en Lúmina"), close);
    const body = document.createElement("div");
    body.className = "dlg-body";

    const preview = document.createElement("div");
    preview.className = `dlg-preview${state.metadata.imageUrl ? "" : " no-image"}`;
    if (state.metadata.imageUrl) { const image = document.createElement("img"); image.src = state.metadata.imageUrl; image.referrerPolicy = "no-referrer"; image.addEventListener("error", () => { image.remove(); preview.classList.add("no-image"); }); preview.append(image); }
    const copy = document.createElement("div");
    const titleInput = document.createElement("textarea");
    titleInput.className = "dlg-title";
    titleInput.rows = 2;
    titleInput.value = state.title;
    titleInput.placeholder = "Título";
    titleInput.title = "Puedes cambiar el título";
    titleInput.addEventListener("input", () => { state.title = titleInput.value; state.titleEdited = true; });
    copy.append(textNode("small", state.loading ? "Pensando un título…" : state.metadata.siteName || location.hostname.replace(/^www\./, "")), titleInput);
    preview.append(copy);
    body.append(preview);

    if (state.error) body.append(textNode("p", state.error, "dlg-error"));
    // Etiquetas
    const tagsSection = document.createElement("section");
    if (state.existing) {
      tagsSection.append(textNode("h3", "Sus etiquetas"));
      const list = document.createElement("div");
      list.className = "dlg-chips";
      (state.existing.tags.length ? state.existing.tags : [{ name: "Sin etiquetas todavía" }]).forEach((tag) => list.append(chip(tag.name, { sub: tag.level === "free", color: tag.level === "free" ? "" : tag.color })));
      tagsSection.append(list);
      if (state.loading || state.suggested.length) {
        const more = textNode("h3", "Podrías añadir");
        more.style.marginTop = "10px";
        tagsSection.append(more);
        const extra = document.createElement("div");
        extra.className = "dlg-chips";
        if (state.loading) { extra.append(chip("Sugiriendo…", { sub: true })); extra.lastChild.classList.add("loading"); }
        state.suggested.forEach((tag) => extra.append(chip(`${state.selected.has(tag.key) ? "✓ " : "+ "}${tag.name}`, { on: state.selected.has(tag.key), color: tag.color, sub: tag.level === "secondary", onClick: () => { if (state.selected.has(tag.key)) state.selected.delete(tag.key); else if (state.selected.size < 5) state.selected.add(tag.key); renderDialog(); } })));
        tagsSection.append(extra);
      }
    } else {
      const title = textNode("h3", "Etiquetas");
      const count = document.createElement("em");
      count.textContent = state.loading ? "Sugiriendo…" : "";
      title.append(count);
      tagsSection.append(title);
      const list = document.createElement("div");
      list.className = "dlg-chips";
      if (state.loading) for (let index = 0; index < 3; index += 1) list.append(chip("Sugiriendo…", { sub: true })), list.lastChild.classList.add("loading");
      const byKey = new Map(state.catalog.map((tag) => [tag.key, tag]));
      const shown = [...new Set([...state.suggested.map((tag) => tag.key), ...state.selected])].map((key) => byKey.get(key)).filter(Boolean);
      // Puestas: con × para quitarlas. Sugeridas sin poner: punteadas, un clic las añade.
      shown.forEach((tag) => {
        const on = state.selected.has(tag.key);
        list.append(chip(on ? tag.name : `+ ${tag.name}`, { on, suggest: !on, color: tag.color, sub: tag.level === "secondary",
          onClick: () => { if (!on && state.selected.size < 5) { state.selected.add(tag.key); renderDialog(); } },
          onRemove: on ? () => { state.selected.delete(tag.key); renderDialog(); } : undefined }));
      });
      tagsSection.append(list);
      if (!state.loading && state.catalog.length) {
        const add = document.createElement("div");
        add.className = "dlg-add";
        add.style.marginTop = "6px";
        const input = document.createElement("input");
        input.placeholder = "Añadir otra etiqueta…";
        const menu = document.createElement("div");
        menu.className = "dlg-menu";
        const fold = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
        const update = () => {
          const query = fold(input.value.trim());
          // Solo al escribir: con el campo vacío no se despliega todo el catálogo.
          const matches = query ? state.catalog.filter((tag) => !state.selected.has(tag.key) && (fold(tag.name).includes(query) || tag.parents.some((parent) => fold(parent).includes(query)))).slice(0, 8) : [];
          menu.replaceChildren(...matches.map((tag, index) => {
            const option = document.createElement("button");
            option.type = "button";
            if (index === 0) option.className = "active";
            const dot = document.createElement("i"); dot.style.background = tag.color;
            option.append(dot, document.createTextNode(tag.name), textNode("small", tag.level === "secondary" ? tag.parents[0] || "" : "Tema"));
            option.addEventListener("mousedown", (event) => { event.preventDefault(); if (state.selected.size < 5) { state.selected.add(tag.key); renderDialog(); } });
            return option;
          }));
          menu.classList.toggle("show", Boolean(input === shadow.activeElement && matches.length));
        };
        input.addEventListener("input", update);
        input.addEventListener("focus", update);
        input.addEventListener("blur", () => setTimeout(() => menu.classList.remove("show"), 120));
        input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) { event.preventDefault(); menu.querySelector("button")?.dispatchEvent(new MouseEvent("mousedown")); } });
        add.append(input, menu);
        tagsSection.append(add);
      }
    }
    body.append(tagsSection);

    // Carpeta
    if (state.boards.length) {
      const folders = document.createElement("section");
      const folderTitle = textNode("h3", "Espacio");
      if (state.suggestedSpace) { const hint = document.createElement("em"); hint.textContent = `Sugerido: ${state.suggestedSpace.name}`; folderTitle.append(hint); }
      folders.append(folderTitle);
      const list = document.createElement("div");
      list.className = "dlg-chips";
      const ordered = [...state.boards].sort((a, b) => (state.recentIds.indexOf(a.id) + 1 || 999) - (state.recentIds.indexOf(b.id) + 1 || 999));
      list.append(chip("Ninguno", { on: !state.boardId, onClick: () => { state.boardId = ""; renderDialog(); } }));
      ordered.slice(0, 8).forEach((board) => list.append(chip(`${state.suggestedSpace?.id === board.id ? "✦ " : ""}${board.name}`, { on: state.boardId === board.id, color: board.color || "", onClick: () => { state.boardId = state.boardId === board.id ? "" : board.id; renderDialog(); } })));
      folders.append(list);
      body.append(folders);
    }

    // Nota
    const noteSection = document.createElement("section");
    noteSection.append(textNode("h3", "Nota"));
    const note = document.createElement("textarea");
    note.placeholder = "¿Por qué lo guardas? (opcional)";
    note.value = state.note || "";
    note.addEventListener("input", () => { state.note = note.value; });
    noteSection.append(note);
    body.append(noteSection);

    const foot = document.createElement("div");
    foot.className = "dlg-foot";
    if (state.existing) {
      const open = textNode("button", "Abrir en Lúmina", "dlg-link");
      open.addEventListener("click", () => { send({ type: "LUMINA_OPEN", path: state.existing.luminaUrl }); closeDialog(); });
      const spacer = document.createElement("label");
      spacer.append(open);
      foot.append(spacer);
    } else {
      const analyze = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox"; box.checked = state.analyze;
      box.addEventListener("change", () => { state.analyze = box.checked; });
      analyze.append(box, document.createTextNode("Resumir y analizar con IA"));
      foot.append(analyze);
    }
    const save = document.createElement("button");
    save.className = "dlg-save";
    save.type = "button";
    save.disabled = Boolean(state.loading && !state.error) || Boolean(state.saving);
    save.append(document.createTextNode(state.saving ? "Guardando…" : state.existing ? "Guardar cambios" : "Guardar"), textNode("kbd", isMacKeys ? "⌘↵" : "Ctrl↵"));
    save.addEventListener("click", () => void submitDialog());
    foot.append(save);

    dialog.append(head, body, foot);
    const focused = shadow.activeElement;
    const restoreInput = focused && focused.tagName === "INPUT" && focused.placeholder === "Añadir otra etiqueta…";
    dialogRoot.replaceChildren(dialog);
    if (restoreInput) dialog.querySelector(".dlg-add input")?.focus();
  }

  async function submitDialog() {
    const state = dialogState;
    if (!state || state.saving || (state.loading && !state.error)) return;
    state.saving = true;
    renderDialog();
    // Se esconde el diálogo un instante para que no salga en la captura de la página.
    if (!state.existing && !state.item) { dialogRoot.style.visibility = "hidden"; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 80)))); }
    const note = (state.note || "").trim();
    let result;
    const title = state.titleEdited || (!state.existing && state.title !== (state.metadata.title || document.title)) ? state.title.trim().slice(0, 200) : "";
    if (state.existing) result = await send({ type: "LUMINA_DIALOG_EXTRA", id: state.existing.id, boardId: state.boardId, note, title: state.titleEdited ? title : "", tagKeys: [...state.selected] }).catch((error) => ({ error: error?.message }));
    else result = await send({ type: "LUMINA_DIALOG_SAVE", payload: state.item?.payload || null, tagKeys: [...state.selected], boardId: state.boardId, note, analyze: state.analyze, title: state.titleEdited ? title : "" }).catch((error) => ({ error: error?.message }));
    if (!dialogState) return;
    dialogRoot.style.visibility = "";
    if (!result || result.error) { state.saving = false; state.error = result?.error || "No se pudo guardar."; renderDialog(); return; }
    closeDialog();
    if (state.existing) showToast({ title: state.existing.title, id: state.existing.id, tags: state.existing.tags, duplicate: true });
    else showToast(result);
  }

  dialogRoot.addEventListener("mousedown", (event) => { if (event.target === dialogRoot) closeDialog(); });
  document.addEventListener("keydown", (event) => {
    if (!dialogState) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeDialog(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submitDialog(); }
  }, true);
  // Mientras el diálogo está abierto, las teclas no llegan a la página (p. ej. atajos de YouTube o X).
  dialogRoot.addEventListener("keydown", (event) => { if (event.key !== "Escape" && !(event.key === "Enter" && (event.metaKey || event.ctrlKey))) event.stopPropagation(); });

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LUMINA_TOAST") { showToast(message.result); if (message.result && !message.result.error) window.setTimeout(() => void markSavedClips(), 600); }
    if (message?.type === "LUMINA_OPEN_DIALOG") { if (window.top === window) void openSaveDialog(); sendResponse({ ok: true }); return false; }
    if (message?.type === "LUMINA_READ_PAGE") sendResponse(globalThis.LuminaPage.readStructuredPage(document));
    return false;
  });
})();
