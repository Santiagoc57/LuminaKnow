// Interpreta fechas en español dentro de la búsqueda: "ayer", "la semana pasada", "febrero 2021", "12 de enero".
export type QueryDateRange = { from: number; to: number; phrase: string };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MONTH_PATTERN = `(${MONTHS.join("|")}|setiembre)`;
const BEFORE = "(?<![\\p{L}\\p{N}:#_-])";
const AFTER = "(?![\\p{L}\\p{N}:_-])";

function day(year: number, month: number, date: number) {
  return new Date(year, month, date).getTime();
}

function dayRange(now: Date, offset: number) {
  return [day(now.getFullYear(), now.getMonth(), now.getDate() + offset), day(now.getFullYear(), now.getMonth(), now.getDate() + offset + 1)];
}

// La semana empieza el lunes.
function weekRange(now: Date, offset: number) {
  const monday = now.getDate() - ((now.getDay() + 6) % 7) + offset * 7;
  return [day(now.getFullYear(), now.getMonth(), monday), day(now.getFullYear(), now.getMonth(), monday + 7)];
}

function monthRange(year: number, month: number) {
  return [day(year, month, 1), day(year, month + 1, 1)];
}

function monthIndex(name: string) {
  return name.toLocaleLowerCase("es") === "setiembre" ? 8 : MONTHS.indexOf(name.toLocaleLowerCase("es"));
}

type Rule = { pattern: string; range: (match: RegExpExecArray, now: Date) => number[] | null };

const RULES: Rule[] = [
  { pattern: "anteayer|antier|antes de ayer", range: (_, now) => dayRange(now, -2) },
  { pattern: "ayer", range: (_, now) => dayRange(now, -1) },
  { pattern: "hoy", range: (_, now) => dayRange(now, 0) },
  { pattern: "esta semana", range: (_, now) => weekRange(now, 0) },
  { pattern: "(?:la )?semana pasada", range: (_, now) => weekRange(now, -1) },
  { pattern: "este mes", range: (_, now) => monthRange(now.getFullYear(), now.getMonth()) },
  { pattern: "(?:el )?mes pasado", range: (_, now) => monthRange(now.getFullYear(), now.getMonth() - 1) },
  { pattern: "este a[nñ]o", range: (_, now) => [day(now.getFullYear(), 0, 1), day(now.getFullYear() + 1, 0, 1)] },
  { pattern: "(?:el )?a[nñ]o pasado", range: (_, now) => [day(now.getFullYear() - 1, 0, 1), day(now.getFullYear(), 0, 1)] },
  {
    pattern: "hace (\\d{1,3}) (d[ií]as?|semanas?|mes(?:es)?)",
    range: (match, now) => {
      const amount = Number(match[1]);
      const unit = match[2].toLocaleLowerCase("es");
      if (unit.startsWith("d")) return dayRange(now, -amount);
      if (unit.startsWith("s")) return weekRange(now, -amount);
      return monthRange(now.getFullYear(), now.getMonth() - amount);
    },
  },
  {
    pattern: `(\\d{1,2}) de ${MONTH_PATTERN}(?: (?:de |del )?(\\d{4}))?`,
    range: (match, now) => {
      const date = Number(match[1]);
      const month = monthIndex(match[2]);
      let year = match[3] ? Number(match[3]) : now.getFullYear();
      // Sin año se entiende la última vez que ocurrió esa fecha.
      if (!match[3] && day(year, month, date) > now.getTime()) year -= 1;
      if (new Date(year, month, date).getMonth() !== month) return null;
      return [day(year, month, date), day(year, month, date + 1)];
    },
  },
  { pattern: `${MONTH_PATTERN} (?:de |del )?(\\d{4})`, range: (match) => monthRange(Number(match[2]), monthIndex(match[1])) },
  // «en septiembre» sin año (el mes solo, «marzo», sigue siendo texto): el septiembre más reciente (este año si ya pasó o está en curso; si no, el anterior).
  { pattern: `(?:en |del mes de )${MONTH_PATTERN}`, range: (match, now) => { const month = monthIndex(match[1]); return monthRange(month <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1, month); } },
];

// Devuelve la búsqueda sin la frase de fecha. Lo que va entre comillas siempre es texto literal.
export function extractDateRange(input: string, now: Date): { rest: string; range: QueryDateRange | null } {
  const masked = input.replace(/"[^"]*"/g, (quoted) => " ".repeat(quoted.length));
  let best: { match: RegExpExecArray; bounds: number[] } | null = null;
  for (const rule of RULES) {
    const match = new RegExp(`${BEFORE}(?:${rule.pattern})${AFTER}`, "iu").exec(masked);
    if (!match) continue;
    const bounds = rule.range(match, now);
    // Una fecha imposible ("31 de febrero") no debe caer en otra regla: se deja como texto.
    if (!bounds) return { rest: input, range: null };
    if (!best || match[0].length > best.match[0].length) best = { match, bounds };
  }
  if (!best) return { rest: input, range: null };
  const { match, bounds } = best;
  return {
    rest: `${input.slice(0, match.index)} ${input.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim(),
    range: { from: bounds[0], to: bounds[1], phrase: match[0] },
  };
}
