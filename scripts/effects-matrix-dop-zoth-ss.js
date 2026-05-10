const fs = require("fs");
const path = require("path");
const { buildLibrary, normalizeName } = require("../lib/library");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");
const REPORT_JSON = path.join(EXPORT_DIR, "effects_matrix_dop_zoth_ss.json");
const REPORT_MD = path.join(EXPORT_DIR, "effects_matrix_dop_zoth_ss.md");
const TARGET_SETS = new Set(["DOP", "ZOTH", "SS"]);

function extractQuotedKindsFromSet(engineText, setName) {
  const matcher = new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "m");
  const match = matcher.exec(engineText);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)]
    .map((item) => String(item[1] || "").trim())
    .filter(Boolean);
}

function collectSupportedKinds(engineFilePath) {
  if (!fs.existsSync(engineFilePath)) {
    return new Set();
  }
  const engineText = fs.readFileSync(engineFilePath, "utf8");
  const setNames = [
    "CORE_EFFECT_KINDS",
    "PASSIVE_EFFECT_KINDS",
    "BATTLEGEAR_PHASE_EFFECT_KINDS",
    "LOCATION_PHASE_EFFECT_KINDS",
    "ATTACK_STACK_EFFECT_KINDS",
    "ATTACK_TEMP_EFFECT_KINDS",
    "ATTACK_DAMAGE_FORMULA_EFFECT_KINDS",
  ];
  const supported = new Set();
  setNames.forEach((setName) => {
    extractQuotedKindsFromSet(engineText, setName).forEach((kind) => supported.add(kind));
  });
  [...engineText.matchAll(/\["([a-zA-Z0-9_]+)"\s*,\s*\{/g)].forEach((item) => {
    if (item[1]) {
      supported.add(item[1]);
    }
  });
  return supported;
}

function inferTimingStatus(card) {
  const text = String(card?.ability || "").toLowerCase();
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const hasSourcePrefix = (prefix) =>
    effects.some((effect) => String(effect?.sourceText || "").toLowerCase().includes(prefix));
  const hasTiming = (value) =>
    effects.some((effect) => String(effect?.timing || "").toLowerCase() === value);
  if (text.includes("at the beginning of combat")) {
    const ok = hasTiming("begin_combat") || hasSourcePrefix("at the beginning of combat");
    return ok ? null : "timing_incorrect";
  }
  if (text.includes("at the beginning of your turn") || text.includes("at the beginning of each turn")) {
    if (text.includes("if you do, each player removes a total of") && text.includes("mugic counters")) {
      return null;
    }
    const ok = hasTiming("begin_turn") || hasSourcePrefix("at the beginning of your turn") || hasSourcePrefix("at the beginning of each turn");
    return ok ? null : "timing_incorrect";
  }
  if (text.includes("when this becomes the active location") || text.includes("whenever this becomes the active location")) {
    const ok = hasTiming("location_step") || hasSourcePrefix("becomes the active location");
    return ok ? null : "timing_incorrect";
  }
  return null;
}

function inferTargetStatus(card) {
  const text = String(card?.ability || "").toLowerCase();
  if (!/\btarget\b/.test(text)) {
    return null;
  }
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const hasTargetSpec = effects.some((effect) => {
    const spec = effect?.targetSpec || null;
    return spec && spec.required;
  });
  const hasTargetField = effects.some((effect) => {
    const target = String(effect?.target || "").toLowerCase();
    return Boolean(target && target !== "none");
  });
  const hasTargetSourceText = effects.some((effect) =>
    String(effect?.sourceText || "").toLowerCase().includes("target ")
  );
  return hasTargetSpec || hasTargetField || hasTargetSourceText ? null : "target_incorrect";
}

function buildStatus(card, supportedKinds) {
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  if (!effects.length) {
    return "sem_parse";
  }
  const unsupported = [...new Set(effects.map((effect) => String(effect?.kind || "").trim()).filter(Boolean))]
    .filter((kind) => !supportedKinds.has(kind));
  if (unsupported.length) {
    return "parser_only";
  }
  return inferTimingStatus(card) || inferTargetStatus(card) || "implemented";
}

function loadTestText() {
  const files = ["tests/effect-parser.test.js", "tests/battle-engine.test.js"];
  return files
    .map((file) => path.join(ROOT_DIR, file))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
}

function main() {
  const engineFile = path.join(ROOT_DIR, "public", "js", "battle", "engine.js");
  const supportedKinds = collectSupportedKinds(engineFile);
  const testText = loadTestText().toLowerCase();
  const library = buildLibrary(ROOT_DIR);
  const targetCards = library.cards.filter(
    (card) => TARGET_SETS.has(String(card?.set || "").toUpperCase()) && String(card?.ability || "").trim()
  );

  const rows = targetCards.map((card) => {
    const parsedKinds = [...new Set((card.parsedEffects || []).map((effect) => String(effect?.kind || "").trim()).filter(Boolean))];
    const unsupportedKinds = parsedKinds.filter((kind) => !supportedKinds.has(kind));
    const cardToken = normalizeName(card.name || "");
    const coveredByCardName = cardToken && testText.includes(cardToken.toLowerCase());
    const coveredByKind = parsedKinds.some((kind) => testText.includes(String(kind || "").toLowerCase()));
    return {
      set: String(card.set || "").toUpperCase(),
      type: card.type,
      name: card.name,
      status: buildStatus(card, supportedKinds),
      ability: String(card.ability || "").trim(),
      parsedKinds,
      unsupportedKinds,
      tested: Boolean(coveredByCardName || coveredByKind),
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    scope: ["DOP", "ZOTH", "SS"],
    totals: {
      cardsWithAbility: rows.length,
      sem_parse: rows.filter((row) => row.status === "sem_parse").length,
      parser_only: rows.filter((row) => row.status === "parser_only").length,
      timing_incorrect: rows.filter((row) => row.status === "timing_incorrect").length,
      target_incorrect: rows.filter((row) => row.status === "target_incorrect").length,
      implemented: rows.filter((row) => row.status === "implemented").length,
      tested: rows.filter((row) => row.tested).length,
    },
    bySet: [...TARGET_SETS].reduce((acc, setCode) => {
      const slice = rows.filter((row) => row.set === setCode);
      acc[setCode] = {
        cardsWithAbility: slice.length,
        sem_parse: slice.filter((row) => row.status === "sem_parse").length,
        parser_only: slice.filter((row) => row.status === "parser_only").length,
        timing_incorrect: slice.filter((row) => row.status === "timing_incorrect").length,
        target_incorrect: slice.filter((row) => row.status === "target_incorrect").length,
        implemented: slice.filter((row) => row.status === "implemented").length,
      };
      return acc;
    }, {}),
  };

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ summary, rows }, null, 2), "utf8");

  const mdLines = [
    "# Effects Matrix - DOP / ZOTH / SS",
    "",
    `- Generated at: \`${summary.generatedAt}\``,
    `- Cards with ability: \`${summary.totals.cardsWithAbility}\``,
    `- Implemented: \`${summary.totals.implemented}\``,
    `- sem_parse: \`${summary.totals.sem_parse}\``,
    `- parser_only: \`${summary.totals.parser_only}\``,
    `- timing_incorrect: \`${summary.totals.timing_incorrect}\``,
    `- target_incorrect: \`${summary.totals.target_incorrect}\``,
    `- Tested (card-name or kind mention): \`${summary.totals.tested}\``,
    "",
    "## By Set",
    "",
  ];
  Object.entries(summary.bySet).forEach(([setCode, values]) => {
    mdLines.push(
      `- ${setCode}: implemented=${values.implemented}, sem_parse=${values.sem_parse}, parser_only=${values.parser_only}, timing_incorrect=${values.timing_incorrect}, target_incorrect=${values.target_incorrect}`
    );
  });

  const gaps = rows.filter((row) => row.status !== "implemented");
  if (gaps.length) {
    mdLines.push("", "## Gaps", "");
    gaps.slice(0, 80).forEach((row) => {
      mdLines.push(`- [${row.set}] ${row.type} ${row.name}: ${row.status}`);
    });
  }

  fs.writeFileSync(REPORT_MD, `${mdLines.join("\n").trim()}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        report: REPORT_JSON,
        markdown: REPORT_MD,
        summary,
      },
      null,
      2
    )
  );
}

main();
