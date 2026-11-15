import assert from "node:assert/strict";
import test from "node:test";
import { EARLY_SOURCE_SCHEMA, earlySourcePrompt } from "../lib/source-suggestions";
import { LIBRARY_TAG_CATALOG } from "../lib/canonical-tags";
import { canSelectCatalogTag, matchingCatalogTags } from "../lib/tag-picker";

test("el selector encuentra etiquetas sin tildes y excluye asignadas e inactivas", () => {
  const technology = LIBRARY_TAG_CATALOG.find((tag) => tag.name === "Tecnología")!;
  assert.deepEqual(matchingCatalogTags(LIBRARY_TAG_CATALOG, [], " TECNOLOGIA "), [technology]);
  assert.deepEqual(matchingCatalogTags(LIBRARY_TAG_CATALOG, [technology.id], "tecnologia"), []);
  assert.deepEqual(matchingCatalogTags([{ ...technology, active: false }], [], ""), []);
  assert.equal(matchingCatalogTags(LIBRARY_TAG_CATALOG, [], "skills")[0]?.name, "Skills");
});

test("el selector respeta 3 principales y 2 secundarias y permite deseleccionar", () => {
  const primary = LIBRARY_TAG_CATALOG.filter((tag) => tag.level === "primary");
  const secondary = LIBRARY_TAG_CATALOG.filter((tag) => tag.level === "secondary");
  const selected = [...primary.slice(0, 3), ...secondary.slice(0, 2)].map((tag) => tag.id);
  assert.equal(canSelectCatalogTag(LIBRARY_TAG_CATALOG, selected, primary[3].id), false);
  assert.equal(canSelectCatalogTag(LIBRARY_TAG_CATALOG, selected, secondary[2].id), false);
  assert.equal(canSelectCatalogTag(LIBRARY_TAG_CATALOG, selected, primary[0].id), true);
  assert.equal(canSelectCatalogTag(LIBRARY_TAG_CATALOG, [], "inventada"), false);
  assert.equal(canSelectCatalogTag(LIBRARY_TAG_CATALOG, selected.slice(0, -1), secondary[2].id), true);
});

test("la sugerencia exige español, uso concreto y un esquema cerrado compatible con respuestas estrictas", () => {
  const prompt = earlySourcePrompt({ title: "The missing design vocabulary for agents", author: "Impeccable", content: "Design skills for AI agents", sourceType: "web" });
  assert.match(prompt, /todos en español/);
  assert.match(prompt, /PARA QUÉ SIRVE/);
  assert.match(prompt, /No atribuyas funcionalidades/);
  assert.match(prompt, /tag_secondary_skills/);
  assert.equal(EARLY_SOURCE_SCHEMA.additionalProperties, false);
  assert.deepEqual(EARLY_SOURCE_SCHEMA.required, Object.keys(EARLY_SOURCE_SCHEMA.properties));
  assert.ok(EARLY_SOURCE_SCHEMA.properties.tagIds.items.enum.includes("tag_secondary_skills"));
  assert.doesNotMatch(earlySourcePrompt({ title: "Un video", author: "", content: "", sourceType: "youtube" }), /PARA QUÉ SIRVE/);
});
