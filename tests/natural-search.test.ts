import test from "node:test";
import assert from "node:assert/strict";
import { parseLibraryQuery } from "../lib/library-query";

test("entiende búsquedas habladas sin operadores", () => {
  const screenshots = parseLibraryQuery("capturas con gráficos");
  assert.equal(screenshots.sourceType, "capturas");
  assert.equal(screenshots.text, "gráficos");
  const blue = parseLibraryQuery("cosas en azul");
  assert.equal(blue.text, "");
  assert.equal(blue.anyOf[0][0].color, "azul", "el color puede ser el de la imagen…");
  assert.equal(blue.anyOf[0][1].text, "azul", "…o una palabra del texto");
  assert.equal(parseLibraryQuery("de la").text, "de la", "si todo es relleno, se busca tal cual");
  assert.deepEqual(parseLibraryQuery("#Política tipo:video").tagTerms, ["Política"]);
});
