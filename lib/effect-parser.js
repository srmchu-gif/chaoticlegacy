const DISCIPLINE_KEYS = ["courage", "power", "wisdom", "speed", "energy", "mugicability"];
const ELEMENT_KEYS = ["fire", "air", "earth", "water"];
const STAT_WORD_MAP = {
  courage: "courage",
  power: "power",
  wisdom: "wisdom",
  speed: "speed",
  energy: "energy",
  mugicability: "mugicability",
  "mugic ability": "mugicability",
  mugic: "mugicability",
  fire: "fire",
  air: "air",
  earth: "earth",
  water: "water",
};
const CREATURE_TYPE_STOPWORDS = new Set([
  "a",
  "an",
  "all",
  "ally",
  "allied",
  "and",
  "another",
  "any",
  "both",
  "chosen",
  "controlled",
  "controller",
  "control",
  "creature",
  "each",
  "either",
  "engaged",
  "enemy",
  "from",
  "friendly",
  "it",
  "its",
  "least",
  "less",
  "more",
  "most",
  "no",
  "non",
  "of",
  "on",
  "one",
  "opponent",
  "opponents",
  "opposing",
  "or",
  "other",
  "out",
  "player",
  "players",
  "random",
  "same",
  "self",
  "space",
  "spaces",
  "target",
  "that",
  "the",
  "their",
  "them",
  "these",
  "this",
  "those",
  "to",
  "unengaged",
  "with",
  "without",
  "you",
  "your",
]);

function sanitizeAbilityText(text) {
  if (!text || typeof text !== "string") {
    return "";
  }
  return text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/[“”"]/g, " ")
    .replace(/\{\{MC\}\}/gi, "MC")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStatWord(word) {
  const key = String(word || "").toLowerCase().trim();
  return STAT_WORD_MAP[key] || null;
}

function parseConditionalStatWord(word) {
  const key = String(word || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (key === "mugic counter" || key === "mugic counters") {
    return "mugiccounters";
  }
  return normalizeStatWord(key);
}

function parseElementList(fragment) {
  const normalized = String(fragment || "").toLowerCase();
  const picked = ELEMENT_KEYS.filter((element) => normalized.includes(element));
  if (picked.length > 0) {
    return picked;
  }
  if (normalized.includes("all") || normalized.includes("element")) {
    return [...ELEMENT_KEYS];
  }
  return [];
}

function parseStatList(fragment) {
  const text = String(fragment || "").toLowerCase();
  if (!text) {
    return [];
  }
  if (text.includes("all disciplines")) {
    return ["courage", "power", "wisdom", "speed"];
  }
  const stats = [];
  Object.entries(STAT_WORD_MAP).forEach(([raw, mapped]) => {
    if (!mapped || stats.includes(mapped)) {
      return;
    }
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      stats.push(mapped);
    }
  });
  return stats;
}

function parseCountWord(word, fallback = 1) {
  const value = Number(word);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  const lower = String(word || "").toLowerCase().trim();
  if (lower === "zero") return 0;
  if (lower === "one" || lower === "a" || lower === "an") return 1;
  if (lower === "two") return 2;
  if (lower === "three") return 3;
  if (lower === "four") return 4;
  if (lower === "five") return 5;
  if (lower === "six") return 6;
  if (lower === "seven") return 7;
  if (lower === "eight") return 8;
  if (lower === "nine") return 9;
  if (lower === "ten") return 10;
  return fallback;
}

function normalizeTribeWord(word) {
  return String(word || "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z]/g, "")
    .trim();
}

function normalizeTribeLabel(word) {
  const key = normalizeTribeWord(word);
  if (!key) return "";
  if (key === "marrillian" || key === "marrillians" || key === "marrilians") {
    return "marrillian";
  }
  if (key === "overworld") return "overworld";
  if (key === "underworld") return "underworld";
  if (key === "mipedian") return "mipedian";
  if (key === "danian") return "danian";
  if (key === "generic" || key === "tribeless" || key === "all") return "generic";
  return key;
}

function normalizeCreatureTypeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function collectRequiredCreatureTypes(sourceText) {
  const text = String(sourceText || "");
  if (!/\btarget\b/i.test(text) || !/\bcreature\b/i.test(text)) {
    return [];
  }
  const matches = [];
  const regex = /\btarget\s+([^.;:]+?)\s+creature\b/gi;
  let match = regex.exec(text);
  while (match) {
    const fragment = String(match[1] || "")
      .replace(/[()]/g, " ")
      .replace(/[^a-z0-9\s,'/-]/gi, " ")
      .trim();
    if (!fragment) {
      match = regex.exec(text);
      continue;
    }
    const pieces = fragment
      .split(/\s*(?:,|\/|\||\band\b|\bor\b)\s*/i)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    pieces.forEach((entry) => {
      const normalized = normalizeCreatureTypeKey(entry);
      if (!normalized) {
        return;
      }
      const filtered = normalized
        .split(/\s+/)
        .filter((token) => token && !CREATURE_TYPE_STOPWORDS.has(token) && !/^\d+$/.test(token));
      if (!filtered.length) {
        return;
      }
      matches.push(filtered.join(" "));
    });
    match = regex.exec(text);
  }
  return [...new Set(matches)];
}

function inferTargetScopeFromSourceText(sourceText, fallbackScope = "self") {
  const text = String(sourceText || "").toLowerCase();
  const fallback = String(fallbackScope || "self").toLowerCase();
  if (!text) {
    return fallback;
  }
  if (/\b(opposing|opponent)\b/.test(text)) {
    return "opponent";
  }
  if (/\b(your|you control)\b/.test(text)) {
    return "self";
  }
  if (/\btarget\b/.test(text) && fallback === "self") {
    return "all";
  }
  return fallback;
}

function inferTargetSpecForEffect(effect) {
  if (!effect || typeof effect !== "object") {
    return null;
  }
  const text = String(effect.sourceText || "").toLowerCase();
  const requiresDistinctTarget = /\banother target\b/.test(text) && !/\byou (?:can|may) target the same\b/.test(text);
  if (effect.targetSpec && effect.targetSpec.type) {
    if (effect.targetSpec.type !== "creature") {
      return {
        ...effect.targetSpec,
        ...(requiresDistinctTarget ? { distinctFromPrevious: true } : {}),
      };
    }
    const inferredTypes =
      Array.isArray(effect.targetSpec.requiredCreatureTypes) && effect.targetSpec.requiredCreatureTypes.length
        ? effect.targetSpec.requiredCreatureTypes
        : collectRequiredCreatureTypes(effect.sourceText);
    return {
      ...effect.targetSpec,
      ...(inferredTypes.length ? { requiredCreatureTypes: inferredTypes } : {}),
      ...(requiresDistinctTarget ? { distinctFromPrevious: true } : {}),
    };
  }
  let type = null;
  if (text.includes("target battlegear")) {
    type = "battlegear";
  } else if (text.includes("target player")) {
    type = "player";
  } else if (text.includes("target player's")) {
    type = "player";
  } else if (text.includes("target mugic")) {
    type = "mugic";
  } else if (text.includes("target attack")) {
    type = "attack";
  } else if (text.includes("target location") || /\btarget\s+[^.;:]*\s+location\b/.test(text)) {
    type = "location";
  } else if (
    /\btarget(?:\s+[^.;:]*)?\s+creature\b/.test(text)
    || text.includes("opposing engaged creature")
    || text.includes("engaged creature")
    || text.includes("that creature")
  ) {
    type = "creature";
  }
  if (!type) {
    return null;
  }
  const requiredCreatureTypes = type === "creature" ? collectRequiredCreatureTypes(effect.sourceText) : [];
  return {
    type,
    required: true,
    scope: inferTargetScopeFromSourceText(effect.sourceText, effect.target || "self"),
    ...(requiredCreatureTypes.length ? { requiredCreatureTypes } : {}),
    ...(requiresDistinctTarget ? { distinctFromPrevious: true } : {}),
  };
}

function inferChoiceSpecForEffect(effect) {
  if (!effect || typeof effect !== "object") {
    return null;
  }
  if (effect.choiceSpec && effect.choiceSpec.type) {
    return effect.choiceSpec;
  }
  const sourceText = String(effect.sourceText || "").toLowerCase();
  if (effect.kind === "flipBattlegear" && String(effect.mode || "").toLowerCase() === "toggle") {
    return {
      type: "flipMode",
      required: true,
      options: [
        { id: "down", value: "down", label: "Virar face-down" },
        { id: "up", value: "up", label: "Virar face-up" },
      ],
    };
  }
  if (
    (
      effect.kind === "grantChosenElementValueToRecentDamager"
      || effect.kind === "removeChosenElementFromCreatureWithZeroDiscipline"
      || effect.kind === "removeChosenElementFromCreature"
      || effect.kind === "targetCreatureGainChosenElement"
      || effect.kind === "engagedTypeGainChosenElement"
    )
    && sourceText.includes("of your choice")
  ) {
    return {
      type: "elementChoice",
      required: true,
      options: ["fire", "air", "earth", "water"].map((element) => ({
        id: element,
        value: element,
        label: element,
      })),
    };
  }
  return null;
}

function parseAbilityEffects(text) {
  const clean = sanitizeAbilityText(text);
  if (!clean) {
    return [];
  }

  const effects = [];
  let working = clean;

  // Attack with standalone "Untargetable." (e.g. Flaming Coals)
  // must mark the attack card as untargetable while on burst.
  if (/^Untargetable\.?$/i.test(working.trim())) {
    effects.push({
      kind: "attackUntargetable",
      sourceText: working.trim(),
    });
    working = " ";
  }

  // Remove common activated-cost prefixes so the core effect parser can
  // interpret the sentence body in a data-driven way.
  working = working
    .replace(/\b(?:\d+\s*)?(?:\{\{MC\}\}|M(?:C)+)\s*:/gi, " ")
    .replace(/\bExpend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines)(?:\s+\d+)?)?(?:\s+while engaged)?\s*:/gi, " ")
    .replace(/\bDiscard\s+(?:a|an|one|\w+)\s+Mugic Cards?\s*:/gi, " ");

  const swiftRegex = /\bSwift\s+(\d+)\b/gi;
  working = working.replace(swiftRegex, (_, amount) => {
    effects.push({
      kind: "keyword",
      keyword: "swift",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const dynamicSwiftFromMugicCountersRegex =
    /Target(?:\s+[A-Za-z'\-\s]+)?\s+Creature gains\s+["']?Range["']?\s+and\s+["']?Swift\s+X,?["']?\s*,?\s*where X is the number of Mugic counters on\s+([A-Za-z'\-\s]+)\.?/gi;
  working = working.replace(dynamicSwiftFromMugicCountersRegex, (_, sourceName) => {
    effects.push({
      kind: "grantRangeAndSwiftFromSourceMugicCounters",
      amountFrom: "sourceMugicCounters",
      amountSourceName: String(sourceName || "").trim() || null,
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const strikeRegex = /(?<!Invisibility:\s)\bStrike\s+(\d+)\b/gi;
  working = working.replace(strikeRegex, (_, amount) => {
    effects.push({
      kind: "keyword",
      keyword: "strike",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const recklessnessRegex = /\bRecklessness\s+(\d+)\b/gi;
  working = working.replace(recklessnessRegex, (_, amount) => {
    effects.push({
      kind: "keyword",
      keyword: "recklessness",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const outperformRegex = /Outperform\s+(Courage|Power|Wisdom|Speed)\s+(\d+)/gi;
  working = working.replace(outperformRegex, (_, statWord, amount) => {
    effects.push({
      kind: "outperform",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const outperformAllRegex = /Outperform\s+all\s+Disciplines\s+(\d+)/gi;
  working = working.replace(outperformAllRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "outperform",
        stat,
        amount: Number(amount),
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const invisibilityStrikeRegex = /Invisibility:\s*Strike\s+(\d+)/gi;
  working = working.replace(invisibilityStrikeRegex, (_, amount) => {
    effects.push({
      kind: "invisibilityStrike",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const invisibilitySurpriseRegex = /Invisibility:\s*Surprise/gi;
  working = working.replace(invisibilitySurpriseRegex, (_) => {
    effects.push({
      kind: "invisibilitySurprise",
      sourceText: _.trim(),
    });
    return " ";
  });

  const invisibilityDisarmRegex = /Invisibility:\s*Disarm/gi;
  working = working.replace(invisibilityDisarmRegex, (_) => {
    effects.push({
      kind: "invisibilityDisarm",
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackerStatusConditionalDealRegex =
    /If your engaged Creature has\s+(Defender|Range|Untargetable|Fluidmorph|Surprise|Recklessness|Strike),\s*deal\s+(an additional\s+)?(\d+)\s+damage/gi;
  working = working.replace(attackerStatusConditionalDealRegex, (_, statusWord, additionalWord, amount) => {
    const status = String(statusWord || "").toLowerCase().trim();
    if (additionalWord && String(additionalWord).trim()) {
      effects.push({
        kind: "attackDamageConditionalModifier",
        modifier: "add",
        amount: Number(amount),
        conditions: [{ type: "attackerHasStatus", value: status }],
        sourceText: _.trim(),
      });
      return " ";
    }
    effects.push({
      kind: "conditionalDamage",
      mode: "attacker_status",
      comparator: "statusGte",
      status,
      threshold: 1,
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const keywordFlagRegex = /\b(Defender|Range|Untargetable|Fluidmorph|Surprise)\b/gi;
  working = working.replace(keywordFlagRegex, (_, keyword) => {
    effects.push({
      kind: "keyword",
      keyword: String(keyword || "").toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const untargetableByOpposingRegex = /cannot be targeted by opposing Mugic or abilities/gi;
  working = working.replace(untargetableByOpposingRegex, (_) => {
    effects.push({
      kind: "keyword",
      keyword: "untargetable",
      sourceText: _.trim(),
    });
    return " ";
  });

  const untargetableGenericRegex = /(?:Target Creature|[A-Za-z'\-\s]+?)\s+cannot be targeted by Mugic or abilities/gi;
  working = working.replace(untargetableGenericRegex, (_) => {
    effects.push({
      kind: "keyword",
      keyword: "untargetable",
      sourceText: _.trim(),
    });
    return " ";
  });

  const untargetableByAbilitiesRegex =
    /(?:Target Creature|Equipped Creature|[A-Za-z'\-\s]+?)\s+cannot be targeted by abilities/gi;
  working = working.replace(untargetableByAbilitiesRegex, (_) => {
    effects.push({
      kind: "keyword",
      keyword: "untargetable",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginTurnActivateHiveRegex =
    /At the beginning of (?:your|each) turn,\s*if [^.]+,\s*Activate Hive/gi;
  working = working.replace(beginTurnActivateHiveRegex, (_) => {
    effects.push({
      kind: "activateHive",
      timing: "begin_turn",
      sourceText: _.trim(),
    });
    return " ";
  });

  const locationStepActivateHiveRegex = /When this becomes the active Location,\s*Activate Hive/gi;
  working = working.replace(locationStepActivateHiveRegex, (_) => {
    effects.push({
      kind: "activateHive",
      timing: "location_step",
      sourceText: _.trim(),
    });
    return " ";
  });

  const locationStepDeactivateHiveRegex = /When this becomes the active Location,\s*Deactivate Hive/gi;
  working = working.replace(locationStepDeactivateHiveRegex, (_) => {
    effects.push({
      kind: "deactivateHive",
      timing: "location_step",
      sourceText: _.trim(),
    });
    return " ";
  });

  const activateHiveRegex = /\bActivate Hive\b/gi;
  working = working.replace(activateHiveRegex, (_) => {
    effects.push({
      kind: "activateHive",
      sourceText: _.trim(),
    });
    return " ";
  });

  const deactivateHiveRegex = /\bDeactivate Hive\b/gi;
  working = working.replace(deactivateHiveRegex, (_) => {
    effects.push({
      kind: "deactivateHive",
      sourceText: _.trim(),
    });
    return " ";
  });

  const hiveEnergyPerMandiblorRegex =
    /Hive:\s*([A-Za-z][A-Za-z'\-\s]+?)\s+has an additional\s+(\d+)\s+Energy for each Mandiblor you control(?:\s+and each Infected Creature in play)?/gi;
  working = working.replace(hiveEnergyPerMandiblorRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "hiveEnergyPerControlledCreatureType",
      sourceCreatureName: String(creatureName || "").trim(),
      creatureType: "mandiblor",
      stat: "energy",
      amountPerCreature: Number(amount),
      requireHiveActive: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const hivePrefixRegex = /Hive:\s*([A-Za-z]+(?:proof)?(?:\s+\d+)?)/gi;
  working = working.replace(hivePrefixRegex, (_, body) => {
    effects.push({
      kind: "hiveGranted",
      body: String(body || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const challengeRegex = /Challenge\s+(Courage|Power|Wisdom|Speed|Mugic\s*counters?)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi;
  working = working.replace(challengeRegex, (_, stat, threshold, damage) => {
    effects.push({
      kind: "conditionalDamage",
      mode: "challenge",
      comparator: "diffGte",
      stat: parseConditionalStatWord(stat),
      threshold: Number(threshold),
      amount: Number(damage),
      sourceText: _.trim(),
    });
    return " ";
  });

  const statCheckRegex = /Stat Check\s+(Courage|Power|Wisdom|Speed|Mugic\s*counters?)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi;
  working = working.replace(statCheckRegex, (_, stat, threshold, damage) => {
    effects.push({
      kind: "conditionalDamage",
      mode: "stat_check",
      comparator: "selfGte",
      stat: parseConditionalStatWord(stat),
      threshold: Number(threshold),
      amount: Number(damage),
      sourceText: _.trim(),
    });
    return " ";
  });

  const statCheckAutoSuccessRegex =
    /Your other Creatures with\s+(Fire|Air|Earth|Water)\s+succeed on all Stat Checks on attacks they play/gi;
  working = working.replace(statCheckAutoSuccessRegex, (_, elementWord) => {
    effects.push({
      kind: "statCheckAutoSuccessForElement",
      element: String(elementWord || "").toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const statFailRegex = /Stat Fail\s+(Courage|Power|Wisdom|Speed|Mugic\s*counters?)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi;
  working = working.replace(statFailRegex, (_, stat, threshold, damage) => {
    effects.push({
      kind: "conditionalDamage",
      mode: "stat_fail",
      comparator: "defenderLte",
      stat: parseConditionalStatWord(stat),
      threshold: Number(threshold),
      amount: Number(damage),
      sourceText: _.trim(),
    });
    return " ";
  });

  const extraDamageRegex = /([a-zA-Z/\s]+?)\s+attacks?\s+deal(?:s)?\s+an?\s+additional\s+(\d+)\s+damage/gi;
  working = working.replace(extraDamageRegex, (_, filterText, amount) => {
    effects.push({
      kind: "attackDamageModifier",
      modifier: "add",
      amount: Number(amount),
      elements: parseElementList(filterText),
      sourceText: _.trim(),
    });
    return " ";
  });

  const reducedDamageRegex = /Damage dealt by\s+([a-zA-Z/\s]+?)\s+attacks?\s+is reduced by\s+(\d+)/gi;
  working = working.replace(reducedDamageRegex, (_, filterText, amount) => {
    effects.push({
      kind: "attackDamageModifier",
      modifier: "reduce",
      amount: Number(amount),
      elements: parseElementList(filterText),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attacksDealLessToCreatureRegex = /([A-Za-z/\s]+?)\s+Attacks?\s+deal\s+(\d+)\s+less damage to\s+[A-Za-z'\-\s]+/gi;
  working = working.replace(attacksDealLessToCreatureRegex, (_, filterText, amount) => {
    effects.push({
      kind: "incomingDamageReduction",
      amount: Number(amount),
      source: String(filterText || "attack").toLowerCase().trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const dealsAdditionalWithAttacksRegex = /deals?\s+an?\s+additional\s+(\d+)\s+damage\s+with\s+([a-zA-Z/\s]+?)\s+attacks?/gi;
  working = working.replace(dealsAdditionalWithAttacksRegex, (_, amount, filterText) => {
    effects.push({
      kind: "attackDamageModifier",
      modifier: "add",
      amount: Number(amount),
      elements: parseElementList(filterText),
      sourceText: _.trim(),
    });
    return " ";
  });

  const mugicDealsAdditionalDamageRegex =
    /Mugic played by\s+(?:[A-Za-z'\-\s]+|Creatures you control)[^.]*?deal(?:s)?\s+an?\s+additional\s+(\d+)\s+damage/gi;
  working = working.replace(mugicDealsAdditionalDamageRegex, (_, amount) => {
    effects.push({
      kind: "mugicDamageModifier",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageIfAlliesHaveElementRegex =
    /If all Creatures you control have\s+(Fire|Air|Earth|Water),\s*[A-Za-z'\-\s]+?\s+deals?\s+an?\s+additional\s+(\d+)\s+damage\s+with\s+attacks?/gi;
  working = working.replace(attackDamageIfAlliesHaveElementRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "attackDamageIfAlliesHaveElement",
      element: String(elementWord || "").toLowerCase(),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageVsLowerMugicRegex =
    /Attack damage dealt by\s+([A-Za-z'\-\s]+?)\s+Creatures you control to Creatures with fewer Mugic counters is (?:increased|icreased) by\s+(\d+)/gi;
  working = working.replace(attackDamageVsLowerMugicRegex, (_, subtypeWord, amount) => {
    effects.push({
      kind: "attackDamageVsLowerMugicCounters",
      subtype: String(subtypeWord || "").toLowerCase().trim(),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const incomingDamageReductionRegex =
    /Damage dealt to\s+(Warbeast\s+Creatures you control|Creatures you control|[A-Za-z0-9'\-\s]+?)(?:\s+by\s+([A-Za-z0-9'\-\s]+?))?\s+is reduced by\s+(\d+)/gi;
  working = working.replace(incomingDamageReductionRegex, (_, targetGroup, sourceGroup, amount) => {
    effects.push({
      kind: "incomingDamageReduction",
      amount: Number(amount),
      source: String(sourceGroup || "attack").toLowerCase().trim(),
      onlyWarbeast: /warbeast/i.test(String(targetGroup || "")),
      sourceText: _.trim(),
    });
    return " ";
  });

  const incomingDamageZeroRegex =
    /Damage dealt to\s+([A-Za-z0-9'\-\s]+?)(?:\s+by\s+([A-Za-z0-9'\-\s]+?))?\s+is reduced to 0/gi;
  working = working.replace(incomingDamageZeroRegex, (_, targetGroup, sourceGroup) => {
    effects.push({
      kind: "incomingDamageReduction",
      amount: 999,
      source: String(sourceGroup || "attack").toLowerCase().trim(),
      onlyWarbeast: /warbeast/i.test(String(targetGroup || "")),
      sourceText: _.trim(),
    });
    return " ";
  });

  const incomingDamageReductionReversedRegex =
    /Damage dealt by\s+([A-Za-z0-9'\-\s]+?)\s+to\s+(Warbeast\s+Creatures you control|Creatures you control|[A-Za-z0-9'\-\s]+?)\s+is reduced by\s+(\d+)/gi;
  working = working.replace(incomingDamageReductionReversedRegex, (_, sourceGroup, targetGroup, amount) => {
    effects.push({
      kind: "incomingDamageReduction",
      amount: Number(amount),
      source: String(sourceGroup || "attack").toLowerCase().trim(),
      onlyWarbeast: /warbeast/i.test(String(targetGroup || "")),
      sourceText: _.trim(),
    });
    return " ";
  });

  const incomingDamageZeroReversedRegex =
    /Damage dealt by\s+([A-Za-z0-9'\-\s]+?)\s+to\s+([A-Za-z0-9'\-\s]+?)\s+is reduced to 0/gi;
  working = working.replace(incomingDamageZeroReversedRegex, (_, sourceGroup, targetGroup) => {
    effects.push({
      kind: "incomingDamageReduction",
      amount: 999,
      source: String(sourceGroup || "attack").toLowerCase().trim(),
      onlyWarbeast: /warbeast/i.test(String(targetGroup || "")),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatEnergyRegex = /At the beginning of combat,\s*([^.]*?)gains?\s+(\d+)\s+Energy/gi;
  working = working.replace(beginCombatEnergyRegex, (_, targetClause, amount) => {
    const clause = String(targetClause || "").toLowerCase();
    const entry = {
      kind: "beginCombatEnergy",
      amount: Number(amount),
      sourceText: _.trim(),
      duration: "end_combat",
      // Combat-start energy boosts in this ruleset apply to the currently engaged pair by default.
      scope: "engaged",
    };
    const withElement = clause.match(/\bwith\s+(fire|air|earth|water)\b/i);
    if (withElement) {
      entry.requiresElement = String(withElement[1] || "").toLowerCase();
      entry.duration = "end_turn";
    }
    effects.push(entry);
    return " ";
  });

  const beginCombatDamageRegex = /At the beginning of combat[^.]*?deal\s+(\d+)\s+damage\s+to\s+engaged\s+Creatures?/gi;
  working = working.replace(beginCombatDamageRegex, (_, amount) => {
    effects.push({
      kind: "beginCombatDamage",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatGainLowestDisciplineRegex =
    /At the beginning of combat,\s*(?:your\s+)?engaged Creature gains\s+(\d+)\s+to (?:its|their)\s+lowest Discipline/gi;
  working = working.replace(beginCombatGainLowestDisciplineRegex, (_, amount) => {
    effects.push({
      kind: "beginCombatGainLowestDiscipline",
      amount: Number(amount),
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const firstAttackZeroRegex =
    /If an engaged Creature has lower\s+(Courage|Power|Wisdom|Speed)\s+than the opposing engaged Creature,\s*it deals 0 damage on its first attack each combat/gi;
  working = working.replace(firstAttackZeroRegex, (_, statWord) => {
    effects.push({
      kind: "firstAttackZeroIfLower",
      stat: normalizeStatWord(statWord),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatMugicCounterRegex =
    /At the beginning of combat,\s*if an engaged Creature has higher\s+(Courage|Power|Wisdom|Speed)\s+than the opposing engaged Creature,\s*put a Mugic counter on it/gi;
  working = working.replace(beginCombatMugicCounterRegex, (_, statWord) => {
    effects.push({
      kind: "beginCombatMugicCounterHigherStat",
      stat: normalizeStatWord(statWord),
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const disableMugicRegex = /Mugic and activated abilities cannot be played/gi;
  working = working.replace(disableMugicRegex, (_) => {
    effects.push({
      kind: "disableMugicAndActivated",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opposingCannotPlayMugicRegex = /opposing Creatures cannot play Mugic or abilities/gi;
  working = working.replace(opposingCannotPlayMugicRegex, (_) => {
    effects.push({
      kind: "disableMugicAndActivated",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opponentCannotPlayActivatedRegex = /Your opponent cannot play activated abilities/gi;
  working = working.replace(opponentCannotPlayActivatedRegex, (_) => {
    effects.push({
      kind: "disableMugicAndActivated",
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opponentCannotPlayMugicRegex = /Your opponent cannot play Mugic Cards?/gi;
  working = working.replace(opponentCannotPlayMugicRegex, (_) => {
    effects.push({
      kind: "disableMugicAndActivated",
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const additionalMugicCostRegex = /must pay an additional Mugic counter to play abilities/gi;
  working = working.replace(additionalMugicCostRegex, (_) => {
    effects.push({
      kind: "mugicCostIncrease",
      target: "opponent",
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const additionalMugicCostCardsRegex =
    /must pay an additional Mugic counter to play\s+((?:Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)(?:\s+or\s+(?:Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian))*)\s+Mugic Cards?/gi;
  working = working.replace(additionalMugicCostCardsRegex, (_, tribesText) => {
    const tribes = String(tribesText || "")
      .split(/\s+or\s+/i)
      .map((entry) => normalizeTribeLabel(entry))
      .filter(Boolean);
    effects.push({
      kind: "mugicCostIncrease",
      target: "all",
      amount: 1,
      mugicTribes: tribes,
      sourceText: _.trim(),
    });
    return " ";
  });

  const negateMugicRegex = /Negate\s+target\s+Mugic/gi;
  working = working.replace(negateMugicRegex, (_) => {
    effects.push({
      kind: "negateMugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const negateSpecificTribalMugicRegex =
    /Negate\s+target\s+((?:Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)(?:\s+or\s+(?:Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian))*)\s+Mugic/gi;
  working = working.replace(negateSpecificTribalMugicRegex, (_, tribesText) => {
    const tribes = String(tribesText || "")
      .split(/\s+or\s+/i)
      .map((entry) => normalizeTribeLabel(entry))
      .filter(Boolean);
    effects.push({
      kind: "negateMugic",
      mugicTribes: tribes,
      sourceText: _.trim(),
    });
    return " ";
  });

  const negateUpToOneMugicRegex = /Negate\s+up\s+to\s+one\s+target\s+Mugic/gi;
  working = working.replace(negateUpToOneMugicRegex, (_) => {
    effects.push({
      kind: "negateMugic",
      sourceText: _.trim(),
      targetSpec: {
        type: "mugic",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const negateTribalMugicOrAbilityRegex =
    /Negate\s+target\s+(Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Mugic\s+or\s+ability\s+that\s+targets\s+([A-Za-z'\- ]+)/gi;
  working = working.replace(negateTribalMugicOrAbilityRegex, (_, tribeWord, protectedName) => {
    effects.push({
      kind: "negateMugicOrAbilityTargeting",
      tribe: normalizeTribeLabel(tribeWord),
      protectedName: String(protectedName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const negateAnyMugicOrAbilityRegex =
    /Negate\s+target\s+Mugic\s+or\s+ability\s+that\s+targets\s+([A-Za-z'\- ]+)/gi;
  working = working.replace(negateAnyMugicOrAbilityRegex, (_, protectedName) => {
    effects.push({
      kind: "negateMugicOrAbilityTargeting",
      protectedName: String(protectedName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const forceOpponentRandomIfHigherMugicRegex =
    /If your engaged Creature has more Mugic counters than the opposing engaged Creature,\s*your opponent must play Attack Cards at random/gi;
  working = working.replace(forceOpponentRandomIfHigherMugicRegex, (_) => {
    effects.push({
      kind: "forceOpponentRandomAttackIfHigherMugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const forceOpponentRandomAttackRegex = /your opponent must play Attack Cards at random/gi;
  working = working.replace(forceOpponentRandomAttackRegex, (_) => {
    effects.push({
      kind: "forceOpponentRandomAttack",
      sourceText: _.trim(),
    });
    return " ";
  });

  const tribalMugicBlockedRegex = /Tribal Mugic cannot be played/gi;
  working = working.replace(tribalMugicBlockedRegex, (_) => {
    effects.push({
      kind: "disableTribalMugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const anyTribeMugicRegex = /(Target Creature|[A-Za-z'\-]+)\s+can play Mugic of any tribe/gi;
  working = working.replace(anyTribeMugicRegex, (_) => {
    effects.push({
      kind: "canPlayAnyTribeMugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const anyClanSpellsRegex = /(?:can|may)\s+play\s+(?:Mugic|spells?)\s+of\s+any\s+(?:tribe|clan)/gi;
  working = working.replace(anyClanSpellsRegex, (_) => {
    effects.push({
      kind: "canPlayAnyTribeMugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const playMugicFromGeneralDiscardRegex =
    /([A-Za-z'\-\s]+)\s+can play Mugic Cards? in your general discard pile as if they were in your hand/gi;
  working = working.replace(playMugicFromGeneralDiscardRegex, (_, creatureName) => {
    effects.push({
      kind: "playMugicFromGeneralDiscard",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const playedMugicRemovedFromGameRegex =
    /Mugic Cards? played in this way are removed from the game when they leave the burst/gi;
  working = working.replace(playedMugicRemovedFromGameRegex, (_) => {
    effects.push({
      kind: "mugicPlayedFromDiscardExileOnResolve",
      sourceText: _.trim(),
    });
    return " ";
  });

  const controlledTribeCanPlayTribalMugicRegex =
    /(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures\s+you\s+control\s+can\s+play\s+(Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Mugic/gi;
  working = working.replace(controlledTribeCanPlayTribalMugicRegex, (_, casterTribe, mugicTribe) => {
    effects.push({
      kind: "canPlaySpecificTribeMugic",
      casterTribe: normalizeTribeLabel(casterTribe),
      mugicTribe: normalizeTribeLabel(mugicTribe),
      scope: "controlled",
      sourceText: _.trim(),
    });
    return " ";
  });

  const selfCanPlayTribalMugicRegex =
    /([A-Za-z'\- ]+)\s+can\s+play\s+(Generic|OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Mugic/gi;
  working = working.replace(selfCanPlayTribalMugicRegex, (_, creatureName, mugicTribe) => {
    effects.push({
      kind: "canPlaySpecificTribeMugic",
      creatureName: String(creatureName || "").trim(),
      mugicTribe: normalizeTribeLabel(mugicTribe),
      scope: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const locationRemoveElementsRegex = /When this becomes the active Location,\s*Creatures lose all Elemental Types/gi;
  working = working.replace(locationRemoveElementsRegex, (_) => {
    effects.push({
      kind: "locationEnterRemoveAllElements",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatLoseEnergyIfLowerRegex =
    /At the beginning of combat,\s*if an engaged Creature has lower\s+(Courage|Power|Wisdom|Speed)\s+than the opposing engaged Creature,\s*it loses\s+(\d+)\s+Energy/gi;
  working = working.replace(beginCombatLoseEnergyIfLowerRegex, (_, statWord, amount) => {
    effects.push({
      kind: "beginCombatLoseEnergyIfLower",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const energyPenaltyIfStatLowerRegex =
    /If any Creature engaged with\s+[A-Za-z'\-\s]+?\s+has (?:less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed)|(Courage|Power|Wisdom|Speed)\s+less than\s+(\d+)),\s*that Creature has\s+(\d+)\s+less Energy/gi;
  working = working.replace(energyPenaltyIfStatLowerRegex, (_, thresholdA, statA, statB, thresholdB, amount) => {
    effects.push({
      kind: "beginCombatLoseEnergyIfLower",
      stat: normalizeStatWord(statA || statB),
      threshold: Number(thresholdA || thresholdB || 0),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const preventHealIfLowerStatRegex =
    /If any Creature engaged with\s+[A-Za-z'\-\s]+?\s+has (?:less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed)|(Courage|Power|Wisdom|Speed)\s+less than\s+(\d+)),\s*that Creature cannot be healed(?: or gain Energy from non-innate abilities)?/gi;
  working = working.replace(preventHealIfLowerStatRegex, (_, thresholdA, statA, statB, thresholdB) => {
    effects.push({
      kind: "preventHealingIfLowerStat",
      stat: normalizeStatWord(statA || statB),
      threshold: Number(thresholdA || thresholdB || 0),
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const preventElementGainIfLowerStatRegex =
    /If any Creature engaged with\s+[A-Za-z'\-\s]+?\s+has (?:less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed)|(Courage|Power|Wisdom|Speed)\s+less than\s+(\d+)),\s*it does not have and cannot gain any Elemental Types/gi;
  working = working.replace(preventElementGainIfLowerStatRegex, (_, thresholdA, statA, statB, thresholdB) => {
    effects.push({
      kind: "cannotGainElementTypes",
      stat: normalizeStatWord(statA || statB),
      threshold: Number(thresholdA || thresholdB || 0),
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatGainElementsFromAlliesRegex =
    /At the beginning of combat,\s*[^.]+ gains all Elemental Types your\s+(adjacent\s+)?Creatures have/gi;
  working = working.replace(beginCombatGainElementsFromAlliesRegex, (_, adjacentWord) => {
    effects.push({
      kind: "beginCombatGainElementsFromAllies",
      adjacentOnly: Boolean(adjacentWord),
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetGainElementsFromAlliesRegex = /Target Creature gains all Elemental Types your Creatures have/gi;
  working = working.replace(targetGainElementsFromAlliesRegex, (_) => {
    effects.push({
      kind: "beginCombatGainElementsFromAllies",
      adjacentOnly: false,
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatDamagePerMissingElementsRegex =
    /When\s+[A-Za-z'\-\s]+?\s+becomes engaged,\s*the opposing engaged Creature loses\s+(\d+)\s+Energy for each Elemental Type it does not have/gi;
  working = working.replace(beginCombatDamagePerMissingElementsRegex, (_, amount) => {
    effects.push({
      kind: "beginCombatDamagePerMissingElements",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatDamagePerLowDisciplinesRegex =
    /Creatures engaged with\s+[A-Za-z'\-\s]+?\s+have\s+(\d+)\s+less Energy for each Discipline they have below\s+(\d+)/gi;
  working = working.replace(beginCombatDamagePerLowDisciplinesRegex, (_, amount, threshold) => {
    effects.push({
      kind: "beginCombatDamagePerLowDisciplines",
      amount: Number(amount),
      threshold: Number(threshold),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatSetDisciplinesToOpposingScannedRegex =
    /At the beginning of combat,\s*[^.]+ gains or loses Courage,?\s*Power,?\s*Wisdom\s*(?:and|,)\s*Speed so those values become equal to the opposing engaged Creature'?s Scanned Courage,?\s*Power,?\s*Wisdom\s*(?:and|,)\s*Speed/gi;
  working = working.replace(beginCombatSetDisciplinesToOpposingScannedRegex, (_) => {
    effects.push({
      kind: "setDisciplinesToOpposingScanned",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatDiscardOpponentAttackRegex =
    /At the beginning of combat,\s*look at your opponent'?s attack hand and choose an Attack Card\.\s*They discard it and then draw an Attack Card/gi;
  working = working.replace(beginCombatDiscardOpponentAttackRegex, (_) => {
    effects.push({
      kind: "beginCombatAttackDiscardDraw",
      target: "opponent",
      discard: 1,
      draw: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  // Blazier override for gameplay: treat this specific text as self location deck reorder.
  const scryLocationTopBottomSelfOverrideRegex =
    /Look at the top\s+(\w+)\s+cards?\s+of\s+target player's\s+Location\s+Deck\.\s*Put one of them on top of that deck and the other on the bottom(?:\s+of that deck)?/gi;
  working = working.replace(scryLocationTopBottomSelfOverrideRegex, (_, countWord) => {
    effects.push({
      kind: "scryDeck",
      count: parseCountWord(countWord, 2),
      owner: "self",
      deckType: "location",
      reorderTopBottom: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatScryDeckRegex =
    /At the beginning of combat,\s*(?:if [^.]+,\s*)?(?:that player can\s+)?look at the top\s+(\w+)\s+cards?\s+of\s+(target player's|your|their)\s+(Location|Attack)\s+Deck/gi;
  working = working.replace(beginCombatScryDeckRegex, (_, countWord, owner, deckType) => {
    effects.push({
      kind: "scryDeck",
      count: parseCountWord(countWord, 1),
      owner: /target player/i.test(owner) ? "opponent" : "self",
      deckType: String(deckType || "").toLowerCase(),
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const scryDeckRegex = /Look at the top\s+(\w+)\s+cards?\s+of\s+(target player's|your)\s+(Location|Attack)\s+Deck/gi;
  working = working.replace(scryDeckRegex, (_, countWord, owner, deckType) => {
    const count = Number(countWord) || (String(countWord).toLowerCase() === "two" ? 2 : String(countWord).toLowerCase() === "three" ? 3 : 1);
    effects.push({
      kind: "scryDeck",
      count,
      owner: /target player/i.test(owner) ? "opponent" : "self",
      deckType: String(deckType || "").toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const scryDeckTopBottomOrderingRegex =
    /look at the top\s+(\w+)\s+cards?\s+of\s+their\s+Attack\s+Deck,\s*put one of them on top of that deck and the others on the bottom in any order/gi;
  working = working.replace(scryDeckTopBottomOrderingRegex, (_, countWord) => {
    effects.push({
      kind: "scryDeck",
      count: parseCountWord(countWord, 3),
      owner: "self",
      deckType: "attack",
      reorderTopBottom: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const scrySingleTopCardRegex =
    /Look at the top card of\s+(target player's|your)\s+(Location|Attack)\s+Deck(?:\.\s*You can put that card on the bottom of that deck)?/gi;
  working = working.replace(scrySingleTopCardRegex, (_, owner, deckType) => {
    const sourceText = _.trim();
    effects.push({
      kind: "scryDeck",
      count: 1,
      owner: /target player/i.test(owner) ? "opponent" : "self",
      deckType: String(deckType || "").toLowerCase(),
      moveTopToBottom: /bottom of that deck/i.test(sourceText),
      sourceText,
    });
    return " ";
  });

  const drawDiscardAttackRegex = /Draw an Attack Card and discard an Attack Card/gi;
  working = working.replace(drawDiscardAttackRegex, (_) => {
    effects.push({
      kind: "drawDiscardAttack",
      draw: 1,
      discard: 1,
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const drawThenDiscardAttackRegex = /draws?\s+(\w+)\s+Attack Cards?,\s*then discards?\s+(\w+)\s+Attack Cards?/gi;
  working = working.replace(drawThenDiscardAttackRegex, (_, drawWord, discardWord) => {
    effects.push({
      kind: "drawDiscardAttack",
      draw: parseCountWord(drawWord, 1),
      discard: parseCountWord(discardWord, 1),
      target: /each player/i.test(_) ? "both" : "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const discardThenDrawAttackRegex = /both players discard\s+(\w+)\s+Attack Cards?\s+and\s+draw\s+(\w+)\s+Attack Cards?/gi;
  working = working.replace(discardThenDrawAttackRegex, (_, discardWord, drawWord) => {
    effects.push({
      kind: "drawDiscardAttack",
      draw: parseCountWord(drawWord, 1),
      discard: parseCountWord(discardWord, 1),
      target: "both",
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetAttackDamageRegex = /Target attack(?:[^.]*?)deals?\s+(\d+)\s+damage/gi;
  working = working.replace(targetAttackDamageRegex, (_, amount) => {
    effects.push({
      kind: "targetAttackDamageSet",
      target: /opposing/i.test(_) ? "opponent" : "self",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetAttackDamageReducedRegex = /Target\s+(?:Elemental\s+)?Attack\s+deals?\s+(\d+)\s+less\s+damage/gi;
  working = working.replace(targetAttackDamageReducedRegex, (_, amount) => {
    effects.push({
      kind: "targetAttackDamageModify",
      target: /opposing/i.test(_) ? "opponent" : "self",
      modifier: "reduce",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetAttackCountsAsFirstRegex = /Target attack counts as the first attack played this combat/gi;
  working = working.replace(targetAttackCountsAsFirstRegex, (_) => {
    effects.push({
      kind: "targetAttackCountsAsFirst",
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenEngagedDestroyedDrawDiscardRegex =
    /When your engaged Creature is destroyed this turn,\s*draw\s+(\w+)\s+Attack Cards?\s+and discard\s+(\w+)\s+Attack Cards?/gi;
  working = working.replace(whenEngagedDestroyedDrawDiscardRegex, (_, drawWord, discardWord) => {
    effects.push({
      kind: "delayedOnDestroyedDrawDiscard",
      draw: parseCountWord(drawWord, 1),
      discard: parseCountWord(discardWord, 1),
      target: "self",
      timing: "turn_window",
      sourceText: _.trim(),
    });
    return " ";
  });

  const countsAsFirstAttackRegex =
    /(?:^|[A-Za-z'\-\s]+:\s*)[A-Za-z'\-\s]+?\s+counts as your first attack this combat/gi;
  working = working.replace(countsAsFirstAttackRegex, (_) => {
    effects.push({
      kind: "treatCurrentAttackAsFirst",
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeGeneralDiscardOnDamageRegex =
    /When [A-Za-z'\-\s]+ deals damage,\s*remove a card in a general discard pile from the game/gi;
  working = working.replace(removeGeneralDiscardOnDamageRegex, (_) => {
    effects.push({
      kind: "exileGeneralDiscardOnDamage",
      target: "opponent",
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const discardMugicNextAttackBonusRegex =
    /Discard a Mugic Card:\s*([A-Za-z'\-\s]+)\s+deals\s+(\d+)\s+additional damage with its next attack this turn/gi;
  working = working.replace(discardMugicNextAttackBonusRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "nextAttackThisTurnDamageAdd",
      amount: Number(amount),
      sourceCreatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenDealtAttackDamageGainAttackBonusRegex =
    /When\s+([A-Za-z'\-\s]+)\s+is dealt attack damage,\s*it gains\s+([A-Za-z'\-\s]+)\s+deals?\s+an additional\s+(\d+)\s+attack damage/gi;
  working = working.replace(whenDealtAttackDamageGainAttackBonusRegex, (_, creatureName, bonusName, amount) => {
    effects.push({
      kind: "onTakesAttackDamageGrantAttackBonus",
      amount: Number(amount),
      sourceCreatureName: String(creatureName || "").trim(),
      bonusName: String(bonusName || "").trim(),
      timing: "on_takes_attack_damage",
      sourceText: _.trim(),
    });
    return " ";
  });

  const playMugicWithoutCostOnAttackDamageRegex =
    /When\s+([A-Za-z'\-\s]+)\s+deals attack damage,\s*[A-Za-z'\-\s]+ can immediately play a Mugic Card of cost\s+(\d+)\s+or less without paying its Mugic cost/gi;
  working = working.replace(playMugicWithoutCostOnAttackDamageRegex, (_, creatureName, maxCost) => {
    effects.push({
      kind: "playMugicOnAttackDamage",
      creatureName: String(creatureName || "").trim(),
      maxCost: Number(maxCost),
      ignoreMugicCost: true,
      timing: "on_attack_damage_dealt",
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageCapRegex = /If\s+[A-Za-z'\-\s]+?\s+would deal more than\s+(\d+)\s+damage,\s*it deals?\s+\1\s+damage instead/gi;
  working = working.replace(attackDamageCapRegex, (_, amount) => {
    effects.push({
      kind: "attackDamageCap",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageZeroIfDefenderHasElementRegex =
    /If the opposing engaged Creature has\s+(Fire|Air|Earth|Water),\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackDamageZeroIfDefenderHasElementRegex, (_, elementWord) => {
    effects.push({
      kind: "attackDamageSetIfDefenderHasElement",
      element: String(elementWord || "").toLowerCase(),
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDamageByDefenderStatRegex =
    /If the opposing engaged Creature has less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy),\s*deal\s+(\d+)\s+damage/gi;
  working = working.replace(attackConditionalDamageByDefenderStatRegex, (_, threshold, statWord, amount) => {
    effects.push({
      kind: "conditionalDamage",
      mode: "defender_stat_lt",
      comparator: "defenderLt",
      stat: normalizeStatWord(statWord),
      threshold: Number(threshold),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalSelfTypeBonusRegex =
    /If your engaged Creature is a[n]?\s+([A-Za-z'\-\s]+?)\s+Creature,\s*deal an additional\s+(\d+)\s+damage/gi;
  working = working.replace(attackConditionalSelfTypeBonusRegex, (_, typeWord, amount) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "add",
      amount: Number(amount),
      conditions: [
        {
          type: "attackerHasCreatureType",
          value: normalizeCreatureTypeKey(typeWord),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDefenderTypeSetZeroRegex =
    /If the opposing engaged Creature is a[n]?\s+([A-Za-z'\-\s]+?)\s+Creature,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackConditionalDefenderTypeSetZeroRegex, (_, typeWord) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "set",
      amount: 0,
      conditions: [
        {
          type: "defenderHasCreatureType",
          value: normalizeCreatureTypeKey(typeWord),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDefenderElementReduceRegex =
    /If the opposing engaged Creature has\s+(Fire|Air|Earth|Water),\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced by\s+(\d+)/gi;
  working = working.replace(attackConditionalDefenderElementReduceRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "reduce",
      amount: Number(amount),
      conditions: [
        {
          type: "defenderHasElement",
          value: String(elementWord || "").toLowerCase(),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDefenderEquippedSetZeroRegex =
    /If the opposing engaged Creature is equipped,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackConditionalDefenderEquippedSetZeroRegex, (_) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "set",
      amount: 0,
      conditions: [{ type: "defenderEquipped" }],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalAttackerEquippedKeywordBonusRegex =
    /If your engaged Creature is equipped with a[n]?\s+([A-Za-z'\-\s]+?),\s*deal an additional\s+(\d+)\s+damage/gi;
  working = working.replace(attackConditionalAttackerEquippedKeywordBonusRegex, (_, keyword, amount) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "add",
      amount: Number(amount),
      conditions: [
        {
          type: "attackerEquippedWithKeyword",
          value: normalizeCreatureTypeKey(keyword),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalOpponentControlsLocationRegex =
    /If your opponent controls the active Location,\s*(deal an additional|damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to)\s+(\d+)?(?:\s+damage)?/gi;
  working = working.replace(attackConditionalOpponentControlsLocationRegex, (_, modeWord, amountWord) => {
    const modeText = String(modeWord || "").toLowerCase();
    const isAdd = modeText.includes("deal an additional");
    const modifier = isAdd ? "add" : "set";
    const amount = isAdd ? Number(amountWord || 0) : 0;
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier,
      amount,
      conditions: [{ type: "opponentControlsActiveLocation" }],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalControlsNonTribeReduceZeroRegex =
    /If you control non-(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackConditionalControlsNonTribeReduceZeroRegex, (_, tribeWord) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "set",
      amount: 0,
      conditions: [
        {
          type: "controllerHasNonTribeCreature",
          value: normalizeTribeWord(tribeWord),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDefenderMugicCounterSetZeroRegex =
    /If the opposing engaged Creature has a Mugic counter,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackConditionalDefenderMugicCounterSetZeroRegex, (_) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "set",
      amount: 0,
      conditions: [{ type: "defenderMugicCountersGte", value: 1 }],
      sourceText: _.trim(),
    });
    return " ";
  });

  const opposingEngagedCannotGainMugicCounterRegex =
    /The opposing engaged Creature cannot have Mugic counters put on it/gi;
  working = working.replace(opposingEngagedCannotGainMugicCounterRegex, (_) => {
    effects.push({
      kind: "preventMugicCounterGain",
      target: "opponent",
      scope: "engaged",
      sourceText: _.trim(),
    });
    return " ";
  });

  const discardNamedCardForBonusAttackRegex =
    /You can discard another card named\s+([A-Za-z'\-\s]+?)\.\s*If you do,\s*deal an additional\s+(\d+)\s+damage and draw an Attack Card/gi;
  working = working.replace(discardNamedCardForBonusAttackRegex, (_, cardName, amount) => {
    effects.push({
      kind: "discardNamedAttackForBonus",
      cardName: String(cardName || "").trim(),
      bonusDamage: Number(amount),
      draw: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackConditionalDiscardContainsNameReduceRegex =
    /If an Attack Card named\s+([A-Za-z'\-\s]+?)\s+is in your attack discard pile,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced by\s+(\d+)/gi;
  working = working.replace(attackConditionalDiscardContainsNameReduceRegex, (_, attackName, amount) => {
    effects.push({
      kind: "attackDamageConditionalModifier",
      modifier: "reduce",
      amount: Number(amount),
      conditions: [
        {
          type: "attackDiscardContainsName",
          value: String(attackName || "").trim(),
        },
      ],
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerMugicCounterRegex =
    /Deal an additional\s+(\d+)\s+damage for each Mugic counter on your engaged Creature/gi;
  working = working.replace(attackDamagePerMugicCounterRegex, (_, amount) => {
    effects.push({
      kind: "attackDamagePerMugicCounter",
      amountPerCounter: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerElementTypeRegex =
    /Deal an additional\s+(\d+)\s+damage for each Elemental Type your engaged Creature has/gi;
  working = working.replace(attackDamagePerElementTypeRegex, (_, amount) => {
    effects.push({
      kind: "attackDamagePerElementType",
      amountPerElement: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerSharedElementsRegex =
    /Deal\s+(\d+)\s+damage for each Elemental Type shared by both engaged Creatures/gi;
  working = working.replace(attackDamagePerSharedElementsRegex, (_, amount) => {
    effects.push({
      kind: "attackDamagePerSharedElementType",
      amountPerElement: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerControlledTribeRegex =
    /Deal\s+(\d+)\s+damage for each Tribe you control beyond the first/gi;
  working = working.replace(attackDamagePerControlledTribeRegex, (_, amount) => {
    effects.push({
      kind: "attackDamagePerControlledTribe",
      amountPerTribe: Number(amount),
      subtractFirst: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerControlledCreatureTypeRegex =
    /Deal\s+(\d+)\s+damage for each\s+([A-Za-z'\-\s]+?)\s+Creature you control(?:\s+adjacent to your engaged Creature)?/gi;
  working = working.replace(attackDamagePerControlledCreatureTypeRegex, (_, amount, typeWord) => {
    effects.push({
      kind: "attackDamagePerControlledCreatureType",
      amountPerCreature: Number(amount),
      creatureType: normalizeCreatureTypeKey(typeWord),
      adjacentToEngaged: /adjacent to your engaged Creature/i.test(_),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerDiscardRegex =
    /Deal\s+(\d+)\s+damage for each Attack Card in your Attack Discard pile/gi;
  working = working.replace(attackDamagePerDiscardRegex, (_, amount) => {
    effects.push({
      kind: "attackDamagePerAttackDiscard",
      amountPerCard: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageSetZeroIfDiscardGreaterRegex =
    /If (?:there are|your Attack Discard pile has)\s+more than\s+(\d+)\s+Attack Cards?,\s*(?:it|this attack)\s+deals?\s+0\s+damage/gi;
  working = working.replace(attackDamageSetZeroIfDiscardGreaterRegex, (_, amount) => {
    effects.push({
      kind: "attackDamageSetIfAttackDiscardGt",
      threshold: Number(amount),
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageSetZeroIfFewerMugicCardsRegex =
    /If you have fewer Mugic Cards?\s+(?:in(?:\s+your)?\s+hand|available)\s+than your opponent,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced to 0/gi;
  working = working.replace(attackDamageSetZeroIfFewerMugicCardsRegex, (_) => {
    effects.push({
      kind: "attackDamageSetIfFewerMugicCards",
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamageFromLastAttackRegex =
    /(?:[A-Za-z'\-\s]+?)\s+deals?\s+additional damage equal to the damage dealt by the last attack played this combat/gi;
  working = working.replace(attackDamageFromLastAttackRegex, (_) => {
    effects.push({
      kind: "attackDamageFromLastAttack",
      sourceText: _.trim(),
    });
    return " ";
  });

  const nextAttackThisCombatDealsZeroRegex =
    /The next attack played this combat deals?\s+0\s+damage/gi;
  working = working.replace(nextAttackThisCombatDealsZeroRegex, (_) => {
    effects.push({
      kind: "nextAttackThisCombatSetDamage",
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackDamagePerDefenderDisciplineOverRegex =
    /For each Discipline over\s+(\d+)\s+the opposing engaged Creature has,\s*damage dealt by\s+[A-Za-z'\-\s]+?\s+is reduced by\s+(\d+)/gi;
  working = working.replace(attackDamagePerDefenderDisciplineOverRegex, (_, threshold, amount) => {
    effects.push({
      kind: "attackDamagePerDefenderDisciplineOver",
      threshold: Number(threshold),
      amountPerDiscipline: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const selfDamageRegex = /Your engaged Creature (?:takes|is dealt)\s+(\d+)\s+damage/gi;
  working = working.replace(selfDamageRegex, (_, amount) => {
    effects.push({
      kind: "selfDamage",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeMugicCountersFromEngagedByLowStatsRegex =
    /Remove a Mugic counter from engaged Creatures with less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy)\s+or\s+(Courage|Power|Wisdom|Speed|Energy)/gi;
  working = working.replace(removeMugicCountersFromEngagedByLowStatsRegex, (_, threshold, statA, statB) => {
    effects.push({
      kind: "mugicCounterRemoveByStatThreshold",
      target: "all",
      scope: "engagedAll",
      threshold: Number(threshold),
      stats: [normalizeStatWord(statA), normalizeStatWord(statB)].filter(Boolean),
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyEngagedBattlegearByLowStatsRegex =
    /Destroy all Battlegear equipped to engaged Creatures with less than\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy)\s+or\s+(Courage|Power|Wisdom|Speed|Energy)/gi;
  working = working.replace(destroyEngagedBattlegearByLowStatsRegex, (_, threshold, statA, statB) => {
    effects.push({
      kind: "destroyBattlegearByStatThreshold",
      target: "all",
      scope: "engagedAll",
      threshold: Number(threshold),
      stats: [normalizeStatWord(statA), normalizeStatWord(statB)].filter(Boolean),
      sourceText: _.trim(),
    });
    return " ";
  });

  const statCheckDestroyOpposingBattlegearRegex =
    /Stat Check\s+(Courage|Power|Wisdom|Speed|Energy)\s+(\d+):\s*Choose a Battlegear equipped to an opposing Creature and destroy it/gi;
  working = working.replace(statCheckDestroyOpposingBattlegearRegex, (_, statWord, threshold) => {
    effects.push({
      kind: "destroyBattlegearIfAttackerStatGte",
      stat: normalizeStatWord(statWord),
      threshold: Number(threshold),
      target: "opponent",
      scope: "engaged",
      sourceText: _.trim(),
      targetSpec: {
        type: "battlegear",
        required: true,
        scope: "opponent",
      },
    });
    return " ";
  });

  const opposingEngagedCannotBeHealedRegex = /Opposing engaged Creature cannot be healed/gi;
  working = working.replace(opposingEngagedCannotBeHealedRegex, (_) => {
    effects.push({
      kind: "healBlocked",
      target: "opponent",
      scope: "engaged",
      sourceText: _.trim(),
    });
    return " ";
  });

  const searchAttackDeckToDiscardRegex =
    /Search your Attack Deck for up to\s+(\w+)\s+Attack Cards?\s+and put them in your Attack Discard pile,\s*then shuffle your Attack Deck/gi;
  working = working.replace(searchAttackDeckToDiscardRegex, (_, countWord) => {
    effects.push({
      kind: "searchDeckToDiscard",
      deckType: "attack",
      targetPile: "discard",
      count: parseCountWord(countWord, 1),
      sourceText: _.trim(),
    });
    return " ";
  });

  const tribeAttackBonusRegex =
    /Attacks played by[^.]*?deal(?:s)?\s+an?\s+additional\s+(\d+)\s+damage\s+to\s+(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures?/gi;
  working = working.replace(tribeAttackBonusRegex, (_, amount, tribeWord) => {
    effects.push({
      kind: "attackDamageVsTribe",
      amount: Number(amount),
      tribe: String(tribeWord || "").toLowerCase().replace("'", ""),
      sourceText: _.trim(),
    });
    return " ";
  });

  const tribeStatBonusRegex =
    /(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures?\s+have an additional\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(tribeStatBonusRegex, (_, tribeWord, amount, statWord) => {
    effects.push({
      kind: "tribeStatModifier",
      tribe: String(tribeWord || "").toLowerCase().replace("'", ""),
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const otherCreaturesLessStatRegex =
    /Other\s+Creatures\s+you\s+control\s+have\s+(\d+)\s+less\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(otherCreaturesLessStatRegex, (_, amount, statWord) => {
    effects.push({
      kind: "alliedStatModifier",
      stat: normalizeStatWord(statWord),
      amount: -Number(amount),
      excludeSelf: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const generalDiscardConditionalBuffRegex =
    /If\s+([A-Za-z'\-\s]+?)\s+is in your general discard pile,\s*([A-Za-z'\-\s]+?)\s+Creatures?\s+you control have an additional\s+(\d+)\s+(all Disciplines|Courage|Power|Wisdom|Speed|Energy)/gi;
  working = working.replace(generalDiscardConditionalBuffRegex, (_, sourceName, creatureTypeText, amount, statWord) => {
    const normalizedType = normalizeCreatureTypeKey(creatureTypeText);
    const numeric = Number(amount || 0);
    const pushStat = (stat) =>
      effects.push({
        kind: "discardPresenceStatAura",
        sourceName: String(sourceName || "").trim(),
        requiredCreatureType: normalizedType,
        stat,
        amount: numeric,
        sourceText: _.trim(),
      });
    const normalizedStat = String(statWord || "").toLowerCase();
    if (normalizedStat.includes("all disciplines")) {
      ["courage", "power", "wisdom", "speed"].forEach(pushStat);
    } else {
      pushStat(normalizeStatWord(statWord));
    }
    return " ";
  });

  const leadershipCounterOnWinRegex =
    /When\s+([A-Za-z'\-\s]+)\s+wins combat(?:,)?\s*put a Leadership Counter on it/gi;
  working = working.replace(leadershipCounterOnWinRegex, (_, creatureName) => {
    effects.push({
      kind: "namedCounterOnCombatWin",
      counterKey: "leadership",
      amount: 1,
      creatureName: String(creatureName || "").trim(),
      timing: "on_combat_win",
      sourceText: _.trim(),
    });
    return " ";
  });

  const startsFaceUpRegex =
    /begins the game and comes into play with this side face-up/gi;
  working = working.replace(startsFaceUpRegex, (_) => {
    effects.push({
      kind: "startsFaceUp",
      sourceText: _.trim(),
    });
    return " ";
  });

  const startsFaceUpShortRegex = /begins the game face-up/gi;
  working = working.replace(startsFaceUpShortRegex, (_) => {
    effects.push({
      kind: "startsFaceUp",
      sourceText: _.trim(),
    });
    return " ";
  });

  const alliesGainPerLeadershipRegex =
    /Other Creatures you control have an additional\s+(\d+)\s+Energy\s+for each Leadership Counter on\s+([A-Za-z'\-\s]+)/gi;
  working = working.replace(alliesGainPerLeadershipRegex, (_, amount, creatureName) => {
    effects.push({
      kind: "alliesStatPerNamedCounter",
      counterKey: "leadership",
      sourceCreatureName: String(creatureName || "").trim(),
      stat: "energy",
      amountPerCounter: Number(amount),
      excludeSelf: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementOpposingStatLossRegex =
    /(Fire|Air|Earth|Water):\s*Opposing engaged Creature loses\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(elementOpposingStatLossRegex, (_, elementWord, amount, statWord) => {
    effects.push({
      kind: "conditionalStatModifier",
      target: "opponent",
      stat: normalizeStatWord(statWord),
      amount: -Number(amount),
      requiresElement: String(elementWord || "").toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementOpposingStatSetZeroRegex =
    /(Fire|Air|Earth|Water):\s*Reduce opposing engaged Creature's\s+(Courage|Power|Wisdom|Speed)\s+to 0/gi;
  working = working.replace(elementOpposingStatSetZeroRegex, (_, elementWord, statWord) => {
    effects.push({
      kind: "conditionalStatSet",
      target: "opponent",
      stat: normalizeStatWord(statWord),
      value: 0,
      requiresElement: String(elementWord || "").toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementOpposingAllDisciplinesLossRegex =
    /(Fire|Air|Earth|Water):\s*Opposing Creature loses\s+(\d+)\s+to all Disciplines/gi;
  working = working.replace(elementOpposingAllDisciplinesLossRegex, (_, elementWord, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "conditionalStatModifier",
        target: "opponent",
        stat,
        amount: -Number(amount),
        requiresElement: String(elementWord || "").toLowerCase(),
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const selfLoseElementRegex = /Your engaged Creature loses\s+(Fire|Air|Earth|Water)/gi;
  working = working.replace(selfLoseElementRegex, (_, elementWord) => {
    effects.push({
      kind: "removeElement",
      target: "self",
      element: String(elementWord || "").toLowerCase(),
      duration: "end_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opposingLoseElementRegex = /Opposing engaged Creature loses\s+(Fire|Air|Earth|Water)/gi;
  working = working.replace(opposingLoseElementRegex, (_, elementWord) => {
    effects.push({
      kind: "removeElement",
      target: "opponent",
      element: String(elementWord || "").toLowerCase(),
      duration: "end_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeInvisibilityRegex = /(Opposing engaged Creature|Target Creature)\s+loses\s+Invisibility/gi;
  working = working.replace(removeInvisibilityRegex, (_, targetWord) => {
    const opposingTarget = /opposing/i.test(String(targetWord || ""));
    effects.push({
      kind: "removeInvisibility",
      target: opposingTarget ? "opponent" : "self",
      targetSpec: {
        type: "creature",
        required: true,
        scope: opposingTarget ? "opponent" : "all",
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const infectRegex = /Infect\s+target\s+((?:Uninfected\s+)?(?:engaged\s+|unengaged\s+|adjacent\s+|opposing\s+|infected\s+)*)Creature/gi;
  working = working.replace(infectRegex, (_, targetQualifier) => {
    const qualifierText = String(targetQualifier || "").toLowerCase();
    const requireUninfected = qualifierText.includes("uninfected");
    const requireInfected = !requireUninfected && qualifierText.includes("infected");
    effects.push({
      kind: "infectTargetCreature",
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
        requireUninfected,
        ...(requireInfected ? { requireInfected: true } : {}),
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const infectUpToTwoRegex = /Infect up to two target Uninfected Creatures/gi;
  working = working.replace(infectUpToTwoRegex, (_) => {
    effects.push({
      kind: "infectTargetCreature",
      amount: 2,
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
        requireUninfected: true,
        maxTargets: 2,
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const swapUnengagedCreaturesRegex =
    /The controller of target unengaged Creature chooses another unengaged Creature they control\.\s*Those two creatures swap spaces/gi;
  working = working.replace(swapUnengagedCreaturesRegex, (_) => {
    effects.push({
      kind: "boardMove",
      operation: "swap_positions",
      target: "self",
      includeEngaged: false,
      sourceText: _.trim(),
    });
    return " ";
  });

  const genericSwapCreaturesRegex = /Those two creatures swap spaces/gi;
  working = working.replace(genericSwapCreaturesRegex, (_) => {
    effects.push({
      kind: "boardMove",
      operation: "swap_positions",
      target: "self",
      includeEngaged: false,
      sourceText: _.trim(),
    });
    return " ";
  });

  const copyMugicRegex =
    /Copy target Mugic(?: played by a Creature you control)?(?:\.\s*You may choose new targets for the copy)?/gi;
  working = working.replace(copyMugicRegex, (_) => {
    effects.push({
      kind: "copyMugic",
      target: /you control/i.test(_) ? "self" : "all",
      allowRetarget: /new targets/i.test(_),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginTurnCopyOpposingCreatureRegex =
    /At the beginning of (?:each|your) turn,\s*(?:[A-Za-z'\-\s]+?)\s+becomes a copy of target opposing Creature/gi;
  working = working.replace(beginTurnCopyOpposingCreatureRegex, (_) => {
    effects.push({
      kind: "copyCreatureProfile",
      target: "self",
      source: "opponent",
      timing: "begin_turn",
      duration: "until_overwritten_or_leave_play",
      sourceText: _.trim(),
    });
    return " ";
  });

  const becomesCopyOpposingCreatureRegex =
    /(?:Target Creature|[A-Za-z'\-\s]+?)\s+becomes a copy of target opposing Creature/gi;
  working = working.replace(becomesCopyOpposingCreatureRegex, (_) => {
    effects.push({
      kind: "copyCreatureProfile",
      target: /Target Creature/i.test(_) ? "opponent" : "self",
      source: "opponent",
      duration: "until_overwritten_or_leave_play",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginTurnRelocateSelfRegex =
    /(At the beginning of (?:your|each) turn,\s*)?(?:you can\s+)?relocate target Creature you control to any unoccupied space(?:\s+adjacent to it)?/gi;
  working = working.replace(beginTurnRelocateSelfRegex, (_, turnPrefix) => {
    effects.push({
      kind: "relocateEffect",
      operation: "move_to_empty",
      target: "self",
      adjacentOnly: /adjacent to it/i.test(_),
      includeEngaged: true,
      timing: turnPrefix ? "begin_turn" : undefined,
      sourceText: _.trim(),
    });
    return " ";
  });

  const relocateOpposingUnengagedRegex =
    /Relocate target opposing unengaged Creature to any unoccupied space(?:\s+adjacent to (?:this Creature|it))?/gi;
  working = working.replace(relocateOpposingUnengagedRegex, (_) => {
    effects.push({
      kind: "relocateEffect",
      operation: "move_to_empty",
      target: "opponent",
      includeEngaged: false,
      adjacentOnly: /adjacent/i.test(_),
      sourceText: _.trim(),
    });
    return " ";
  });

  const relocateBothEngagedRegex =
    /Relocate both engaged Creatures to any unoccupied space(?:\s+adjacent to either of them)?/gi;
  working = working.replace(relocateBothEngagedRegex, (_) => {
    effects.push({
      kind: "relocateEffect",
      operation: "move_engaged_both_to_empty",
      target: "all",
      includeEngaged: true,
      adjacentOnly: /adjacent/i.test(_),
      sourceText: _.trim(),
    });
    return " ";
  });

  const relocateSelfGenericRegex = /Relocate it to any unoccupied space(?:\s+adjacent to it)?/gi;
  working = working.replace(relocateSelfGenericRegex, (_) => {
    effects.push({
      kind: "relocateEffect",
      operation: "move_to_empty",
      target: "self",
      includeEngaged: true,
      adjacentOnly: /adjacent/i.test(_),
      sourceText: _.trim(),
    });
    return " ";
  });

  const cannotGainElementTypesRegex =
    /(Opposing engaged Creature|Target Creature|That Creature|it)\s+(?:does not have and\s+)?cannot gain any Elemental Types/gi;
  working = working.replace(cannotGainElementTypesRegex, (_, targetWord) => {
    const rawTarget = String(targetWord || "").toLowerCase();
    const target = rawTarget.includes("opposing") ? "opponent" : "self";
    effects.push({
      kind: "cannotGainElementTypes",
      target,
      sourceText: _.trim(),
    });
    return " ";
  });

  const putMugicCounterRegex = /Put a Mugic counter on target(?:\s+adjacent)?\s+Creature(?:\s+you control)?/gi;
  working = working.replace(putMugicCounterRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "self",
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatPutMugicCounterOnEngagedTribeRegex =
    /At the beginning of combat,\s*put a Mugic counter on any engaged\s+(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures/gi;
  working = working.replace(beginCombatPutMugicCounterOnEngagedTribeRegex, (_, tribeWord) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "all",
      amount: 1,
      scope: "allCreatures",
      requiredTribes: [normalizeTribeLabel(tribeWord)],
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const putMugicCounterNamedRegex = /put a Mugic counter on\s+(?!each Creature controlled by an opponent)[A-Za-z'\-\s]+/gi;
  working = working.replace(putMugicCounterNamedRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "self",
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const putMugicCounterOpponentAllRegex = /Put a Mugic counter on each Creature controlled by an opponent/gi;
  working = working.replace(putMugicCounterOpponentAllRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "opponent",
      amount: 1,
      scope: "allCreatures",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginningTurnEachPlayerMugicCounterRegex =
    /At the beginning of (?:your|each) turn,\s*each player puts a Mugic counter on a Creature they control(?: with no Mugic counters)?/gi;
  working = working.replace(beginningTurnEachPlayerMugicCounterRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "all",
      amount: 1,
      scope: "allCreatures",
      noCountersOnly: /no Mugic counters/i.test(_),
      timing: "begin_turn",
      sourceText: _.trim(),
    });
    return " ";
  });

  const putMugicCounterItRegex = /put a Mugic counter on it/gi;
  working = working.replace(putMugicCounterItRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "self",
      amount: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeMugicCounterRegex = /Remove a Mugic counter from target(?:\s+engaged)?\s+Creature/gi;
  working = working.replace(removeMugicCounterRegex, (_) => {
    effects.push({
      kind: "mugicCounterModifier",
      target: "opponent",
      amount: -1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeAllMugicCountersChoiceRegex = /Remove all Mugic counters from a Creature of your choice/gi;
  working = working.replace(removeAllMugicCountersChoiceRegex, (_) => {
    effects.push({
      kind: "mugicCounterSet",
      target: "any",
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeAllMugicCountersRegex = /Remove all Mugic counters?\s+(?:on|from)\s+target(?:\s+engaged)?\s+Creature/gi;
  working = working.replace(removeAllMugicCountersRegex, (_) => {
    effects.push({
      kind: "mugicCounterSet",
      target: "opponent",
      amount: 0,
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeXMugicCountersMirrorRegex =
    /Remove X Mugic counters from the opposing engaged Creature,\s*where X is the number of Mugic counters on your engaged Creature/gi;
  working = working.replace(removeXMugicCountersMirrorRegex, (_) => {
    effects.push({
      kind: "mugicCounterMirrorRemove",
      target: "opponent",
      scope: "engaged",
      sourceText: _.trim(),
    });
    return " ";
  });

  const removeTotalMugicCountersRegex =
    /(?:Your opponent|Target player)\s+removes? a total of\s+(\d+)\s+Mugic counters?\s+from among any Creatures? they control/gi;
  working = working.replace(removeTotalMugicCountersRegex, (_, total) => {
    effects.push({
      kind: "mugicCounterRemoveTotal",
      target: "opponent",
      total: Number(total),
      sourceText: _.trim(),
    });
    return " ";
  });

  const conditionalRecklessnessValueRegex =
    /If the opposing engaged Creature has Recklessness,\s*deal damage equal to (?:that Creature's|its)\s+Recklessness value/gi;
  working = working.replace(conditionalRecklessnessValueRegex, (_) => {
    effects.push({
      kind: "conditionalDealDamageByStatusValue",
      status: "recklessness",
      multiplier: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const conditionalRecklessnessTwiceRegex =
    /If your engaged Creature has Recklessness,\s*deal damage equal to twice (?:that Creature's|its)\s+Recklessness value/gi;
  working = working.replace(conditionalRecklessnessTwiceRegex, (_) => {
    effects.push({
      kind: "conditionalDealDamageByStatusValue",
      status: "recklessness",
      multiplier: 2,
      sourceText: _.trim(),
    });
    return " ";
  });

  const conditionalRecklessnessValueSelfRegex =
    /If your engaged Creature has Recklessness,\s*deal damage equal to (?:that Creature's|its)\s+Recklessness value/gi;
  working = working.replace(conditionalRecklessnessValueSelfRegex, (_) => {
    effects.push({
      kind: "conditionalDealDamageByStatusValue",
      status: "recklessness",
      multiplier: 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const ifHasRecklessnessDealRegex = /If your engaged Creature has Recklessness,\s*deal\s+(\d+)\s+damage/gi;
  working = working.replace(ifHasRecklessnessDealRegex, (_, amount) => {
    effects.push({
      kind: "conditionalDealDamageIfStatus",
      status: "recklessness",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const sacrificeRegex = /Sacrifice\s+(?:a\s+)?(?:target\s+)?(?:Creature|creature)/gi;
  working = working.replace(sacrificeRegex, (_) => {
    effects.push({
      kind: "sacrificeCreature",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opponentSacrificeRegex = /your opponent sacrifices a Creature/gi;
  working = working.replace(opponentSacrificeRegex, (_) => {
    effects.push({
      kind: "sacrificeOpponentCreature",
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyCreatureIfStatZeroRegex = /Destroy target engaged Creature with 0\s+(Courage|Power|Wisdom|Speed|Energy)/gi;
  working = working.replace(destroyCreatureIfStatZeroRegex, (_, statWord) => {
    effects.push({
      kind: "destroyCreatureIfStatZero",
      stat: normalizeStatWord(statWord),
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyBattlegearRegex = /[Dd]estroy\s+(?!all\b)(?:target\s+|an?\s+)?(?:opposing\s+)?Battlegear/gi;
  working = working.replace(destroyBattlegearRegex, (_) => {
    effects.push({
      kind: "destroyBattlegear",
      target: /opposing/i.test(_) ? "opponent" : "any",
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyAllOpposingEngagedBattlegearRegex = /Destroy all Battlegear equipped to the opposing engaged Creature/gi;
  working = working.replace(destroyAllOpposingEngagedBattlegearRegex, (_) => {
    effects.push({
      kind: "destroyBattlegear",
      target: "opponent",
      scope: "engagedAll",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatRevealNewLocationRegex = /At the beginning of combat,\s*Reveal a new active Location/gi;
  working = working.replace(beginCombatRevealNewLocationRegex, (_) => {
    effects.push({
      kind: "revealNewLocation",
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const moveTargetMirageLocationRegex = /Move target Mirage Location in play to any place/gi;
  working = working.replace(moveTargetMirageLocationRegex, (_) => {
    effects.push({
      kind: "realityFieldMirageControl",
      targetSpec: {
        type: "location",
        required: true,
        scope: "all",
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const revealNewLocationRegex = /Reveal a new active Location/gi;
  working = working.replace(revealNewLocationRegex, (_) => {
    effects.push({
      kind: "revealNewLocation",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatEachPlayerReturnMugicRegex =
    /At the beginning of combat,\s*each player can return a Mugic Card from their general discard pile to their hand/gi;
  working = working.replace(beginCombatEachPlayerReturnMugicRegex, (_) => {
    effects.push({
      kind: "returnFromDiscard",
      cardType: "mugic",
      target: "both",
      destination: "mugic_slots",
      timing: "begin_combat",
      optional: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const returnFromDiscardRegex = /[Rr]eturn\s+(?:a\s+|target\s+)?(\w[\w\s]*?)\s+(?:Card\s+)?from\s+(?:(?:your|their)\s+)?(?:general\s+)?discard\s+pile/gi;
  working = working.replace(returnFromDiscardRegex, (_, cardType) => {
    effects.push({
      kind: "returnFromDiscard",
      cardType: String(cardType || "").trim().toLowerCase(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const gainElementUntilEndCombatRegex =
    /[Gg]ain(?:s)?\s+(Fire|Air|Earth|Water)(?:\s*,\s*(Fire|Air|Earth|Water))*(?:\s*(?:,\s*and|and)\s+(Fire|Air|Earth|Water))?\s+until the end of combat/gi;
  working = working.replace(gainElementUntilEndCombatRegex, (_) => {
    const matched = _.match(/\b(Fire|Air|Earth|Water)\b/gi) || [];
    const elements = [...new Set(matched.map((e) => e.toLowerCase()))];
    if (elements.length) {
      effects.push({
        kind: "gainElement",
        elements,
        duration: "end_combat",
        sourceText: _.trim(),
      });
    }
    return " ";
  });

  const beginCombatGainElementRegex =
    /At the beginning of combat,\s*engaged Creatures gain\s+(Fire|Air|Earth|Water)(?:\s*,\s*(Fire|Air|Earth|Water))*(?:\s*(?:,\s*and|and)\s+(Fire|Air|Earth|Water))?/gi;
  working = working.replace(beginCombatGainElementRegex, (_) => {
    const matched = _.match(/\b(Fire|Air|Earth|Water)\b/gi) || [];
    const elements = [...new Set(matched.map((e) => e.toLowerCase()))];
    if (elements.length) {
      effects.push({
        kind: "gainElement",
        elements,
        target: "all",
        scope: "engaged",
        timing: "begin_combat",
        sourceText: _.trim(),
      });
    }
    return " ";
  });

  const targetGainElementRegex =
    /(Another\s+)?target\s+[^.;:]*?creature\s+gains?\s+(Fire|Air|Earth|Water)(?:\s*,\s*(Fire|Air|Earth|Water))*(?:\s*(?:,\s*and|and)\s+(Fire|Air|Earth|Water))*(?:\s+until the end of combat)?/gi;
  working = working.replace(targetGainElementRegex, (_, anotherWord) => {
    const matched = _.match(/\b(Fire|Air|Earth|Water)\b/gi) || [];
    const elements = [...new Set(matched.map((e) => e.toLowerCase()))];
    if (elements.length) {
      const entry = {
        kind: "gainElement",
        elements,
        targetSpec: {
          type: "creature",
          required: true,
          scope: "all",
          ...(String(anotherWord || "").trim() ? { distinctFromPrevious: true } : {}),
        },
        sourceText: _.trim(),
      };
      if (/until the end of combat/i.test(String(_ || ""))) {
        entry.duration = "end_combat";
      }
      effects.push(entry);
    }
    return " ";
  });

  const gainElementRegex = /[Gg]ain(?:s)?\s+(Fire|Air|Earth|Water)(?:\s*,\s*(Fire|Air|Earth|Water))*(?:\s*(?:,\s*and|and)\s+(Fire|Air|Earth|Water))*/gi;
  working = working.replace(gainElementRegex, (_) => {
    const matched = _.match(/\b(Fire|Air|Earth|Water)\b/gi) || [];
    const elements = [...new Set(matched.map((e) => e.toLowerCase()))];
    if (elements.length) {
      const entry = {
        kind: "gainElement",
        elements,
        sourceText: _.trim(),
      };
      if (/until the end of combat/i.test(String(_ || ""))) {
        entry.duration = "end_combat";
      }
      effects.push(entry);
    }
    return " ";
  });

  const flipOpposingBattlegearRegex = /Flip all Battlegear equipped to the opposing engaged Creature face-down/gi;
  working = working.replace(flipOpposingBattlegearRegex, (_) => {
    effects.push({
      kind: "suppressOpposingBattlegear",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipEngagedCreatureBattlegearRegex = /Flip engaged Creature'?s Battlegear face-down/gi;
  working = working.replace(flipEngagedCreatureBattlegearRegex, (_) => {
    effects.push({
      kind: "flipBattlegear",
      mode: "down",
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipAllFaceUpBattlegearRegex = /Flip all face-up Battlegear face-down/gi;
  working = working.replace(flipAllFaceUpBattlegearRegex, (_) => {
    effects.push({
      kind: "flipBattlegear",
      mode: "down",
      target: "all",
      scope: "all",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipTargetBattlegearRegex = /Flip target Battlegear face-(up|down)(?:\s+or\s+face-(up|down))?/gi;
  working = working.replace(flipTargetBattlegearRegex, (_, firstMode, secondMode) => {
    const mode = secondMode ? "toggle" : String(firstMode || "down").toLowerCase();
    effects.push({
      kind: "flipBattlegear",
      mode,
      target: /opposing/i.test(_) ? "opponent" : "self",
      sourceText: _.trim(),
      ...(mode === "toggle"
        ? {
            choiceSpec: {
              type: "flipMode",
              required: true,
              options: [
                { id: "down", value: "down", label: "Virar face-down" },
                { id: "up", value: "up", label: "Virar face-up" },
              ],
            },
          }
        : {}),
    });
    return " ";
  });

  const flipOneUpOneDownRegex = /Flip one Battlegear face-up and one Battlegear face-down/gi;
  working = working.replace(flipOneUpOneDownRegex, (_) => {
    effects.push({
      kind: "flipBattlegearPair",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipFaceDownYouControlFaceUpRegex = /Flip a face-down Battlegear you control face-up/gi;
  working = working.replace(flipFaceDownYouControlFaceUpRegex, (_) => {
    effects.push({
      kind: "flipBattlegear",
      mode: "up",
      target: "self",
      scope: "all",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipAllFaceDownOpponentFaceUpRegex = /Your opponent turns all face-down Battlegear Cards? they control face-up/gi;
  working = working.replace(flipAllFaceDownOpponentFaceUpRegex, (_) => {
    effects.push({
      kind: "flipBattlegear",
      mode: "up",
      target: "opponent",
      scope: "all",
      sourceText: _.trim(),
    });
    return " ";
  });

  const battlegearNoAbilitiesRegex = /Battlegear have no abilities/gi;
  working = working.replace(battlegearNoAbilitiesRegex, (_) => {
    effects.push({
      kind: "battlegearNoAbilities",
      sourceText: _.trim(),
    });
    return " ";
  });

  const battlegearIndestructibleRegex = /Battlegear cannot be destroyed/gi;
  working = working.replace(battlegearIndestructibleRegex, (_) => {
    effects.push({
      kind: "battlegearIndestructible",
      sourceText: _.trim(),
    });
    return " ";
  });

  const shuffleAttackDeckAndDiscardBothRegex =
    /Both players shuffle their Attack Decks? and Attack Discard piles together/gi;
  working = working.replace(shuffleAttackDeckAndDiscardBothRegex, (_) => {
    effects.push({
      kind: "shuffleAttackDeckWithDiscard",
      target: "both",
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackUntargetableRegex = /^Untargetable\.?$/i;
  if (attackUntargetableRegex.test(working.trim())) {
    effects.push({
      kind: "attackUntargetable",
      sourceText: working.trim(),
    });
    working = " ";
  }

  const preventDamageRegex = /[Pp]revent\s+(?:the\s+next\s+)?(\d+)\s+damage/gi;
  working = working.replace(preventDamageRegex, (_, amount) => {
    effects.push({
      kind: "preventDamage",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementProofRegex = /(Fire|Air|Earth|Water)proof\s+(\d+)/gi;
  working = working.replace(elementProofRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "elementproof",
      element: String(elementWord || "").toLowerCase(),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const directDamageTargetCreatureRegex = /Deal\s+(\d+)\s+damage\s+to\s+(another\s+)?target\s+([^.;:]*?)Creature/gi;
  working = working.replace(directDamageTargetCreatureRegex, (_, amount, anotherWord) => {
    effects.push({
      kind: "dealDamage",
      amount: Number(amount),
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: inferTargetScopeFromSourceText(_, "all"),
        ...(String(anotherWord || "").trim() ? { distinctFromPrevious: true } : {}),
      },
    });
    return " ";
  });

  const directDamageRegex = /Deal\s+(\d+)\s+damage/gi;
  working = working.replace(directDamageRegex, (_, amount) => {
    effects.push({
      kind: "dealDamage",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const healTargetCreatureRegex = /Heal\s+(\d+)\s+damage\s+to\s+target\s+Creature/gi;
  working = working.replace(healTargetCreatureRegex, (_, amount) => {
    effects.push({
      kind: "healDamage",
      amount: Number(amount),
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const healRegex = /Heal\s+(\d+)\s+damage/gi;
  working = working.replace(healRegex, (_, amount) => {
    effects.push({
      kind: "healDamage",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const gainRegex = /Gain\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(gainRegex, (_, amount, statWord) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetGainStatListRegex =
    /(Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?|Your engaged|Engaged)\s+Creature\s+gains?\s+(\d+)\s+([A-Za-z,\s]*?(?:Disciplines?|Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?))(?=[.;]|$)/gi;
  working = working.replace(targetGainStatListRegex, (_, targetWord, amount, statList) => {
    parseStatList(statList).forEach((stat) => {
      effects.push({
        kind: "statModifier",
        stat,
        amount: Number(amount),
        target: /target/i.test(targetWord) ? "self" : "self",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const targetGainTwoStatsRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)\s+and\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(targetGainTwoStatsRegex, (_, amountA, statA, amountB, statB) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statA),
      amount: Number(amountA),
      target: "self",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statB),
      amount: Number(amountB),
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceGainRegex = /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+to\s+a\s+Discipline\s+of your choice/gi;
  working = working.replace(disciplineChoiceGainRegex, (_, amount) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceGainInTheRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+in\s+the\s+Discipline\s+of your choice/gi;
  working = working.replace(disciplineChoiceGainInTheRegex, (_, amount) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceGainLoseRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+to\s+a\s+Discipline\s+and\s+loses\s+(\d+)\s+to\s+another/gi;
  working = working.replace(disciplineChoiceGainLoseRegex, (_, gainAmount, loseAmount) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(gainAmount),
      sourceText: _.trim(),
    });
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: -Number(loseAmount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceLoseRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature loses\s+(\d+)\s+in\s+the\s+Discipline\s+of your choice/gi;
  working = working.replace(disciplineChoiceLoseRegex, (_, amount) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "opponent",
      amount: -Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceGainThenAnotherRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+in\s+the\s+Discipline\s+of your choice\.\s*Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+in\s+another\s+Discipline\s+of your choice/gi;
  working = working.replace(disciplineChoiceGainThenAnotherRegex, (_, amountA, amountB) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amountA),
      sourceText: _.trim(),
    });
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amountB),
      sourceText: _.trim(),
    });
    return " ";
  });

  const disciplineChoiceLoseThenGainAnotherRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature loses\s+(\d+)\s+in\s+the\s+Discipline\s+of your choice\.\s*Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains\s+(\d+)\s+in\s+another\s+Discipline\s+of your choice/gi;
  working = working.replace(disciplineChoiceLoseThenGainAnotherRegex, (_, amountLose, amountGain) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "opponent",
      amount: -Number(amountLose),
      sourceText: _.trim(),
    });
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amountGain),
      sourceText: _.trim(),
    });
    return " ";
  });

  const setDisciplinesToScannedRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?\s+Creature gains or loses(?: Courage,?\s*Power,?\s*Wisdom\s*(?:and|,)\s*Speed| all Disciplines) so (?:they|its Disciplines?) become (?:their|its)\s+scanned values/gi;
  working = working.replace(setDisciplinesToScannedRegex, (_) => {
    effects.push({
      kind: "setDisciplinesToScanned",
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const loseRegex = /Lose\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(loseRegex, (_, amount, statWord) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: -Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const namedGainRegex = /(?:^|[.;]\s*)\s*([A-Za-z'\-]+)\s+gains?\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(namedGainRegex, (_, _name, amount, statWord) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const namedLoseRegex = /(?:^|[.;]\s*)\s*([A-Za-z'\-]+)\s+loses?\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(namedLoseRegex, (_, _name, amount, statWord) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: -Number(amount),
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opposingLoseStatListRegex =
    /Opposing engaged Creature loses\s+(\d+)\s+([A-Za-z,\s]*?(?:Disciplines?|Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?))(?=[.;]|$)/gi;
  working = working.replace(opposingLoseStatListRegex, (_, amount, statList) => {
    parseStatList(statList).forEach((stat) => {
      effects.push({
        kind: "statModifier",
        stat,
        amount: -Number(amount),
        target: "opponent",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const targetLoseStatListRegex =
    /Target(?:\s+[A-Za-z'\-]+(?:\s+[A-Za-z'\-]+){0,3})?(?:\s+engaged)?\s+Creature\s+loses\s+(\d+)\s+([A-Za-z,\s]*?(?:Disciplines?|Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?))(?=[.;]|$)/gi;
  working = working.replace(targetLoseStatListRegex, (_, amount, statList) => {
    parseStatList(statList).forEach((stat) => {
      effects.push({
        kind: "statModifier",
        stat,
        amount: -Number(amount),
        target: "opponent",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const hasAdditionalRegex = /has an additional\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi;
  working = working.replace(hasAdditionalRegex, (_, amount, statWord) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const supportRegex = /Support:\s*(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)\s+(\d+)/gi;
  working = working.replace(supportRegex, (_, statWord, amount) => {
    effects.push({
      kind: "statModifier",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const supportAllRegex = /Support:\s*all Disciplines\s+(\d+)/gi;
  working = working.replace(supportAllRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "statModifier",
        stat,
        amount: Number(amount),
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const exhaustAllDisciplinesRegex = /Exhaust\s+all Disciplines\s+(\d+)/gi;
  working = working.replace(exhaustAllDisciplinesRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "statModifier",
        stat,
        amount: -Number(amount),
        target: "self",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const intimidateRegex = /Intimidate:\s*(Courage|Power|Wisdom|Speed|Energy)\s+(\d+)/gi;
  working = working.replace(intimidateRegex, (_, statWord, amount) => {
    effects.push({
      kind: "intimidate",
      stat: normalizeStatWord(statWord),
      amount: Number(amount),
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginTurnRelocateAdjacentRegex =
    /At the beginning of your turn,\s*you can relocate target Creature to any unoccupied space adjacent to it/gi;
  working = working.replace(beginTurnRelocateAdjacentRegex, (_) => {
    effects.push({
      kind: "relocateEffect",
      operation: "move_target_to_adjacent_empty",
      target: "self",
      timing: "begin_turn",
      sourceText: _.trim(),
    });
    return " ";
  });

  const gainElementWhenAllyLosesElementRegex =
    /When another Creature you control loses an Elemental Type,\s*([A-Za-z'\-\s]+)\s+gains that Elemental Type/gi;
  working = working.replace(gainElementWhenAllyLosesElementRegex, (_, creatureName) => {
    effects.push({
      kind: "gainElementWhenAllyLosesElement",
      creatureName: String(creatureName || "").trim(),
      timing: "triggered",
      sourceText: _.trim(),
    });
    return " ";
  });

  const mugicCounterRemovedOpposingLosesAllDisciplinesRegex =
    /When a Mugic counter is removed from the opposing engaged Creature,\s*that Creature loses\s+(\d+)\s+to all Disciplines/gi;
  working = working.replace(mugicCounterRemovedOpposingLosesAllDisciplinesRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "conditionalStatModifier",
        target: "opponent",
        stat,
        amount: -Number(amount || 0),
        timing: "on_mugic_counter_removed",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const replaceAttackDamageWithDisciplineLossRegex =
    /Attacks played by Creatures you control reduce the opposing engaged Creature's Disciplines by an amount equal to the damage they would deal instead of dealing damage/gi;
  working = working.replace(replaceAttackDamageWithDisciplineLossRegex, (_) => {
    effects.push({
      kind: "replaceAttackDamageWithDisciplineLoss",
      target: "opponent",
      timing: "attack_burst",
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyIfAllDisciplinesZeroRegex = /If a Creature has 0 in all Disciplines,\s*destroy it/gi;
  working = working.replace(destroyIfAllDisciplinesZeroRegex, (_) => {
    effects.push({
      kind: "destroyCreatureIfAllDisciplinesZero",
      target: "opponent",
      sourceText: _.trim(),
    });
    return " ";
  });

  const expendMpDispelOwRegex =
    /([A-Za-z'\-\s]+)\s+may expend\s+(\d+)\s+MP to dispel an OW spell targeted at (?:him|her|it|[A-Za-z'\-\s]+)/gi;
  working = working.replace(expendMpDispelOwRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "negateMugicOrAbilityTargeting",
      tribe: "overworld",
      protectedName: String(creatureName || "").trim(),
      cost: { type: "mugic", amount: Number(amount || 0) },
      sourceText: _.trim(),
    });
    return " ";
  });

  const scoutsCannotGainInvisibilityRegex =
    /Creatures engaged with Scouts(?:\s+you control)? do not have and cannot gain Invisibility/gi;
  working = working.replace(scoutsCannotGainInvisibilityRegex, (_) => {
    effects.push({
      kind: "engagedVsScoutNoInvisibility",
      sourceText: _.trim(),
    });
    return " ";
  });

  const creaturesCannotGainInvisibilityRegex = /Creatures do not have and cannot gain Invisibility/gi;
  working = working.replace(creaturesCannotGainInvisibilityRegex, (_) => {
    effects.push({
      kind: "globalNoInvisibility",
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementproofAllTypesRegex =
    /Creatures you control have Elementproof all Elemental Types\s+(\d+)/gi;
  working = working.replace(elementproofAllTypesRegex, (_, amount) => {
    ["fire", "air", "earth", "water"].forEach((element) => {
      effects.push({
        kind: "elementproof",
        element,
        amount: Number(amount || 0),
        target: "self",
        scope: "allCreatures",
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const destroyReturnSpellFromGraveyardRegex =
    /Destroy\s+([A-Za-z'\-\s]+)\s+to return one spell to your hand from the Graveyard/gi;
  working = working.replace(destroyReturnSpellFromGraveyardRegex, (_, creatureName) => {
    effects.push({
      kind: "sacrificeCreature",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    effects.push({
      kind: "returnFromDiscard",
      cardType: "mugic",
      sourceText: _.trim(),
    });
    return " ";
  });

  const thisCountsAsMugicBurstRegex = /This counts as a Danian Mugicburst and may be dispelled/gi;
  working = working.replace(thisCountsAsMugicBurstRegex, (_) => {
    effects.push({
      kind: "countsAsMugicBurst",
      tribe: "danian",
      sourceText: _.trim(),
    });
    return " ";
  });

  const onTakeDamageGainAmountAsEnergyRegex =
    /if\s+([A-Za-z'\-\s]+)\s+would take damage from a Mugic or activated ability,\s*it gains that amount of Energy instead/gi;
  working = working.replace(onTakeDamageGainAmountAsEnergyRegex, (_, creatureName) => {
    effects.push({
      kind: "replaceMugicOrAbilityDamageWithEnergyGain",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const replaceBecomeEngagedSwapRegex =
    /If\s+([A-Za-z'\-\s]+)\s+would become engaged on your turn,\s*you can swaps? spaces with an UnderWorld Creature you control\. If you do, that Creature becomes engaged instead/gi;
  working = working.replace(replaceBecomeEngagedSwapRegex, (_, creatureName) => {
    effects.push({
      kind: "replaceBecomeEngagedBySwapWithUnderworld",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const initiativeElementGrantsElementRegex =
    /If the Initiative of the active Location is an Elemental Type,\s*your engaged Creature (?:has Element 5 in|gains)\s+that Elemental Type/gi;
  working = working.replace(initiativeElementGrantsElementRegex, (_) => {
    effects.push({
      kind: "gainInitiativeElementType",
      amount: /has Element 5 in/i.test(_) ? 5 : 1,
      sourceText: _.trim(),
    });
    return " ";
  });

  const firstAttackAgainstDealsLessRegex =
    /The first attack against\s+([A-Za-z'\-\s]+)\s+each combat deals\s+(\d+)\s+less damage/gi;
  working = working.replace(firstAttackAgainstDealsLessRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "incomingFirstAttackDamageReduction",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const ifHigherCourageWisdomFirstAttackZeroRegex =
    /If\s+([A-Za-z'\-\s]+)\s+has both higher Courage and Wisdom than the opposing engaged Creature,\s*the first attack against it each combat deals 0 damage/gi;
  working = working.replace(ifHigherCourageWisdomFirstAttackZeroRegex, (_, creatureName) => {
    effects.push({
      kind: "firstAttackZeroIfHigherCourageAndWisdom",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const maxxorSpendMcRestoreEnergyRegex =
    /([A-Za-z'\-\s]+)\s+may spend\s+(\d+)\s+MC to restore\s+(\d+)\s+energy/gi;
  working = working.replace(maxxorSpendMcRestoreEnergyRegex, (_, creatureName, mc, amount) => {
    effects.push({
      kind: "healDamage",
      amount: Number(amount || 0),
      cost: { type: "mugic", amount: Number(mc || 0) },
      sourceCreatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const nonAttackDamageRedirectToSelfRegex =
    /All non-attack damage that would be dealt to target adjacent Creature is dealt to\s+([A-Za-z'\-\s]+)\s+instead/gi;
  working = working.replace(nonAttackDamageRedirectToSelfRegex, (_, creatureName) => {
    effects.push({
      kind: "redirectNonAttackDamageToSelf",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const chooseTribeTargetCountsAsChosenRegex =
    /Choose a Tribe\.\s*Target Creature also counts as the chosen Tribe/gi;
  working = working.replace(chooseTribeTargetCountsAsChosenRegex, (_) => {
    effects.push({
      kind: "targetCreatureCountsAsChosenTribe",
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetElementalAttackLosesAbilitiesRegex = /Target Elemental Attack loses all abilities/gi;
  working = working.replace(targetElementalAttackLosesAbilitiesRegex, (_) => {
    effects.push({
      kind: "targetAttackLoseAllAbilities",
      sourceText: _.trim(),
    });
    return " ";
  });

  const songOfDeflectionRetargetRegex =
    /Change the target of target Mugic or ability with a single target/gi;
  working = working.replace(songOfDeflectionRetargetRegex, (_) => {
    effects.push({
      kind: "retargetSingleTargetMugic",
      sourceText: _.trim(),
      targetSpec: {
        type: "mugic",
        required: true,
        scope: "stack",
      },
    });
    return " ";
  });

  const targetCreatureLosesAllAbilitiesRegex = /Target engaged Creature loses all abilities|Target Creature loses all abilities/gi;
  working = working.replace(targetCreatureLosesAllAbilitiesRegex, (_) => {
    effects.push({
      kind: "suppressTargetCreatureAbilities",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const activeLocationLosesAllAbilitiesRegex = /The active Location loses all abilities/gi;
  working = working.replace(activeLocationLosesAllAbilitiesRegex, (_) => {
    effects.push({
      kind: "suppressActiveLocationAbilities",
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetElementalAttackDealsZeroToNamedRegex =
    /Target Elemental Attack deals?\s+0\s+damage\s+to\s+([A-Za-z'\-\s]+)/gi;
  working = working.replace(targetElementalAttackDealsZeroToNamedRegex, (_, creatureName) => {
    effects.push({
      kind: "targetAttackDamageSet",
      amount: 0,
      target: "opponent",
      creatureName: String(creatureName || "").trim(),
      targetSpec: {
        type: "attack",
        required: true,
        scope: "all",
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const canMoveAsIfAdjacentRegex = /([A-Za-z'\-\s]+)\s+can move to any space as if it were adjacent/gi;
  working = working.replace(canMoveAsIfAdjacentRegex, (_, creatureName) => {
    effects.push({
      kind: "moveAsIfAdjacent",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const uninfectOpposingThenInfectOwnRegex =
    /Uninfect all opposing Creatures\.\s*For each Creature Uninfected this way,\s*Infect an Uninfected Creature you control/gi;
  working = working.replace(uninfectOpposingThenInfectOwnRegex, (_) => {
    effects.push({
      kind: "uninfectOpposingThenInfectOwn",
      sourceText: _.trim(),
    });
    return " ";
  });

  const minionCannotPlayIfChieftainRegex =
    /Minion Creatures cannot play activated abilities if their controller also controls a Chieftain Creature/gi;
  working = working.replace(minionCannotPlayIfChieftainRegex, (_) => {
    effects.push({
      kind: "minionActivatedBlockedByChieftain",
      sourceText: _.trim(),
    });
    return " ";
  });

  const creatureCannotBeTargetedByMugicRegex = /([A-Za-z'\-\s]+)\s+cannot be targeted by Mugic/gi;
  working = working.replace(creatureCannotBeTargetedByMugicRegex, (_, creatureName) => {
    effects.push({
      kind: "keyword",
      keyword: "untargetable",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const mugicCostReductionToMinimumRegex =
    /([A-Za-z'\-\s]+)\s+pays\s+(\d+)\s+less Mugic counter to play Mugic Cards to a minimum of\s+(\d+)/gi;
  working = working.replace(mugicCostReductionToMinimumRegex, (_, creatureName, amount, minimum) => {
    effects.push({
      kind: "mugicCostReduction",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      minimum: Number(minimum || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const mugicCostReductionEngagedTribeRegex =
    /Engaged\s+(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creatures pay\s+(\d+)\s+less Mugic counter to play their first Mugic this turn/gi;
  working = working.replace(mugicCostReductionEngagedTribeRegex, (_, tribeWord, amount) => {
    effects.push({
      kind: "mugicCostReduction",
      target: "all",
      amount: Number(amount || 0),
      minimum: 0,
      firstMugicOnly: true,
      requiredTribes: [normalizeTribeLabel(tribeWord)],
      sourceText: _.trim(),
    });
    return " ";
  });

  const superchargedAlterantFlipRegex =
    /When\s+Supercharged Alterant\s+is flipped face-up,\s*choose a Discipline\.\s*Equipped Creature gains\s+(\d+)\s+in the chosen Discipline/gi;
  working = working.replace(superchargedAlterantFlipRegex, (_, amount) => {
    effects.push({
      kind: "disciplineChoiceModifier",
      target: "self",
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const scoutMonocularFlipFaceUpRegex = /(?:MC:\s*)?Turn target face-down Battlegear face-up/gi;
  working = working.replace(scoutMonocularFlipFaceUpRegex, (_) => {
    effects.push({
      kind: "flipBattlegear",
      mode: "up",
      target: "any",
      targetSpec: {
        type: "battlegear",
        required: true,
        scope: "all",
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const spectralViewerEngagedRegex =
    /When equipped Creature becomes engaged,\s*Creatures engaged with it lose and cannot gain Invisibility/gi;
  working = working.replace(spectralViewerEngagedRegex, (_) => {
    effects.push({
      kind: "engagedVsScoutNoInvisibility",
      requireScout: false,
      sourceText: _.trim(),
    });
    return " ";
  });

  const stingbladePrototypeRegex =
    /When Hive is activated,\s*the next time an Attack would deal damage this turn,\s*it deals\s+(\d+)\s+damage instead/gi;
  working = working.replace(stingbladePrototypeRegex, (_, amount) => {
    effects.push({
      kind: "nextAttackThisCombatSetDamage",
      amount: Number(amount || 0),
      requiresHiveActive: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const realityFieldMirageBlockRegex =
    /When equipped Creature enters a space with a Mirage Location,\s*shuffle that Mirage Location into its controller'?s Location Deck\.\s*Mirage Locations cannot be placed in equipped Creature'?s space/gi;
  working = working.replace(realityFieldMirageBlockRegex, (_) => {
    effects.push({
      kind: "realityFieldMirageControl",
      sourceText: _.trim(),
    });
    return " ";
  });

  const nonDanianAdditionalDamageToInfectedRegex =
    /Non-Danian Creatures you control deal\s+(\d+)\s+additional attack damage to Infected Creatures/gi;
  working = working.replace(nonDanianAdditionalDamageToInfectedRegex, (_, amount) => {
    effects.push({
      kind: "nonDanianAttackDamageVsInfected",
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const otherCreaturesWithElementAdditionalEnergyRegex =
    /Other Creatures you control with\s+(Fire|Air|Earth|Water)\s+have an additional\s+(\d+)\s+Energy/gi;
  working = working.replace(otherCreaturesWithElementAdditionalEnergyRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "alliedStatModifierByElement",
      element: String(elementWord || "").toLowerCase(),
      stat: "energy",
      amount: Number(amount || 0),
      excludeSelf: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const ifCanMoveIntoOccupiedMustDoSoRegex =
    /If\s+([A-Za-z'\-\s]+)\s+can move into an adjacent occupied space,\s*it must do so/gi;
  working = working.replace(ifCanMoveIntoOccupiedMustDoSoRegex, (_, creatureName) => {
    effects.push({
      kind: "mustEngageIfPossible",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whileControlTribeWhenDealFirstAttackGainEnergyRegex =
    /While you control an\s+(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creature,\s*when\s+([A-Za-z'\-\s]+)\s+deals damage with its first attack each combat,\s*it gains Energy equal to the damage it dealt/gi;
  working = working.replace(whileControlTribeWhenDealFirstAttackGainEnergyRegex, (_, tribeWord, creatureName) => {
    effects.push({
      kind: "onFirstAttackDamageGainSameEnergyIfControlTribe",
      requiredTribe: normalizeTribeLabel(tribeWord),
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenPlayAttackWhileEquippedGainEnergyRegex =
    /When\s+([A-Za-z'\-\s]+)\s+plays an Attack Card while equipped,\s*it gains\s+(\d+)\s+Energy/gi;
  working = working.replace(whenPlayAttackWhileEquippedGainEnergyRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "onPlayAttackWhileEquippedGainEnergy",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const firstAttackDamageWithElementRegex =
    /Creatures with\s+(Fire|Air|Earth|Water)\s+deal an additional\s+(\d+)\s+damage on their first attack each combat/gi;
  working = working.replace(firstAttackDamageWithElementRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "attackDamageModifier",
      modifier: "add",
      amount: Number(amount || 0),
      elements: [String(elementWord || "").toLowerCase()],
      sourceText: _.trim(),
    });
    return " ";
  });

  const grandHallMugicCounterRemovedRegex =
    /When a Mugic counter is removed from a Creature,\s*Grand Hall of Muge'?s Summit deals\s+(\d+)\s+damage to the engaged Creature controlled by the same player/gi;
  working = working.replace(grandHallMugicCounterRemovedRegex, (_, amount) => {
    effects.push({
      kind: "onMugicCounterRemovedDealDamageToEngaged",
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const iparuJungleRegex =
    /When this becomes the active Location,\s*flip a coin\.\s*If tails,\s*shuffle Iparu Jungle into its controller'?s Location Deck and that player reveals a new active Location\.\s*Mirage:\s*At the beginning of combat,\s*each engaged Creature in this space gains or loses Energy so its Energy is equal to its Scanned Energy/gi;
  working = working.replace(iparuJungleRegex, (_) => {
    effects.push({
      kind: "revealNewLocation",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "setEngagedEnergyToScannedAtBeginCombat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const mipedimOasisEmbassyRegex =
    /When this becomes the active Location,\s*shuffle any Mirage Locations into their controllers'? Location Decks\.\s*Mipedian Creatures have Water/gi;
  working = working.replace(mipedimOasisEmbassyRegex, (_) => {
    effects.push({
      kind: "realityFieldMirageControl",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "tribeGainElement",
      tribes: ["mipedian"],
      elements: ["water"],
      sourceText: _.trim(),
    });
    return " ";
  });

  const oipontsLookoutRegex =
    /Creatures with Air have Earth\.\s*If Hive is Active,\s*Danian Creatures have Air and Earth/gi;
  working = working.replace(oipontsLookoutRegex, (_) => {
    effects.push({
      kind: "airCreaturesGainEarth",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "tribeGainElementIfHiveActive",
      tribes: ["danian"],
      elements: ["air", "earth"],
      sourceText: _.trim(),
    });
    return " ";
  });

  const shaKreeFlatsRegex =
    /At the beginning of combat,\s*engaged Elementalist Creatures gain an Elemental type of their controller'?s choice/gi;
  working = working.replace(shaKreeFlatsRegex, (_) => {
    effects.push({
      kind: "engagedTypeGainChosenElement",
      requiredCreatureTypes: ["elementalist"],
      sourceText: _.trim(),
    });
    return " ";
  });

  const indigoGroveRegex =
    /When this becomes the active Location,\s*you can sacrifice a non-Conjuror Creature you control\.\s*If you do,\s*return a Conjuror Creature Card in your general discard pile to play to any unoccupied space/gi;
  working = working.replace(indigoGroveRegex, (_) => {
    effects.push({
      kind: "sacrificeCreature",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "returnCreatureFromDiscardToBoard",
      target: "self",
      requiredCreatureTypes: ["conjuror"],
      sourceText: _.trim(),
      targetSpec: {
        type: "creature_discard",
        required: true,
        scope: "self",
        requiredCreatureTypes: ["conjuror"],
      },
    });
    return " ";
  });

  const whenDealAttackDamageGainAllDisciplinesThenDestroyIfAboveRegex =
    /When\s+([A-Za-z'\-\s]+)\s+deals attack damage,\s*it gains\s+(\d+)\s+to all Disciplines\.\s*If\s+\1\s+has more than\s+(\d+)\s+Power,\s*destroy it/gi;
  working = working.replace(whenDealAttackDamageGainAllDisciplinesThenDestroyIfAboveRegex, (_, creatureName, amount, threshold) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "conditionalStatModifier",
        target: "self",
        stat,
        amount: Number(amount || 0),
        timing: "on_attack_damage_dealt",
        sourceText: _.trim(),
      });
    });
    effects.push({
      kind: "destroySelfIfPowerAboveThreshold",
      creatureName: String(creatureName || "").trim(),
      threshold: Number(threshold || 0),
      timing: "on_attack_damage_dealt",
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenMugicCounterPutLoseEnergyRegex =
    /When\s+([A-Za-z'\-\s]+)\s+has a Mugic counter put on it,\s*it loses\s+(\d+)\s+Energy/gi;
  working = working.replace(whenMugicCounterPutLoseEnergyRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "onMugicCounterAddedLoseEnergy",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenCreatureDealsDamageToThisLoseEnergyRegex =
    /When a Creature deals damage to\s+([A-Za-z'\-\s]+),\s*that Creature loses\s+(\d+)\s+Energy/gi;
  working = working.replace(whenCreatureDealsDamageToThisLoseEnergyRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "onTakeDamageSourceLosesEnergy",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whileControlMipedianHasDisarmRegex =
    /While you control a Mipedian Creature,\s*([A-Za-z'\-\s]+)\s+has Disarm/gi;
  working = working.replace(whileControlMipedianHasDisarmRegex, (_, creatureName) => {
    effects.push({
      kind: "keywordIfControlTribe",
      requiredTribe: "mipedian",
      keyword: "disarm",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whileInBattleSpendMcSacrificeUwRestoreRegex =
    /While in battle,\s*([A-Za-z'\-\s]+)\s+may spend\s+(\d+)\s+MP and sacrifice one other UW Creature you control to restore\s+(\d+)\s+energy/gi;
  working = working.replace(whileInBattleSpendMcSacrificeUwRestoreRegex, (_, creatureName, mp, amount) => {
    effects.push({
      kind: "sacrificeFriendlyTribeForHeal",
      requiredTribe: "underworld",
      creatureName: String(creatureName || "").trim(),
      cost: { type: "mugic", amount: Number(mp || 0) },
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const nextAttackDealsAdditionalDamageRegex =
    /([A-Za-z'\-\s]+)\s+deals?\s+(\d+)\s+additional damage with (?:its|his|her)\s+next attack this turn/gi;
  working = working.replace(nextAttackDealsAdditionalDamageRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "nextAttackThisTurnDamageAdd",
      amount: Number(amount || 0),
      sourceCreatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const discardPileMandiblorAuraRegex =
    /If\s+([A-Za-z'\-\s]+)\s+is in your general discard pile,\s*Mandiblor Creatures you control have an additional\s+(\d+)\s+in all Disciplines/gi;
  working = working.replace(discardPileMandiblorAuraRegex, (_, creatureName, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "discardPresenceStatAura",
        sourceName: String(creatureName || "").trim(),
        requiredCreatureType: "mandiblor",
        stat,
        amount: Number(amount || 0),
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const discardMandiblorCountAsControlledRegex =
    /Mandiblor Creature Cards in your general discard pile count as Mandiblors you control when counting Mandiblors/gi;
  working = working.replace(discardMandiblorCountAsControlledRegex, (_) => {
    effects.push({
      kind: "countDiscardCreaturesAsControlledType",
      creatureType: "mandiblor",
      sourceText: _.trim(),
    });
    return " ";
  });

  const sacrificeBattlegearTargetTaskmasterBuffRegex =
    /Sacrifice a Battlegear:\s*Target Taskmaster gains\s+(\d+)\s+to all Disciplines/gi;
  working = working.replace(sacrificeBattlegearTargetTaskmasterBuffRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "statModifier",
        target: "self",
        stat,
        amount: Number(amount || 0),
        targetSpec: {
          type: "creature",
          required: true,
          scope: "self",
          requiredCreatureTypes: ["taskmaster"],
        },
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const targetAttackReflectDamageRegex =
    /When target attack deals damage,\s*deal the same amount of damage to the Creature that played that attack/gi;
  working = working.replace(targetAttackReflectDamageRegex, (_) => {
    effects.push({
      kind: "targetAttackReflectDamage",
      sourceText: _.trim(),
    });
    return " ";
  });

  const opposingEngagedNextAttackDealsLessToSelfRegex =
    /The next attack played by the opposing engaged Creature this turn deals\s+(\d+)\s+less damage to\s+([A-Za-z'\-\s]+)/gi;
  working = working.replace(opposingEngagedNextAttackDealsLessToSelfRegex, (_, amount, creatureName) => {
    effects.push({
      kind: "incomingNextAttackReduction",
      amount: Number(amount || 0),
      targetCreatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const returnMandiblorFromDiscardToBoardRegex =
    /Return target Mandiblor Creature Card in your general discard pile to play to any unoccupied space on your side of the Battleboard/gi;
  working = working.replace(returnMandiblorFromDiscardToBoardRegex, (_) => {
    effects.push({
      kind: "returnCreatureFromDiscardToBoard",
      requiredCreatureTypes: ["mandiblor"],
      target: "self",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature_discard",
        required: true,
        scope: "self",
        requiredCreatureTypes: ["mandiblor"],
      },
    });
    return " ";
  });

  const returnTargetTribalCreatureFromDiscardRegex =
    /Return target\s+(OverWorld|UnderWorld|Mipedian|Danian|M'arrillian|Marrillian)\s+Creature Card in your general discard pile to play to any unoccupied space/gi;
  working = working.replace(returnTargetTribalCreatureFromDiscardRegex, (_, tribeWord) => {
    effects.push({
      kind: "returnCreatureFromDiscardToBoard",
      target: "self",
      requiredTribes: [normalizeTribeLabel(tribeWord)],
      sourceText: _.trim(),
      targetSpec: {
        type: "creature_discard",
        required: true,
        scope: "self",
        requiredTribes: [normalizeTribeLabel(tribeWord)],
      },
    });
    return " ";
  });

  const takeAttackDamageGainElementsFromAttackRegex =
    /When\s+([A-Za-z'\-\s]+)\s+takes attack damage,\s*it gains all Elemental Types that attack had/gi;
  working = working.replace(takeAttackDamageGainElementsFromAttackRegex, (_, creatureName) => {
    effects.push({
      kind: "gainElementsFromIncomingAttack",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const whenGainElementGainElementFiveRegex =
    /When\s+([A-Za-z'\-\s]+)\s+gains an Elemental Type this way,\s*it gains Element\s+(\d+)\s+in the corresponding Elemental Type/gi;
  working = working.replace(whenGainElementGainElementFiveRegex, (_, creatureName, amount) => {
    effects.push({
      kind: "onGainElementGainElementValue",
      creatureName: String(creatureName || "").trim(),
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const swapShardBattlegearBetweenKharallRegex =
    /Swap two Shard Battlegear equipped to two Kha'rall Creatures you control/gi;
  working = working.replace(swapShardBattlegearBetweenKharallRegex, (_) => {
    effects.push({
      kind: "swapBattlegearBetweenControlledCreatures",
      battlegearKeyword: "shard",
      requiredCreatureTypes: ["kharall"],
      sourceText: _.trim(),
    });
    return " ";
  });

  const dealtAttackDamageThisTurnGainElementRegex =
    /Choose an Elemental Type\.\s*Target Creature which dealt attack damage this turn gains Element\s+(\d+)\s+of the chosen Elemental Type/gi;
  working = working.replace(dealtAttackDamageThisTurnGainElementRegex, (_, amount) => {
    effects.push({
      kind: "grantChosenElementValueToRecentDamager",
      amount: Number(amount || 0),
      sourceText: _.trim(),
      choiceSpec: {
        type: "elementChoice",
        required: true,
        options: ["fire", "air", "earth", "water"].map((element) => ({
          id: element,
          value: element,
          label: element,
        })),
      },
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const warriorsYouControlAllDisciplinesRegex =
    /Warriors you control have an additional\s+(\d+)\s+in all Disciplines/gi;
  working = working.replace(warriorsYouControlAllDisciplinesRegex, (_, amount) => {
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      effects.push({
        kind: "alliedStatModifier",
        stat,
        amount: Number(amount || 0),
        requiredCreatureType: "warrior",
        excludeSelf: false,
        sourceText: _.trim(),
      });
    });
    return " ";
  });

  const onMugicCounterPutFlipTargetGearRegex =
    /When a Creature you control has a Mugic counter put on it,\s*flip target face-up Battlegear face-down/gi;
  working = working.replace(onMugicCounterPutFlipTargetGearRegex, (_) => {
    effects.push({
      kind: "flipTargetBattlegearOnMugicCounterGain",
      sourceText: _.trim(),
      targetSpec: {
        type: "battlegear",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const moveIntoAnyUnoccupiedAsAdjacentRegex =
    /([A-Za-z'\-\s]+)\s+can move into any unoccupied space as if it were adjacent/gi;
  working = working.replace(moveIntoAnyUnoccupiedAsAdjacentRegex, (_, creatureName) => {
    effects.push({
      kind: "moveAsIfAdjacent",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const moveIntoOpposingRelocateInsteadRegex =
    /If\s+([A-Za-z'\-\s]+)\s+would move into an opposing Creature's space,\s*it relocates that opposing Creature into\s+\1'?s?\s+space instead/gi;
  working = working.replace(moveIntoOpposingRelocateInsteadRegex, (_, creatureName) => {
    effects.push({
      kind: "replaceMoveIntoOpposingWithRelocate",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const targetCreatureWithZeroDisciplineLosesChosenElementRegex =
    /Target Creature with 0 in any Discipline loses an Elemental Type of your choice/gi;
  working = working.replace(targetCreatureWithZeroDisciplineLosesChosenElementRegex, (_) => {
    effects.push({
      kind: "removeChosenElementFromCreatureWithZeroDiscipline",
      sourceText: _.trim(),
      choiceSpec: {
        type: "elementChoice",
        required: true,
        options: ["fire", "air", "earth", "water"].map((element) => ({
          id: element,
          value: element,
          label: element,
        })),
      },
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const activePlayerRevealsNewLocationRegex = /The active player reveals a new active Location/gi;
  working = working.replace(activePlayerRevealsNewLocationRegex, (_) => {
    effects.push({
      kind: "revealNewLocation",
      target: "active_player",
      sourceText: _.trim(),
    });
    return " ";
  });

  const flipAllBattlegearEquippedToSelfFaceUpRegex =
    /At the beginning of your turn,\s*flip all Battlegear equipped to\s+([A-Za-z'\-\s]+)\s+face-up/gi;
  working = working.replace(flipAllBattlegearEquippedToSelfFaceUpRegex, (_, creatureName) => {
    effects.push({
      kind: "flipSelfBattlegearFaceUp",
      timing: "begin_turn",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const attackSameNameInDiscardBonusRegex =
    /Attacks played by Creatures you control deal an additional\s+(\d+)\s+damage if there is an Attack Card with the same name in your Attack Discard pile/gi;
  working = working.replace(attackSameNameInDiscardBonusRegex, (_, amount) => {
    effects.push({
      kind: "attackDamageBonusIfSameNameInDiscard",
      amount: Number(amount || 0),
      sourceText: _.trim(),
    });
    return " ";
  });

  const discardAttackReturnByBuildPointsRegex =
    /Discard an Attack Card\.\s*If you do,\s*return an Attack Card with Build Points less than or equal to the discarded Attack Card to your hand\.\s*If you cannot,\s*draw an Attack Card/gi;
  working = working.replace(discardAttackReturnByBuildPointsRegex, (_) => {
    effects.push({
      kind: "discardAttackReturnByBuildPointsOrDraw",
      sourceText: _.trim(),
    });
    return " ";
  });

  const setSelfDisciplinesToScannedNamedRegex =
    /([A-Za-z'\-\s]+)\s+gains or loses Courage,\s*Power,\s*Wisdom and Speed to make its Disciplines equal to its Scanned Disciplines/gi;
  working = working.replace(setSelfDisciplinesToScannedNamedRegex, (_, creatureName) => {
    effects.push({
      kind: "setDisciplinesToScanned",
      target: "self",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const yourOtherCreaturesWithElementEnergyRegex =
    /Your other Creatures with\s+(Fire|Air|Earth|Water)\s+have an additional\s+(\d+)\s+Energy/gi;
  working = working.replace(yourOtherCreaturesWithElementEnergyRegex, (_, elementWord, amount) => {
    effects.push({
      kind: "alliedStatModifierByElement",
      element: String(elementWord || "").toLowerCase(),
      stat: "energy",
      amount: Number(amount || 0),
      excludeSelf: true,
      sourceText: _.trim(),
    });
    return " ";
  });

  const expendAnyElementTargetDanianGainsExpendedRegex =
    /Target Danian Creature gains the expended Elemental Type/gi;
  working = working.replace(expendAnyElementTargetDanianGainsExpendedRegex, (_) => {
    effects.push({
      kind: "targetDanianGainsExpendedElement",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "self",
        requiredTribes: ["danian"],
      },
    });
    return " ";
  });

  const nextAttackDamageDealtTargetLosesDisciplinesByDamageRegex =
    /When\s+([A-Za-z'\-\s]+)\s+next deals attack damage this turn,\s*the opposing engaged Creature loses X to all Disciplines,\s*where X is the damage dealt/gi;
  working = working.replace(nextAttackDamageDealtTargetLosesDisciplinesByDamageRegex, (_, creatureName) => {
    effects.push({
      kind: "onNextAttackDamageReduceOpposingDisciplinesByDamage",
      creatureName: String(creatureName || "").trim(),
      sourceText: _.trim(),
    });
    return " ";
  });

  const destroyAllBattlegearEngagedCreaturesRegex =
    /Destroy all Battlegear equipped to engaged Creatures/gi;
  working = working.replace(destroyAllBattlegearEngagedCreaturesRegex, (_) => {
    effects.push({
      kind: "destroyBattlegear",
      target: "engagedAll",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatGainEnergyEqualLowestScannedAmongOthersRegex =
    /At the beginning of combat,\s*([A-Za-z'\-\s]+)\s+gains Energy equal to the lowest Scanned Energy among other Creatures you control/gi;
  working = working.replace(beginCombatGainEnergyEqualLowestScannedAmongOthersRegex, (_, creatureName) => {
    effects.push({
      kind: "beginCombatGainLowestScannedEnergyFromAllies",
      creatureName: String(creatureName || "").trim(),
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatGainAllElementsInfectedCreaturesHaveRegex =
    /At the beginning of combat,\s*([A-Za-z'\-\s]+)\s+gains all Elemental Types Infected Creatures have/gi;
  working = working.replace(beginCombatGainAllElementsInfectedCreaturesHaveRegex, (_, creatureName) => {
    effects.push({
      kind: "beginCombatGainElementsFromInfectedCreatures",
      creatureName: String(creatureName || "").trim(),
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const beginCombatStealOpposingEngagedBattlegearIfUnequippedRegex =
    /At the beginning of combat,\s*if\s+([A-Za-z'\-\s]+)\s+is unequipped,\s*all Battlegear equipped to the opposing engaged Creature becomes equipped to\s+\1/gi;
  working = working.replace(beginCombatStealOpposingEngagedBattlegearIfUnequippedRegex, (_, creatureName) => {
    effects.push({
      kind: "beginCombatStealOpposingEngagedBattlegearIfUnequipped",
      creatureName: String(creatureName || "").trim(),
      timing: "begin_combat",
      sourceText: _.trim(),
    });
    return " ";
  });

  const minionIgnoredChieftainForTargetRegex =
    /Target Minion Creature is treated as if its controller did not also control a Chieftain/gi;
  working = working.replace(minionIgnoredChieftainForTargetRegex, (_) => {
    effects.push({
      kind: "targetMinionIgnoreChieftainRestriction",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
        requiredCreatureTypes: ["minion"],
      },
    });
    return " ";
  });

  const retargetSingleTargetMugicRegex =
    /Choose a new target for target Mugic which only targets a single Creature/gi;
  working = working.replace(retargetSingleTargetMugicRegex, (_) => {
    effects.push({
      kind: "retargetSingleTargetMugic",
      sourceText: _.trim(),
      targetSpec: {
        type: "mugic",
        required: true,
        scope: "stack",
      },
    });
    return " ";
  });

  const whenOpposingUninfectedTargetedByYourMugicInfectRegex =
    /When an opposing Uninfected Creature is targeted by a Mugic you control,\s*Infect that Creature/gi;
  working = working.replace(whenOpposingUninfectedTargetedByYourMugicInfectRegex, (_) => {
    effects.push({
      kind: "infectTargetedOpposingUninfectedCreature",
      sourceText: _.trim(),
    });
    return " ";
  });

  const swapAttackDiscardWithDeckRegex =
    /Swap your attack discard pile with your Attack Deck,\s*then shuffle your Attack Deck/gi;
  working = working.replace(swapAttackDiscardWithDeckRegex, (_) => {
    effects.push({
      kind: "shuffleAttackDeckWithDiscard",
      target: "self",
      sourceText: _.trim(),
    });
    return " ";
  });

  const armamentAdagioSwapGearRegex =
    /Swap any Battlegear on two target Creatures controlled by the same player/gi;
  working = working.replace(armamentAdagioSwapGearRegex, (_) => {
    effects.push({
      kind: "swapBattlegearBetweenControlledCreatures",
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
        maxTargets: 2,
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const echoesEmptyHandsRegex =
    /Destroy all Battlegear equipped to target engaged Creature\.\s*That Creature gains\s+(\d+)\s+Energy/gi;
  working = working.replace(echoesEmptyHandsRegex, (_, amount) => {
    effects.push({
      kind: "destroyBattlegear",
      target: "engaged",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "healDamage",
      amount: Number(amount || 0),
      target: "all",
      sourceText: _.trim(),
    });
    return " ";
  });

  const elementalDenialRegex =
    /Target Creature loses X Elemental Types of your choice/gi;
  working = working.replace(elementalDenialRegex, (_) => {
    effects.push({
      kind: "removeChosenElementFromCreature",
      amount: "all",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const elementalElegyRegex =
    /Target Creature loses an Elemental Type of your choice\.\s*If that Creature has no Elemental Types,\s*it cannot move instead/gi;
  working = working.replace(elementalElegyRegex, (_) => {
    effects.push({
      kind: "removeChosenElementFromCreature",
      amount: 1,
      cannotMoveIfNoElements: true,
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const hymnOfElementsRegex =
    /(Another\s+)?Target Creature gains an Elemental Type of your choice/gi;
  working = working.replace(hymnOfElementsRegex, (_, anotherWord) => {
    effects.push({
      kind: "targetCreatureGainChosenElement",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
        ...(String(anotherWord || "").trim() ? { distinctFromPrevious: true } : {}),
      },
    });
    return " ";
  });

  const melodyOfMeekRegex =
    /If target Creature with\s+(\d+)\s+or less Scanned Energy would take greater than\s+(\d+)\s+damage from a single source,\s*it takes\s+(\d+)\s+damage instead/gi;
  working = working.replace(melodyOfMeekRegex, (_, threshold, capFrom, capTo) => {
    effects.push({
      kind: "incomingDamageCapIfLowScannedEnergy",
      threshold: Number(threshold || 0),
      triggerAbove: Number(capFrom || 0),
      cap: Number(capTo || capFrom || 0),
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const fightersFanfareRegex =
    /Damage dealt by the next attack that resolves this turn is dealt to target engaged Creature instead/gi;
  working = working.replace(fightersFanfareRegex, (_) => {
    effects.push({
      kind: "redirectNextAttackDamageToTargetCreature",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const songOfEncompassingRegex =
    /Creatures you control gain the Creature Type\s+([A-Za-z'\-\s]+)\s+in addition to their other types/gi;
  working = working.replace(songOfEncompassingRegex, (_, typeWord) => {
    effects.push({
      kind: "grantCreatureTypeToControlledCreatures",
      creatureType: normalizeCreatureTypeKey(typeWord),
      sourceText: _.trim(),
    });
    return " ";
  });

  const songOfMandiblorRegex =
    /Target Creature gains\s+(\d+)\s+Courage,\s*Power,\s*Wisdom,\s*and\s*Speed for each Danian Creature in play/gi;
  working = working.replace(songOfMandiblorRegex, (_, amount) => {
    effects.push({
      kind: "statPerTribeCreatureCount",
      tribes: ["danian"],
      stats: ["courage", "power", "wisdom", "speed"],
      amountPerCreature: Number(amount || 0),
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const strainOfClarityRegex =
    /Choose one:\s*Shuffle target Mirage Location into its controller'?s Location Deck\.\s*If the active Location is a Mirage,\s*shuffle it into its controller'?s Location deck and that player reveals a new active Location/gi;
  working = working.replace(strainOfClarityRegex, (_) => {
    effects.push({
      kind: "realityFieldMirageControl",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "revealNewLocation",
      sourceText: _.trim(),
    });
    return " ";
  });

  const strainExpensiveDelusionsRegex =
    /Destroy all Battlegear equipped to Creatures in the same space as target Mirage Location\.\s*Shuffle it into its controller'?s Location Deck/gi;
  working = working.replace(strainExpensiveDelusionsRegex, (_) => {
    effects.push({
      kind: "destroyBattlegear",
      target: "engagedAll",
      sourceText: _.trim(),
    });
    effects.push({
      kind: "realityFieldMirageControl",
      sourceText: _.trim(),
    });
    return " ";
  });

  const shuffleTargetAttackOrLocationDeckRegex = /Shuffle target player's Attack Deck or Location Deck/gi;
  working = working.replace(shuffleTargetAttackOrLocationDeckRegex, (_) => {
    effects.push({
      kind: "shuffleTargetPlayerDeckChoice",
      target: "opponent",
      sourceText: _.trim(),
      targetSpec: {
        type: "player",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const cannotMoveRegex = /Target Creature cannot move/gi;
  working = working.replace(cannotMoveRegex, (_) => {
    effects.push({
      kind: "cannotMove",
      sourceText: _.trim(),
      targetSpec: {
        type: "creature",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const discardMugicEachPlayerRegex = /When this becomes the active Location,\s*each player discards a Mugic Card/gi;
  working = working.replace(discardMugicEachPlayerRegex, (_) => {
    effects.push({
      kind: "discardMugicFromEachPlayer",
      sourceText: _.trim(),
      timing: "location_step",
    });
    return " ";
  });

  const uninfectAllCreaturesRegex = /When this becomes the active Location,\s*Uninfect all Creatures/gi;
  working = working.replace(uninfectAllCreaturesRegex, (_) => {
    effects.push({
      kind: "uninfectAllCreatures",
      sourceText: _.trim(),
    });
    return " ";
  });

  const exileTargetGeneralDiscardPileRegex = /Target player removes all cards in their general discard pile from the game/gi;
  working = working.replace(exileTargetGeneralDiscardPileRegex, (_) => {
    effects.push({
      kind: "exileGeneralDiscardCards",
      target: "opponent",
      amount: "all",
      sourceText: _.trim(),
      targetSpec: {
        type: "player",
        required: true,
        scope: "all",
      },
    });
    return " ";
  });

  const exileUpToCardsFromGeneralDiscardRegex = /Remove up to\s+(\w+)\s+target cards in one general discard pile from the game/gi;
  working = working.replace(exileUpToCardsFromGeneralDiscardRegex, (_, countWord) => {
    effects.push({
      kind: "exileGeneralDiscardCards",
      target: "all",
      amount: parseCountWord(countWord, 1),
      sourceText: _.trim(),
    });
    return " ";
  });

  const swapTwoTargetUnengagedMipedianSpacesRegex =
    /Swap the spaces of two target unengaged Mipedian Creatures you control/gi;
  working = working.replace(swapTwoTargetUnengagedMipedianSpacesRegex, (_) => {
    effects.push({
      kind: "boardMove",
      operation: "swap_positions",
      includeEngaged: false,
      target: "self",
      targetSpec: {
        type: "creature",
        required: true,
        scope: "self",
        maxTargets: 2,
      },
      sourceText: _.trim(),
    });
    return " ";
  });

  const simpleStatRegex =
    /(?:^|\s)(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?|Fire|Air|Earth|Water)\s+(\d+)(?=[\s.,;:]|$)/gi;
  working.replace(simpleStatRegex, (_, statWord, amount) => {
    const stat = normalizeStatWord(statWord);
    if (stat) {
      effects.push({
        kind: stat === "fire" || stat === "air" || stat === "earth" || stat === "water" ? "elementModifier" : "statModifier",
        stat,
        amount: Number(amount),
        sourceText: `${String(statWord).trim()} ${String(amount).trim()}`,
      });
    }
    return _;
  });

  const signedElementRegex = /(?:^|\s)(Fire|Air|Earth|Water)\s*([+-]\d+)(?=[\s.,;:]|$)/gi;
  working.replace(signedElementRegex, (_, statWord, signedAmount) => {
    effects.push({
      kind: "elementModifier",
      stat: normalizeStatWord(statWord),
      amount: Number(signedAmount),
      sourceText: `${String(statWord).trim()} ${String(signedAmount).trim()}`,
    });
    return _;
  });

  const abilityHasTargetCreature = /\btarget\b[^.]*\bcreature\b/i.test(clean);
  const abilityHasTargetPlayer = /\btarget\b[^.]*\bplayer\b/i.test(clean) || /\btarget player's\b/i.test(clean);
  const abilityHasTargetAttack = /\btarget\b[^.]*\battack\b/i.test(clean);
  const abilityHasTargetMugic = /\btarget\b[^.]*\bmugic\b/i.test(clean);
  const abilityHasTargetBattlegear = /\btarget\b[^.]*\bbattlegear\b/i.test(clean);
  const abilityHasTargetCreatureDiscard =
    /\btarget\b[^.]*\bcreature card\b[^.]*\bgeneral discard pile\b/i.test(clean);
  const targetByKindFallback = new Map([
    ["mugicCounterModifier", "creature"],
    ["disciplineChoiceModifier", "creature"],
    ["setDisciplinesToScanned", "creature"],
    ["beginCombatGainElementsFromAllies", "creature"],
    ["incomingDamageReduction", "creature"],
    ["elementproof", "creature"],
    ["relocateEffect", "creature"],
    ["scryDeck", "player"],
    ["negateMugicOrAbilityTargeting", "mugic"],
    ["negateMugic", "mugic"],
    ["disableTribalMugic", "mugic"],
    ["targetAttackDamageModify", "attack"],
    ["targetAttackDamageSet", "attack"],
    ["targetCreatureCountsAsChosenTribe", "creature"],
    ["targetAttackLoseAllAbilities", "attack"],
    ["infectTargetCreature", "creature"],
    ["removeChosenElementFromCreature", "creature"],
    ["targetCreatureGainChosenElement", "creature"],
    ["incomingDamageCapIfLowScannedEnergy", "creature"],
    ["cannotMove", "creature"],
    ["suppressTargetCreatureAbilities", "creature"],
    ["shuffleTargetPlayerDeckChoice", "player"],
    ["exileGeneralDiscardCards", "player"],
  ]);
  return effects.map((effect) => {
    let targetSpec = inferTargetSpecForEffect(effect);
    const choiceSpec = inferChoiceSpecForEffect(effect);
    if (!targetSpec && abilityHasTargetCreature) {
      const targetFriendlyKinds = new Set([
        "keyword",
        "invisibilityStrike",
        "invisibilitySurprise",
        "invisibilityDisarm",
        "intimidate",
        "outperform",
        "statModifier",
        "elementModifier",
        "removeElement",
        "gainElement",
        "dealDamage",
        "healDamage",
        "preventDamage",
      ]);
      if (targetFriendlyKinds.has(String(effect?.kind || ""))) {
        targetSpec = {
          type: "creature",
          required: true,
          scope: inferTargetScopeFromSourceText(effect?.sourceText, effect.target || "self"),
        };
      }
    }
    if (!targetSpec) {
      const fallbackType = targetByKindFallback.get(String(effect?.kind || ""));
      if (fallbackType) {
        targetSpec = {
          type: fallbackType,
          required: true,
          scope: inferTargetScopeFromSourceText(effect?.sourceText, effect.target || "all"),
        };
      }
    }
    if (!targetSpec && abilityHasTargetPlayer && String(effect?.kind || "") === "scryDeck") {
      targetSpec = {
        type: "player",
        required: true,
        scope: "all",
      };
    }
    if (!targetSpec && abilityHasTargetAttack && /attack/i.test(String(effect?.kind || ""))) {
      targetSpec = {
        type: "attack",
        required: true,
        scope: "all",
      };
    }
    if (!targetSpec && abilityHasTargetMugic && /mugic|negate/i.test(String(effect?.kind || ""))) {
      targetSpec = {
        type: "mugic",
        required: true,
        scope: "all",
      };
    }
    if (!targetSpec && abilityHasTargetBattlegear && /battlegear|gear/i.test(String(effect?.kind || ""))) {
      targetSpec = {
        type: "battlegear",
        required: true,
        scope: "all",
      };
    }
    if (!targetSpec && abilityHasTargetCreatureDiscard) {
      targetSpec = {
        type: "creature_discard",
        required: true,
        scope: "self",
      };
    }
    const output = { ...effect };
    if (targetSpec) {
      output.targetSpec = targetSpec;
    }
    if (choiceSpec) {
      output.choiceSpec = choiceSpec;
    }
    return output;
  });
}

function applyStatEffects(baseStats, effects) {
  const output = { ...baseStats };
  for (const key of [...DISCIPLINE_KEYS, ...ELEMENT_KEYS]) {
    if (!Number.isFinite(output[key])) {
      output[key] = 0;
    }
  }

  for (const effect of effects || []) {
    if (effect.kind !== "statModifier" && effect.kind !== "elementModifier") {
      continue;
    }
    if (!effect.stat || !Number.isFinite(effect.amount)) {
      continue;
    }
    output[effect.stat] = (output[effect.stat] || 0) + effect.amount;
  }

  return output;
}

module.exports = {
  DISCIPLINE_KEYS,
  ELEMENT_KEYS,
  sanitizeAbilityText,
  parseAbilityEffects,
  applyStatEffects,
};
