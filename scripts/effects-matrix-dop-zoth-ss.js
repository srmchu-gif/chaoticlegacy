const fs = require("fs");
const path = require("path");
const { buildLibrary, normalizeName } = require("../lib/library");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");
const REPORT_JSON = path.join(EXPORT_DIR, "effects_matrix_dop_zoth_ss.json");
const REPORT_MD = path.join(EXPORT_DIR, "effects_matrix_dop_zoth_ss.md");
const REPORT_TXT = path.join(EXPORT_DIR, "effects_audit_multi_target_dop_zoth_ss.txt");
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

function splitAbilityClauses(abilityText) {
  return String(abilityText || "")
    .split(/[.;:](?=\s|$)/)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function inferMultiEffectStatus(card) {
  const text = String(card?.ability || "");
  if (!text) {
    return null;
  }
  const normalizedText = text
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bgeneral discard pile\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const clauses = splitAbilityClauses(normalizedText).filter((entry) => {
    const compact = String(entry || "").replace(/\s+/g, " ").trim();
    if (!compact) return false;
    if (/^(?:\d*\s*M(?:C)+|MCMC|MCMCM|MC)\s*$/i.test(compact)) {
      return false;
    }
    if (/^(?:discard|sacrifice)\b[^:]{0,80}$/i.test(compact) && !/\bdeal\b|\bheal\b|\bdestroy\b|\breturn\b/i.test(compact)) {
      return false;
    }
    return true;
  });
  if (clauses.length < 2) {
    return null;
  }
  const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const parsedKinds = new Set(parsedEffects.map((entry) => String(entry?.kind || "").trim()).filter(Boolean));
  const explicitUnresolvedChecks = [
    {
      when: /\bif\b[^.]*\bsacrifice\b/i.test(normalizedText),
      missing: !parsedKinds.has("sacrificeCreature") && !parsedKinds.has("destroySelfIfPowerAboveThreshold"),
    },
    {
      when: /\binfect that creature\b/i.test(normalizedText),
      missing: !parsedKinds.has("infectTargetCreature") && !parsedKinds.has("infectTargetedOpposingUninfectedCreature"),
    },
    {
      when: /\breturn\b[^.]*\bto your hand when it resolves\b/i.test(normalizedText),
      missing: !parsedKinds.has("returnFromDiscard"),
    },
    {
      when: /\bhive cannot be deactivated\b/i.test(normalizedText),
      missing: !parsedKinds.has("deactivateHive"),
    },
    {
      when: /\bdestroy all battlegear\b[\s\S]*\bequip\b/i.test(normalizedText),
      missing: !parsedKinds.has("beginCombatStealOpposingEngagedBattlegearIfUnequipped"),
    },
  ];
  if (explicitUnresolvedChecks.some((entry) => entry.when && entry.missing)) {
    return "multi_effect_incomplete";
  }
  const actionHints = (
    normalizedText.match(/\b(deal|heal|infect|uninfect|destroy|return|shuffle|draw|discard|move|swap|negate|copy|gain|lose|flip|look)\b/gi)
    || []
  ).length;
  const hasConditionalChain =
    /\banother target\b/i.test(normalizedText)
    || /\bchoose one\b/i.test(normalizedText)
    || /\bthen\b/i.test(normalizedText)
    || /\binstead\b/i.test(normalizedText)
    || /(?:^|[.!?]\s*)if\b/i.test(normalizedText);
  const encodedConditional = parsedEffects.some((effect) =>
    Boolean(
      effect?.cannotMoveIfNoElements
      || effect?.choiceSpec?.required
      || effect?.targetSpec?.distinctFromPrevious
      || Number(effect?.targetSpec?.maxTargets || 0) >= 2
      || effect?.requiresElement
      || effect?.requiresHiveActive
      || effect?.requireHiveActive
      || effect?.noCountersOnly
      || effect?.minimum
      || effect?.optional
      || effect?.reorderTopBottom
      || effect?.moveTopToBottom
      || effect?.triggerAbove
    )
  );
  if (encodedConditional) {
    return null;
  }
  if (
    parsedEffects.length === 1
    && [
      "drawDiscardAttack",
      "searchDeckToDiscard",
      "shuffleAttackDeckWithDiscard",
      "conditionalDamage",
      "dealDamage",
      "healDamage",
      "attackDamageModifier",
      "activateHive",
      "deactivateHive",
      "incomingDamageReduction",
      "elementModifier",
      "keyword",
      "returnFromDiscard",
      "moveAsIfAdjacent",
      "revealNewLocation",
    ].includes(parsedEffects[0]?.kind)
  ) {
    return null;
  }
  if (/\bas if\b/i.test(normalizedText) && !/\bif\b/i.test(normalizedText.replace(/\bas if\b/gi, ""))) {
    return null;
  }
  if (parsedEffects.length <= 1 && (actionHints >= 2 || hasConditionalChain)) {
    return "multi_effect_incomplete";
  }
  return null;
}

function inferChoiceStatus(card) {
  const text = String(card?.ability || "").toLowerCase();
  if (!text.includes("choose one")) {
    return null;
  }
  const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const hasChoiceSpec = parsedEffects.some(
    (effect) => effect?.choiceSpec?.required || /your choice|choose/i.test(String(effect?.sourceText || ""))
  );
  if (!hasChoiceSpec && parsedEffects.length <= 1) {
    return "choice_resolution_incomplete";
  }
  return null;
}

function inferTargetResolutionStatus(card) {
  const text = String(card?.ability || "").toLowerCase();
  if (!/\btarget\b/.test(text)) {
    return null;
  }
  const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const targetEffects = parsedEffects.filter((effect) => effect?.targetSpec?.required);
  if (!targetEffects.length) {
    return "target_resolution_incomplete";
  }
  if (text.includes("up to two target") || text.includes("up to three target")) {
    const hasMaxTargets = targetEffects.some((effect) => Number(effect?.targetSpec?.maxTargets || 0) >= 2);
    if (!hasMaxTargets) {
      return "target_resolution_incomplete";
    }
  }
  if (text.includes("another target")) {
    const hasDistinctTarget = targetEffects.some((effect) => effect?.targetSpec?.distinctFromPrevious === true);
    if (!hasDistinctTarget) {
      return "target_resolution_incomplete";
    }
  }
  return null;
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
  return (
    inferTimingStatus(card)
    || inferTargetStatus(card)
    || inferTargetResolutionStatus(card)
    || inferChoiceStatus(card)
    || inferMultiEffectStatus(card)
    || "implemented"
  );
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
      multi_effect_incomplete: rows.filter((row) => row.status === "multi_effect_incomplete").length,
      target_resolution_incomplete: rows.filter((row) => row.status === "target_resolution_incomplete").length,
      choice_resolution_incomplete: rows.filter((row) => row.status === "choice_resolution_incomplete").length,
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
        multi_effect_incomplete: slice.filter((row) => row.status === "multi_effect_incomplete").length,
        target_resolution_incomplete: slice.filter((row) => row.status === "target_resolution_incomplete").length,
        choice_resolution_incomplete: slice.filter((row) => row.status === "choice_resolution_incomplete").length,
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
    `- multi_effect_incomplete: \`${summary.totals.multi_effect_incomplete}\``,
    `- target_resolution_incomplete: \`${summary.totals.target_resolution_incomplete}\``,
    `- choice_resolution_incomplete: \`${summary.totals.choice_resolution_incomplete}\``,
    `- Tested (card-name or kind mention): \`${summary.totals.tested}\``,
    "",
    "## By Set",
    "",
  ];
  Object.entries(summary.bySet).forEach(([setCode, values]) => {
    mdLines.push(
      `- ${setCode}: implemented=${values.implemented}, sem_parse=${values.sem_parse}, parser_only=${values.parser_only}, timing_incorrect=${values.timing_incorrect}, target_incorrect=${values.target_incorrect}, multi_effect_incomplete=${values.multi_effect_incomplete}, target_resolution_incomplete=${values.target_resolution_incomplete}, choice_resolution_incomplete=${values.choice_resolution_incomplete}`
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
  const priorityOrder = [
    "target_resolution_incomplete",
    "choice_resolution_incomplete",
    "multi_effect_incomplete",
    "timing_incorrect",
    "target_incorrect",
    "parser_only",
    "sem_parse",
  ];
  const sortedGaps = gaps.slice().sort((a, b) => {
    const aPriority = priorityOrder.indexOf(a.status);
    const bPriority = priorityOrder.indexOf(b.status);
    if (aPriority !== bPriority) {
      return (aPriority === -1 ? 99 : aPriority) - (bPriority === -1 ? 99 : bPriority);
    }
    return String(a.name || "").localeCompare(String(b.name || ""), "en");
  });
  const txtLines = [
    "AUDITORIA MULTI-EFEITO + TARGET (DOP/ZOTH/SS)",
    `Gerado em: ${summary.generatedAt}`,
    `Cartas com habilidade: ${summary.totals.cardsWithAbility}`,
    `Implementadas sem gap: ${summary.totals.implemented}`,
    `Gaps totais: ${sortedGaps.length}`,
    "",
  ];
  if (!sortedGaps.length) {
    txtLines.push("Sem gaps criticos detectados nesta rodada.");
  } else {
    sortedGaps.forEach((row, index) => {
      txtLines.push(
        `${index + 1}. [${row.status}] ${row.set} ${row.type} - ${row.name}`,
        `   Habilidade: ${row.ability}`,
        `   Kinds: ${(row.parsedKinds || []).join(", ") || "nenhum"}`,
        ""
      );
    });
  }
  fs.writeFileSync(REPORT_TXT, `${txtLines.join("\n").trim()}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        report: REPORT_JSON,
        markdown: REPORT_MD,
        text: REPORT_TXT,
        summary,
      },
      null,
      2
    )
  );
}

main();
