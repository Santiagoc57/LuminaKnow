import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoOutline } from "../lib/outline";
import type { AppVideo } from "../lib/types";

test("el resumen por momentos cubre todo un video largo", () => {
  const video = {
    durationSeconds: 3600,
    summary: { gist: "Idea", keyPoints: [], takeaways: [], chapters: [{ title: "Parte 1", startSeconds: 0, summary: "Inicio" }] },
  } as unknown as AppVideo;
  const chunks = Array.from({ length: 36 }, (_, index) => ({ id: index, startSeconds: index * 100, endSeconds: index * 100 + 90, text: `Esta es una explicación suficientemente completa correspondiente al momento número ${index}.` }));
  const outline = buildVideoOutline(video, chunks);
  assert.equal(outline.length, 6);
  assert.equal(outline[0].startSeconds, 0);
  assert.ok(outline.at(-1)!.endSeconds >= 3600);
  assert.ok(outline.every((section) => section.points.length === 3));
});
