const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { buildLibrary, normalizeName } = require("../lib/library");

const ROOT = path.resolve(__dirname, "..");

test("normalizeName remove acentos e simbolos", () => {
  assert.equal(normalizeName("Najarin's Tower"), "najarins tower");
  assert.equal(normalizeName("M'arrillian"), "marrillian");
  assert.equal(normalizeName("  Água-Forte  "), "agua forte");
});

test("buildLibrary carrega cartas e associa imagens locais", () => {
  const library = buildLibrary(ROOT);
  assert.ok(library.stats.totalCards > 1000);
  assert.ok(library.stats.creatures > 0);
  assert.ok(library.stats.attacks > 0);
  assert.ok(library.stats.locations > 0);

  const cardWithImage = library.cards.find(
    (card) => card.type === "creatures" && typeof card.image === "string" && card.image.length > 0
  );
  assert.ok(cardWithImage, "Nenhuma criatura com imagem encontrada");
  assert.ok(Array.isArray(cardWithImage.parsedEffects));
});

test("buildLibrary expoe creature types canonicos e keywords para Lore", () => {
  const library = buildLibrary(ROOT);
  const lore = library.cards.find(
    (card) => card.type === "creatures" && card.name === "Lore"
  );
  assert.ok(lore, "Carta Lore nao encontrada");
  assert.ok(Array.isArray(lore.creatureTypes));
  assert.ok(lore.creatureTypes.some((entry) => /muge/i.test(entry)));
  assert.ok(Array.isArray(lore.creatureTypeKeywords));
  assert.ok(lore.creatureTypeKeywords.includes("danian"));
  assert.ok(lore.creatureTypeKeywords.includes("muge"));
});

test("buildLibrary infere creature types quando campo types estiver vazio", () => {
  const library = buildLibrary(ROOT);
  const loreAlpha = library.cards.find(
    (card) =>
      card.type === "creatures"
      && card.name === "Lore (Alpha), Danian Shaman Commander Variant"
  );
  assert.ok(loreAlpha, "Lore alpha nao encontrada");
  assert.equal(loreAlpha.creatureTypesInferred, true);
  assert.ok(loreAlpha.creatureTypes.some((entry) => /muge/i.test(entry)));
  assert.ok(library.stats.inferredCreatureTypes > 0);
});
