/* Página de LUMINA en el celular: vincular, ver la bandeja y enviar. */
(function () {
  const core = self.LuminaCore;
  const app = document.getElementById("app");
  const statusEl = document.getElementById("status");
  const toastEl = document.getElementById("toast");
  let objectUrls = [];
  let connection = { state: "checking" };

  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const ago = (time) => {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return "ahora";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `hace ${hours} h` : `hace ${Math.round(hours / 24)} d`;
  };

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => toastEl.classList.remove("show"), 2800);
  }

  function setStatus() {
    const labels = {
      checking: "Comprobando tu Mac…",
      online: `Conectado con tu Mac${connection.name ? ` · ${connection.name}` : ""}`,
      away: "Fuera de alcance · se envía al volver a casa",
      unpaired: "Sin vincular",
      revoked: "Este celular fue desvinculado",
    };
    statusEl.textContent = labels[connection.state] || "";
    statusEl.className = connection.state === "online" ? "online" : "";
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
      } catch (cause) {
        error.textContent = cause instanceof TypeError ? "No se pudo hablar con tu Mac. ¿Estás en la Wi-Fi de casa?" : cause.message;
      }
    });
  }

  async function mainView() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
    const queue = (await core.list("queue")).sort((a, b) => a.id - b.id);
    const sent = (await core.list("sent")).sort((a, b) => b.sentAt - a.sentAt).slice(0, 12);
    const thumb = (item) => {
      if (item.kind === "image" && item.blob) { const url = URL.createObjectURL(item.blob); objectUrls.push(url); return `<span class="thumb" style="background-image:url('${url}')"></span>`; }
      return `<span class="thumb">${item.kind === "url" ? "↗" : "✎"}</span>`;
    };
    const label = (item) => item.kind === "image" ? (item.title || item.name || "Imagen") : item.kind === "url" ? (item.title || item.url) : item.text;
    app.innerHTML = `
      ${connection.state === "revoked" ? `<section class="card"><p class="lead">Este celular ya no está vinculado.</p><p class="muted">Genera un código nuevo en tu Mac para volver a vincularlo. Lo que está en la bandeja se conserva.</p><div class="row" style="margin-top:12px"><button id="repair">Vincular de nuevo</button></div></section>` : ""}
      <section>
        <h2>Bandeja${queue.length ? ` · ${queue.length}` : ""}</h2>
        ${queue.length ? `<div class="list">${queue.map((item) => `
          <div class="item">${thumb(item)}<div><strong>${escapeHtml(label(item))}</strong>
            ${item.error ? `<small class="error">${escapeHtml(item.error)}</small>` : `<small>Esperando a tu Mac · ${ago(item.createdAt)}</small>`}
            <span class="actions">${item.error ? `<button class="link" data-retry="${item.id}">Reintentar</button>` : ""}<button class="link" data-remove="${item.id}">Quitar</button></span>
          </div></div>`).join("")}</div>
          <div class="row" style="margin-top:12px"><button id="send">Enviar ahora</button></div>`
          : `<div class="card empty">Nada pendiente. Comparte una foto, una captura o un enlace y elige <b>LUMINA</b>.</div>`}
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

    const sendButton = document.getElementById("send");
    if (sendButton) sendButton.addEventListener("click", () => void sendNow());
    const repair = document.getElementById("repair");
    if (repair) repair.addEventListener("click", async () => { await core.setMeta("token", null); connection = { state: "unpaired" }; await render(); });
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
      if (!window.confirm("¿Desvincular este celular? Lo que está en la bandeja se conserva.")) return;
      await core.setMeta("token", null);
      connection = { state: "unpaired" };
      await render();
    });
  }

  async function render() {
    setStatus();
    if (!window.isSecureContext) {
      app.innerHTML = `<section class="card"><p class="lead">Abre LUMINA con la dirección segura (https).</p><p class="muted">Sin ella, Android no deja instalar la app ni recibir lo que compartes. Mira la guía en Ajustes → Celular, en tu Mac.</p></section>`;
      return;
    }
    if (connection.state === "unpaired") return pairView();
    return mainView();
  }

  async function start() {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      try { await navigator.serviceWorker.register("/m/sw.js", { scope: "/m/" }); } catch { /* sin modo sin conexión */ }
      navigator.serviceWorker.addEventListener("message", (event) => { if (event.data && event.data.type === "flushed") void render(); });
    }
    const shared = Number(new URLSearchParams(location.search).get("shared") || "0");
    if (shared) { toast(shared === 1 ? "Guardado en LUMINA" : `${shared} guardados en LUMINA`); history.replaceState(null, "", "/m/index.html"); }
    connection = window.isSecureContext ? await core.ping() : { state: "away" };
    await render();
    if (connection.state === "online" && (await core.list("queue")).length) await sendNow();
  }

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    connection = await core.ping();
    await render();
    if (connection.state === "online" && (await core.list("queue")).length) await sendNow();
  });

  void start();
})();
