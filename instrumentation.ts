// Se ejecuta una vez al arrancar el servidor de LUMINA.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startMobileHttps } = await import("./lib/mobile-https");
  startMobileHttps();
}
