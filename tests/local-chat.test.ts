import assert from "node:assert/strict";
import test from "node:test";
import { localChatAnswer } from "../lib/local-chat";

const chunks = [
  { id: 1, startSeconds: 12, endSeconds: 35, text: "La inteligencia artificial transforma la forma de programar.", score: 0.8 },
  { id: 2, startSeconds: 80, endSeconds: 105, text: "El experto explica los riesgos y las oportunidades para los desarrolladores.", score: 0.4 },
];

test("responde localmente la idea central con citas verificables", () => {
  const result = localChatAnswer("¿Cuál es la idea central del video?", chunks, {
    gist: "El video analiza el impacto de la inteligencia artificial.",
    keyPoints: [
      { text: "La programación cambiará", startSeconds: 12 },
      { text: "También existen riesgos", startSeconds: 80 },
    ],
    chapters: [{ title: "Introducción", startSeconds: 12, summary: "Presentación del tema" }],
    takeaways: ["Conviene aprender a usar estas herramientas"],
  });
  assert.match(result.content, /impacto de la inteligencia artificial/);
  assert.match(result.content, /\[0:12\]/);
  assert.equal(result.citations[0]?.startSeconds, 12);
});

test("declara falta de evidencia cuando no hay coincidencias", () => {
  const result = localChatAnswer("¿Cuál es la receta de la paella?", chunks.map((chunk) => ({ ...chunk, score: 0 })), null);
  assert.match(result.content, /No encuentro evidencia suficiente/);
  assert.equal(result.citations.length, 0);
});
