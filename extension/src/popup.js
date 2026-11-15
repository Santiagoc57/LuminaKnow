const browserApi = globalThis.browser || globalThis.chrome;
const $ = (selector) => document.querySelector(selector);
let context = null;
let savedId = null;

function message(type, payload = {}) {
  return browserApi.runtime.sendMessage({ type, ...payload });
}

function showRelated(items) {
  if (!items?.length) return;
  $("#related").classList.remove("hidden");
  $("#related-count").textContent = String(items.length);
  $("#related-list").replaceChildren(...items.map((item) => {
    const button = document.createElement("button");
    button.className = "related-item";
    const mark = document.createElement("span");
    mark.textContent = item.sourceType === "youtube" ? "▶" : item.sourceType === "reddit" ? "r/" : item.sourceType === "x" ? "𝕏" : "↗";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = item.title;
    const reason = document.createElement("small");
    reason.textContent = item.reason;
    copy.append(title, reason);
    button.append(mark, copy);
    button.addEventListener("click", () => message("LUMINA_OPEN", { path: item.luminaUrl }));
    return button;
  }));
}

function renderTags() {
  $("#tags").replaceChildren(...context.tags.map((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = tag.name;
    chip.title = "Quitar etiqueta";
    chip.addEventListener("click", () => { context.tags = context.tags.filter((item) => item.key !== tag.key); renderTags(); });
    return chip;
  }));
}

async function load() {
  const result = await message("LUMINA_GET_CONTEXT");
  $("#loading").classList.add("hidden");
  if (result.error) { $("#setup").classList.remove("hidden"); $("#setup p").textContent = result.error; return; }
  context = result;
  if (!result.config.connected) { $("#setup").classList.remove("hidden"); return; }
  $("#capture").classList.remove("hidden");
  $("#site").textContent = result.metadata.siteName || new URL(result.metadata.url).hostname;
  const url = new URL(result.metadata.url);
  if (/(^|\.)google\./.test(url.hostname) && (url.searchParams.get("udm") === "2" || url.searchParams.get("tbm") === "isch")) {
    $("#hint").textContent = "Esto guardaría la búsqueda. Para guardar una imagen, pasa el ratón sobre ella y pulsa el botón de Lúmina.";
    $("#hint").classList.remove("hidden");
  }
  $("#save").textContent = result.config.defaultMode === "save" ? "Guardar" : "Guardar y analizar";
  $("#title").textContent = result.metadata.title;
  renderTags();
  showRelated(result.related);
}

async function capture() {
  if (!context) return;
  const button = $("#save");
  const mode = context.config.defaultMode;
  button.disabled = true; $("#message").textContent = mode === "process" ? "Guardando y analizando…" : "Guardando…";
  const result = await message("LUMINA_CAPTURE", { metadata: context.metadata, mode, tags: context.tags });
  button.disabled = false;
  if (result.error) { $("#message").textContent = result.error; $("#message").className = "message error"; return; }
  $("#message").textContent = result.duplicate ? "Ya estaba en Lúmina." : mode === "process" ? "Guardado. El análisis ya comenzó." : "Guardado en Lúmina.";
  $("#message").className = "message success";
  savedId = result.id;
  $("#note-box").classList.remove("hidden");
  $("#note").focus();
}

async function saveNote() {
  const note = $("#note").value.trim();
  if (!savedId || !note) return;
  $("#save-note").disabled = true;
  const result = await message("LUMINA_ADD_NOTE", { id: savedId, note });
  $("#save-note").disabled = false;
  if (result.error) { $("#message").textContent = result.error; $("#message").className = "message error"; return; }
  $("#note").value = "";
  $("#message").textContent = "Nota guardada.";
  $("#message").className = "message success";
}

$("#save").addEventListener("click", () => capture());
if (/Mac/i.test(navigator.platform)) $("#shortcut").textContent = "⌃⇧S guarda al instante";
$("#save-note").addEventListener("click", () => saveNote());
$("#options").addEventListener("click", () => browserApi.runtime.openOptionsPage());
$("#open-options").addEventListener("click", () => browserApi.runtime.openOptionsPage());
$("#open-lumina").addEventListener("click", () => message("LUMINA_OPEN"));
void load();
