import assert from "node:assert/strict";
import test from "node:test";
import { libraryQueryTerms, matchesLibraryQuery, parseLibraryQuery } from "../lib/library-query";
import { extractDateRange } from "../lib/query-dates";
import type { AppVideo } from "../lib/types";

// Viernes 6 de noviembre de 2026, 15:00
const NOW = new Date(2026, 10, 6, 15);
const local = (year: number, month: number, date: number) => new Date(year, month - 1, date).getTime();
const range = (input: string) => extractDateRange(input, NOW).range;

test("entiende fechas en español", () => {
  assert.deepEqual([range("hoy")?.from, range("hoy")?.to], [local(2026, 11, 6), local(2026, 11, 7)]);
  assert.equal(range("ayer")?.from, local(2026, 11, 5));
  assert.equal(range("anteayer")?.from, local(2026, 11, 4));
  assert.equal(range("antes de ayer")?.from, local(2026, 11, 4));
  assert.deepEqual([range("esta semana")?.from, range("esta semana")?.to], [local(2026, 11, 2), local(2026, 11, 9)]);
  assert.deepEqual([range("la semana pasada")?.from, range("la semana pasada")?.to], [local(2026, 10, 26), local(2026, 11, 2)]);
  assert.deepEqual([range("mes pasado")?.from, range("mes pasado")?.to], [local(2026, 10, 1), local(2026, 11, 1)]);
  assert.equal(range("el año pasado")?.from, local(2025, 1, 1));
  assert.deepEqual([range("febrero 2021")?.from, range("febrero 2021")?.to], [local(2021, 2, 1), local(2021, 3, 1)]);
  assert.equal(range("febrero de 2021")?.from, local(2021, 2, 1));
  assert.equal(range("12 de enero de 2021")?.from, local(2021, 1, 12));
  assert.equal(range("hace 3 días")?.from, local(2026, 11, 3));
  assert.equal(range("hace 2 meses")?.from, local(2026, 9, 1));
});

test("una fecha sin año es la última vez que ocurrió", () => {
  assert.equal(range("3 de noviembre")?.from, local(2026, 11, 3));
  assert.equal(range("25 de diciembre")?.from, local(2025, 12, 25));
});

test("cruza bien el cambio de año", () => {
  const january = extractDateRange("mes pasado", new Date(2027, 0, 15)).range;
  assert.equal(january?.from, local(2026, 12, 1));
});

test("no confunde texto normal con fechas", () => {
  assert.equal(range("marzo"), null, "un mes solo puede ser texto");
  assert.equal(range("mayoría"), null);
  assert.equal(range("hoyo"), null);
  assert.equal(range("31 de febrero de 2021"), null);
  assert.equal(range('"hoy en día"'), null, "las comillas fuerzan texto literal");
  assert.equal(range("tipo:hoy"), null);
  assert.equal(range("#ayer"), null);
  assert.equal(extractDateRange("artículos la semana pasada tipo:x", NOW).rest, "artículos tipo:x");
});

const source = (title: string, createdAt: Date, extra: object = {}) => ({ id: title, sourceType: "web", url: "https://example.com", title, channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: createdAt.toISOString(), ...extra }) as unknown as AppVideo;

test("la fecha filtra por cuándo se guardó y se combina con otros términos", () => {
  const video = source("Ensayo sobre porsche", new Date(2026, 10, 5, 22));
  const matches = (query: string) => matchesLibraryQuery(video, parseLibraryQuery(query, NOW));
  assert.ok(matches("ayer"));
  assert.ok(matches("ayer porsche"));
  assert.ok(matches("esta semana"));
  assert.ok(!matches("hoy"));
  assert.ok(!matches("ayer mercedes"));
  assert.ok(matches('"ensayo"'));
  assert.ok(!matches('"hoy"'));
});

test("la búsqueda con || acepta cualquiera de las alternativas", () => {
  const porsche = source("Un porsche clásico", NOW);
  const mercedes = source("Un mercedes viejo", NOW);
  const ford = source("Un ford azul", NOW);
  const matches = (video: AppVideo, query: string) => matchesLibraryQuery(video, parseLibraryQuery(query, NOW));
  for (const query of ["porsche || mercedes", "porsche||mercedes"]) {
    assert.ok(matches(porsche, query));
    assert.ok(matches(mercedes, query));
    assert.ok(!matches(ford, query));
  }
  assert.ok(matches(porsche, "porsche || mercedes clásico"), "los demás términos también deben cumplirse");
  assert.ok(!matches(mercedes, "porsche || mercedes clásico"));
  assert.ok(matches(ford, "porsche || mercedes || ford"));
  assert.ok(matches(ford, "|| ford"), "un || suelto no rompe la búsqueda");
  assert.ok(matches(porsche, "porsche ||"));
});

test("los espacios muestran cada alternativa y cada fecha como una sola ficha", () => {
  assert.deepEqual(libraryQueryTerms("porsche || mercedes tipo:imagen"), ["porsche || mercedes", "tipo:imagen"]);
  assert.deepEqual(libraryQueryTerms("la semana pasada #logo"), ["la semana pasada", "#logo"]);
  assert.deepEqual(libraryQueryTerms('"hoy en día" nubes'), ['"hoy en día"', "nubes"]);
});

test("tipo:captura reconoce capturas pero no portadas de páginas web", () => {
  const visual = (confidence: number) => ({ visual: { text: "", labels: [{ id: "screenshot", name: "captura de pantalla", confidence }], colors: [], width: 1, height: 1, description: "", objects: [], aiModel: "", error: "" } });
  const matches = (video: AppVideo) => matchesLibraryQuery(video, parseLibraryQuery("tipo:captura", NOW));
  assert.ok(matches(source("post", NOW, { sourceType: "x", ...visual(0.95) })));
  assert.ok(matches(source("imagen", NOW, { sourceType: "image", ...visual(0.9) })));
  assert.ok(!matches(source("portada", NOW, { sourceType: "web", ...visual(0.95) })));
  assert.ok(!matches(source("dudosa", NOW, { sourceType: "image", ...visual(0.4) })));
  assert.ok(!matches(source("sin analizar", NOW, { sourceType: "image" })));
});
