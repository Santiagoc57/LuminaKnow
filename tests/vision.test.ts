import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { matchesLibraryQuery, parseLibraryQuery } from "../lib/library-query";
import { sniffImage } from "../lib/media";
import type { AppVideo } from "../lib/types";
import { colorName } from "../lib/visual-colors";

test("los formatos se reconocen por sus bytes, no por el nombre", () => {
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext, "jpg");
  assert.equal(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))?.ext, "png");
  assert.equal(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))?.ext, "webp");
  assert.equal(sniffImage(new TextEncoder().encode("<!doctype html><html>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns=")), null);
});

test("los colores tienen nombre en español", () => {
  assert.deepEqual(["#101010", "#ffffff", "#808080", "#d02020", "#2050d0", "#20a040", "#f0d020", "#e08020", "#8040c0"].map(colorName), ["negro", "blanco", "gris", "rojo", "azul", "verde", "amarillo", "naranja", "morado"]);
});

test("el buscador entiende object:, color:, tipo:imagen y el texto dentro de la imagen", () => {
  const image = { id: "i", sourceType: "image", url: "local://imagen/i", title: "Foto", channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: new Date().toISOString(), visual: { text: "Bloqueador solar SPF 50", labels: [{ id: "shoes", name: "zapatos", confidence: 0.8 }, { id: "chair", name: "silla", confidence: 0.25 }], colors: [{ hex: "#2050d0", share: 0.4 }, { hex: "#d02020", share: 0.02 }], width: 1, height: 1, description: "Un frasco sobre una mesa", objects: ["frasco"], aiModel: "x", error: "" } } as unknown as AppVideo;
  const matches = (query: string) => matchesLibraryQuery(image, parseLibraryQuery(query));
  assert.ok(matches("object:zapatos"));
  assert.ok(matches("objeto:shoes"));
  assert.ok(matches("object:frasco"), "también usa lo que describió la IA");
  assert.ok(!matches("object:silla"), "las etiquetas de baja confianza no cuentan como objeto");
  assert.ok(matches("color:azul"));
  assert.ok(!matches("color:rojo"), "un color casi ausente no cuenta");
  assert.ok(matches("tipo:imagen"));
  assert.ok(matches("bloqueador"));
  assert.ok(matches("mesa"));
  assert.ok(!matches("tipo:youtube"));
});

test("subir una imagen la analiza en el Mac, la guarda y no la duplica", { skip: process.platform !== "darwin" }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-vision-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?vision=${stamp}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('profile', 'Prueba', 'x', '#000', ?)").run(new Date().toISOString());
  const { createImageSource, visionAvailable } = await import(`../lib/vision?vision=${stamp}`);
  const { getVideo } = await import(`../lib/data?vision=${stamp}`);
  const bytes = new Uint8Array(await fs.readFile("public/og.png"));
  const kind = sniffImage(bytes)!;
  const first = await createImageSource({ bytes, kind, title: "portada.png", profileId: "profile" });
  assert.equal(first.duplicate, false);
  const second = await createImageSource({ bytes, kind, title: "otra.png", profileId: "profile" });
  assert.deepEqual(second, { id: first.id, duplicate: true });
  const video = getVideo(first.id);
  assert.equal(video.sourceType, "image");
  assert.equal(video.title, "portada");
  assert.equal(video.status, "ready");
  if (visionAvailable()) {
    assert.ok(video.visual.width > 0, "Vision debe informar las dimensiones");
    assert.ok(video.visual.colors.length > 0);
  }
  await fs.access(path.join(directory, "media", video.thumbnailUrl.split("/").pop()));
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});

test("las búsquedas toleran singular y plural, y los espacios se parten en términos", async () => {
  const { libraryQueryTerms } = await import("../lib/library-query");
  assert.deepEqual(libraryQueryTerms('nubes tipo:imagen #logo autor:"Ana Ruiz"'), ["nubes", "tipo:imagen", "#logo", 'autor:"Ana Ruiz"']);
  const photo = { id: "n", sourceType: "image", url: "local://imagen/n", title: "Foto", channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: new Date().toISOString(), visual: { text: "", labels: [{ id: "cloudy", name: "nubes", confidence: 0.8 }, { id: "flower", name: "flor", confidence: 0.8 }], colors: [], width: 1, height: 1, description: "", objects: [], aiModel: "", error: "" } } as unknown as AppVideo;
  const matches = (query: string) => matchesLibraryQuery(photo, parseLibraryQuery(query));
  assert.ok(matches("nubes"));
  assert.ok(matches("nube"));
  assert.ok(matches("object:nubes"));
  assert.ok(matches("flores"));
  assert.ok(matches("nubes tipo:imagen"), "varios términos deben cumplirse a la vez");
  assert.ok(!matches("nubes tipo:youtube"));
  assert.ok(!matches("montañas"));
});

test("el estado leído o visto se puede buscar y guardar como espacio", () => {
  const base = { id: "c", sourceType: "web", url: "https://example.com", title: "Ensayo", channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: new Date().toISOString() };
  const read = { ...base, consumedAt: new Date().toISOString() } as unknown as AppVideo;
  const pending = { ...base, consumedAt: null } as unknown as AppVideo;
  for (const query of ["estado:leído", "estado:visto"]) {
    assert.ok(matchesLibraryQuery(read, parseLibraryQuery(query)));
    assert.ok(!matchesLibraryQuery(pending, parseLibraryQuery(query)));
  }
  assert.ok(matchesLibraryQuery(pending, parseLibraryQuery("estado:pendiente")));
  assert.ok(!matchesLibraryQuery(read, parseLibraryQuery("estado:pendiente")));
});

test("Misma vibra ordena por parecido y descarta lo que no se parece", async () => {
  const { MAX_SIMILAR_DISTANCE, printDistance, rankBySimilarity } = await import("../lib/similar");
  const seed = new Float32Array([1, 0, 0]);
  assert.equal(printDistance(seed, seed), 0);
  const ranked = rankBySimilarity(seed, [
    { id: "lejano", print: new Float32Array([-1, 0, 0]) },
    { id: "cercano", print: new Float32Array([0.95, 0.31, 0]) },
    { id: "medio", print: new Float32Array([0.7, 0.71, 0]) },
    { id: "otra-version", print: new Float32Array([1, 0]) },
  ], 10);
  assert.deepEqual(ranked.map((item: { id: string }) => item.id), ["cercano", "medio"]);
  assert.ok(ranked.every((item: { distance: number }) => item.distance <= MAX_SIMILAR_DISTANCE));
  assert.equal(rankBySimilarity(seed, [{ id: "a", print: seed }, { id: "b", print: seed }], 1).length, 1, "respeta el límite");
});
