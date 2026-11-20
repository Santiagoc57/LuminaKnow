import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dataDirectory = process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const secretsPath = path.join(dataDirectory, "secrets.json");

type Secrets = { geminiApiKey?: string; openaiApiKey?: string; sessionSecret?: string; telegramBotToken?: string; telegramChatId?: number };

function readSecrets(): Secrets {
  try {
    return JSON.parse(fs.readFileSync(secretsPath, "utf8")) as Secrets;
  } catch {
    return {};
  }
}

function writeSecrets(secrets: Secrets) {
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  fs.chmodSync(secretsPath, 0o600);
}

export function getOpenAIKey() {
  return process.env.OPENAI_API_KEY || readSecrets().openaiApiKey || "";
}

export function setOpenAIKey(openaiApiKey: string) {
  const secrets = readSecrets();
  if (openaiApiKey.trim()) secrets.openaiApiKey = openaiApiKey.trim();
  else delete secrets.openaiApiKey;
  writeSecrets(secrets);
}

export function getGeminiKey() {
  return process.env.GEMINI_API_KEY || readSecrets().geminiApiKey || "";
}

export function setGeminiKey(geminiApiKey: string) {
  const secrets = readSecrets();
  if (geminiApiKey.trim()) secrets.geminiApiKey = geminiApiKey.trim();
  else delete secrets.geminiApiKey;
  writeSecrets(secrets);
}

// Bot de Telegram propio: su clave y el chat (tu cuenta) que puede guardar en LUMINA.
export function getTelegramConfig() {
  const secrets = readSecrets();
  return { token: secrets.telegramBotToken || "", chatId: secrets.telegramChatId || 0 };
}

export function setTelegramConfig(patch: { token?: string; chatId?: number | null }) {
  const secrets = readSecrets();
  if (patch.token !== undefined) { secrets.telegramBotToken = patch.token || undefined; secrets.telegramChatId = undefined; }
  if (patch.chatId !== undefined) secrets.telegramChatId = patch.chatId || undefined;
  writeSecrets(secrets);
}

export function getSessionSecret() {
  const secrets = readSecrets();
  if (secrets.sessionSecret) return secrets.sessionSecret;
  secrets.sessionSecret = crypto.randomBytes(48).toString("base64url");
  writeSecrets(secrets);
  return secrets.sessionSecret;
}
