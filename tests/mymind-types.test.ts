import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import { detectMovie, detectProduct, formatPrice } from "../lib/web-product";
import { quoteFromNote, quotedText } from "../lib/note-text";

const page = (head: string) => new JSDOM(`<!doctype html><html><head>${head}</head><body></body></html>`, { url: "https://tienda.example/silla" }).window.document;

test("detecta productos por JSON-LD u Open Graph", () => {
  const product = detectProduct(page(`<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Silla Roble","brand":{"@type":"Brand","name":"Muuto"},"image":["/img/silla.jpg"],"offers":{"@type":"Offer","price":"349.00","priceCurrency":"EUR"}}]}</script>`), "https://tienda.example/silla");
  assert.deepEqual(product, { name: "Silla Roble", brand: "Muuto", price: "349.00", currency: "EUR", image: "https://tienda.example/img/silla.jpg" });
  const og = detectProduct(page(`<meta property="og:type" content="product"><meta property="product:price:amount" content="59"><meta property="product:price:currency" content="USD"><meta property="og:title" content="Lámpara">`), "https://tienda.example/x");
  assert.equal(og?.price, "59");
  assert.equal(detectProduct(page(`<meta property="og:type" content="article">`), "https://x.example"), null);
  assert.match(formatPrice("349.00", "EUR"), /349/);
});

test("detecta películas y series", () => {
  const movie = detectMovie(page(`<script type="application/ld+json">{"@type":"Movie","name":"Dune: Part Two","datePublished":"2024-03-01","duration":"PT2H46M","director":[{"@type":"Person","name":"Denis Villeneuve"}],"aggregateRating":{"ratingValue":8.5},"image":"https://img.example/dune.jpg","description":"Paul Atreides se une a los Fremen."}</script>`), "https://www.imdb.com/title/tt15239678/");
  assert.equal(movie?.kind, "movie");
  assert.equal(movie?.year, "2024");
  assert.equal(movie?.duration, "2 h 46 min");
  assert.equal(movie?.director, "Denis Villeneuve");
  assert.equal(movie?.rating, "8.5");
  assert.equal(detectMovie(page(`<script type="application/ld+json">{"@type":"TVSeries","name":"Severance"}</script>`), "https://x")?.kind, "series");
});

test("las citas se reconocen al pegar y al leer una nota", () => {
  assert.equal(quotedText("“Todo fluye” — Heráclito"), "> Todo fluye\n\n— Heráclito");
  assert.equal(quotedText("sin comillas"), null);
  assert.deepEqual(quoteFromNote("> Línea uno\n> Línea dos\n\n— [Fuente](https://x.com)"), { text: "Línea uno\nLínea dos", author: "Fuente" });
  assert.equal(quoteFromNote("Una nota normal"), null);
});

test("un carrusel se guarda como una sola tarjeta con todas sus fotos", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-gallery-"));
  process.env.LUMINA_DATA_DIR = directory;
  process.env.LUMINA_AUTO_DESCRIBE_IMAGES = "0";
  global.__luminaDb = undefined;
  const { getDb } = await import(`../lib/db?gallery=${Date.now()}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'S', 'x', '#000', ?)").run(new Date().toISOString());
  const { createGallerySource } = await import(`../lib/vision?gallery=${Date.now()}`);
  const png = (seed: number) => { const bytes = new Uint8Array(fsSync.readFileSync(path.join(process.cwd(), "public", "og.png"))); const copy = new Uint8Array(bytes.length + 1); copy.set(bytes); copy[bytes.length] = seed; return copy; };
  const result = await createGallerySource({ images: [png(1), png(2), png(3)].map((bytes) => ({ bytes, kind: { ext: "png" as const, mime: "image/png" } })), title: "Carrusel", pageUrl: "https://www.instagram.com/p/abc/", author: "estudio", profileId: "p" });
  assert.equal(result.images, 3);
  const slides = db.prepare("SELECT preview_url AS url FROM source_items WHERE video_id = ? ORDER BY ordinal").all(result.id) as Array<{ url: string }>;
  assert.equal(slides.length, 3);
  assert.ok(slides.every((slide) => slide.url.startsWith("/api/media/")));
  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
