import { getDb } from "./db";
import { checkLinks, findDuplicates } from "./maintenance";
import { backfillSnapshots } from "./snapshots";
import { similarTagPairs } from "./tag-merge";

// Limpieza automática una vez por semana: busca duplicados, revisa enlaces rotos, guarda copias de las webs
// y cuenta etiquetas parecidas. No borra ni une nada: deja un resumen para que tú decidas en Mantenimiento.

const REPORT_KEY = "weekly_maintenance_report";
const WEEK = 7 * 24 * 60 * 60_000;

export type MaintenanceReport = { at: string; duplicates: number; broken: number; snapshots: number; similarTags: number };

export function maintenanceReport(): MaintenanceReport | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(REPORT_KEY) as { value: string } | undefined;
  try { return row ? JSON.parse(row.value) as MaintenanceReport : null; } catch { return null; }
}

export async function runWeeklyMaintenance(force = false) {
  const last = maintenanceReport();
  if (!force && last && Date.now() - new Date(last.at).getTime() < WEEK) return last;
  const duplicates = findDuplicates().length;
  const broken = (await checkLinks()).length;
  const snapshots = (await backfillSnapshots()).saved;
  const report: MaintenanceReport = { at: new Date().toISOString(), duplicates, broken, snapshots, similarTags: similarTagPairs().length };
  getDb().prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(REPORT_KEY, JSON.stringify(report));
  return report;
}

export function scheduleWeeklyMaintenance() {
  const state = globalThis as { __luminaWeeklyTimer?: NodeJS.Timeout };
  if (state.__luminaWeeklyTimer) return;
  const run = () => { void runWeeklyMaintenance().catch((error) => console.warn("[LUMINA] La limpieza semanal falló:", error instanceof Error ? error.message : error)); };
  // Se revisa cada 6 horas si ya pasó una semana; la primera vez, unos minutos después de arrancar.
  setTimeout(run, 5 * 60_000).unref();
  state.__luminaWeeklyTimer = setInterval(run, 6 * 60 * 60_000);
  state.__luminaWeeklyTimer.unref();
}
