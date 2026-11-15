import assert from "node:assert/strict";
import test from "node:test";
import { chunkCues, citationsFromText, formatTimestamp, friendlyJobError, parseSourceUrl, parseVtt, parseXUrl, parseYouTubeUrl } from "../lib/utils";

test("convierte fallos técnicos de yt-dlp en mensajes accionables", () => {
  const error = new Error("Command failed: yt-dlp ERROR: Requested format is not available");
  assert.match(friendlyJobError(error), /Actualiza el extractor de Lúmina/);
  assert.doesNotMatch(friendlyJobError(error), /Command failed/);
});

test("parsea publicaciones públicas de X y Twitter", () => {
  assert.deepEqual(parseXUrl("https://x.com/OpenAI/status/1234567890123456789?s=20"), {
    postId: "1234567890123456789",
    username: "OpenAI",
    url: "https://x.com/OpenAI/status/1234567890123456789",
  });
  assert.equal(parseXUrl("https://twitter.com/user/status/123")?.postId, "123");
  assert.equal(parseXUrl("https://x.com/OpenAI"), null);
  assert.equal(parseSourceUrl("https://x.com/OpenAI/status/123")?.sourceType, "x");
});

test("oculta los errores técnicos de formato del proveedor de IA", () => {
  const error = new Error('{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}');
  assert.match(friendlyJobError(error), /formato compatible|resumen local/);
  assert.doesNotMatch(friendlyJobError(error), /INVALID_ARGUMENT|\{"error"/);
});

test("parsea URLs normales, cortas y Shorts", () => {
  assert.equal(parseYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")?.youtubeId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?t=15")?.youtubeId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("youtube.com/shorts/dQw4w9WgXcQ")?.youtubeId, "dQw4w9WgXcQ");
  assert.equal(parseYouTubeUrl("https://example.com/video"), null);
});

test("preserva tiempos y elimina subtítulos duplicados", () => {
  const cues = parseVtt(`WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nHola <c>mundo</c>\n\n00:00:03.000 --> 00:00:04.000\nHola mundo\n\n00:00:05.500 --> 00:00:08.000\nSegunda idea`);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startSeconds, 1);
  assert.equal(cues[0].endSeconds, 4);
  assert.equal(cues[1].startSeconds, 5.5);
});

test("extrae solo las líneas completadas de subtítulos automáticos rodantes", () => {
  const cues = parseVtt(`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nPrimera frase<c> completa</c>\n\n00:00:02.000 --> 00:00:02.010\nPrimera frase completa\n\n00:00:02.010 --> 00:00:04.000\nPrimera frase completa\nSegunda<c> idea</c>\n\n00:00:04.000 --> 00:00:04.010\nSegunda idea`);
  assert.deepEqual(cues.map((cue) => cue.text), ["Primera frase completa", "Segunda idea"]);
  assert.equal(cues[0].startSeconds, 0);
  assert.equal(cues[1].startSeconds, 2.01);
});

test("agrupa cues sin perder los límites temporales", () => {
  const chunks = chunkCues([
    { startSeconds: 0, endSeconds: 10, text: "Primera idea" },
    { startSeconds: 10, endSeconds: 20, text: "Segunda idea" },
    { startSeconds: 150, endSeconds: 160, text: "Tema nuevo" },
  ], 200);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].endSeconds, 20);
  assert.equal(chunks[1].startSeconds, 150);
  assert.equal(formatTimestamp(3723), "1:02:03");
});

test("vincula cada cita con un fragmento almacenado", () => {
  const chunks = [
    { id: 10, startSeconds: 25, endSeconds: 42, text: "La primera evidencia." },
    { id: 11, startSeconds: 90, endSeconds: 115, text: "La segunda evidencia." },
  ];
  const citations = citationsFromText("Primera afirmación [0:27]. Segunda [1:31]. Repetida [0:28].", chunks);
  assert.deepEqual(citations.map((citation) => citation.startSeconds), [25, 90]);
  assert.equal(citations[0].text, "La primera evidencia.");
});
