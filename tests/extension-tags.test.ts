import assert from "node:assert/strict";
import test from "node:test";
import { LIBRARY_TAG_BY_ID } from "../lib/canonical-tags";

test("la extensión solo propone etiquetas del catálogo cerrado", async () => {
  await import(`../extension/src/common.js?test=${Date.now()}`);
  const shared = (globalThis as typeof globalThis & { LuminaShared: { proposeTags: (metadata: Record<string, string>) => Array<{ key: string; name: string; level: string }> } }).LuminaShared;
  const tags = shared.proposeTags({ url: "https://github.com/example/project", title: "Open source TypeScript automation agent", description: "A developer tool with AI agents" });
  assert.ok(tags.length >= 2 && tags.length <= 5);
  assert.ok(tags.every((tag) => LIBRARY_TAG_BY_ID.has(tag.key)));
  assert.ok(tags.filter((tag) => tag.level === "primary").length <= 3);
  assert.ok(tags.filter((tag) => tag.level === "secondary").length <= 2);
});
