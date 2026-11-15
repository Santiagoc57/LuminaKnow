import assert from "node:assert/strict";
import test from "node:test";
import { extractXPost } from "../lib/x-post";

test("extrae texto, autor y fecha de una publicación pública mediante oEmbed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /^https:\/\/publish\.x\.com\/oembed\?/);
    assert.match(url, /omit_script=true/);
    return new Response(JSON.stringify({
      author_name: "OpenAI",
      author_url: "https://x.com/OpenAI",
      html: '<blockquote><p lang="es">Una idea &amp; otra<br>en dos líneas.</p>&mdash; OpenAI (@OpenAI) <a href="https://x.com/OpenAI/status/1234567890123456789">August 18, 2026</a></blockquote>',
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const post = await extractXPost("https://twitter.com/OpenAI/status/1234567890123456789?s=20");
    assert.equal(post.postId, "1234567890123456789");
    assert.equal(post.url, "https://x.com/OpenAI/status/1234567890123456789");
    assert.equal(post.channel, "OpenAI · @OpenAI");
    assert.equal(post.description, "Una idea & otra\nen dos líneas.");
    assert.equal(post.publishedAt.slice(0, 10), "2026-08-18");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explica cuando X no entrega contenido público", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  try {
    await assert.rejects(() => extractXPost("https://x.com/user/status/123"), /eliminada|privada|públicamente/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
