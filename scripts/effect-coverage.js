const path = require("path");
const { buildLibrary } = require("../lib/library");

const rootDir = path.resolve(__dirname, "..");
const library = buildLibrary(rootDir);
const cardsWithAbility = library.cards.filter((card) => String(card.ability || "").trim());

const parsed = cardsWithAbility.filter((card) => (card.parsedEffects || []).length > 0);
const unparsed = cardsWithAbility.filter((card) => !(card.parsedEffects || []).length);

const kindCounts = new Map();
parsed.forEach((card) => {
  (card.parsedEffects || []).forEach((effect) => {
    const key = String(effect.kind || "unknown");
    kindCounts.set(key, (kindCounts.get(key) || 0) + 1);
  });
});

const topKinds = [...kindCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const topUnparsed = unparsed.slice(0, 40).map((card) => ({
  type: card.type,
  name: card.name,
  ability: card.ability,
}));

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    cards: library.cards.length,
    cardsWithAbility: cardsWithAbility.length,
    parsedAbilityCards: parsed.length,
    unparsedAbilityCards: unparsed.length,
    coveragePercent: Number(((parsed.length / Math.max(1, cardsWithAbility.length)) * 100).toFixed(2)),
  },
  topKinds,
  sampleUnparsedAbilities: topUnparsed,
};

console.log(JSON.stringify(report, null, 2));
