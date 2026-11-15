import assert from "node:assert/strict";
import test from "node:test";
import { catalogTagColor } from "../lib/tag-colors";
import { LIBRARY_TAG_CATALOG } from "../lib/canonical-tags";

test("los colores del catálogo no dependen del orden ni de las etiquetas vecinas", () => {
  const keys = ["tag_primary_inteligencia_artificial", "tag_primary_diseno_grafico", "tag_secondary_prompts", "tag_secondary_ui_ux"];
  const original = new Map(keys.map((key) => [key, catalogTagColor(key)]));
  for (const key of [...keys].reverse()) assert.equal(catalogTagColor(key), original.get(key));
  assert.equal(new Set(original.values()).size, keys.length);
  for (const tag of LIBRARY_TAG_CATALOG) {
    assert.equal(tag.color, catalogTagColor(tag.id));
    assert.match(tag.color, /^#[0-9a-f]{6}$/i);
    const channels = tag.color.slice(1).match(/../g)!.map((value) => parseInt(value, 16));
    assert.ok(Math.max(...channels) - Math.min(...channels) > 100, `${tag.name} debe usar un color vivo`);
  }
});
