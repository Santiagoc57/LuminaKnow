/* Service worker de LUMINA en el celular: recibe lo compartido aunque la Mac no esté al alcance. */
importScripts("/m/core.js");

const CACHE = "lumina-m-v6";
const SHELL = ["/m/index.html", "/m/app.js", "/m/core.js", "/m/app.css", "/m/manifest.webmanifest", "/m/icon-192.png", "/m/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((client) => client.postMessage(message));
}

async function flushAndNotify() {
  const result = await LuminaCore.flush();
  await notifyClients({ type: "flushed", result });
  if (result.pending && result.state === "away" && self.registration.sync) {
    try { await self.registration.sync.register("lumina-flush"); } catch { /* sin sincronización en segundo plano */ }
  }
  return result;
}

async function handleShare(event) {
  const form = await event.request.formData();
  const count = await LuminaCore.enqueueShare({
    title: String(form.get("title") || ""),
    text: String(form.get("text") || ""),
    url: String(form.get("url") || ""),
    files: form.getAll("files"),
  });
  event.waitUntil(flushAndNotify());
  return Response.redirect(`/m/index.html?shared=${count}`, 303);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method === "POST" && url.pathname === "/m/share") { event.respondWith(handleShare(event)); return; }
  if (event.request.method !== "GET" || !url.pathname.startsWith("/m/")) return;
  // Primero lo guardado (abre al instante, incluso fuera de casa) y se actualiza por detrás cuando hay conexión.
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = url.pathname === "/m/" ? "/m/index.html" : url.pathname;
    const cached = await cache.match(key);
    const network = fetch(event.request).then((response) => { if (response.ok) cache.put(key, response.clone()); return response; }).catch(() => cached);
    return cached || network;
  }));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "lumina-flush") event.waitUntil(flushAndNotify().then((result) => { if (result.state === "away") throw new Error("La Mac aún no está al alcance."); }));
});

self.addEventListener("message", (event) => {
  if (event.data === "flush") event.waitUntil(flushAndNotify());
});
