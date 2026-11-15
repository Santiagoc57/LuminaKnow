import assert from "node:assert/strict";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { matchesLibraryQuery, parseLibraryQuery } from "../lib/library-query";
import { parseArxivEntry, pdfLinkFrom, usablePdfTitle } from "../lib/pdf-link";
import type { AppVideo } from "../lib/types";

test("reconoce arXiv y enlaces a PDF, y deja pasar el resto", () => {
  assert.deepEqual(pdfLinkFrom("https://arxiv.org/abs/1706.03762"), { url: "https://arxiv.org/pdf/1706.03762", arxivId: "1706.03762" });
  assert.deepEqual(pdfLinkFrom("https://arxiv.org/pdf/1706.03762v7.pdf"), { url: "https://arxiv.org/pdf/1706.03762v7", arxivId: "1706.03762v7" });
  assert.equal(pdfLinkFrom("https://www.arxiv.org/abs/cs.AI/0301001")?.arxivId, "cs.AI/0301001");
  assert.equal(pdfLinkFrom("https://arxiv.org/list/cs.AI/recent"), null);
  assert.equal(pdfLinkFrom("https://example.com/informe.PDF?x=1")?.arxivId, null);
  assert.equal(pdfLinkFrom("https://example.com/articulo"), null);
  assert.equal(pdfLinkFrom("file:///etc/passwd.pdf"), null);
  assert.equal(pdfLinkFrom("no es un enlace"), null);
});

test("descarta títulos basura de los metadatos", () => {
  assert.equal(usablePdfTitle("Attention Is All You Need"), "Attention Is All You Need");
  for (const junk of ["Microsoft Word - informe.docx", "paper_final.pdf", "Untitled", "  ", "doc"]) assert.equal(usablePdfTitle(junk), "", junk);
});

test("lee los datos de arXiv", () => {
  const xml = "<feed><title>query</title><entry><title>Un   título &amp; algo</title><summary>Resumen\n largo</summary><published>2017-06-12T17:57:34Z</published><author><name>Ana Ruiz</name></author><author><name>Beto Paz</name></author></entry></feed>";
  assert.deepEqual(parseArxivEntry(xml), { title: "Un título & algo", abstract: "Resumen largo", authors: ["Ana Ruiz", "Beto Paz"], publishedAt: "2017-06-12T17:57:34Z" });
  assert.equal(parseArxivEntry("<feed></feed>"), null);
  assert.equal(parseArxivEntry("<feed><entry><title>Error</title></entry></feed>"), null);
});

test("el buscador entiende tipo:pdf y tipo:arxiv", () => {
  const base = { id: "p", sourceType: "pdf", title: "Doc", channel: "", description: "", tags: [], collections: [], sourceItems: [], createdAt: new Date().toISOString() };
  const local = { ...base, url: "local://pdf/p" } as unknown as AppVideo;
  const paper = { ...base, url: "https://arxiv.org/abs/1" } as unknown as AppVideo;
  assert.ok(matchesLibraryQuery(local, parseLibraryQuery("tipo:pdf")));
  assert.ok(!matchesLibraryQuery(local, parseLibraryQuery("tipo:arxiv")));
  assert.ok(matchesLibraryQuery(paper, parseLibraryQuery("tipo:arxiv")));
});

test("un PDF se extrae en el Mac, se puede buscar entero y borrar sin dejar archivos", { skip: process.platform !== "darwin" || !fsSync.existsSync("bin/lumina-vision") }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-pdf-test-"));
  process.env.LUMINA_DATA_DIR = directory;
  global.__luminaDb = undefined;
  const stamp = Date.now();
  const { getDb } = await import(`../lib/db?pdf=${stamp}`);
  const db = getDb();
  db.prepare("INSERT INTO profiles(id, name, pin_hash, avatar_color, created_at) VALUES('p', 'Prueba', 'x', '#000', ?)").run(new Date().toISOString());
  const { createPdfSource, searchPdfText } = await import(`../lib/pdf?pdf=${stamp}`);
  const { getVideo, listVideos } = await import(`../lib/data?pdf=${stamp}`);
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.setTitle("Informe de prueba");
  document.setAuthor("Ana Ruiz");
  const longLine = "palabra ".repeat(11);
  for (let index = 0; index < 60; index += 1) {
    const page = document.addPage();
    for (let line = 0; line < 45; line += 1) page.drawText(index === 59 && line === 0 ? "contraseñaFinal zanahoriaunica" .replace("ñ", "n") : longLine, { x: 30, y: 760 - line * 16, size: 11, font });
  }
  const scanned = document.addPage();
  scanned.drawImage(await document.embedPng(await fs.readFile("public/og.png")), { x: 20, y: 300, width: 560, height: 315 });
  const bytes = new Uint8Array(await document.save());

  const created = await createPdfSource({ bytes, profileId: "p", fileName: "archivo.pdf" });
  assert.equal(created.duplicate, false);
  assert.deepEqual(await createPdfSource({ bytes, profileId: "p" }), { id: created.id, duplicate: true });
  const video = getVideo(created.id);
  assert.equal(video.sourceType, "pdf");
  assert.equal(video.title, "Informe de prueba");
  assert.equal(video.channel, "Ana Ruiz");
  assert.equal(video.status, "saved", "guardar no envía nada a la IA");
  assert.equal(video.sourceItems.length, 61);
  assert.equal(video.sourceItems[59].metadata.page, 60);
  assert.equal(video.sourceItems[60].metadata.ocr, true, "la página escaneada se lee con Vision");
  assert.match(video.sourceItems[60].text, /L[uú]mina/);
  assert.match(video.thumbnailUrl, /\.png$/);

  const listed = listVideos().find((item: { id: string }) => item.id === created.id);
  assert.ok(listed.sourceItems.length < 61, "el listado no carga el PDF entero");
  assert.ok(!JSON.stringify(listed.sourceItems).includes("zanahoriaunica"));
  assert.deepEqual(searchPdfText("zanahoriaunica"), [created.id], "pero se encuentra por el texto completo");
  assert.deepEqual(searchPdfText("noexisteestapalabra"), []);
  assert.deepEqual(searchPdfText('"()*:'), []);

  await assert.rejects(createPdfSource({ bytes: new TextEncoder().encode("<html>nop</html>"), profileId: "p" }), /no es un PDF/);
  await assert.rejects(createPdfSource({ bytes: new TextEncoder().encode("%PDF-1.4 roto"), profileId: "p" }), /No se pudo/);

  const { deleteMediaForVideo } = await import(`../lib/media?pdf=${stamp}`);
  const media = path.join(directory, "media");
  assert.equal((await fs.readdir(media)).length, 2);
  deleteMediaForVideo(created.id);
  assert.equal((await fs.readdir(media)).length, 0);

  db.close(); global.__luminaDb = undefined;
  await fs.rm(directory, { recursive: true, force: true });
});
