import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSummary } from "../lib/summary";

test("normaliza ideas antiguas y solo añade un tiempo cuando encuentra evidencia", () => {
  const summary = normalizeSummary({
    gist: "Una conversación sobre ciudades sostenibles.",
    keyPoints: ["La movilidad eléctrica reduce la contaminación urbana", "Un dato sin respaldo localizable"],
    chapters: [{ title: "Transporte limpio", startSeconds: 90, summary: "Movilidad y emisiones" }],
    takeaways: ["Medir el impacto"],
  }, [
    { startSeconds: 96, text: "La movilidad eléctrica ayuda a reducir la contaminación en las zonas urbanas." },
    { startSeconds: 220, text: "La conversación termina con una invitación a medir resultados." },
  ]);

  assert.equal(summary?.keyPoints[0]?.startSeconds, 96);
  assert.equal(summary?.keyPoints[1]?.startSeconds, null);
});

test("conserva los tiempos verificables de resúmenes nuevos", () => {
  const summary = normalizeSummary({
    gist: "Idea central",
    keyPoints: [{ text: "Una idea comprobada", startSeconds: 42.5 }],
    chapters: [],
    takeaways: [],
  });
  assert.deepEqual(summary?.keyPoints, [{ text: "Una idea comprobada", startSeconds: 42.5 }]);
});

test("conserva el resumen detallado por temas y adapta resúmenes anteriores", () => {
  const detailed = normalizeSummary({
    gist: "Idea central",
    sections: [{ title: "Un tema concreto", points: [{ text: "Argumento respaldado", startSeconds: 18 }] }],
    keyPoints: [],
    chapters: [],
    takeaways: [],
  });
  assert.deepEqual(detailed?.sections, [{ title: "Un tema concreto", points: [{ text: "Argumento respaldado", startSeconds: 18 }] }]);

  const legacy = normalizeSummary({
    gist: "Idea central",
    keyPoints: [{ text: "Una consecuencia importante", startSeconds: 34 }],
    chapters: [{ title: "El argumento principal", startSeconds: 30, summary: "Se desarrolla la tesis central." }],
    takeaways: [],
  });
  assert.equal(legacy?.sections?.[0]?.title, "El argumento principal");
  assert.equal(legacy?.sections?.[0]?.points.length, 2);
});
