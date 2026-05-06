/**
 * Effect Interpreter — Browser-side
 *
 * Reads card descriptions, identifies keywords, and converts text into
 * playable game effects. Accepts new cards automatically without manual code.
 *
 * This module mirrors lib/effect-parser.js patterns but operates client-side
 * and adds an execution layer that integrates with the Battle Engine.
 */

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

function normalizeStatWord(word) {
  const key = String(word || "").toLowerCase().trim();
  return STAT_WORD_MAP[key] || null;
}

function sanitize(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/[""\"]/g, " ")
    .replace(/\{\{MC\}\}/gi, "MC")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim();
}

function parseElementList(fragment) {
  const normalized = String(fragment || "").toLowerCase();
  const picked = ELEMENT_KEYS.filter((e) => normalized.includes(e));
  if (picked.length > 0) return picked;
  if (normalized.includes("all") || normalized.includes("element")) return [...ELEMENT_KEYS];
  return [];
}

/* ─────────────────── PATTERN REGISTRY ─────────────────── */

const PATTERNS = [];

function register(regex, handler) {
  PATTERNS.push({ regex, handler });
}

// Keywords with amount
register(/\bSwift\s+(\d+)\b/gi, (m) => ({ kind: "keyword", keyword: "swift", amount: Number(m[1]), sourceText: m[0].trim() }));
register(/(?<!Invisibility:\s)\bStrike\s+(\d+)\b/gi, (m) => ({ kind: "keyword", keyword: "strike", amount: Number(m[1]), sourceText: m[0].trim() }));
register(/\bRecklessness\s+(\d+)\b/gi, (m) => ({ kind: "keyword", keyword: "recklessness", amount: Number(m[1]), sourceText: m[0].trim() }));

// Outperform
register(/Outperform\s+(Courage|Power|Wisdom|Speed)\s+(\d+)/gi, (m) => ({
  kind: "outperform", stat: normalizeStatWord(m[1]), amount: Number(m[2]), sourceText: m[0].trim(),
}));

// Invisibility variants
register(/Invisibility:\s*Strike\s+(\d+)/gi, (m) => ({ kind: "invisibilityStrike", amount: Number(m[1]), sourceText: m[0].trim() }));
register(/Invisibility:\s*Surprise/gi, (m) => ({ kind: "invisibilitySurprise", sourceText: m[0].trim() }));
register(/Invisibility:\s*Disarm/gi, (m) => ({ kind: "invisibilityDisarm", sourceText: m[0].trim() }));

// Flag keywords
register(/\b(Defender|Range|Untargetable|Fluidmorph|Surprise)\b/gi, (m) => ({
  kind: "keyword", keyword: m[1].toLowerCase(), sourceText: m[0].trim(),
}));

// Hive
register(/\bActivate Hive\b/gi, (m) => ({ kind: "activateHive", sourceText: m[0].trim() }));
register(/Hive:\s*([A-Za-z]+(?:proof)?(?:\s+\d+)?)/gi, (m) => ({
  kind: "hiveGranted", body: m[1].trim(), sourceText: m[0].trim(),
}));

// Challenge / Stat Check / Stat Fail → conditional damage
register(/Challenge\s+(Courage|Power|Wisdom|Speed)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi, (m) => ({
  kind: "conditionalDamage", mode: "challenge", comparator: "diffGte",
  stat: normalizeStatWord(m[1]), threshold: Number(m[2]), amount: Number(m[3]), sourceText: m[0].trim(),
}));
register(/Stat Check\s+(Courage|Power|Wisdom|Speed)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi, (m) => ({
  kind: "conditionalDamage", mode: "stat_check", comparator: "selfGte",
  stat: normalizeStatWord(m[1]), threshold: Number(m[2]), amount: Number(m[3]), sourceText: m[0].trim(),
}));
register(/Stat Fail\s+(Courage|Power|Wisdom|Speed)\s+(\d+)\s*:\s*Deal\s+(\d+)\s+damage/gi, (m) => ({
  kind: "conditionalDamage", mode: "stat_fail", comparator: "selfLte",
  stat: normalizeStatWord(m[1]), threshold: Number(m[2]), amount: Number(m[3]), sourceText: m[0].trim(),
}));

// Attack damage modifiers
register(/([a-zA-Z/\s]+?)\s+attacks?\s+deal(?:s)?\s+an?\s+additional\s+(\d+)\s+damage/gi, (m) => ({
  kind: "attackDamageModifier", modifier: "add", amount: Number(m[2]),
  elements: parseElementList(m[1]), sourceText: m[0].trim(),
}));
register(/Damage dealt by\s+([a-zA-Z/\s]+?)\s+attacks?\s+is reduced by\s+(\d+)/gi, (m) => ({
  kind: "attackDamageModifier", modifier: "reduce", amount: Number(m[2]),
  elements: parseElementList(m[1]), sourceText: m[0].trim(),
}));

// Begin combat effects
register(/At the beginning of combat[^.]*?gains?\s+(\d+)\s+Energy/gi, (m) => ({
  kind: "beginCombatEnergy", amount: Number(m[1]), sourceText: m[0].trim(),
}));
register(/At the beginning of combat[^.]*?deal\s+(\d+)\s+damage\s+to\s+engaged\s+Creatures?/gi, (m) => ({
  kind: "beginCombatDamage", amount: Number(m[1]), sourceText: m[0].trim(),
}));
register(/At the beginning of combat,\s*if an engaged Creature has higher\s+(Courage|Power|Wisdom|Speed)\s+than the opposing engaged Creature,\s*put a Mugic counter on it/gi, (m) => ({
  kind: "beginCombatMugicCounterHigherStat", stat: normalizeStatWord(m[1]), amount: 1, sourceText: m[0].trim(),
}));

// First attack zero
register(/If an engaged Creature has lower\s+(Courage|Power|Wisdom|Speed)\s+than the opposing engaged Creature,\s*it deals 0 damage on its first attack each combat/gi, (m) => ({
  kind: "firstAttackZeroIfLower", stat: normalizeStatWord(m[1]), sourceText: m[0].trim(),
}));

// Disable mugic
register(/Mugic and activated abilities cannot be played/gi, (m) => ({
  kind: "disableMugicAndActivated", sourceText: m[0].trim(),
}));

// Location remove elements
register(/When this becomes the active Location,\s*Creatures lose all Elemental Types/gi, (m) => ({
  kind: "locationEnterRemoveAllElements", sourceText: m[0].trim(),
}));

// Element conditional stat modifiers
register(/(Fire|Air|Earth|Water):\s*Opposing engaged Creature loses\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi, (m) => ({
  kind: "conditionalStatModifier", target: "opponent", stat: normalizeStatWord(m[3]),
  amount: -Number(m[2]), requiresElement: m[1].toLowerCase(), sourceText: m[0].trim(),
}));
register(/(Fire|Air|Earth|Water):\s*Opposing Creature loses\s+(\d+)\s+to all Disciplines/gi, (m) => {
  return ["courage", "power", "wisdom", "speed"].map((stat) => ({
    kind: "conditionalStatModifier", target: "opponent", stat,
    amount: -Number(m[2]), requiresElement: m[1].toLowerCase(), sourceText: m[0].trim(),
  }));
});

// Remove element
register(/Your engaged Creature loses\s+(Fire|Air|Earth|Water)/gi, (m) => ({
  kind: "removeElement", target: "self", element: m[1].toLowerCase(), sourceText: m[0].trim(),
}));

// Infect
register(/Infect\s+target\s+Uninfected\s+Creature/gi, (m) => ({
  kind: "infectTargetCreature", sourceText: m[0].trim(),
}));

// Recklessness conditional
register(/If your engaged Creature has Recklessness,\s*deal\s+(\d+)\s+damage/gi, (m) => ({
  kind: "conditionalDealDamageIfStatus", status: "recklessness", amount: Number(m[1]), sourceText: m[0].trim(),
}));

// Elementproof
register(/(Fire|Air|Earth|Water)proof\s+(\d+)/gi, (m) => ({
  kind: "elementproof", element: m[1].toLowerCase(), amount: Number(m[2]), sourceText: m[0].trim(),
}));

// NEW PATTERNS — Sacrifice, Destroy Battlegear, Reveal Location, Return, Gain Element, Prevent
register(/Sacrifice\s+(?:a\s+)?(?:target\s+)?(?:Creature|creature)/gi, (m) => ({
  kind: "sacrificeCreature", sourceText: m[0].trim(),
}));
register(/[Dd]estroy\s+(?:target\s+|an?\s+)?(?:opposing\s+)?Battlegear/gi, (m) => ({
  kind: "destroyBattlegear", target: /opposing/i.test(m[0]) ? "opponent" : "any", sourceText: m[0].trim(),
}));
register(/Reveal a new active Location/gi, (m) => ({
  kind: "revealNewLocation", sourceText: m[0].trim(),
}));
register(/[Rr]eturn\s+(?:a\s+|target\s+)?(\w[\w\s]*?)\s+(?:Card\s+)?from\s+(?:(?:your|their)\s+)?(?:general\s+)?discard\s+pile/gi, (m) => ({
  kind: "returnFromDiscard", cardType: m[1].trim().toLowerCase(), sourceText: m[0].trim(),
}));
register(/[Gg]ain(?:s)?\s+(Fire|Air|Earth|Water)(?:\s*,\s*(Fire|Air|Earth|Water))*(?:\s*(?:,\s*and|and)\s+(Fire|Air|Earth|Water))*/gi, (m) => {
  const matched = m[0].match(/\b(Fire|Air|Earth|Water)\b/gi) || [];
  return { kind: "gainElement", elements: [...new Set(matched.map((e) => e.toLowerCase()))], sourceText: m[0].trim() };
});
register(/[Pp]revent\s+(?:the\s+next\s+)?(\d+)\s+damage/gi, (m) => ({
  kind: "preventDamage", amount: Number(m[1]), sourceText: m[0].trim(),
}));

// Direct damage / heal
register(/Deal\s+(\d+)\s+damage/gi, (m) => ({ kind: "dealDamage", amount: Number(m[1]), sourceText: m[0].trim() }));
register(/Heal\s+(\d+)\s+damage/gi, (m) => ({ kind: "healDamage", amount: Number(m[1]), sourceText: m[0].trim() }));

// Stat modifiers
register(/Gain\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi, (m) => ({
  kind: "statModifier", stat: normalizeStatWord(m[2]), amount: Number(m[1]), sourceText: m[0].trim(),
}));
register(/Lose\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi, (m) => ({
  kind: "statModifier", stat: normalizeStatWord(m[2]), amount: -Number(m[1]), sourceText: m[0].trim(),
}));
register(/has an additional\s+(\d+)\s+(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)/gi, (m) => ({
  kind: "statModifier", stat: normalizeStatWord(m[2]), amount: Number(m[1]), sourceText: m[0].trim(),
}));

// Support / Intimidate
register(/Support:\s*(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)\s+(\d+)/gi, (m) => ({
  kind: "statModifier", stat: normalizeStatWord(m[1]), amount: Number(m[2]), sourceText: m[0].trim(),
}));
register(/Support:\s*all Disciplines\s+(\d+)/gi, (m) => {
  return ["courage", "power", "wisdom", "speed"].map((stat) => ({
    kind: "statModifier", stat, amount: Number(m[1]), sourceText: m[0].trim(),
  }));
});
register(/Intimidate:\s*(Courage|Power|Wisdom|Speed|Energy)\s+(\d+)/gi, (m) => ({
  kind: "intimidate", stat: normalizeStatWord(m[1]), amount: Number(m[2]), sourceText: m[0].trim(),
}));


/* ─────────────────── INTERPRET CARD ─────────────────── */

/**
 * Interprets a card's ability text and returns an array of structured effects.
 * Works for ANY card type (creature, attack, mugic, battlegear, location).
 * Accepts new cards automatically — no manual coding required.
 */
export function interpretCard(card) {
  if (!card) return [];

  // If card already has parsed effects from server, reuse them
  if (Array.isArray(card.parsedEffects) && card.parsedEffects.length > 0) {
    return card.parsedEffects;
  }

  const text = sanitize(card.ability || "");
  if (!text) return [];

  const effects = [];
  let working = text;

  for (const { regex, handler } of PATTERNS) {
    regex.lastIndex = 0;
    working = working.replace(regex, (...args) => {
      const result = handler(args);
      if (Array.isArray(result)) {
        effects.push(...result);
      } else if (result) {
        effects.push(result);
      }
      return " ";
    });
  }

  return effects;
}


/* ─────────────────── EXECUTE EFFECT ─────────────────── */

/**
 * Executes a single parsed effect within a battle context.
 * @param {object} effect - The parsed effect from interpretCard()
 * @param {object} ctx - Execution context { board, exchange, sourcePlayerIndex, log }
 */
export function executeEffect(effect, ctx) {
  if (!effect || !ctx) return;

  const { board, exchange, sourcePlayerIndex, log } = ctx;
  const targetIndex = sourcePlayerIndex === 0 ? 1 : 0;

  switch (effect.kind) {
    case "dealDamage":
      if (exchange) exchange.damageToCreature[targetIndex] += effect.amount;
      log?.push(`Efeito: Deal ${effect.amount} damage.`);
      break;

    case "healDamage":
      if (exchange) exchange.healToCreature[sourcePlayerIndex] += effect.amount;
      log?.push(`Efeito: Heal ${effect.amount} damage.`);
      break;

    case "statModifier":
    case "elementModifier":
      if (exchange && effect.stat) {
        const target = effect.amount < 0 ? targetIndex : sourcePlayerIndex;
        exchange.statAdjustments[target][effect.stat] += effect.amount;
      }
      break;

    case "attackDamageModifier":
      if (exchange) {
        if (effect.modifier === "add") exchange.attackDamageAdd[sourcePlayerIndex] += effect.amount;
        if (effect.modifier === "reduce") exchange.attackDamageReduce[targetIndex] += effect.amount;
      }
      break;

    case "destroyBattlegear": {
      const targetPlayerIdx = effect.target === "opponent" ? targetIndex : sourcePlayerIndex;
      const slot = board?.engagement?.[targetPlayerIdx === board.activePlayerIndex ? "attackerSlot" : "defenderSlot"];
      if (slot !== null && slot !== undefined) {
        const unit = board.players[targetPlayerIdx]?.creatures?.[slot];
        if (unit?.gearCard) {
          log?.push(`Battlegear ${unit.gearCard.name} destruído!`);
          unit.gearCard = null;
        }
      }
      break;
    }

    case "revealNewLocation":
      // Handled by engine — swap active location
      log?.push("Nova Location revelada!");
      break;

    case "gainElement":
      if (exchange && effect.elements) {
        effect.elements.forEach((el) => {
          exchange.statAdjustments[sourcePlayerIndex][el] += 1;
        });
      }
      break;

    case "preventDamage":
      if (exchange) {
        exchange.healToCreature[sourcePlayerIndex] += effect.amount;
      }
      break;

    case "sacrificeCreature":
      log?.push("Criatura sacrificada!");
      break;

    case "activateHive":
      if (board?.combat) board.combat.hiveActive = true;
      break;

    case "disableMugicAndActivated":
      if (exchange) exchange.disableMugic = true;
      break;

    default:
      // Effect is tracked but not executed (passive/conditional)
      break;
  }
}

/**
 * Batch-executes all effects from a card within a battle context.
 */
export function executeCardEffects(card, ctx) {
  const effects = interpretCard(card);
  effects.forEach((effect) => executeEffect(effect, ctx));
  return effects;
}

export { DISCIPLINE_KEYS, ELEMENT_KEYS, sanitize, normalizeStatWord };
