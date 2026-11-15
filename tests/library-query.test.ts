import assert from "node:assert/strict";
import test from "node:test";
import { matchesLibraryQuery, parseLibraryQuery } from "../lib/library-query";
import type { AppVideo, LibraryTag } from "../lib/types";

const tags: LibraryTag[] = [
  { id: "politica", catalogKey: "p", name: "Política", color: "#000", level: "primary", parentIds: [], sortOrder: 0, active: true },
  { id: "batalla", catalogKey: "b", name: "Batalla cultural", color: "#000", level: "secondary", parentIds: ["politica"], sortOrder: 0, active: true },
];
const video = { id: "v", sourceType: "web", url: "https://example.com/ensayo", title: "La libertad", channel: "David", description: "Ensayo político", createdAt: "2026-04-01T00:00:00Z", tags: [tags[1]], collections: [{ id: "c", name: "Lecturas", color: "#000" }], sourceItems: [], note: null, summary: null } as unknown as AppVideo;

test("interpreta operadores, comillas y etiquetas jerárquicas", () => {
  const parsed = parseLibraryQuery('#política site:example.com en:"Lecturas" autor:David antes:2027 libertad');
  assert.deepEqual(parsed.tagTerms, ["política"]);
  assert.equal(parsed.collection, "Lecturas");
  assert.equal(parsed.text, "libertad");
  assert.equal(matchesLibraryQuery(video, parsed, tags), true);
  assert.equal(matchesLibraryQuery(video, parseLibraryQuery("tipo:youtube"), tags), false);
});

test("los enlaces se comparan sin www, parámetros de seguimiento ni barra final", async () => {
  const { normalizeUrl } = await import("../lib/maintenance");
  assert.equal(normalizeUrl("https://www.example.com/articulo/?utm_source=x&id=3#arriba"), normalizeUrl("https://example.com/articulo?id=3"));
  assert.notEqual(normalizeUrl("https://example.com/a?id=3"), normalizeUrl("https://example.com/a?id=4"));
});
