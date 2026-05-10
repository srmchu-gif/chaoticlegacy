export const STAT_KEYS = ["courage", "power", "wisdom", "speed", "energy", "mugicability", "fire", "air", "earth", "water"];
export const ELEMENT_KEYS = ["fire", "air", "earth", "water"];
const SUPPORT_STAT_KEYS = ["courage", "power", "wisdom", "speed", "energy", "mugicability"];

function asNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseStatWord(word) {
  const normalized = String(word || "").toLowerCase().trim();
  if (normalized === "mugic ability" || normalized === "mugicability" || normalized === "mugic") {
    return "mugicability";
  }
  return SUPPORT_STAT_KEYS.includes(normalized) ? normalized : null;
}

function createZeroStatMap() {
  return Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardAbilityText(card) {
  return String(card?.ability || "").trim();
}

function shouldRevealBattlegearAtBeginning(gearCard) {
  const text = cardAbilityText(gearCard).toLowerCase();
  return text.includes("reveal at beginning of game");
}

function isPassiveEffect(effect) {
  const text = String(effect?.sourceText || "").trim();
  if (!text) {
    return false;
  }
  if (/^Support:/i.test(text) || /^Intimidate:/i.test(text) || /^Outperform/i.test(text)) {
    return false;
  }
  if (/has an additional/i.test(text)) {
    return true;
  }
  if (/^(Courage|Power|Wisdom|Speed|Energy|Mugic(?: Ability|ability)?|Fire|Air|Earth|Water)\s+-?\d+$/i.test(text)) {
    return true;
  }
  return false;
}

function findPassiveStatMods(card) {
  const mods = createZeroStatMap();
  (card?.parsedEffects || []).forEach((effect) => {
    if (!effect || !effect.stat || !Number.isFinite(effect.amount)) {
      return;
    }
    if (effect.kind === "statModifier" || effect.kind === "elementModifier") {
      if (!isPassiveEffect(effect)) {
        return;
      }
      mods[effect.stat] = (mods[effect.stat] || 0) + effect.amount;
    }
  });
  return mods;
}

function sumKeywordAmount(cardList, regex) {
  let total = 0;
  cardList.forEach((card) => {
    const text = cardAbilityText(card);
    let match = regex.exec(text);
    while (match) {
      total += asNumber(match[1], 0);
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  });
  return total;
}

function collectIntimidate(cardList) {
  const output = [];
  const regex = /Intimidate:\s*(Courage|Power|Wisdom|Speed)\s*(\d+)/gi;
  cardList.forEach((card) => {
    const text = cardAbilityText(card);
    let match = regex.exec(text);
    while (match) {
      const stat = parseStatWord(match[1]);
      if (stat) {
        output.push({ stat, amount: asNumber(match[2], 0) });
      }
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  });
  return output;
}

function collectSupport(cardList) {
  const output = [];
  const regex = /Support:\s*(All Disciplines|Courage|Power|Wisdom|Speed|Energy|Mugic(?: Ability|ability)?)\s*(\d+)/gi;
  cardList.forEach((card) => {
    const text = cardAbilityText(card);
    let match = regex.exec(text);
    while (match) {
      const amount = asNumber(match[2], 0);
      const statWord = String(match[1] || "").toLowerCase().trim();
      if (statWord === "all disciplines") {
        ["courage", "power", "wisdom", "speed"].forEach((stat) => output.push({ stat, amount }));
      } else {
        const stat = parseStatWord(match[1]);
        if (stat) {
          output.push({ stat, amount });
        }
      }
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  });
  return output;
}

function hasKeyword(cardList, regex) {
  return cardList.some((card) => regex.test(cardAbilityText(card)));
}

function collectParsedEffects(cardList) {
  return cardList.flatMap((card) => card?.parsedEffects || []);
}

function sumParsedKeywordAmount(cardList, keyword, kind = "keyword") {
  return collectParsedEffects(cardList)
    .filter((effect) => effect.kind === kind && String(effect.keyword || "").toLowerCase() === String(keyword).toLowerCase())
    .reduce((total, effect) => total + asNumber(effect.amount, 0), 0);
}

function hasParsedEffect(cardList, kind) {
  return collectParsedEffects(cardList).some((effect) => effect.kind === kind);
}

function hasParsedKeyword(cardList, keyword) {
  const target = String(keyword || "").toLowerCase();
  return collectParsedEffects(cardList).some(
    (effect) => effect.kind === "keyword" && String(effect.keyword || "").toLowerCase() === target
  );
}

function createCreatureUnit(card, gearCard, slot) {
  const initialGearFaceUp = Boolean(gearCard) && shouldRevealBattlegearAtBeginning(gearCard);
  const statics = [card, initialGearFaceUp ? gearCard : null].filter(Boolean);
  const passiveA = findPassiveStatMods(card);
  const passiveB = initialGearFaceUp ? findPassiveStatMods(gearCard) : createZeroStatMap();
  const passiveMods = createZeroStatMap();
  STAT_KEYS.forEach((key) => {
    passiveMods[key] = (passiveA[key] || 0) + (passiveB[key] || 0);
  });
  const strike = sumParsedKeywordAmount(statics, "strike") + sumKeywordAmount(statics, /(?:^|[\s.:])Strike\s+(\d+)/gi);
  const recklessness =
    sumParsedKeywordAmount(statics, "recklessness") + sumKeywordAmount(statics, /(?:^|[\s.:])Recklessness\s+(\d+)/gi);
  const swift = sumParsedKeywordAmount(statics, "swift") + sumKeywordAmount(statics, /(?:^|[\s.:])Swift\s+(\d+)/gi);
  const parsedEffects = collectParsedEffects(statics);
  const invisibilityStrike = parsedEffects
    .filter((effect) => effect.kind === "invisibilityStrike")
    .reduce((total, effect) => total + asNumber(effect.amount, 0), 0);
  const invisibilitySurprise = hasParsedEffect(statics, "invisibilitySurprise");
  const plainSurprise = hasKeyword(statics, /\bSurprise\b/i) || hasParsedKeyword(statics, "surprise");

  return {
    slot,
    card,
    gearCard,
    gearState: gearCard ? (initialGearFaceUp ? "face_up" : "face_down") : null,
    creaturePassiveMods: passiveA,
    gearPassiveMods: passiveB,
    passiveMods,
    tempMods: createZeroStatMap(),
    tempEffects: [],
    statuses: {
      strike,
      recklessness,
      swift,
      surprise: invisibilitySurprise || plainSurprise,
      plainSurprise,
      invisibilitySurprise,
      invisibility: hasKeyword(statics, /\bInvisibility\b/i) || hasParsedEffect(statics, "invisibilityStrike") || hasParsedEffect(statics, "invisibilityDisarm"),
      invisibilityStrike,
      disarm: hasParsedEffect(statics, "invisibilityDisarm"),
      defender: hasKeyword(statics, /\bDefender\b/i) || hasParsedKeyword(statics, "defender"),
      range: hasKeyword(statics, /\bRange\b/i) || hasParsedKeyword(statics, "range"),
      untargetable: hasKeyword(statics, /\bUntargetable\b/i) || hasParsedKeyword(statics, "untargetable"),
      fluidmorph: hasKeyword(statics, /\bFluidmorph\b/i) || hasParsedKeyword(statics, "fluidmorph"),
      intimidate: collectIntimidate(statics),
      support: collectSupport(statics),
    },
    currentEnergy: Math.max(1, asNumber(card?.stats?.energy, 0) + passiveMods.energy),
    mugicCounters: Math.max(0, asNumber(card?.stats?.mugicability, 0) + passiveMods.mugicability),
    namedCounters: {},
    defeated: false,
    combat: {
      attacksMade: 0,
      attacksReceived: 0,
      activatedAbilityUsed: false,
      nextAttackBonus: 0,
    },
    movedThisAction: false,
    defeatRecorded: false,
  };
}

function buildBattlePlayer(cards, label, options = {}) {
  const creatureSlots = Number.isFinite(Number(options.creatureSlots)) ? Number(options.creatureSlots) : 6;
  const mugicSlots = Number.isFinite(Number(options.mugicSlots)) ? Number(options.mugicSlots) : 6;
  if (!Array.isArray(cards.creatures) || cards.creatures.length < creatureSlots) {
    throw new Error(`${label} precisa de pelo menos ${creatureSlots} creatures.`);
  }
  if (!Array.isArray(cards.attacks) || cards.attacks.length < 6) {
    throw new Error(`${label} precisa de pelo menos 6 attacks.`);
  }
  const creatures = cards.creatures.slice(0, creatureSlots);
  const gears = Array.isArray(cards.battlegear) ? cards.battlegear : [];
  const mugics = Array.isArray(cards.mugic) ? cards.mugic.slice(0, mugicSlots) : [];
  return {
    label,
    creatures: creatures.map((card, slot) => createCreatureUnit(card, gears[slot] || null, slot)),
    attackDeck: shuffle(cards.attacks),
    attackHand: [],
    attackDiscard: [],
    mugicDeck: [],
    mugicHand: [],
    mugicSlots: mugics.map((card, index) => ({
      id: `mugic-slot:${index}:${card?.id || card?.name || "mugic"}`,
      slotIndex: index,
      card,
      available: true,
      queued: false,
      spent: false,
      disabledByEffect: false,
    })),
    mugicDiscard: [],
    locationDeck: shuffle(cards.locations || []),
    locationDiscard: [],
    creatureDiscard: [],
    battlegearDiscard: [],
  };
}

export function createBoardState(playerCardsA, playerCardsB, options = {}) {
  const playerA = buildBattlePlayer(playerCardsA, "Jogador 1", options);
  const playerB = buildBattlePlayer(playerCardsB, "Jogador 2", options);
  return {
    activePlayerIndex: 0,
    turn: 1,
    players: [playerA, playerB],
    locationCard: null,
    locationOwnerIndex: null,
    engagement: {
      attackerSlot: null,
      defenderSlot: null,
    },
    initiativeWinner: 0,
    pendingAttacks: { 0: null, 1: null },
    revealedAttacks: { 0: null, 1: null },
    exchange: null,
    combat: {
      active: false,
      startResolved: false,
      exchangeCount: 0,
      hiveActive: false,
      hiveExpiresTurn: null,
      lastResolvedAttackDamage: 0,
      lastResolvedAttackName: null,
      lastResolvedAttackPlayer: null,
    },
    action: {
      movedThisTurn: false,
      selectedMoverSlot: null,
    },
    // Visual state — no game logic, only presentation
    visual: {
      slotRotations: {
        0: Array.from({ length: 6 }, () => (Math.random() - 0.5) * 5),
        1: Array.from({ length: 6 }, () => (Math.random() - 0.5) * 5),
      },
      slotOffsets: {
        0: Array.from({ length: 6 }, () => ({ dx: (Math.random() - 0.5) * 4, dy: (Math.random() - 0.5) * 3 })),
        1: Array.from({ length: 6 }, () => ({ dx: (Math.random() - 0.5) * 4, dy: (Math.random() - 0.5) * 3 })),
      },
      attacksRevealed: false,
    },
  };
}

export function getAliveSlots(player) {
  return player.creatures.filter((unit) => !unit.defeated).map((unit) => unit.slot);
}

export function drawCards(player, deckKey, discardKey, handKey, amount) {
  for (let i = 0; i < amount; i += 1) {
    if (!player[deckKey].length && player[discardKey].length) {
      player[deckKey] = shuffle(player[discardKey]);
      player[discardKey] = [];
    }
    if (!player[deckKey].length) {
      return;
    }
    player[handKey].push(player[deckKey].pop());
  }
}

export function unitMaxEnergy(unit) {
  return Math.max(1, asNumber(unit?.card?.stats?.energy, 0) + asNumber(unit?.passiveMods?.energy, 0) + asNumber(unit?.tempMods?.energy, 0));
}

export function createTempStatMap() {
  return createZeroStatMap();
}
