import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

// Puerta segura (HTTPS) para el celular dentro de la red de casa. Android solo instala la app de LUMINA
// y la deja en el menú Compartir si la conexión es HTTPS, así que aquí se crea un certificado propio:
// una «autoridad» de LUMINA que instalas una vez en el celular, y un certificado para esta Mac firmado por ella.
// Nada sale de tu red: el celular habla directo con la Mac y esta reenvía todo a la app de siempre.

export const MOBILE_HTTPS_PORT = Number(process.env.LUMINA_MOBILE_PORT || 3443);
const APP_PORT = Number(process.env.PORT || 3000);
const dataDirectory = process.env.LUMINA_DATA_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), "data");
const certDirectory = path.join(dataDirectory, "mobile-certs");
const caKey = path.join(certDirectory, "lumina-ca.key");
export const caCertPath = path.join(certDirectory, "lumina-ca.crt");
const serverKey = path.join(certDirectory, "server.key");
const serverCert = path.join(certDirectory, "server.crt");
const serverMeta = path.join(certDirectory, "server.json");

export function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((item): item is os.NetworkInterfaceInfo => Boolean(item && item.family === "IPv4" && !item.internal && !item.address.startsWith("169.254.")))
    .map((item) => item.address);
}

export function localHostName() {
  try { return execFileSync("/usr/sbin/scutil", ["--get", "LocalHostName"], { encoding: "utf8" }).trim(); } catch { return os.hostname().replace(/\.local$/, ""); }
}

function openssl(args: string[]) {
  execFileSync("/usr/bin/openssl", args, { stdio: "ignore" });
}

function ensureCa() {
  if (fs.existsSync(caKey) && fs.existsSync(caCertPath)) return;
  fs.mkdirSync(certDirectory, { recursive: true, mode: 0o700 });
  const config = path.join(certDirectory, "ca.cnf");
  fs.writeFileSync(config, [
    "[req]", "distinguished_name = dn", "prompt = no", "[dn]", "CN = LUMINA (solo esta casa)", "O = LUMINA",
    "[v3_ca]", "basicConstraints = critical, CA:TRUE, pathlen:0", "keyUsage = critical, keyCertSign, cRLSign", "subjectKeyIdentifier = hash",
  ].join("\n"));
  openssl(["req", "-x509", "-new", "-nodes", "-newkey", "rsa:2048", "-sha256", "-days", "3650", "-keyout", caKey, "-out", caCertPath, "-config", config, "-extensions", "v3_ca"]);
  fs.chmodSync(caKey, 0o600);
}

function serverNames() {
  const host = localHostName();
  return { ips: ["127.0.0.1", ...lanAddresses()], dns: ["localhost", ...(host ? [`${host}.local`] : [])] };
}

// El certificado de la Mac se rehace solo si cambia su dirección en la red o está por vencer;
// la autoridad no cambia, así que el celular no tiene que instalar nada de nuevo.
function ensureServerCert() {
  ensureCa();
  const names = serverNames();
  const wanted = [...names.ips.map((ip) => `IP:${ip}`), ...names.dns.map((dns) => `DNS:${dns}`)].sort();
  try {
    const meta = JSON.parse(fs.readFileSync(serverMeta, "utf8")) as { names: string[]; expires: number };
    if (fs.existsSync(serverCert) && meta.expires - Date.now() > 30 * 86_400_000 && wanted.every((name) => meta.names.includes(name))) return;
  } catch { /* se genera abajo */ }
  const csr = path.join(certDirectory, "server.csr");
  const ext = path.join(certDirectory, "server.ext");
  fs.writeFileSync(ext, ["basicConstraints = CA:FALSE", "keyUsage = critical, digitalSignature, keyEncipherment", "extendedKeyUsage = serverAuth", `subjectAltName = ${wanted.join(", ")}`].join("\n"));
  openssl(["req", "-new", "-nodes", "-newkey", "rsa:2048", "-keyout", serverKey, "-out", csr, "-subj", "/CN=LUMINA en esta Mac"]);
  // Chrome rechaza certificados de más de 398 días.
  openssl(["x509", "-req", "-in", csr, "-CA", caCertPath, "-CAkey", caKey, "-CAcreateserial", "-out", serverCert, "-days", "397", "-sha256", "-extfile", ext]);
  fs.chmodSync(serverKey, 0o600);
  fs.writeFileSync(serverMeta, JSON.stringify({ names: wanted, expires: Date.now() + 397 * 86_400_000 }));
}

type MobileState = { server?: https.Server; error?: string; timer?: NodeJS.Timeout };
const state = ((globalThis as unknown as { __luminaMobile?: MobileState }).__luminaMobile ??= {});

export function mobileHttpsStatus() {
  return { running: Boolean(state.server?.listening), error: state.error || "", port: MOBILE_HTTPS_PORT, addresses: lanAddresses(), host: localHostName(), caReady: fs.existsSync(caCertPath) };
}

function proxy(request: http.IncomingMessage, response: http.ServerResponse) {
  const upstream = http.request({
    host: "127.0.0.1",
    port: APP_PORT,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: `localhost:${APP_PORT}`, "x-forwarded-proto": "https", "x-forwarded-for": request.socket.remoteAddress || "" },
  }, (reply) => {
    response.writeHead(reply.statusCode || 502, reply.headers);
    reply.pipe(response);
  });
  upstream.on("error", () => { if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain; charset=utf-8" }); response.end("LUMINA no está respondiendo en esta Mac."); });
  request.pipe(upstream);
}

function listen() {
  try {
    ensureServerCert();
  } catch (error) {
    state.error = `No se pudo crear el certificado: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  const server = https.createServer({ key: fs.readFileSync(serverKey), cert: fs.readFileSync(serverCert) }, proxy);
  server.on("error", (error: NodeJS.ErrnoException) => { state.error = error.code === "EADDRINUSE" ? `El puerto ${MOBILE_HTTPS_PORT} ya está en uso.` : error.message; state.server = undefined; });
  server.listen(MOBILE_HTTPS_PORT, "0.0.0.0", () => { state.error = ""; });
  state.server = server;
}

export function startMobileHttps() {
  if (process.env.LUMINA_MOBILE === "0" || state.server) return;
  listen();
  // Si la Mac cambia de red, se rehace el certificado y se reinicia la puerta.
  let known = lanAddresses().join(",");
  state.timer = setInterval(() => {
    const now = lanAddresses().join(",");
    if (now === known) return;
    known = now;
    state.server?.close();
    state.server = undefined;
    listen();
  }, 60_000);
  state.timer.unref();
}
