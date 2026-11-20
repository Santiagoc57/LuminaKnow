import crypto from "node:crypto";
import { getDb } from "./db";
import { createExtensionToken } from "./extension-auth";
import { getTelegramConfig, setTelegramConfig } from "./secrets";

// Guardar desde Telegram: tu propio bot (creado con @BotFather). El Mac le pregunta a Telegram por mensajes nuevos
// (no hace falta abrir puertos ni un servidor en internet). Solo tu chat, vinculado con un código, puede guardar.

const API = "https://api.telegram.org";
const APP_PORT = Number(process.env.PORT || 3000);
type Update = { update_id: number; message?: { chat: { id: number }; text?: string; caption?: string; photo?: Array<{ file_id: string; file_size?: number }>; document?: { file_id: string; mime_type?: string; file_name?: string }; entities?: Array<{ type: string; url?: string; offset: number; length: number }> } };

const state = globalThis as { __luminaTelegram?: { running: boolean; offset: number; pairCode: string; pairExpires: number; lastError: string; serverToken: string } };
function runtime() {
  state.__luminaTelegram ??= { running: false, offset: 0, pairCode: "", pairExpires: 0, lastError: "", serverToken: "" };
  return state.__luminaTelegram;
}

async function call<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const { token } = getTelegramConfig();
  const response = await fetch(`${API}/bot${token}/${method}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(65_000) });
  const data = await response.json() as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(data.description || `Telegram respondió ${response.status}`);
  return data.result;
}

const reply = (chatId: number, text: string) => call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }).catch(() => undefined);

// Guarda usando las mismas rutas que la extensión y el celular, con un código propio del cliente «telegram».
async function luminaPost(path: string, body: unknown) {
  const run = runtime();
  if (!run.serverToken) {
    const profile = getDb().prepare("SELECT id FROM profiles ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    if (!profile) throw new Error("LUMINA aún no tiene perfil.");
    run.serverToken = createExtensionToken(profile.id, "telegram");
  }
  const response = await fetch(`http://127.0.0.1:${APP_PORT}${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${run.serverToken}` }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { title?: string; duplicate?: boolean; error?: string };
  if (!response.ok) throw new Error(data.error || "LUMINA no pudo guardarlo.");
  return data;
}

function firstUrl(message: NonNullable<Update["message"]>) {
  const text = message.text || message.caption || "";
  const fromEntity = (message.entities ?? []).find((entity) => entity.type === "text_link" && entity.url)?.url;
  return fromEntity || text.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;!?]+$/, "") || "";
}

async function handle(update: Update) {
  const message = update.message;
  if (!message) return;
  const chatId = message.chat.id;
  const { chatId: allowed } = getTelegramConfig();
  const run = runtime();
  const text = (message.text || "").trim();
  // Vincular: el primer chat que envía el código que muestra Ajustes queda como el tuyo.
  if (!allowed) {
    const code = text.replace(/^\/start\s*/i, "").replace(/\D/g, "");
    if (run.pairCode && Date.now() < run.pairExpires && code === run.pairCode) {
      setTelegramConfig({ chatId });
      run.pairCode = "";
      await reply(chatId, "✓ Listo: este chat ya guarda en tu LUMINA. Reenvíame enlaces, fotos o texto.");
    } else await reply(chatId, "Hola. Para vincularme, escribe aquí el código que aparece en LUMINA → Ajustes → Telegram.");
    return;
  }
  if (chatId !== allowed) return; // Solo tu chat.
  try {
    if (message.photo?.length || (message.document && /^image\//.test(message.document.mime_type || ""))) {
      const fileId = message.photo ? [...message.photo].sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0].file_id : message.document!.file_id;
      const file = await call<{ file_path: string }>("getFile", { file_id: fileId });
      const bytes = Buffer.from(await (await fetch(`${API}/file/bot${getTelegramConfig().token}/${file.file_path}`, { signal: AbortSignal.timeout(60_000) })).arrayBuffer());
      const saved = await luminaPost("/api/extension/image", { bytesBase64: bytes.toString("base64"), title: (message.caption || "").slice(0, 200) });
      await reply(chatId, saved.duplicate ? "Esa imagen ya estaba en LUMINA." : "✓ Imagen guardada en LUMINA.");
      return;
    }
    const url = firstUrl(message);
    if (url) {
      const saved = await luminaPost("/api/extension/capture", { url, title: "", description: (message.text || message.caption || "").replace(url, "").trim().slice(0, 2000), mode: "process" });
      await reply(chatId, saved.duplicate ? `Ya estaba en LUMINA: ${saved.title || url}` : `✓ Guardado en LUMINA${saved.title ? `: ${saved.title}` : ""}. Lo estoy analizando.`);
      return;
    }
    if (text && !text.startsWith("/")) {
      await luminaPost("/api/mobile/note", { text });
      await reply(chatId, "✓ Nota guardada en LUMINA.");
    }
  } catch (error) {
    await reply(chatId, `No pude guardarlo: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

async function loop() {
  const run = runtime();
  while (run.running && getTelegramConfig().token) {
    try {
      const updates = await call<Update[]>("getUpdates", { offset: run.offset, timeout: 50, allowed_updates: ["message"] });
      run.lastError = "";
      for (const update of updates) { run.offset = update.update_id + 1; await handle(update); }
    } catch (error) {
      run.lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  run.running = false;
}

export function startTelegram() {
  const run = runtime();
  if (run.running || !getTelegramConfig().token) return;
  run.running = true;
  void loop();
}

export function stopTelegram() { runtime().running = false; }

export async function connectTelegram(token: string) {
  setTelegramConfig({ token: token.trim() });
  const me = await call<{ username: string }>("getMe").catch((error) => { setTelegramConfig({ token: "" }); throw new Error(`Esa clave no funciona: ${error instanceof Error ? error.message : error}`); });
  stopTelegram();
  setTimeout(startTelegram, 500);
  return newPairCode(me.username);
}

export function newPairCode(username = "") {
  const run = runtime();
  run.pairCode = String(crypto.randomInt(100000, 999999));
  run.pairExpires = Date.now() + 15 * 60_000;
  return { username, code: run.pairCode };
}

export async function telegramStatus() {
  const { token, chatId } = getTelegramConfig();
  const run = runtime();
  let username = "";
  if (token) { try { username = (await call<{ username: string }>("getMe")).username; } catch { username = ""; } }
  return { connected: Boolean(token), username, paired: Boolean(chatId), running: run.running, lastError: run.lastError, pairCode: run.pairCode && Date.now() < run.pairExpires ? run.pairCode : "" };
}

export function disconnectTelegram() {
  stopTelegram();
  setTelegramConfig({ token: "" });
}
