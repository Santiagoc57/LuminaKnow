const extensionBrowser = globalThis.browser || globalThis.chrome;
const defaults = { serverUrl: "http://localhost:3000", token: "", resurface: true, defaultMode: "process", floatingButtons: true, askNote: false };
const field = (id) => document.getElementById(id);

async function load() {
  const config = { ...defaults, ...await extensionBrowser.storage.local.get(defaults) };
  field("server").value = config.serverUrl;
  field("token").value = config.token;
  field("resurface").checked = config.resurface;
  field("analyze").checked = config.defaultMode !== "save";
  field("floating").checked = config.floatingButtons !== false;
  field("ask-note").checked = Boolean(config.askNote);
}

async function save() {
  const config = { serverUrl: field("server").value.trim().replace(/\/$/, "") || defaults.serverUrl, token: field("token").value.trim(), resurface: field("resurface").checked, defaultMode: field("analyze").checked ? "process" : "save", floatingButtons: field("floating").checked, askNote: field("ask-note").checked };
  await extensionBrowser.storage.local.set(config);
  return config;
}

async function testConnection(persist) {
  field("status").textContent = "Conectando…";
  field("status").className = "";
  try {
    const config = persist ? await save() : { serverUrl: field("server").value.trim().replace(/\/$/, ""), token: field("token").value.trim() };
    const response = await fetch(`${config.serverUrl}/api/extension/ping`, { headers: { Authorization: `Bearer ${config.token}` } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "No fue posible conectar.");
    field("status").textContent = `Conectada con el perfil ${payload.profile.name}.`;
    field("status").className = "success";
  } catch (error) {
    field("status").textContent = error instanceof Error ? error.message : "No fue posible conectar.";
    field("status").className = "error";
  }
}

field("save").addEventListener("click", () => testConnection(true));
field("test").addEventListener("click", () => testConnection(false));
void load();
