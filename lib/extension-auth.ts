import crypto from "node:crypto";
import { getDb } from "./db";

const TOKEN_PREFIX = "lumina_ext_";

// Cada cliente (la extensión del navegador, OpenClip…) tiene su propio código: revocar uno no desconecta los demás.
export type ExtensionClient = "browser" | "openclip" | "mobile";

function tokenSettingKey(profileId: string, client: ExtensionClient = "browser") {
  return client === "browser" ? `extension_token_hash:${profileId}` : `extension_token_hash:${profileId}:${client}`;
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createExtensionToken(profileId: string, client: ExtensionClient = "browser") {
  const encodedProfile = Buffer.from(profileId).toString("base64url");
  const token = `${TOKEN_PREFIX}${encodedProfile}.${client === "browser" ? "" : `${client}.`}${crypto.randomBytes(32).toString("base64url")}`;
  getDb().prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(tokenSettingKey(profileId, client), hashToken(token));
  return token;
}

export function hasExtensionToken(profileId: string, client: ExtensionClient = "browser") {
  return Boolean(getDb().prepare("SELECT 1 FROM settings WHERE key = ?").get(tokenSettingKey(profileId, client)));
}

export function revokeExtensionToken(profileId: string, client: ExtensionClient = "browser") {
  getDb().prepare("DELETE FROM settings WHERE key = ?").run(tokenSettingKey(profileId, client));
}

export function profileForExtensionToken(token: string | null) {
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const parts = token.slice(TOKEN_PREFIX.length).split(".");
  const encodedProfile = parts[0];
  const client: ExtensionClient = parts.length === 3 && (parts[1] === "openclip" || parts[1] === "mobile") ? parts[1] : "browser";
  if (!encodedProfile) return null;
  let profileId = "";
  try { profileId = Buffer.from(encodedProfile, "base64url").toString("utf8"); } catch { return null; }
  const stored = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(tokenSettingKey(profileId, client)) as { value: string } | undefined;
  if (!stored) return null;
  const actual = hashToken(token);
  if (stored.value.length !== actual.length || !crypto.timingSafeEqual(Buffer.from(stored.value), Buffer.from(actual))) return null;
  return (getDb().prepare("SELECT id, name, avatar_color AS avatarColor FROM profiles WHERE id = ?").get(profileId) as { id: string; name: string; avatarColor: string } | undefined) || null;
}

export function requireExtensionProfile(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.toLocaleLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : request.headers.get("x-lumina-token");
  const profile = profileForExtensionToken(token);
  if (!profile) throw new Error("UNAUTHORIZED");
  return profile;
}
