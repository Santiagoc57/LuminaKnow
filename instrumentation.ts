// Se ejecuta una vez al arrancar el servidor de LUMINA.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Primero, lo más nuevo de iCloud (si la sincronización está activada en este Mac).
  const { scheduleICloudSync } = await import("./lib/icloud-sync");
  scheduleICloudSync();
  // Bot de Telegram propio, si está configurado.
  const { startTelegram } = await import("./lib/telegram");
  startTelegram();
  const { startMobileHttps } = await import("./lib/mobile-https");
  startMobileHttps();
  if (process.env.LUMINA_DAILY_BACKUP !== "0") {
    const { scheduleDailyBackups } = await import("./lib/backup");
    scheduleDailyBackups();
  }
  if (process.env.LUMINA_WEEKLY_MAINTENANCE !== "0") {
    const { scheduleWeeklyMaintenance } = await import("./lib/weekly-maintenance");
    scheduleWeeklyMaintenance();
  }
}
