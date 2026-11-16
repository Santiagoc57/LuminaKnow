// Límite de intentos de PIN: LUMINA está abierta en la Wi-Fi de casa (para el celular),
// así que nadie en la red debe poder probar PIN sin parar. Tras 5 fallos seguidos se bloquea
// ese perfil 30 s, y cada nuevo fallo duplica la espera (hasta 15 min). Un acierto lo reinicia.
type Entry = { failures: number; lockedUntil: number };
const MAX_FREE_FAILURES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const store = ((globalThis as unknown as { __luminaLoginThrottle?: Map<string, Entry> }).__luminaLoginThrottle ??= new Map());

export function loginWaitSeconds(key: string, now = Date.now()) {
  const entry = store.get(key);
  return entry && entry.lockedUntil > now ? Math.ceil((entry.lockedUntil - now) / 1000) : 0;
}

export function recordLoginFailure(key: string, now = Date.now()) {
  const entry = store.get(key) ?? { failures: 0, lockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= MAX_FREE_FAILURES) entry.lockedUntil = now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (entry.failures - MAX_FREE_FAILURES));
  store.set(key, entry);
  return loginWaitSeconds(key, now);
}

export function recordLoginSuccess(key: string) {
  store.delete(key);
}
