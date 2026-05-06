import {
  ELEMENT_KEYS,
  clamp,
  createBoardState,
  createTempStatMap,
  drawCards,
  getAliveSlots,
  unitMaxEnergy,
} from "./board-state.js";

const BOARD_ADJACENCY = {
  A: ["B", "C"],
  B: ["A", "C", "D", "E"],
  C: ["A", "B", "E", "F"],
  D: ["B", "E", "G", "H"],
  E: ["B", "C", "D", "F", "G", "H", "I"],
  F: ["C", "E", "H", "I"],
  G: ["D", "E", "H", "J"],
  H: ["D", "E", "F", "G", "I", "J", "K"],
  I: ["E", "F", "H", "K"],
  J: ["G", "H", "K", "L"],
  K: ["H", "I", "J", "L"],
  L: ["J", "K"],
};
const PLAYER_SLOT_LETTERS = {
  0: ["A", "B", "C", "D", "E", "F"],
  1: ["L", "J", "K", "G", "H", "I"],
};
const ONE_VS_ONE_START_LETTERS = {
  0: "E",
  1: "H",
};
const LETTER_TO_PLAYER_SLOT = {
  0: Object.fromEntries(PLAYER_SLOT_LETTERS[0].map((letter, slot) => [letter, slot])),
  1: Object.fromEntries(PLAYER_SLOT_LETTERS[1].map((letter, slot) => [letter, slot])),
};
const ACTIVATABLE_EFFECT_KINDS = new Set([
  "dealDamage",
  "healDamage",
  "statModifier",
  "elementModifier",
  "conditionalStatModifier",
  "removeElement",
  "attackDamageModifier",
  "targetAttackDamageSet",
  "targetAttackDamageModify",
  "targetAttackCountsAsFirst",
  "gainElement",
  "preventDamage",
  "mugicCounterModifier",
  "mugicCounterMirrorRemove",
  "mugicCounterRemoveTotal",
  "mugicCounterRemoveByStatThreshold",
  "preventMugicCounterGain",
  "mugicCounterSet",
  "destroyBattlegear",
  "destroyBattlegearByStatThreshold",
  "flipBattlegearPair",
  "discardNamedAttackForBonus",
  "attackUntargetable",
  "delayedOnDestroyedDrawDiscard",
  "nextAttackThisCombatSetDamage",
  "treatCurrentAttackAsFirst",
  "shuffleAttackDeckWithDiscard",
  "exileGeneralDiscardOnDamage",
  "healBlocked",
  "revealNewLocation",
  "drawDiscardAttack",
  "searchDeckToDiscard",
  "disciplineChoiceModifier",
  "setDisciplinesToScanned",
  "beginCombatGainLowestDiscipline",
  "mugicCostIncrease",
  "mugicDamageModifier",
  "scryDeck",
  "returnFromDiscard",
  "canPlayAnyTribeMugic",
  "canPlaySpecificTribeMugic",
  "playMugicFromGeneralDiscard",
  "mugicPlayedFromDiscardExileOnResolve",
  "nextAttackThisTurnDamageAdd",
  "onTakesAttackDamageGrantAttackBonus",
  "playMugicOnAttackDamage",
  "discardPresenceStatAura",
  "alliedStatModifier",
  "namedCounterOnCombatWin",
  "alliesStatPerNamedCounter",
  "startsFaceUp",
  "sacrificeCreature",
  "cannotGainElementTypes",
  "boardMove",
  "relocateEffect",
  "copyMugic",
  "copyCreatureProfile",
  "infectTargetCreature",
  "uninfectOpposingThenInfectOwn",
  "infectTargetedOpposingUninfectedCreature",
  "nonDanianAttackDamageVsInfected",
  "beginCombatGainElementsFromInfectedCreatures",
  "minionActivatedBlockedByChieftain",
  "targetMinionIgnoreChieftainRestriction",
  "incomingFirstAttackDamageReduction",
  "targetAttackReflectDamage",
  "incomingNextAttackReduction",
  "removeChosenElementFromCreatureWithZeroDiscipline",
  "returnCreatureFromDiscardToBoard",
  "swapBattlegearBetweenControlledCreatures",
  "grantChosenElementValueToRecentDamager",
  "grantRangeAndSwiftFromSourceMugicCounters",
  "redirectNonAttackDamageToSelf",
  "discardAttackReturnByBuildPointsOrDraw",
  "sacrificeFriendlyTribeForHeal",
  "targetDanianGainsExpendedElement",
  "onNextAttackDamageReduceOpposingDisciplinesByDamage",
  "targetCreatureCountsAsChosenTribe",
  "targetAttackLoseAllAbilities",
  "retargetSingleTargetMugic",
]);
const BATTLEGEAR_PHASE_EFFECT_KINDS = new Set([
  "dealDamage",
  "healDamage",
  "attackDamageModifier",
  "elementproof",
  "gainElement",
  "preventDamage",
  "destroyBattlegear",
  "mugicDamageModifier",
  "mugicCostIncrease",
  "mugicCounterModifier",
  "mugicCounterSet",
  "preventMugicCounterGain",
  "healBlocked",
]);
const PASSIVE_EFFECT_KINDS = new Set([
  "attackDamageModifier",
  "mugicDamageModifier",
  "attackDamageVsTribe",
  "dealDamage",
  "healDamage",
  "firstAttackZeroIfLower",
  "beginCombatGainLowestDiscipline",
  "beginCombatLoseEnergyIfLower",
  "beginCombatGainElementsFromAllies",
  "conditionalDealDamageIfStatus",
  "conditionalDealDamageByStatusValue",
  "disciplineChoiceModifier",
  "setDisciplinesToScanned",
  "elementproof",
  "tribeStatModifier",
  "mugicCounterModifier",
  "mugicCounterSet",
  "mugicCounterRemoveByStatThreshold",
  "preventMugicCounterGain",
  "mugicCostIncrease",
  "targetAttackDamageSet",
  "targetAttackDamageModify",
  "targetAttackCountsAsFirst",
  "negateMugic",
  "negateMugicOrAbilityTargeting",
  "disableTribalMugic",
  "suppressOpposingBattlegear",
  "battlegearNoAbilities",
  "battlegearIndestructible",
  "flipBattlegear",
  "destroyBattlegear",
  "destroyBattlegearByStatThreshold",
  "flipBattlegearPair",
  "discardNamedAttackForBonus",
  "attackUntargetable",
  "delayedOnDestroyedDrawDiscard",
  "nextAttackThisCombatSetDamage",
  "treatCurrentAttackAsFirst",
  "shuffleAttackDeckWithDiscard",
  "exileGeneralDiscardOnDamage",
  "healBlocked",
  "destroyCreatureIfStatZero",
  "sacrificeOpponentCreature",
  "activateHive",
  "disableMugicAndActivated",
  "forceOpponentRandomAttack",
  "forceOpponentRandomAttackIfHigherMugic",
  "beginCombatAttackDiscardDraw",
  "beginCombatDamagePerMissingElements",
  "beginCombatDamagePerLowDisciplines",
  "setDisciplinesToOpposingScanned",
  "searchDeckToDiscard",
  "preventHealingIfLowerStat",
  "scryDeck",
  "returnFromDiscard",
  "canPlayAnyTribeMugic",
  "canPlaySpecificTribeMugic",
  "playMugicFromGeneralDiscard",
  "mugicPlayedFromDiscardExileOnResolve",
  "nextAttackThisTurnDamageAdd",
  "onTakesAttackDamageGrantAttackBonus",
  "playMugicOnAttackDamage",
  "discardPresenceStatAura",
  "alliedStatModifier",
  "namedCounterOnCombatWin",
  "alliesStatPerNamedCounter",
  "startsFaceUp",
  "sacrificeCreature",
  "cannotGainElementTypes",
  "boardMove",
  "relocateEffect",
  "copyMugic",
  "copyCreatureProfile",
  "infectTargetCreature",
  "uninfectOpposingThenInfectOwn",
  "infectTargetedOpposingUninfectedCreature",
  "nonDanianAttackDamageVsInfected",
  "beginCombatGainElementsFromInfectedCreatures",
  "minionActivatedBlockedByChieftain",
  "targetMinionIgnoreChieftainRestriction",
  "incomingFirstAttackDamageReduction",
  "replaceAttackDamageWithDisciplineLoss",
  "destroyCreatureIfAllDisciplinesZero",
  "targetAttackReflectDamage",
  "incomingNextAttackReduction",
  "replaceMugicOrAbilityDamageWithEnergyGain",
  "moveAsIfAdjacent",
  "mustEngageIfPossible",
  "replaceMoveIntoOpposingWithRelocate",
  "replaceBecomeEngagedBySwapWithUnderworld",
  "gainInitiativeElementType",
  "engagedVsScoutNoInvisibility",
  "alliedStatModifierByElement",
  "countDiscardCreaturesAsControlledType",
  "mugicCostReduction",
  "grantRangeAndSwiftFromSourceMugicCounters",
  "gainElementWhenAllyLosesElement",
  "countsAsMugicBurst",
  "destroySelfIfPowerAboveThreshold",
  "attackDamageBonusIfSameNameInDiscard",
  "keywordIfControlTribe",
  "beginCombatGainLowestScannedEnergyFromAllies",
  "firstAttackZeroIfHigherCourageAndWisdom",
  "beginCombatStealOpposingEngagedBattlegearIfUnequipped",
]);

const SIMPLE_STATS = ["courage", "power", "wisdom", "speed", "energy", "mugicability"];
const MODIFIABLE_STATS = [...SIMPLE_STATS, ...ELEMENT_KEYS];
const CREATURE_TYPE_TARGET_STOPWORDS = new Set([
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
const RULE_PROFILE_DEFAULT = "official_master";
const RULE_PROFILE_CONFIG = {
  official_master: {
    attackSelection: "sequential",
    burstTiming: "official",
    attackHandSize: 2,
  },
  online: {
    // Prepared for future divergence; intentionally unused in this delivery.
    attackSelection: "simultaneous",
    burstTiming: "online",
    attackHandSize: 3,
  },
};
const CORE_EFFECT_KINDS = new Set([
  "dealDamage",
  "healDamage",
  "statModifier",
  "elementModifier",
  "conditionalStatModifier",
  "removeElement",
  "attackDamageModifier",
  "targetAttackDamageSet",
  "targetAttackDamageModify",
  "targetAttackCountsAsFirst",
  "mugicCounterModifier",
  "mugicCounterMirrorRemove",
  "mugicCounterRemoveTotal",
  "mugicCounterRemoveByStatThreshold",
  "mugicCounterSet",
  "mugicCostIncrease",
  "preventDamage",
  "destroyBattlegear",
  "destroyBattlegearByStatThreshold",
  "healBlocked",
  "gainElement",
  "disciplineChoiceModifier",
  "setDisciplinesToScanned",
  "firstAttackZeroIfLower",
  "forceOpponentRandomAttack",
  "forceOpponentRandomAttackIfHigherMugic",
  "negateMugic",
  "negateMugicOrAbilityTargeting",
  "disableTribalMugic",
  "suppressOpposingBattlegear",
  "battlegearNoAbilities",
  "battlegearIndestructible",
  "flipBattlegear",
  "revealNewLocation",
  "drawDiscardAttack",
  "searchDeckToDiscard",
  "beginCombatGainLowestDiscipline",
  "beginCombatMugicCounterHigherStat",
  "disableMugicAndActivated",
  "conditionalDealDamageByStatusValue",
  "conditionalDealDamageIfStatus",
  "elementproof",
  "beginCombatEnergy",
  "beginCombatDamage",
  "beginCombatAttackDiscardDraw",
  "beginCombatDamagePerMissingElements",
  "beginCombatDamagePerLowDisciplines",
  "setDisciplinesToOpposingScanned",
  "beginCombatLoseEnergyIfLower",
  "beginCombatGainElementsFromAllies",
  "destroyCreatureIfStatZero",
  "sacrificeOpponentCreature",
  "sacrificeCreature",
  "activateHive",
  "preventHealingIfLowerStat",
  "tribeStatModifier",
  "removeInvisibility",
  "scryDeck",
  "returnFromDiscard",
  "canPlayAnyTribeMugic",
  "canPlaySpecificTribeMugic",
  "playMugicFromGeneralDiscard",
  "mugicPlayedFromDiscardExileOnResolve",
  "nextAttackThisTurnDamageAdd",
  "onTakesAttackDamageGrantAttackBonus",
  "playMugicOnAttackDamage",
  "discardPresenceStatAura",
  "alliedStatModifier",
  "namedCounterOnCombatWin",
  "alliesStatPerNamedCounter",
  "startsFaceUp",
  "cannotGainElementTypes",
  "boardMove",
  "relocateEffect",
  "copyMugic",
  "copyCreatureProfile",
  "infectTargetCreature",
  "uninfectOpposingThenInfectOwn",
  "infectTargetedOpposingUninfectedCreature",
  "nonDanianAttackDamageVsInfected",
  "beginCombatGainElementsFromInfectedCreatures",
  "minionActivatedBlockedByChieftain",
  "targetMinionIgnoreChieftainRestriction",
  "incomingFirstAttackDamageReduction",
  "replaceAttackDamageWithDisciplineLoss",
  "destroyCreatureIfAllDisciplinesZero",
  "targetAttackReflectDamage",
  "incomingNextAttackReduction",
  "replaceMugicOrAbilityDamageWithEnergyGain",
  "moveAsIfAdjacent",
  "mustEngageIfPossible",
  "replaceMoveIntoOpposingWithRelocate",
  "replaceBecomeEngagedBySwapWithUnderworld",
  "flipTargetBattlegearOnMugicCounterGain",
  "gainElementsFromIncomingAttack",
  "onGainElementGainElementValue",
  "gainInitiativeElementType",
  "engagedVsScoutNoInvisibility",
  "alliedStatModifierByElement",
  "countDiscardCreaturesAsControlledType",
  "mugicCostReduction",
  "onFirstAttackDamageGainSameEnergyIfControlTribe",
  "onPlayAttackWhileEquippedGainEnergy",
  "onMugicCounterAddedLoseEnergy",
  "onTakeDamageSourceLosesEnergy",
  "grantChosenElementValueToRecentDamager",
  "removeChosenElementFromCreatureWithZeroDiscipline",
  "returnCreatureFromDiscardToBoard",
  "swapBattlegearBetweenControlledCreatures",
  "flipSelfBattlegearFaceUp",
  "gainElementWhenAllyLosesElement",
  "countsAsMugicBurst",
  "redirectNonAttackDamageToSelf",
  "destroySelfIfPowerAboveThreshold",
  "attackDamageBonusIfSameNameInDiscard",
  "discardAttackReturnByBuildPointsOrDraw",
  "sacrificeFriendlyTribeForHeal",
  "targetDanianGainsExpendedElement",
  "onNextAttackDamageReduceOpposingDisciplinesByDamage",
  "keywordIfControlTribe",
  "beginCombatGainLowestScannedEnergyFromAllies",
  "targetCreatureCountsAsChosenTribe",
  "targetAttackLoseAllAbilities",
  "firstAttackZeroIfHigherCourageAndWisdom",
  "beginCombatStealOpposingEngagedBattlegearIfUnequipped",
  "retargetSingleTargetMugic",
]);
const ATTACK_DAMAGE_FORMULA_EFFECT_KINDS = new Set([
  "conditionalDamage",
  "dealDamage",
  "attackDamageSetIfDefenderHasElement",
  "attackDamageCap",
  "attackDamageConditionalModifier",
  "attackDamagePerMugicCounter",
  "attackDamagePerElementType",
  "attackDamagePerSharedElementType",
  "attackDamagePerControlledTribe",
  "attackDamagePerControlledCreatureType",
  "attackDamagePerAttackDiscard",
  "attackDamageSetIfAttackDiscardGt",
  "attackDamageSetIfFewerMugicCards",
  "conditionalStatSet",
  "attackDamageFromLastAttack",
  "attackDamagePerDefenderDisciplineOver",
  "selfDamage",
]);
const ATTACK_TEMP_EFFECT_KINDS = new Set([
  "statModifier",
  "elementModifier",
  "conditionalStatModifier",
  "removeElement",
]);
const ATTACK_STACK_EFFECT_KINDS = new Set([
  "healDamage",
  "gainElement",
  "mugicCounterModifier",
  "mugicCounterMirrorRemove",
  "mugicCounterRemoveTotal",
  "mugicCounterRemoveByStatThreshold",
  "preventMugicCounterGain",
  "mugicCounterSet",
  "mugicCostIncrease",
  "preventDamage",
  "destroyBattlegear",
  "destroyBattlegearByStatThreshold",
  "flipBattlegearPair",
  "discardNamedAttackForBonus",
  "attackUntargetable",
  "delayedOnDestroyedDrawDiscard",
  "nextAttackThisCombatSetDamage",
  "treatCurrentAttackAsFirst",
  "shuffleAttackDeckWithDiscard",
  "exileGeneralDiscardOnDamage",
  "healBlocked",
  "targetAttackDamageSet",
  "targetAttackDamageModify",
  "targetAttackCountsAsFirst",
  "attackDamageModifier",
  "drawDiscardAttack",
  "searchDeckToDiscard",
  "suppressOpposingBattlegear",
  "disableTribalMugic",
  "negateMugic",
  "negateMugicOrAbilityTargeting",
  "activateHive",
  "revealNewLocation",
  "conditionalDealDamageByStatusValue",
  "conditionalDealDamageIfStatus",
  "disciplineChoiceModifier",
  "setDisciplinesToScanned",
  "firstAttackZeroIfLower",
  "forceOpponentRandomAttack",
  "forceOpponentRandomAttackIfHigherMugic",
  "disableMugicAndActivated",
  "flipBattlegear",
  "beginCombatGainLowestDiscipline",
  "scryDeck",
  "returnFromDiscard",
  "canPlayAnyTribeMugic",
  "canPlaySpecificTribeMugic",
  "playMugicFromGeneralDiscard",
  "mugicPlayedFromDiscardExileOnResolve",
  "nextAttackThisTurnDamageAdd",
  "onTakesAttackDamageGrantAttackBonus",
  "playMugicOnAttackDamage",
  "discardPresenceStatAura",
  "alliedStatModifier",
  "namedCounterOnCombatWin",
  "alliesStatPerNamedCounter",
  "startsFaceUp",
  "sacrificeCreature",
  "cannotGainElementTypes",
  "boardMove",
  "relocateEffect",
  "copyMugic",
  "copyCreatureProfile",
]);
const ATTACK_EFFECT_KINDS_SUPPORTED = new Set([
  ...ATTACK_DAMAGE_FORMULA_EFFECT_KINDS,
  ...ATTACK_TEMP_EFFECT_KINDS,
  ...ATTACK_STACK_EFFECT_KINDS,
]);
const EFFECT_RUNTIME_REGISTRY = new Map([
  ["statModifier", { scope: "unit", timing: "burst" }],
  ["elementModifier", { scope: "unit", timing: "burst" }],
  ["conditionalStatModifier", { scope: "unit", timing: "burst" }],
  ["dealDamage", { scope: "engaged", timing: "burst" }],
  ["healDamage", { scope: "engaged", timing: "burst" }],
  ["attackDamageModifier", { scope: "combat", timing: "burst" }],
  ["gainElement", { scope: "unit", timing: "burst" }],
  ["mugicCounterModifier", { scope: "unit", timing: "burst" }],
  ["mugicCounterMirrorRemove", { scope: "unit", timing: "burst" }],
  ["mugicCounterRemoveTotal", { scope: "unit", timing: "burst" }],
  ["mugicCounterRemoveByStatThreshold", { scope: "unit", timing: "burst" }],
  ["preventMugicCounterGain", { scope: "unit", timing: "burst" }],
  ["mugicCounterSet", { scope: "unit", timing: "burst" }],
  ["destroyBattlegear", { scope: "engaged", timing: "burst" }],
  ["destroyBattlegearByStatThreshold", { scope: "engaged", timing: "burst" }],
  ["flipBattlegearPair", { scope: "engaged", timing: "burst" }],
  ["discardNamedAttackForBonus", { scope: "player", timing: "burst" }],
  ["attackUntargetable", { scope: "attack", timing: "burst" }],
  ["delayedOnDestroyedDrawDiscard", { scope: "player", timing: "burst" }],
  ["nextAttackThisCombatSetDamage", { scope: "combat", timing: "burst" }],
  ["treatCurrentAttackAsFirst", { scope: "combat", timing: "burst" }],
  ["shuffleAttackDeckWithDiscard", { scope: "player", timing: "burst" }],
  ["exileGeneralDiscardOnDamage", { scope: "player", timing: "burst" }],
    ["healBlocked", { scope: "engaged", timing: "burst" }],
    ["targetAttackDamageModify", { scope: "attack", timing: "burst" }],
    ["targetAttackCountsAsFirst", { scope: "attack", timing: "burst" }],
    ["drawDiscardAttack", { scope: "player", timing: "burst" }],
  ["revealNewLocation", { scope: "board", timing: "burst" }],
  ["scryDeck", { scope: "player", timing: "burst" }],
    ["returnFromDiscard", { scope: "player", timing: "burst" }],
    ["canPlayAnyTribeMugic", { scope: "unit", timing: "burst" }],
    ["canPlaySpecificTribeMugic", { scope: "unit", timing: "burst" }],
    ["playMugicFromGeneralDiscard", { scope: "unit", timing: "burst" }],
    ["mugicPlayedFromDiscardExileOnResolve", { scope: "unit", timing: "burst" }],
    ["nextAttackThisTurnDamageAdd", { scope: "combat", timing: "burst" }],
    ["onTakesAttackDamageGrantAttackBonus", { scope: "combat", timing: "burst" }],
    ["playMugicOnAttackDamage", { scope: "unit", timing: "burst" }],
    ["discardPresenceStatAura", { scope: "unit", timing: "passive" }],
    ["alliedStatModifier", { scope: "unit", timing: "passive" }],
    ["namedCounterOnCombatWin", { scope: "unit", timing: "triggered" }],
    ["alliesStatPerNamedCounter", { scope: "unit", timing: "passive" }],
    ["startsFaceUp", { scope: "unit", timing: "setup" }],
    ["negateMugicOrAbilityTargeting", { scope: "stack", timing: "burst" }],
    ["cannotGainElementTypes", { scope: "unit", timing: "burst" }],
  ["boardMove", { scope: "board", timing: "burst" }],
  ["relocateEffect", { scope: "board", timing: "burst" }],
  ["copyMugic", { scope: "stack", timing: "burst" }],
  ["copyCreatureProfile", { scope: "unit", timing: "burst" }],
  ["infectTargetCreature", { scope: "unit", timing: "burst" }],
  ["uninfectOpposingThenInfectOwn", { scope: "board", timing: "burst" }],
  ["infectTargetedOpposingUninfectedCreature", { scope: "board", timing: "triggered" }],
  ["nonDanianAttackDamageVsInfected", { scope: "combat", timing: "passive" }],
  ["beginCombatGainElementsFromInfectedCreatures", { scope: "unit", timing: "begin_combat" }],
  ["minionActivatedBlockedByChieftain", { scope: "board", timing: "passive" }],
  ["targetMinionIgnoreChieftainRestriction", { scope: "unit", timing: "burst" }],
  ["incomingFirstAttackDamageReduction", { scope: "combat", timing: "passive" }],
  ["replaceAttackDamageWithDisciplineLoss", { scope: "combat", timing: "passive" }],
  ["destroyCreatureIfAllDisciplinesZero", { scope: "combat", timing: "passive" }],
  ["targetAttackReflectDamage", { scope: "attack", timing: "burst" }],
  ["incomingNextAttackReduction", { scope: "combat", timing: "burst" }],
  ["replaceMugicOrAbilityDamageWithEnergyGain", { scope: "combat", timing: "passive" }],
  ["moveAsIfAdjacent", { scope: "unit", timing: "passive" }],
  ["mustEngageIfPossible", { scope: "unit", timing: "passive" }],
  ["replaceMoveIntoOpposingWithRelocate", { scope: "unit", timing: "passive" }],
  ["replaceBecomeEngagedBySwapWithUnderworld", { scope: "unit", timing: "passive" }],
  ["flipTargetBattlegearOnMugicCounterGain", { scope: "battlegear", timing: "triggered" }],
  ["gainElementsFromIncomingAttack", { scope: "unit", timing: "triggered" }],
  ["onGainElementGainElementValue", { scope: "unit", timing: "triggered" }],
  ["gainInitiativeElementType", { scope: "unit", timing: "begin_combat" }],
  ["engagedVsScoutNoInvisibility", { scope: "combat", timing: "passive" }],
  ["alliedStatModifierByElement", { scope: "unit", timing: "passive" }],
  ["countDiscardCreaturesAsControlledType", { scope: "player", timing: "passive" }],
  ["mugicCostReduction", { scope: "unit", timing: "passive" }],
  ["onFirstAttackDamageGainSameEnergyIfControlTribe", { scope: "unit", timing: "triggered" }],
  ["onPlayAttackWhileEquippedGainEnergy", { scope: "unit", timing: "triggered" }],
  ["onMugicCounterAddedLoseEnergy", { scope: "unit", timing: "triggered" }],
  ["onTakeDamageSourceLosesEnergy", { scope: "combat", timing: "triggered" }],
  ["grantChosenElementValueToRecentDamager", { scope: "unit", timing: "burst" }],
  ["grantRangeAndSwiftFromSourceMugicCounters", { scope: "unit", timing: "burst" }],
  ["removeChosenElementFromCreatureWithZeroDiscipline", { scope: "unit", timing: "burst" }],
  ["returnCreatureFromDiscardToBoard", { scope: "board", timing: "burst" }],
  ["swapBattlegearBetweenControlledCreatures", { scope: "board", timing: "burst" }],
  ["flipSelfBattlegearFaceUp", { scope: "unit", timing: "begin_turn" }],
  ["gainElementWhenAllyLosesElement", { scope: "unit", timing: "triggered" }],
  ["countsAsMugicBurst", { scope: "stack", timing: "burst" }],
  ["redirectNonAttackDamageToSelf", { scope: "unit", timing: "burst" }],
  ["destroySelfIfPowerAboveThreshold", { scope: "unit", timing: "triggered" }],
  ["attackDamageBonusIfSameNameInDiscard", { scope: "combat", timing: "passive" }],
  ["discardAttackReturnByBuildPointsOrDraw", { scope: "player", timing: "burst" }],
  ["sacrificeFriendlyTribeForHeal", { scope: "unit", timing: "burst" }],
  ["targetDanianGainsExpendedElement", { scope: "unit", timing: "burst" }],
  ["onNextAttackDamageReduceOpposingDisciplinesByDamage", { scope: "combat", timing: "triggered" }],
  ["keywordIfControlTribe", { scope: "unit", timing: "passive" }],
  ["beginCombatGainLowestScannedEnergyFromAllies", { scope: "unit", timing: "begin_combat" }],
  ["targetCreatureCountsAsChosenTribe", { scope: "unit", timing: "burst" }],
  ["targetAttackLoseAllAbilities", { scope: "attack", timing: "burst" }],
  ["firstAttackZeroIfHigherCourageAndWisdom", { scope: "combat", timing: "passive" }],
  ["beginCombatStealOpposingEngagedBattlegearIfUnequipped", { scope: "battlegear", timing: "begin_combat" }],
  ["retargetSingleTargetMugic", { scope: "stack", timing: "burst" }],
]);
const INVALID_TARGET_UNIT = Object.freeze({ __invalidTargetUnit: true });

export const PHASE_FLOW = [
  "location_step",
  "action_step_pre_move",
  "move_action",
  "combat_sequence",
  "additional_movement",
  "showdown_check",
  "end_of_turn_recovery",
];

export const PHASE_LABEL = {
  location_step: "Location Step",
  action_step_pre_move: "Pre-Move Priority",
  move_action: "Move Action",
  combat_sequence: "Combat Sequence",
  additional_movement: "Additional Movement",
  showdown_check: "Showdown Check",
  end_of_turn_recovery: "End of Turn Recovery",
  finished: "Finished",
};

/* ─── Simple event emitter for UI integration ─── */
const _listeners = new Map();
export function onBattleEvent(eventName, callback) {
  if (!_listeners.has(eventName)) _listeners.set(eventName, []);
  _listeners.get(eventName).push(callback);
  return () => {
    const list = _listeners.get(eventName) || [];
    const idx = list.indexOf(callback);
    if (idx >= 0) list.splice(idx, 1);
  };
}
export function clearBattleListeners() {
  _listeners.clear();
}
function emitBattleEvent(eventName, data) {
  (_listeners.get(eventName) || []).forEach((fn) => { try { fn(data); } catch (_) { /* skip */ } });
}

function logEffect(battle, entry) {
  if (!battle) return;
  if (!Array.isArray(battle.effectLog)) battle.effectLog = [];
  const normalizedTargets = Array.isArray(entry?.targetsResolved)
    ? entry.targetsResolved
    : Array.isArray(entry?.targets)
      ? entry.targets
      : [];
  battle.effectLog.push({
    turn: battle.board?.turn || 0,
    phase: battle.phase || "",
    timestamp: Date.now(),
    activationType: entry?.activationType || "runtime",
    timing: entry?.timing || battle.phase || "runtime",
    targetsResolved: normalizedTargets,
    result: entry?.result || "resolved",
    ...entry,
  });
}

function currentEngagedUnit(board, playerIndex) {
  const unit = unitForPlayer(board, playerIndex);
  if (!unit) {
    return null;
  }
  return unit;
}

function stripUnitBattlegear(unit) {
  if (!unit?.gearCard) {
    return false;
  }
  const gearStats = unit.gearPassiveMods || {};
  MODIFIABLE_STATS.forEach((stat) => {
    unit.passiveMods[stat] = Number(unit.passiveMods?.[stat] || 0) - Number(gearStats[stat] || 0);
  });
  unit.gearCard = null;
  unit.gearState = null;
  unit.gearPassiveMods = createTempStatMap();
  unit.currentEnergy = clamp(unit.currentEnergy, 0, unitMaxEnergy(unit));
  return true;
}

function destroyEngagedBattlegear(
  board,
  playerIndex,
  battle,
  reason = "Battlegear destruido.",
  mode = "destroy",
  forcedUnit = null,
  flipMode = "down"
) {
  const unit = forcedUnit || currentEngagedUnit(board, playerIndex);
  if (!unit || !unit.gearCard) {
    return false;
  }
  if (mode === "flip") {
    const requested = String(flipMode || "").toLowerCase();
    const nextState =
      requested === "toggle"
        ? unit.gearState === "face_down"
          ? "face_up"
          : "face_down"
        : requested === "up" || requested === "face_up" || String(reason || "").toLowerCase().includes("face-up")
          ? "face_up"
          : "face_down";
    if (unit.gearState === nextState) {
      return false;
    }
    unit.gearState = nextState;
    recalculateUnitDerivedState(unit);
    battle.log.push(
      `${board.players[playerIndex].label}: ${unit.gearCard.name} ${nextState === "face_down" ? "virou face-down" : "virou face-up"}.`
    );
    logEffect(battle, { type: "battlegear", source: unit.gearCard.name, effectKind: "flip", targets: [unitDisplayName(unit)], description: `${unit.gearCard.name} ${nextState === "face_down" ? "virou face-down" : "virou face-up"}` });
    return true;
  }
  if (mode === "destroy" && board.exchange?.battlegearIndestructible) {
    battle.log.push("Battlegear nao pode ser destruido neste combate.");
    return false;
  }
  const removedGear = unit.gearCard;
  const name = removedGear.name;
  stripUnitBattlegear(unit);
  board.players[playerIndex].battlegearDiscard.push(removedGear);
  battle.log.push(`${board.players[playerIndex].label}: ${name} removido (${reason})`);
  logEffect(battle, { type: "battlegear", source: name, effectKind: "destroyBattlegear", targets: [unitDisplayName(unit)], description: `${name} destruido: ${reason}` });
  return true;
}

function uniqueGearTargets(entries) {
  const seen = new Set();
  const output = [];
  (entries || []).forEach((entry) => {
    const unitId = entry?.unit?.unitId;
    if (!unitId || seen.has(unitId)) {
      return;
    }
    seen.add(unitId);
    output.push(entry);
  });
  return output;
}

function collectBattlegearTargetsByScope(board, sourcePlayerIndex, effect, runtimeContext = null) {
  const selectedTarget = effectSelectionFromRuntime(effect, runtimeContext);
  if (selectedTarget?.type === "battlegear" || selectedTarget?.type === "creature") {
    const selectedUnit = resolveUnitFromSelection(board, selectedTarget);
    if (!selectedUnit?.unit?.gearCard) {
      return [];
    }
    return [selectedUnit];
  }

  const scope = String(effect?.scope || "engaged").toLowerCase();
  const target = String(effect?.target || "self").toLowerCase();
  const players =
    target === "all"
      ? [0, 1]
      : target === "opponent"
        ? [targetPlayer(sourcePlayerIndex)]
        : target === "any"
          ? [sourcePlayerIndex, targetPlayer(sourcePlayerIndex)]
          : [sourcePlayerIndex];
  const collected = [];

  const pushEngaged = (playerIndex) => {
    const unit = unitForPlayer(board, playerIndex);
    if (unit?.gearCard) {
      collected.push({ playerIndex, unit });
    }
  };
  const pushAllUnits = (playerIndex) => {
    (board.players[playerIndex]?.creatures || []).forEach((unit) => {
      if (unit && !unit.defeated && unit.gearCard) {
        collected.push({ playerIndex, unit });
      }
    });
  };

  if (scope === "all") {
    players.forEach((playerIndex) => pushAllUnits(playerIndex));
    return uniqueGearTargets(collected);
  }
  if (scope === "engagedall") {
    players.forEach((playerIndex) => pushEngaged(playerIndex));
    return uniqueGearTargets(collected);
  }
  players.forEach((playerIndex) => pushEngaged(playerIndex));
  return uniqueGearTargets(collected);
}

function revealEngagedBattlegearAtCombatStart(battle) {
  const board = battle.board;
  [0, 1].forEach((playerIndex) => {
    const unit = unitForPlayer(board, playerIndex);
    if (!unit || !unit.gearCard || unit.gearState !== "face_down") {
      return;
    }
    unit.gearState = "face_up";
    recalculateUnitDerivedState(unit);
    battle.log.push(`${board.players[playerIndex].label}: ${unit.gearCard.name} revelado no inicio do combate.`);
  });
}

function zeroAttackMap() {
  return { 0: 0, 1: 0 };
}

function targetPlayer(playerIndex) {
  return playerIndex === 0 ? 1 : 0;
}

function isAiControlledPlayer(battle, playerIndex) {
  if (!battle || !Number.isInteger(playerIndex)) {
    return false;
  }
  return Boolean(battle.ai?.[`player${playerIndex}`]);
}

function isHumanControlledPlayer(battle, playerIndex, forceAutoHuman = false) {
  if (forceAutoHuman || !battle || !Number.isInteger(playerIndex)) {
    return false;
  }
  return !isAiControlledPlayer(battle, playerIndex);
}

function unitForPlayer(board, playerIndex) {
  const letter = playerIndex === board.activePlayerIndex
    ? normalizeBoardLetter(board.engagement.attackerLetter)
    : normalizeBoardLetter(board.engagement.defenderLetter);
  if (!letter) {
    return null;
  }
  const occupied = getUnitAtLetter(board, letter);
  if (!occupied || occupied.playerIndex !== playerIndex) {
    return null;
  }
  return occupied.unit || null;
}

function slotForPlayer(board, playerIndex) {
  const unit = unitForPlayer(board, playerIndex);
  if (!unit) {
    return null;
  }
  return unit.slot;
}

function slotLetter(playerIndex, slot) {
  return PLAYER_SLOT_LETTERS[playerIndex]?.[slot] || null;
}

function slotFromLetter(playerIndex, letter) {
  return LETTER_TO_PLAYER_SLOT[playerIndex]?.[letter] ?? null;
}

function normalizeBoardLetter(letter) {
  const value = String(letter || "").trim().toUpperCase();
  return BOARD_ADJACENCY[value] ? value : null;
}

function unitPositionLetter(playerIndex, unit) {
  if (!unit) {
    return null;
  }
  const normalized = normalizeBoardLetter(unit.positionLetter);
  if (normalized) {
    return normalized;
  }
  return slotLetter(playerIndex, unit.slot);
}

function ensureBattleUnitMetadata(board) {
  board.players.forEach((player, playerIndex) => {
    player.creatures.forEach((unit, slotIndex) => {
      if (!unit) {
        return;
      }
      if (!unit.unitId) {
        unit.unitId = `${playerIndex}:${unit.card?.id || unit.card?.name || "unit"}:${slotIndex}`;
      }
      if (unit.defeated) {
        unit.positionLetter = null;
        return;
      }
      const letter = unitPositionLetter(playerIndex, unit);
      if (letter) {
        unit.positionLetter = letter;
      }
    });
  });
}

function findUnitById(board, unitId) {
  if (!unitId) {
    return null;
  }
  for (let playerIndex = 0; playerIndex <= 1; playerIndex += 1) {
    const player = board.players[playerIndex];
    for (const unit of player.creatures) {
      if (unit?.unitId === unitId) {
        return { playerIndex, unit };
      }
    }
  }
  return null;
}

function getOccupancyByLetter(board) {
  ensureBattleUnitMetadata(board);
  const occupancy = new Map();
  board.players.forEach((player, playerIndex) => {
    player.creatures.forEach((unit) => {
      if (!unit || unit.defeated) {
        return;
      }
      const letter = unitPositionLetter(playerIndex, unit);
      if (!letter) {
        return;
      }
      occupancy.set(letter, { playerIndex, unit });
    });
  });
  return occupancy;
}

function getUnitAtLetter(board, letter) {
  const normalized = normalizeBoardLetter(letter);
  if (!normalized) {
    return null;
  }
  return getOccupancyByLetter(board).get(normalized) || null;
}

function isLetterEmpty(board, letter) {
  return !getUnitAtLetter(board, letter);
}

function moveUnitToLetter(board, playerIndex, unit, targetLetter) {
  const normalized = normalizeBoardLetter(targetLetter);
  if (!unit || unit.defeated || !normalized) {
    return false;
  }
  const fromLetter = unitPositionLetter(playerIndex, unit);
  if (!fromLetter) {
    return false;
  }
  if (!(BOARD_ADJACENCY[fromLetter] || []).includes(normalized)) {
    return false;
  }
  if (!isLetterEmpty(board, normalized)) {
    return false;
  }
  unit.positionLetter = normalized;
  return true;
}

function isUnitCurrentlyEngaged(board, playerIndex, unit) {
  if (!unit || unit.defeated) {
    return false;
  }
  const unitLetter = unitPositionLetter(playerIndex, unit);
  if (!unitLetter) {
    return false;
  }
  const attackerLetter = normalizeBoardLetter(board.engagement.attackerLetter);
  const defenderLetter = normalizeBoardLetter(board.engagement.defenderLetter);
  return unitLetter === attackerLetter || unitLetter === defenderLetter;
}

function chooseMoveEffectPlayers(sourcePlayerIndex, target = "self") {
  if (target === "opponent") {
    return [targetPlayer(sourcePlayerIndex)];
  }
  if (target === "all" || target === "either") {
    return [sourcePlayerIndex, targetPlayer(sourcePlayerIndex)];
  }
  return [sourcePlayerIndex];
}

function eligibleUnitsForBoardMove(board, playerIndex, options = {}) {
  const includeEngaged = Boolean(options.includeEngaged);
  return (board.players[playerIndex]?.creatures || []).filter((unit) => {
    if (!unit || unit.defeated) {
      return false;
    }
    if (!includeEngaged && isUnitCurrentlyEngaged(board, playerIndex, unit)) {
      return false;
    }
    return Boolean(unitPositionLetter(playerIndex, unit));
  });
}

function applySwapPositionsByEffect(board, sourcePlayerIndex, effect, battle, logKind = "boardMove") {
  const candidatePlayers = chooseMoveEffectPlayers(sourcePlayerIndex, effect.target || "self");
  for (const playerIndex of candidatePlayers) {
    const units = eligibleUnitsForBoardMove(board, playerIndex, {
      includeEngaged: Boolean(effect.includeEngaged),
    });
    if (units.length < 2) {
      continue;
    }
    const first = units[0];
    const second = units[1];
    const letterA = unitPositionLetter(playerIndex, first);
    const letterB = unitPositionLetter(playerIndex, second);
    if (!letterA || !letterB || letterA === letterB) {
      continue;
    }
    first.positionLetter = letterB;
    second.positionLetter = letterA;
    battle.log.push(
      `[resolved_effect] ${logKind}.swap_positions: ${unitDisplayName(first)} (${letterA}->${letterB}) <-> ${unitDisplayName(second)} (${letterB}->${letterA}).`
    );
    return true;
  }
  battle.log.push(`[noop_filtered_context] ${logKind}.swap_positions: sem criaturas elegiveis para troca.`);
  return false;
}

function applyMoveToEmptyByEffect(board, sourcePlayerIndex, effect, battle, logKind = "boardMove") {
  const targetPlayerIndex = chooseMoveEffectPlayers(sourcePlayerIndex, effect.target || "self")[0];
  const movable = eligibleUnitsForBoardMove(board, targetPlayerIndex, {
    includeEngaged: Boolean(effect.includeEngaged),
  })[0];
  if (!movable) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_empty: sem criatura elegivel.`);
    return false;
  }
  const fromLetter = unitPositionLetter(targetPlayerIndex, movable);
  if (!fromLetter) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_empty: criatura sem posicao valida.`);
    return false;
  }
  const preferredLetters =
    effect.side === "self"
      ? [...PLAYER_SLOT_LETTERS[targetPlayerIndex]]
      : effect.side === "opponent"
        ? [...PLAYER_SLOT_LETTERS[targetPlayer(targetPlayerIndex)]]
        : Object.keys(BOARD_ADJACENCY);
  const candidates = preferredLetters.filter((letter) => {
    if (!isLetterEmpty(board, letter)) {
      return false;
    }
    if (effect.adjacentOnly) {
      return canLettersEngage(fromLetter, letter);
    }
    return true;
  });
  if (!candidates.length) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_empty: sem destino vazio valido.`);
    return false;
  }
  const destination = candidates[0];
  movable.positionLetter = destination;
  battle.log.push(`[resolved_effect] ${logKind}.move_to_empty: ${unitDisplayName(movable)} (${fromLetter}->${destination}).`);
  return true;
}

function applyMoveToTargetSpaceByEffect(board, sourcePlayerIndex, effect, battle, logKind = "boardMove") {
  const moverPlayerIndex = chooseMoveEffectPlayers(sourcePlayerIndex, effect.target || "self")[0];
  const movable = eligibleUnitsForBoardMove(board, moverPlayerIndex, {
    includeEngaged: Boolean(effect.includeEngaged),
  })[0];
  if (!movable) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_target_space: sem criatura elegivel.`);
    return false;
  }
  const fromLetter = unitPositionLetter(moverPlayerIndex, movable);
  if (!fromLetter) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_target_space: origem invalida.`);
    return false;
  }
  const enemyIndex = targetPlayer(moverPlayerIndex);
  const enemyTargets = eligibleUnitsForBoardMove(board, enemyIndex, { includeEngaged: true })
    .map((unit) => ({ unit, letter: unitPositionLetter(enemyIndex, unit) }))
    .filter((entry) => Boolean(entry.letter) && canLettersEngage(fromLetter, entry.letter));
  if (!enemyTargets.length) {
    battle.log.push(`[noop_filtered_context] ${logKind}.move_to_target_space: sem alvo inimigo adjacente.`);
    return false;
  }
  const chosenTarget = enemyTargets[0];
  if (effect.engageOnOccupied) {
    board.engagement.attackerSlot = movable.slot;
    board.engagement.defenderSlot = chosenTarget.unit.slot;
    if (moverPlayerIndex === board.activePlayerIndex) {
      board.engagement.attackerLetter = fromLetter;
      board.engagement.defenderLetter = chosenTarget.letter;
    } else {
      board.engagement.attackerLetter = chosenTarget.letter;
      board.engagement.defenderLetter = fromLetter;
    }
    battle.log.push(
      `[resolved_effect] ${logKind}.move_to_target_space: ${unitDisplayName(movable)} engaja ${unitDisplayName(chosenTarget.unit)} em ${chosenTarget.letter}.`
    );
    return true;
  }
  movable.positionLetter = chosenTarget.letter;
  battle.log.push(
    `[resolved_effect] ${logKind}.move_to_target_space: ${unitDisplayName(movable)} reposicionada para ${chosenTarget.letter}.`
  );
  return true;
}

function applyBoardMoveByEffect(board, sourcePlayerIndex, effect, battle, logKind = "boardMove") {
  const operation = String(effect?.operation || "").toLowerCase();
  if (operation === "swap_positions") {
    return applySwapPositionsByEffect(board, sourcePlayerIndex, effect, battle, logKind);
  }
  if (operation === "move_to_empty") {
    return applyMoveToEmptyByEffect(board, sourcePlayerIndex, effect, battle, logKind);
  }
  if (operation === "move_to_target_space") {
    return applyMoveToTargetSpaceByEffect(board, sourcePlayerIndex, effect, battle, logKind);
  }
  battle.log.push(`[noop_filtered_context] ${logKind}: operacao '${operation || "unknown"}' nao suportada.`);
  return false;
}

function firstAliveUnitForPlayer(board, playerIndex) {
  return (board.players[playerIndex]?.creatures || []).find((unit) => unit && !unit.defeated) || null;
}

function resolveEffectSourceUnit(board, sourcePlayerIndex, effect, runtimeContext = null) {
  const sourceFlag = String(effect?.source || "self").toLowerCase();
  if (sourceFlag === "opponent") {
    const engagedOpponent = unitForPlayer(board, targetPlayer(sourcePlayerIndex));
    if (engagedOpponent && !engagedOpponent.defeated) {
      return engagedOpponent;
    }
    return firstAliveUnitForPlayer(board, targetPlayer(sourcePlayerIndex));
  }
  if (runtimeContext?.sourceUnit && !runtimeContext.sourceUnit.defeated) {
    return runtimeContext.sourceUnit;
  }
  const engaged = unitForPlayer(board, sourcePlayerIndex);
  if (engaged && !engaged.defeated) {
    return engaged;
  }
  return firstAliveUnitForPlayer(board, sourcePlayerIndex);
}

function resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext = null) {
  const byRuntime = runtimeContext?.sourceUnit && !runtimeContext.sourceUnit.defeated
    ? runtimeContext.sourceUnit
    : null;
  const targetName = String(
    effect?.sourceCreatureName
    || effect?.creatureName
    || effect?.sourceName
    || effect?.bonusName
    || ""
  ).trim();
  if (!targetName) {
    return byRuntime || resolveEffectSourceUnit(board, sourcePlayerIndex, effect, runtimeContext);
  }
  const matched = (board.players[sourcePlayerIndex]?.creatures || []).find((unit) =>
    unit && !unit.defeated && cardNameMatches(activeCreatureCard(unit)?.name, targetName)
  );
  if (matched) {
    return matched;
  }
  return byRuntime || resolveEffectSourceUnit(board, sourcePlayerIndex, effect, runtimeContext);
}

function effectSelectionFromRuntime(effect, runtimeContext = null) {
  const index = Number(effect?._runtimeIndex);
  if (!Number.isFinite(index)) {
    return null;
  }
  const map = runtimeContext?.targetsByEffect;
  if (!map || typeof map !== "object") {
    return null;
  }
  return map[index] || map[String(index)] || null;
}

function resolveUnitFromSelection(board, selection) {
  if (!selection || !selection.unitId) {
    return null;
  }
  const found = findUnitById(board, selection.unitId);
  if (!found?.unit || found.unit.defeated) {
    return null;
  }
  return found;
}

function resolveCreatureDiscardFromSelection(board, selection) {
  if (!selection || selection.type !== "creature_discard" || !Number.isInteger(selection.playerIndex)) {
    return null;
  }
  const discard = board.players?.[selection.playerIndex]?.creatureDiscard;
  if (!Array.isArray(discard)) {
    return null;
  }
  const index = Number(selection.discardIndex);
  if (!Number.isInteger(index) || index < 0 || index >= discard.length) {
    return null;
  }
  const card = discard[index];
  if (!card) {
    return null;
  }
  return {
    playerIndex: Number(selection.playerIndex),
    discardIndex: index,
    card,
  };
}

function resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext = null) {
  const selected = effectSelectionFromRuntime(effect, runtimeContext);
  if (selected && Number.isInteger(selected.playerIndex)) {
    return selected.playerIndex;
  }
  const targetFlag = String(effect?.target || "self").toLowerCase();
  if (targetFlag === "opponent") {
    return targetPlayer(sourcePlayerIndex);
  }
  if (targetFlag === "all" || targetFlag === "both") {
    return sourcePlayerIndex;
  }
  return sourcePlayerIndex;
}

function resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext = null) {
  const selected = effectSelectionFromRuntime(effect, runtimeContext);
  if (selected?.type === "creature" || selected?.type === "battlegear") {
    const found = resolveUnitFromSelection(board, selected);
    if (found) {
      return found.unit;
    }
    return INVALID_TARGET_UNIT;
  }
  const targetFlag = String(effect?.target || "self").toLowerCase();
  const sourceText = String(effect?.sourceText || "").toLowerCase();
  const mentionsEngagedCreature =
    sourceText.includes("engaged creature")
    || sourceText.includes("engaged creatures")
    || sourceText.includes("opposing engaged")
    || sourceText.includes("your engaged");
  if (mentionsEngagedCreature && board?.combat?.active) {
    if (targetFlag === "opponent") {
      return unitForPlayer(board, targetPlayer(sourcePlayerIndex));
    }
    if (targetFlag === "all" || targetFlag === "both") {
      return unitForPlayer(board, sourcePlayerIndex) || unitForPlayer(board, targetPlayer(sourcePlayerIndex));
    }
    return unitForPlayer(board, sourcePlayerIndex);
  }
  if (targetFlag === "opponent") {
    return firstAliveUnitForPlayer(board, targetPlayer(sourcePlayerIndex));
  }
  if (targetFlag === "all") {
    return firstAliveUnitForPlayer(board, sourcePlayerIndex) || firstAliveUnitForPlayer(board, targetPlayer(sourcePlayerIndex));
  }
  if (runtimeContext?.sourceUnit && !runtimeContext.sourceUnit.defeated) {
    return runtimeContext.sourceUnit;
  }
  return firstAliveUnitForPlayer(board, sourcePlayerIndex);
}

function isInvalidTargetUnitSelection(unit) {
  return unit === INVALID_TARGET_UNIT;
}

function applyCopyCreatureProfileEffect(board, sourcePlayerIndex, effect, battle, runtimeContext = null) {
  const receiver = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
  if (isInvalidTargetUnitSelection(receiver)) {
    battle.log.push("[noop_filtered_context] copyCreatureProfile: alvo invalido na resolucao.");
    return false;
  }
  if (!receiver) {
    battle.log.push("[noop_filtered_context] copyCreatureProfile: sem criatura alvo valida.");
    return false;
  }
  const profileSource = resolveEffectSourceUnit(board, sourcePlayerIndex, effect, runtimeContext);
  if (!profileSource) {
    battle.log.push("[noop_filtered_context] copyCreatureProfile: sem criatura de origem valida.");
    return false;
  }
  const sourceCard = activeCreatureCard(profileSource);
  if (!sourceCard) {
    battle.log.push("[noop_filtered_context] copyCreatureProfile: origem sem perfil escaneado.");
    return false;
  }
  const copiedCard = cloneCardForRuntime(sourceCard);
  if (!copiedCard) {
    battle.log.push("[noop_filtered_context] copyCreatureProfile: falha ao copiar perfil.");
    return false;
  }
  if (!receiver.originalScannedCard) {
    receiver.originalScannedCard = receiver.card;
  }
  receiver.copyRuntime = {
    card: copiedCard,
    sourcePlayerIndex,
    sourceUnitId: profileSource.unitId,
    sourceCardId: sourceCard.id || sourceCard.name,
    appliedTurn: Number(board.turn || 0),
    persistent: true,
  };
  recalculateUnitDerivedState(receiver);
  if (!battle.copyRuntimeByUnit) {
    battle.copyRuntimeByUnit = {};
  }
  battle.copyRuntimeByUnit[receiver.unitId] = { ...receiver.copyRuntime };
  battle.log.push(
    `[resolved_effect] copyCreatureProfile: ${unitDisplayName(receiver)} copia o perfil de ${unitDisplayName(profileSource)}.`
  );
  return true;
}

function chooseCopyableMugicStackItem(battle, sourcePlayerIndex, effect) {
  const desiredOwner = String(effect?.target || "self").toLowerCase() === "opponent"
    ? targetPlayer(sourcePlayerIndex)
    : sourcePlayerIndex;
  const stack = Array.isArray(battle?.burstStack) ? battle.burstStack : [];
  for (let idx = stack.length - 1; idx >= 0; idx -= 1) {
    const entry = stack[idx];
    if (!entry || (entry.kind !== "mugic" && entry.kind !== "mugic_copy")) {
      continue;
    }
    if (String(effect?.target || "").toLowerCase() === "all") {
      return entry;
    }
    if (Number(entry.owner) === desiredOwner) {
      return entry;
    }
  }
  return null;
}

function applyCopyMugicEffect(board, sourcePlayerIndex, effect, battle) {
  const sourceStackItem = chooseCopyableMugicStackItem(battle, sourcePlayerIndex, effect);
  if (!sourceStackItem || !Array.isArray(sourceStackItem.effectPayload) || !sourceStackItem.effectPayload.length) {
    battle.log.push("[noop_filtered_context] copyMugic: nenhuma Mugic valida para copiar na pilha.");
    return false;
  }
  const copiedPayload = sourceStackItem.effectPayload.map((entry) => normalizeEffectForRuntime({ ...entry }, "burst"));
  queueStackItem(battle, {
    kind: "mugic_copy",
    source: `Copy ${sourceStackItem.source || "Mugic"}`,
    owner: sourcePlayerIndex,
    playerIndex: sourcePlayerIndex,
    costsPaid: null,
    effectPayload: copiedPayload,
    targetsSnapshot: sourceStackItem.targetsSnapshot || sourceStackItem.targets || null,
    effectRef: sourceStackItem.effectRef || "mugic-copy",
    timing: "copied_mugic_burst",
    copiedFrom: sourceStackItem.effectRef || sourceStackItem.source || "mugic",
  });
  battle.stackNeedsPriorityReopen = true;
  battle.log.push(
    `[resolved_effect] copyMugic: ${board.players[sourcePlayerIndex].label} copia ${sourceStackItem.source || "Mugic"} para a pilha.`
  );
  if (effect.allowRetarget) {
    battle.log.push("[resolved_effect] copyMugic: a copia permite escolher novos alvos nesta janela.");
  }
  return true;
}

function applyRelocateEffect(board, sourcePlayerIndex, effect, battle) {
  const operation = String(effect?.operation || "move_to_empty").toLowerCase();
  if (operation === "move_engaged_both_to_empty") {
    const engagedUnits = [0, 1]
      .map((playerIndex) => ({ playerIndex, unit: unitForPlayer(board, playerIndex) }))
      .filter((entry) => entry.unit && !entry.unit.defeated);
    if (!engagedUnits.length) {
      battle.log.push("[noop_filtered_context] relocateEffect.move_engaged_both_to_empty: sem criaturas engajadas.");
      return false;
    }
    let movedCount = 0;
    engagedUnits.forEach((entry) => {
      const fromLetter = unitPositionLetter(entry.playerIndex, entry.unit);
      const destination = (BOARD_ADJACENCY[fromLetter] || []).find((letter) => isLetterEmpty(board, letter));
      if (!destination) {
        return;
      }
      entry.unit.positionLetter = destination;
      movedCount += 1;
      battle.log.push(
        `[resolved_effect] relocateEffect.move_engaged_both_to_empty: ${unitDisplayName(entry.unit)} (${fromLetter}->${destination}).`
      );
    });
    if (!movedCount) {
      battle.log.push("[noop_filtered_context] relocateEffect.move_engaged_both_to_empty: sem destino adjacente livre.");
      return false;
    }
    return true;
  }
  return applyBoardMoveByEffect(board, sourcePlayerIndex, effect, battle, "relocateEffect");
}

function resolveUnitSelection(board, playerIndex, selection) {
  if (typeof selection === "string") {
    const entry = getUnitAtLetter(board, selection);
    if (entry?.playerIndex === playerIndex) {
      return entry.unit;
    }
    return null;
  }
  if (Number.isInteger(selection)) {
    return board.players[playerIndex]?.creatures?.[selection] || null;
  }
  return null;
}

function ownAdjacentSlots(playerIndex, slot) {
  const letter = slotLetter(playerIndex, slot);
  if (!letter) {
    return [];
  }
  return (BOARD_ADJACENCY[letter] || [])
    .map((adjacentLetter) => slotFromLetter(playerIndex, adjacentLetter))
    .filter((adjacentSlot) => Number.isInteger(adjacentSlot));
}

function enemyAdjacentSlots(playerIndex, slot) {
  const letter = slotLetter(playerIndex, slot);
  const enemyIndex = targetPlayer(playerIndex);
  if (!letter) {
    return [];
  }
  return (BOARD_ADJACENCY[letter] || [])
    .map((adjacentLetter) => slotFromLetter(enemyIndex, adjacentLetter))
    .filter((adjacentSlot) => Number.isInteger(adjacentSlot));
}

function canSlotsEngage(attackerSlot, defenderSlot, attackerPlayerIndex) {
  const adjacentEnemySlots = enemyAdjacentSlots(attackerPlayerIndex, attackerSlot);
  return adjacentEnemySlots.includes(defenderSlot);
}

function canLettersEngage(attackerLetter, defenderLetter) {
  const source = normalizeBoardLetter(attackerLetter);
  const target = normalizeBoardLetter(defenderLetter);
  if (!source || !target) {
    return false;
  }
  return (BOARD_ADJACENCY[source] || []).includes(target);
}

function moveLimitForUnit(unit) {
  const swift = Math.max(0, Number(unit?.statuses?.swift || 0));
  return Math.max(1, 1 + swift);
}

function unitMoveUsageMap(battle) {
  if (!battle?.movementState) {
    return new Map();
  }
  if (!(battle.movementState.movedUnitMoveCountsThisTurn instanceof Map)) {
    battle.movementState.movedUnitMoveCountsThisTurn = new Map();
  }
  return battle.movementState.movedUnitMoveCountsThisTurn;
}

function movesUsedByUnitThisTurn(battle, unitId) {
  return Math.max(0, Number(unitMoveUsageMap(battle).get(unitId) || 0));
}

function unitHasMoveCapacity(battle, unit) {
  if (!unit || unit.defeated) {
    return false;
  }
  return movesUsedByUnitThisTurn(battle, unit.unitId) < moveLimitForUnit(unit);
}

function registerUnitMoveUsage(battle, unit, stepsUsed = 1) {
  if (!battle?.movementState || !unit || !unit.unitId) {
    return;
  }
  const steps = Math.max(1, Number(stepsUsed || 1));
  const usageMap = unitMoveUsageMap(battle);
  const previous = Math.max(0, Number(usageMap.get(unit.unitId) || 0));
  const updated = previous + steps;
  usageMap.set(unit.unitId, updated);
  battle.movementState.hasMovedCreatureThisTurn = true;
  const exhausted = updated >= moveLimitForUnit(unit);
  if (battle.movementState.movedUnitIdsThisTurn instanceof Set) {
    if (exhausted) {
      battle.movementState.movedUnitIdsThisTurn.add(unit.unitId);
    } else {
      battle.movementState.movedUnitIdsThisTurn.delete(unit.unitId);
    }
  }
  unit.movedThisAction = exhausted;
}

function reachableLettersForUnit(board, battle, playerIndex, unit, maxSteps, allowThroughOccupied = false) {
  const fromLetter = unitPositionLetter(playerIndex, unit);
  if (!fromLetter || maxSteps < 1) {
    return new Map();
  }
  const occupancy = getOccupancyByLetter(board);
  const distances = new Map([[fromLetter, 0]]);
  const queue = [{ letter: fromLetter, steps: 0 }];
  while (queue.length) {
    const { letter, steps } = queue.shift();
    if (steps >= maxSteps) {
      continue;
    }
    (BOARD_ADJACENCY[letter] || []).forEach((neighbor) => {
      const nextSteps = steps + 1;
      const occupied = occupancy.get(neighbor);
      const occupiedByEnemy = occupied && occupied.playerIndex !== playerIndex && !occupied.unit?.defeated;
      const occupiedByAlly = occupied && occupied.playerIndex === playerIndex && !occupied.unit?.defeated;
      const canTraverse = !occupied || allowThroughOccupied;
      if (!canTraverse && (occupiedByEnemy || occupiedByAlly)) {
        if (occupiedByEnemy) {
          const previous = distances.get(neighbor);
          if (!Number.isFinite(previous) || nextSteps < previous) {
            distances.set(neighbor, nextSteps);
          }
        }
        return;
      }
      const previous = distances.get(neighbor);
      if (Number.isFinite(previous) && previous <= nextSteps) {
        return;
      }
      distances.set(neighbor, nextSteps);
      queue.push({ letter: neighbor, steps: nextSteps });
    });
  }
  distances.delete(fromLetter);
  return distances;
}

function moveUnitToAdjacentEmptySlot(board, playerIndex, fromSlot, toSlot) {
  const player = board.players[playerIndex];
  const fromUnit = player?.creatures?.[fromSlot];
  const toUnit = player?.creatures?.[toSlot];
  if (!fromUnit || !toUnit) {
    return false;
  }
  if (fromUnit.defeated || !toUnit.defeated || fromUnit.movedThisAction) {
    return false;
  }
  if (!ownAdjacentSlots(playerIndex, fromSlot).includes(toSlot)) {
    return false;
  }
  player.creatures[fromSlot] = toUnit;
  player.creatures[toSlot] = fromUnit;
  toUnit.slot = fromSlot;
  fromUnit.slot = toSlot;
  fromUnit.movedThisAction = true;
  return true;
}

/* ─── Move attacker into the slot vacated by a defeated defender ─── */
function moveAttackerToDefeatedDefenderSlot(board, battle) {
  const attackerIndex = board.activePlayerIndex;
  const defenderLetter = normalizeBoardLetter(board.engagement.defenderLetter);
  if (!defenderLetter) {
    return;
  }
  const attacker = unitForPlayer(board, attackerIndex);
  if (!attacker || attacker.defeated) {
    return;
  }
  if (isLetterEmpty(board, defenderLetter)) {
    attacker.positionLetter = defenderLetter;
  battle.log.push(`${unitDisplayName(attacker)} avanca para ${defenderLetter}.`);
  }
  registerUnitMoveUsage(battle, attacker, 1);
}

/* ─── Post-combat movement: AI auto-moves creatures to better positions ─── */
function autoPostCombatMoves(board, battle) {
  const activeIndex = board.activePlayerIndex;
  const player = board.players[activeIndex];
  const enemy = board.players[targetPlayer(activeIndex)];
  let moved = true;
  let guard = 0;
  // Iterate until no more moves can be made
  while (moved && guard < 30) {
    guard += 1;
    moved = false;
    player.creatures.forEach((unit) => {
      if (!unit || unit.defeated || unit.movedThisAction) {
        return;
      }
      const neighbors = ownAdjacentSlots(activeIndex, unit.slot);
      // Find the best empty adjacent slot that gets closer to enemies
      let bestSlot = -1;
      let bestScore = -1;
      neighbors.forEach((neighborSlot) => {
        const neighborUnit = player.creatures[neighborSlot];
        if (!neighborUnit || !neighborUnit.defeated) {
          return;
        }
        // Score: how many alive enemy creatures can this slot engage?
        const enemySlots = enemyAdjacentSlots(activeIndex, neighborSlot);
        const engageCount = enemySlots.filter((es) => {
          const enemyUnit = enemy.creatures[es];
          return enemyUnit && !enemyUnit.defeated;
        }).length;
        // Prefer slots that can engage enemies, then prefer forward slots
        const score = engageCount * 100 + (neighborSlot >= 3 ? 10 : 0);
        if (score > bestScore) {
          bestScore = score;
          bestSlot = neighborSlot;
        }
      });
      if (bestSlot >= 0 && bestScore > 0) {
        const fromSlot = unit.slot;
        const targetUnit = player.creatures[bestSlot];
        player.creatures[fromSlot] = targetUnit;
        player.creatures[bestSlot] = unit;
        targetUnit.slot = fromSlot;
        unit.slot = bestSlot;
        unit.movedThisAction = true;
      battle.log.push(`${unitDisplayName(unit)} se move para slot ${bestSlot + 1}.`);
        moved = true;
      }
    });
  }
}

function parseInitiativeKey(card) {
  return String(card?.stats?.initiative || "").toLowerCase().trim();
}

function supportsTribe(unit, tribeKeyword) {
  const tribe = String(activeCreatureCard(unit)?.tribe || "").toLowerCase();
  return Boolean(tribeKeyword) && tribe.includes(tribeKeyword);
}

function normalizeTribeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeCardNameKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
      .trim();
}

function cardNameMatches(value, expected) {
  const a = normalizeCardNameKey(value);
  const b = normalizeCardNameKey(expected);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
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

function zeroStatMap() {
  return Object.fromEntries(MODIFIABLE_STATS.map((stat) => [stat, 0]));
}

function activeCreatureCard(unit) {
  return unit?.copyRuntime?.card || unit?.card || null;
}

function activeGearCard(unit) {
  return unit?.gearCard && unit?.gearState !== "face_down" ? unit.gearCard : null;
}

function unitDisplayName(unit) {
  return activeCreatureCard(unit)?.name || unit?.card?.name || "Creature";
}

function activeCreatureEffects(unit) {
  return Array.isArray(activeCreatureCard(unit)?.parsedEffects) ? activeCreatureCard(unit).parsedEffects : [];
}

function combinedParsedEffects(unit) {
  return [...activeCreatureEffects(unit), ...(activeGearCard(unit)?.parsedEffects || [])];
}

function isPassiveStatEffect(effect) {
  const text = String(effect?.sourceText || "").trim();
  if (!text) {
    return false;
  }
  if (/^support:/i.test(text) || /^intimidate:/i.test(text) || /^outperform/i.test(text)) {
    return false;
  }
  if (/has an additional/i.test(text)) {
    return true;
  }
  if (/^(courage|power|wisdom|speed|energy|mugic(?: ability|ability)?|fire|air|earth|water)\s*[+-]?\d+$/i.test(text)) {
    return true;
  }
  return false;
}

function collectPassiveModsFromCard(card) {
  const mods = zeroStatMap();
  (card?.parsedEffects || []).forEach((effect) => {
    if (!effect?.stat || !Number.isFinite(effect.amount)) {
      return;
    }
    if (effect.kind !== "statModifier" && effect.kind !== "elementModifier") {
      return;
    }
    if (!isPassiveStatEffect(effect)) {
      return;
    }
    mods[effect.stat] = Number(mods[effect.stat] || 0) + Number(effect.amount || 0);
  });
  return mods;
}

function sumKeywordAmountFromEffects(effects, keyword) {
  const target = String(keyword || "").toLowerCase();
  return (effects || [])
    .filter((effect) => effect?.kind === "keyword" && String(effect.keyword || "").toLowerCase() === target)
    .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
}

function collectIntimidateFromCardList(cards) {
  const output = [];
  const regex = /Intimidate:\s*(Courage|Power|Wisdom|Speed)\s*(\d+)/gi;
  cards.forEach((card) => {
    const text = String(card?.ability || "");
    let match = regex.exec(text);
    while (match) {
      const stat = String(match[1] || "").toLowerCase();
      if (["courage", "power", "wisdom", "speed"].includes(stat)) {
        output.push({ stat, amount: Number(match[2] || 0) });
      }
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  });
  return output;
}

function collectSupportFromCardList(cards) {
  const output = [];
  const regex = /Support:\s*(All Disciplines|Courage|Power|Wisdom|Speed|Energy|Mugic(?: Ability|ability)?)\s*(\d+)/gi;
  cards.forEach((card) => {
    const text = String(card?.ability || "");
    let match = regex.exec(text);
    while (match) {
      const amount = Number(match[2] || 0);
      const statWord = String(match[1] || "").toLowerCase().trim();
      if (statWord === "all disciplines") {
        ["courage", "power", "wisdom", "speed"].forEach((stat) => output.push({ stat, amount }));
      } else if (statWord === "mugic ability" || statWord === "mugicability" || statWord === "mugic") {
        output.push({ stat: "mugicability", amount });
      } else if (["courage", "power", "wisdom", "speed", "energy"].includes(statWord)) {
        output.push({ stat: statWord, amount });
      }
      match = regex.exec(text);
    }
    regex.lastIndex = 0;
  });
  return output;
}

function cloneCardForRuntime(card) {
  if (!card || typeof card !== "object") {
    return null;
  }
  const copy = { ...card };
  if (card.stats && typeof card.stats === "object") {
    copy.stats = { ...card.stats };
  }
  if (Array.isArray(card.parsedEffects)) {
    copy.parsedEffects = card.parsedEffects.map((effect) => ({ ...effect }));
  }
  if (card.raw && typeof card.raw === "object") {
    copy.raw = { ...card.raw };
  }
  return copy;
}

function recalculateUnitDerivedState(unit) {
  if (!unit) {
    return;
  }
  const oldMax = unitMaxEnergy(unit);
  const oldCurrent = Number(unit.currentEnergy || 0);
  const oldDamageTaken = Math.max(0, oldMax - oldCurrent);

  const creatureCard = activeCreatureCard(unit);
  const gearCard = unit.gearCard || null;
  const gearFaceUp = Boolean(gearCard) && unit.gearState !== "face_down";
  const cards = [creatureCard, gearFaceUp ? gearCard : null].filter(Boolean);
  const parsedEffects = [
    ...cards.flatMap((card) => card?.parsedEffects || []),
    ...((Array.isArray(unit.tempEffects) ? unit.tempEffects : [])),
  ];

  const creaturePassive = collectPassiveModsFromCard(creatureCard);
  const gearPassive = gearFaceUp ? collectPassiveModsFromCard(gearCard) : zeroStatMap();
  const passiveMods = zeroStatMap();
  MODIFIABLE_STATS.forEach((stat) => {
    passiveMods[stat] = Number(creaturePassive[stat] || 0) + Number(gearPassive[stat] || 0);
  });
  unit.creaturePassiveMods = creaturePassive;
  unit.gearPassiveMods = gearPassive;
  unit.passiveMods = passiveMods;

  const invisibilityStrike = parsedEffects
    .filter((effect) => effect.kind === "invisibilityStrike")
    .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
  const hasKeyword = (keyword) =>
    parsedEffects.some((effect) => effect.kind === "keyword" && String(effect.keyword || "").toLowerCase() === keyword);
  const hasEffectKind = (kind) => parsedEffects.some((effect) => effect.kind === kind);
  const plainSurprise = hasKeyword("surprise") || /\bSurprise\b/i.test(cards.map((card) => String(card?.ability || "")).join(" "));

  const previousStatuses = unit.statuses && typeof unit.statuses === "object" ? unit.statuses : {};
  unit.statuses = {
    strike: sumKeywordAmountFromEffects(parsedEffects, "strike"),
    recklessness: sumKeywordAmountFromEffects(parsedEffects, "recklessness"),
    swift: sumKeywordAmountFromEffects(parsedEffects, "swift"),
    surprise: hasEffectKind("invisibilitySurprise") || plainSurprise,
    plainSurprise,
    invisibilitySurprise: hasEffectKind("invisibilitySurprise"),
    invisibility: hasEffectKind("invisibilityStrike") || hasEffectKind("invisibilityDisarm") || /\bInvisibility\b/i.test(cards.map((card) => String(card?.ability || "")).join(" ")),
    invisibilityStrike,
    disarm: hasEffectKind("invisibilityDisarm"),
    defender: hasKeyword("defender") || /\bDefender\b/i.test(cards.map((card) => String(card?.ability || "")).join(" ")),
    range: hasKeyword("range") || /\bRange\b/i.test(cards.map((card) => String(card?.ability || "")).join(" ")),
    untargetable: hasKeyword("untargetable") || /\bUntargetable\b/i.test(cards.map((card) => String(card?.ability || "")).join(" ")),
    fluidmorph: hasKeyword("fluidmorph") || /\bFluidmorph\b/i.test(cards.map((card) => String(card?.ability || "")).join(" ")),
    intimidate: collectIntimidateFromCardList(cards),
    support: collectSupportFromCardList(cards),
    infected: Boolean(previousStatuses.infected),
    infectSource: previousStatuses.infectSource || null,
    infectTurn: Number(previousStatuses.infectTurn || 0) || null,
    ignoreChieftainGate: Boolean(previousStatuses.ignoreChieftainGate),
  };
  Object.entries(previousStatuses).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(unit.statuses, key)) {
      return;
    }
    unit.statuses[key] = value;
  });

  const newMax = unitMaxEnergy(unit);
  unit.currentEnergy = clamp(newMax - oldDamageTaken, 0, newMax);
  unit.mugicCounters = Math.max(0, Number(unit.mugicCounters || 0));
}

function unitHasEffectKind(unit, kind) {
  if (!unit || !kind) {
    return false;
  }
  return combinedParsedEffects(unit).some((effect) => effect?.kind === kind);
}

function playerHasEffectKind(board, playerIndex, kind) {
  return aliveUnitsForPlayer(board, playerIndex).some((unit) =>
    combinedParsedEffects(unit).some((effect) => effect?.kind === kind)
  );
}

function canCreaturePlayMugicCard(board, playerIndex, unit, mugicCard) {
  const minionGateActive = playerHasEffectKind(board, playerIndex, "minionActivatedBlockedByChieftain");
  const bypassChieftain = Boolean(unit?.statuses?.ignoreChieftainGate);
  if (
    minionGateActive
    && !bypassChieftain
    && unitHasCreatureType(unit, "minion")
    && playerControlsChieftain(board, playerIndex)
  ) {
    return false;
  }
  const mugicTribe = normalizeTribeKey(mugicCard?.tribe);
  if (!mugicTribe || mugicTribe === "generic" || mugicTribe === "tribeless" || mugicTribe === "all") {
    return true;
  }
  const creatureTribe = normalizeTribeKey(activeCreatureCard(unit)?.tribe);
  if (creatureTribe && mugicTribe === creatureTribe) {
    return true;
  }
  if (board?.exchange?.allowAnyTribeMugic?.[playerIndex]) {
    return true;
  }
  const specificSet = board?.exchange?.allowSpecificTribeMugic?.[playerIndex];
  if (specificSet instanceof Set && specificSet.has(mugicTribe)) {
    return true;
  }
  const effects = combinedParsedEffects(unit);
  if (effects.some((effect) => effect?.kind === "canPlayAnyTribeMugic")) {
    return true;
  }
  const globalPermission = (board?.players?.[playerIndex]?.creatures || []).some((ally) => {
    if (!ally || ally.defeated) {
      return false;
    }
    const allyEffects = combinedParsedEffects(ally);
    return allyEffects.some((effect) => {
      if (effect?.kind !== "canPlaySpecificTribeMugic" || String(effect.scope || "").toLowerCase() !== "controlled") {
        return false;
      }
      const allowedMugicTribe = normalizeTribeKey(effect?.mugicTribe);
      const requiredCasterTribe = normalizeTribeKey(effect?.casterTribe);
      if (!allowedMugicTribe || allowedMugicTribe !== mugicTribe) {
        return false;
      }
      if (!requiredCasterTribe) {
        return true;
      }
      const casterTribe = normalizeTribeKey(activeCreatureCard(unit)?.tribe);
      return casterTribe === requiredCasterTribe;
    });
  });
  if (globalPermission) {
    return true;
  }
  return effects.some((effect) => {
    if (effect?.kind !== "canPlaySpecificTribeMugic") {
      return false;
    }
    const allowedMugicTribe = normalizeTribeKey(effect?.mugicTribe);
    if (!allowedMugicTribe || allowedMugicTribe !== mugicTribe) {
      return false;
    }
    const casterTribe = normalizeTribeKey(activeCreatureCard(unit)?.tribe);
    const requiredCasterTribe = normalizeTribeKey(effect?.casterTribe);
    if (requiredCasterTribe) {
      return casterTribe === requiredCasterTribe;
    }
    return true;
  });
}

function hasInvisibilityAdvantage(attacker, defender) {
  return Boolean(attacker?.statuses?.invisibility) && !Boolean(defender?.statuses?.invisibility);
}

function unitHasElement(unit, statValueLookup, element) {
  return (statValueLookup(unit, element) || 0) > 0;
}

function resolveSupportBonus(board, playerIndex, unit, stat) {
  if (!unit || !Array.isArray(unit.statuses?.support) || !unit.statuses.support.length) {
    return 0;
  }
  const neighbors = ownAdjacentSlots(playerIndex, unit.slot);
  const tribeName = String(activeCreatureCard(unit)?.tribe || "").toLowerCase();
  let allies = 0;
  neighbors.forEach((neighborSlot) => {
    const ally = board.players[playerIndex].creatures[neighborSlot];
    if (!ally || ally.defeated) {
      return;
    }
    if (String(activeCreatureCard(ally)?.tribe || "").toLowerCase() === tribeName) {
      allies += 1;
    }
  });
  if (!allies) {
    return 0;
  }
  return unit.statuses.support.filter((item) => item.stat === stat).reduce((sum, item) => sum + item.amount * allies, 0);
}

function unitStat(board, playerIndex, unit, stat, exchange = null) {
  if (!unit) {
    return 0;
  }
  const override = exchange?.statSetValues?.[playerIndex]?.[stat];
  const base = Number.isFinite(Number(override))
    ? Number(override)
    : Number(activeCreatureCard(unit)?.stats?.[stat] || 0);
  const passive = Number(unit.passiveMods?.[stat] || 0);
  const temp = Number(unit.tempMods?.[stat] || 0);
  const support = resolveSupportBonus(board, playerIndex, unit, stat);
  const exchangeShift = Number(exchange?.statAdjustments?.[playerIndex]?.[stat] || 0);
  return base + passive + temp + support + exchangeShift;
}

function canGainMugicCounter(board, playerIndex, unit, exchange = null) {
  if (!unit || unit.defeated) {
    return false;
  }
  if (unit.preventMugicCounterGain) {
    return false;
  }
  if (exchange?.preventMugicCounterGain?.[playerIndex]) {
    return false;
  }
  return true;
}

function resolveSnapshotUnit(board, playerIndex, unitOrSlot) {
  if (!board || !Number.isInteger(playerIndex)) {
    return null;
  }
  if (unitOrSlot && typeof unitOrSlot === "object") {
    return unitOrSlot;
  }
  if (Number.isInteger(unitOrSlot)) {
    return board.players[playerIndex]?.creatures?.[unitOrSlot] || null;
  }
  if (typeof unitOrSlot === "string") {
    const entry = getUnitAtLetter(board, unitOrSlot);
    if (entry?.playerIndex === playerIndex) {
      return entry.unit || null;
    }
  }
  return null;
}

export function getEffectiveUnitSnapshot(battle, playerIndex, unitOrSlot) {
  const board = battle?.board;
  const unit = resolveSnapshotUnit(board, playerIndex, unitOrSlot);
  if (!board || !unit || unit.defeated) {
    return null;
  }
  const creatureCard = activeCreatureCard(unit);
  if (!creatureCard) {
    return null;
  }
  const isEngaged = isUnitCurrentlyEngaged(board, playerIndex, unit);
  const exchangeContext = board.combat?.active ? board.exchange : null;
  const statKeys = ["courage", "power", "wisdom", "speed", ...ELEMENT_KEYS];
  const stats = {};
  const base = {};
  const bonus = {};
  statKeys.forEach((stat) => {
    const baseValue = Number(creatureCard?.stats?.[stat] || 0);
    const currentValue = Number(unitStat(board, playerIndex, unit, stat, exchangeContext) || 0);
    base[stat] = baseValue;
    stats[stat] = currentValue;
    bonus[stat] = currentValue - baseValue;
  });
  const maxEnergy = Math.max(0, Number(unitMaxEnergy(unit) || 0));
  const currentEnergy = Math.max(0, Number(unit.currentEnergy || 0));
  return {
    playerIndex,
    unitId: unit.unitId || null,
    unit,
    card: creatureCard,
    slot: unit.slot,
    letter: unitPositionLetter(playerIndex, unit),
    engaged: isEngaged,
    stats,
    base,
    bonus,
    energy: {
      current: currentEnergy,
      max: maxEnergy,
      bonus: currentEnergy - Number(creatureCard?.stats?.energy || 0),
    },
    mugicCounters: Math.max(0, Number(unit.mugicCounters || 0)),
    gearCard: unit.gearCard || null,
    gearState: unit.gearCard ? (unit.gearState || "face_up") : null,
    gearActive: Boolean(unit.gearCard) && unit.gearState !== "face_down",
  };
}

function unitHasSubtype(unit, subtype) {
  return unitHasCreatureType(unit, subtype);
}

function unitCreatureTypeKeywords(unit) {
  const card = activeCreatureCard(unit);
  if (!card) {
    return new Set();
  }
  const keywordList = Array.isArray(card.creatureTypeKeywords) && card.creatureTypeKeywords.length
    ? card.creatureTypeKeywords
    : [];
  const fallbackFromRaw = keywordList.length
    ? []
    : String(card?.raw?.types || "")
        .split(/\s*(?:,|;|\/|\||&|\band\b|\bor\b)\s*/i)
        .map((entry) => normalizeCreatureTypeKey(entry))
        .filter(Boolean);
  const output = new Set();
  [...keywordList, ...fallbackFromRaw].forEach((entry) => {
    const key = normalizeCreatureTypeKey(entry);
    if (!key) {
      return;
    }
    output.add(key);
    key.split(/\s+/).filter(Boolean).forEach((token) => output.add(token));
  });
  const tribeKey = normalizeCreatureTypeKey(card?.tribe);
  if (tribeKey) {
    output.add(tribeKey);
  }
  const statusTypes = Array.isArray(unit?.statuses?.temporaryCreatureTypes)
    ? unit.statuses.temporaryCreatureTypes
    : [];
  statusTypes.forEach((entry) => {
    const key = normalizeCreatureTypeKey(entry);
    if (!key) {
      return;
    }
    output.add(key);
    key.split(/\s+/).filter(Boolean).forEach((token) => output.add(token));
  });
  return output;
}

function unitHasCreatureType(unit, typeKey) {
  const query = normalizeCreatureTypeKey(typeKey);
  if (!query) {
    return false;
  }
  const keywords = unitCreatureTypeKeywords(unit);
  if (!keywords.size) {
    return false;
  }
  if (keywords.has(query)) {
    return true;
  }
  const queryParts = query.split(/\s+/).filter(Boolean);
  if (!queryParts.length) {
    return false;
  }
  return queryParts.every((part) => keywords.has(part));
}

function unitCardHasCreatureType(card, typeKey) {
  if (!card) {
    return false;
  }
  const query = normalizeCreatureTypeKey(typeKey);
  if (!query) {
    return false;
  }
  const mockUnit = { card, copyRuntime: null };
  return unitHasCreatureType(mockUnit, query);
}

function addTemporaryCreatureType(unit, typeLabel) {
  const key = normalizeCreatureTypeKey(typeLabel);
  if (!unit || !key) {
    return false;
  }
  if (!unit.statuses || typeof unit.statuses !== "object") {
    unit.statuses = {};
  }
  if (!Array.isArray(unit.statuses.temporaryCreatureTypes)) {
    unit.statuses.temporaryCreatureTypes = [];
  }
  if (unit.statuses.temporaryCreatureTypes.some((entry) => normalizeCreatureTypeKey(entry) === key)) {
    return false;
  }
  unit.statuses.temporaryCreatureTypes.push(typeLabel);
  return true;
}

function isUnitInfected(unit) {
  return Boolean(unit?.statuses?.infected);
}

function infectUnit(board, playerIndex, unit, sourceLabel = "Infect", battle = null) {
  if (!unit || unit.defeated || isUnitInfected(unit)) {
    return false;
  }
  if (!unit.statuses || typeof unit.statuses !== "object") {
    unit.statuses = {};
  }
  unit.statuses.infected = true;
  unit.statuses.infectSource = sourceLabel;
  unit.statuses.infectTurn = Number(board?.turn || 0);
  if (battle) {
    const targetName = `${board.players[playerIndex]?.label || `Jogador ${playerIndex + 1}`} - ${unitDisplayName(unit)}`;
    battle.log.push(`[infect] ${targetName} foi infectada.`);
    logEffect(battle, {
      type: "status",
      source: sourceLabel,
      effectKind: "infect",
      activationType: "runtime",
      timing: battle.phase,
      targets: [targetName],
      targetsResolved: [targetName],
      result: "applied",
      description: `${targetName} foi infectada.`,
      effects: ["infectTargetCreature"],
    });
  }
  return true;
}

function uninfectUnit(board, playerIndex, unit, sourceLabel = "Uninfect", battle = null) {
  if (!unit || unit.defeated || !isUnitInfected(unit)) {
    return false;
  }
  unit.statuses.infected = false;
  delete unit.statuses.infectSource;
  delete unit.statuses.infectTurn;
  if (battle) {
    const targetName = `${board.players[playerIndex]?.label || `Jogador ${playerIndex + 1}`} - ${unitDisplayName(unit)}`;
    battle.log.push(`[infect] ${targetName} foi desinfectada.`);
    logEffect(battle, {
      type: "status",
      source: sourceLabel,
      effectKind: "uninfect",
      activationType: "runtime",
      timing: battle.phase,
      targets: [targetName],
      targetsResolved: [targetName],
      result: "applied",
      description: `${targetName} foi desinfectada.`,
      effects: ["uninfect"],
    });
  }
  return true;
}

function countInfectedCreatures(board, playerIndex = null) {
  const players = Number.isInteger(playerIndex) ? [playerIndex] : [0, 1];
  let total = 0;
  players.forEach((idx) => {
    (board.players[idx]?.creatures || []).forEach((unit) => {
      if (unit && !unit.defeated && isUnitInfected(unit)) {
        total += 1;
      }
    });
  });
  return total;
}

function triggerAllyElementLossHooks(board, battle, ownerPlayerIndex, lostUnit, lostElements = [], sourceLabel = "Element loss") {
  if (!Array.isArray(lostElements) || !lostElements.length) {
    return;
  }
  const canonicalElements = [...new Set(lostElements.map((entry) => String(entry || "").toLowerCase()).filter((entry) => ELEMENT_KEYS.includes(entry)))];
  if (!canonicalElements.length) {
    return;
  }
  aliveUnitsForPlayer(board, ownerPlayerIndex).forEach((allyUnit) => {
    if (!allyUnit || allyUnit.defeated || allyUnit.unitId === lostUnit?.unitId) {
      return;
    }
    const matchingEffects = combinedParsedEffects(allyUnit).filter(
      (effect) => effect?.kind === "gainElementWhenAllyLosesElement" && effectCreatureNameMatchesUnit(effect, allyUnit)
    );
    if (!matchingEffects.length) {
      return;
    }
    canonicalElements.forEach((element) => {
      if (unitStat(board, ownerPlayerIndex, allyUnit, element) > 0) {
        return;
      }
      allyUnit.tempMods[element] = Number(allyUnit.tempMods?.[element] || 0) + 1;
      battle?.log?.push(
        `[trigger] gainElementWhenAllyLosesElement: ${unitDisplayName(allyUnit)} ganha ${element}.`
      );
      if (battle) {
        logEffect(battle, {
          type: "ability",
          source: unitDisplayName(allyUnit),
          effectKind: "gainElementWhenAllyLosesElement",
          activationType: "triggered",
          timing: battle.phase,
          targetsResolved: [`${board.players[ownerPlayerIndex].label} - ${unitDisplayName(allyUnit)}`],
          result: "applied",
          description: `${unitDisplayName(allyUnit)} ganhou ${element} (${sourceLabel})`,
        });
      }
    });
  });
}

function effectCreatureNameMatchesUnit(effect, unit) {
  const expected = String(
    effect?.creatureName
    || effect?.sourceCreatureName
    || effect?.targetCreatureName
    || ""
  ).trim();
  if (!expected) {
    return true;
  }
  return cardNameMatches(activeCreatureCard(unit)?.name, expected);
}

function unitHasZeroInAllDisciplines(board, playerIndex, unit, exchange = null) {
  if (!unit || unit.defeated) {
    return false;
  }
  return ["courage", "power", "wisdom", "speed"].every(
    (stat) => Number(unitStat(board, playerIndex, unit, stat, exchange)) <= 0
  );
}

function applyDisciplineLossFromDamage(board, playerIndex, unit, damageAmount, exchange = null) {
  if (!unit || unit.defeated) {
    return 0;
  }
  const amount = Math.max(0, Number(damageAmount || 0));
  if (!amount) {
    return 0;
  }
  ["courage", "power", "wisdom", "speed"].forEach((stat) => {
    if (exchange) {
      exchange.statAdjustments[playerIndex][stat] -= amount;
      return;
    }
    unit.tempMods[stat] = Number(unit.tempMods?.[stat] || 0) - amount;
  });
  return amount;
}

function queueDamageEvent(exchange, targetPlayerIndex, amount, sourceKind = "attack", sourcePlayerIndex = null, sourceUnitId = null) {
  if (!exchange) {
    return;
  }
  const value = Math.max(0, Number(amount || 0));
  if (!value) {
    return;
  }
  if (!Array.isArray(exchange.damageEvents)) {
    exchange.damageEvents = [];
  }
  exchange.damageEvents.push({
    targetPlayerIndex,
    amount: value,
    sourceKind: String(sourceKind || "attack"),
    sourcePlayerIndex: Number.isInteger(sourcePlayerIndex) ? sourcePlayerIndex : null,
    sourceUnitId: sourceUnitId || null,
  });
}

function triggerMugicCounterAddedHooks(board, battle, playerIndex, unit, gainedAmount = 0, sourceLabel = "Mugic Counter") {
  if (!unit || unit.defeated || Number(gainedAmount || 0) <= 0) {
    return;
  }
  const parsedSelfLoss = combinedParsedEffects(unit)
    .filter((effect) => effect?.kind === "onMugicCounterAddedLoseEnergy" && effectCreatureNameMatchesUnit(effect, unit))
    .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
  const selfLoss = Math.max(0, Number(unit?.statuses?.onMugicCounterAddedLoseEnergy || 0), parsedSelfLoss);
  if (selfLoss > 0) {
    unit.currentEnergy = clamp(Number(unit.currentEnergy || 0) - selfLoss, 0, unitMaxEnergy(unit));
    battle.log.push(`[trigger] ${unitDisplayName(unit)} perde ${selfLoss} Energy ao ganhar Mugic counter.`);
  }

  for (let ownerIndex = 0; ownerIndex <= 1; ownerIndex += 1) {
    const controllers = aliveUnitsForPlayer(board, ownerIndex).filter((sourceUnit) =>
      combinedParsedEffects(sourceUnit).some((effect) => effect?.kind === "flipTargetBattlegearOnMugicCounterGain")
    );
    controllers.forEach((sourceUnit) => {
      const gearTargets = aliveUnitsForPlayer(board, 0)
        .map((entry) => ({ playerIndex: 0, unit: entry }))
        .concat(aliveUnitsForPlayer(board, 1).map((entry) => ({ playerIndex: 1, unit: entry })))
        .filter((entry) => entry.unit?.gearCard && entry.unit.gearState !== "face_down");
      const firstTarget = gearTargets[0];
      if (!firstTarget) {
        return;
      }
      destroyEngagedBattlegear(
        board,
        firstTarget.playerIndex,
        battle,
        `${sourceLabel} (${unitDisplayName(sourceUnit)})`,
        "flip",
        firstTarget.unit,
        "down"
      );
    });
  }
}

function addIncomingDamageReduction(unit, amount, source = "attack", options = {}) {
  if (!unit || unit.defeated) {
    return;
  }
  const value = Number(amount || 0);
  if (!value) {
    return;
  }
  if (!unit.statuses || typeof unit.statuses !== "object") {
    unit.statuses = {};
  }
  if (!Array.isArray(unit.statuses.incomingDamageReductions)) {
    unit.statuses.incomingDamageReductions = [];
  }
  unit.statuses.incomingDamageReductions.push({
    amount: value,
    source,
    firstAttackOnly: Boolean(options.firstAttackOnly),
    elementalOnly: Boolean(options.elementalOnly),
    consumeOnMatch: Boolean(options.consumeOnMatch),
  });
}

function consumeIncomingReductionEntries(unit, sourceKind, context = {}) {
  if (!unit || !Array.isArray(unit?.statuses?.incomingDamageReductions)) {
    return;
  }
  unit.statuses.incomingDamageReductions = unit.statuses.incomingDamageReductions.filter((entry) => {
    if (!entry?.consumeOnMatch) {
      return true;
    }
    const source = String(entry?.source || "attack");
    if (!reductionAppliesToSource(source, sourceKind)) {
      return true;
    }
    if (entry?.firstAttackOnly && Number(context.attacksReceived || 0) > 0) {
      return true;
    }
    if (entry?.elementalOnly && !context.isElementalAttack) {
      return true;
    }
    return false;
  });
}

function firstEmptyLetterOnPlayerSide(board, playerIndex) {
  const candidates = PLAYER_SLOT_LETTERS[playerIndex] || [];
  return candidates.find((letter) => isLetterEmpty(board, letter)) || null;
}

function resurrectCreatureFromDiscardSelection(board, selection) {
  const resolved = resolveCreatureDiscardFromSelection(board, selection);
  if (!resolved) {
    return null;
  }
  const destinationLetter = firstEmptyLetterOnPlayerSide(board, resolved.playerIndex);
  if (!destinationLetter) {
    return null;
  }
  const player = board.players[resolved.playerIndex];
  const targetSlot = player.creatures.findIndex((unit) => unit && unit.defeated);
  if (targetSlot < 0) {
    return null;
  }
  const [card] = player.creatureDiscard.splice(resolved.discardIndex, 1);
  if (!card) {
    return null;
  }
  const unit = player.creatures[targetSlot];
  unit.card = card;
  unit.originalScannedCard = null;
  unit.copyRuntime = null;
  unit.gearCard = null;
  unit.gearState = null;
  unit.tempMods = createTempStatMap();
  unit.tempEffects = [];
  unit.namedCounters = {};
  unit.defeated = false;
  unit.defeatRecorded = false;
  unit.movedThisAction = true;
  unit.positionLetter = destinationLetter;
  unit.combat = {
    attacksMade: 0,
    attacksReceived: 0,
    activatedAbilityUsed: false,
    nextAttackBonus: 0,
    onTakesDamageAttackBonus: 0,
  };
  unit.unitId = `${resolved.playerIndex}:${card?.id || card?.name || "revived"}:${Date.now()}:${targetSlot}`;
  recalculateUnitDerivedState(unit);
  unit.currentEnergy = unitMaxEnergy(unit);
  unit.mugicCounters = Math.max(0, Number(card?.stats?.mugicability || 0) + Number(unit.passiveMods?.mugicability || 0));
  return { playerIndex: resolved.playerIndex, unit, letter: destinationLetter, card };
}

function playerControlsChieftain(board, playerIndex) {
  return aliveUnitsForPlayer(board, playerIndex).some((unit) => unitHasCreatureType(unit, "chieftain"));
}

function unitNamedCounterValue(unit, counterKey) {
  const key = String(counterKey || "").toLowerCase().trim();
  if (!key || !unit) {
    return 0;
  }
  const map = unit.namedCounters || {};
  return Math.max(0, Number(map[key] || 0));
}

function addUnitNamedCounter(unit, counterKey, amount = 1) {
  const key = String(counterKey || "").toLowerCase().trim();
  if (!key || !unit || !Number.isFinite(Number(amount))) {
    return 0;
  }
  if (!unit.namedCounters || typeof unit.namedCounters !== "object") {
    unit.namedCounters = {};
  }
  const next = Math.max(0, Number(unit.namedCounters[key] || 0) + Number(amount || 0));
  unit.namedCounters[key] = next;
  return next;
}

function attackerHasStatCheckAutoSuccess(board, playerIndex, attacker, exchange) {
  if (!attacker) {
    return false;
  }
  return board.players[playerIndex].creatures.some((ally) => {
    if (!ally || ally.defeated || ally.slot === attacker.slot) {
      return false;
    }
    const effects = combinedParsedEffects(ally);
    return effects.some((effect) => {
      if (effect.kind !== "statCheckAutoSuccessForElement" || !effect.element) {
        return false;
      }
      return unitStat(board, playerIndex, attacker, effect.element, exchange) > 0;
    });
  });
}

function reductionAppliesToSource(effectSource, sourceKind) {
  const text = String(effectSource || "").toLowerCase();
  if (!text || text === "attack" || text === "attacks") {
    return sourceKind === "attack";
  }
  if (text.includes("recklessness")) {
    return sourceKind === "recklessness";
  }
  if (text.includes("mugic")) {
    return sourceKind === "mugic";
  }
  if (text.includes("water attack")) {
    return sourceKind === "attack";
  }
  return sourceKind === "attack";
}

function incomingDamageReductionForUnit(unit, sourceKind, context = {}) {
  if (!unit) {
    return 0;
  }
  const effects = combinedParsedEffects(unit);
  const fromStaticEffects = effects
    .filter((effect) => effect.kind === "incomingDamageReduction")
    .reduce((total, effect) => {
      if (effect.onlyWarbeast && !unitHasSubtype(unit, "warbeast")) {
        return total;
      }
      if (!reductionAppliesToSource(effect.source, sourceKind)) {
        return total;
      }
      const sourceText = String(effect.source || "").toLowerCase();
      const bpMatch = sourceText.match(/(\d+)\s*build\s*points?/i);
      if (bpMatch) {
        const requiredBp = Number(bpMatch[1]);
        const actualBp = Number(context.attackBuildPoints || 0);
        if (!Number.isFinite(requiredBp) || actualBp !== requiredBp) {
          return total;
        }
      }
      if (sourceText.includes("first attack") && Number(context.attacksReceived || 0) > 0) {
        return total;
      }
      if (sourceText.includes("elemental") && !context.isElementalAttack) {
        return total;
      }
      return total + Number(effect.amount || 0);
    }, 0);
  const runtimeReductions = Array.isArray(unit?.statuses?.incomingDamageReductions)
    ? unit.statuses.incomingDamageReductions
    : [];
  const fromRuntime = runtimeReductions.reduce((total, entry) => {
    const amount = Number(entry?.amount || 0);
    if (!amount) {
      return total;
    }
    const source = String(entry?.source || "attack");
    if (!reductionAppliesToSource(source, sourceKind)) {
      return total;
    }
    if (entry?.firstAttackOnly && Number(context.attacksReceived || 0) > 0) {
      return total;
    }
    if (entry?.elementalOnly && !context.isElementalAttack) {
      return total;
    }
    return total + amount;
  }, 0);
  return fromStaticEffects + fromRuntime;
}

function countActiveElementTypes(board, playerIndex, unit, exchange) {
  if (!unit) {
    return 0;
  }
  return ELEMENT_KEYS.reduce((sum, element) => {
    return sum + (unitStat(board, playerIndex, unit, element, exchange) > 0 ? 1 : 0);
  }, 0);
}

function countSharedElementTypes(board, attackerIndex, attacker, defender, exchange) {
  if (!attacker || !defender) {
    return 0;
  }
  const defenderIndex = targetPlayer(attackerIndex);
  return ELEMENT_KEYS.reduce((sum, element) => {
    const attackerHas = unitStat(board, attackerIndex, attacker, element, exchange) > 0;
    const defenderHas = unitStat(board, defenderIndex, defender, element, exchange) > 0;
    return sum + (attackerHas && defenderHas ? 1 : 0);
  }, 0);
}

function countDisciplinesAboveThreshold(board, playerIndex, unit, threshold, exchange) {
  if (!unit) {
    return 0;
  }
  const limit = Number.isFinite(Number(threshold)) ? Number(threshold) : 0;
  return ["courage", "power", "wisdom", "speed"].reduce((sum, stat) => {
    return sum + (unitStat(board, playerIndex, unit, stat, exchange) > limit ? 1 : 0);
  }, 0);
}

function controllerHasNonTribeCreature(board, playerIndex, tribeKey) {
  const required = normalizeTribeKey(tribeKey);
  if (!required) {
    return false;
  }
  return (board.players[playerIndex]?.creatures || [])
    .some((unit) => unit && !unit.defeated && normalizeTribeKey(activeCreatureCard(unit)?.tribe) !== required);
}

function countControlledCreatureTypes(board, playerIndex, typeKey, adjacentToUnit = null) {
  const normalizedType = normalizeCreatureTypeKey(typeKey);
  if (!normalizedType) {
    return 0;
  }
  const sourceLetter = adjacentToUnit ? normalizeBoardLetter(adjacentToUnit.positionLetter) : null;
  let count = (board.players[playerIndex]?.creatures || []).reduce((total, unit) => {
    if (!unit || unit.defeated || !unitHasCreatureType(unit, normalizedType)) {
      return total;
    }
    if (sourceLetter) {
      const letter = normalizeBoardLetter(unit.positionLetter);
      if (!letter) {
        return total;
      }
      const adjacent = BOARD_ADJACENCY[sourceLetter] || [];
      if (!adjacent.includes(letter)) {
        return total;
      }
    }
    return total + 1;
  }, 0);
  const extraDiscardTypes = board.exchange?.countDiscardCreaturesAsControlledType?.[playerIndex];
  if (extraDiscardTypes instanceof Set && extraDiscardTypes.has(normalizedType)) {
    count += (board.players[playerIndex]?.creatureDiscard || []).filter((card) =>
      unitCardHasCreatureType(card, normalizedType)
    ).length;
  }
  return count;
}

function countAccessibleMugicCards(board, playerIndex) {
  const player = board.players[playerIndex];
  if (!player) {
    return 0;
  }
  const viaSlots = availableMugicSlots(player).length;
  if (viaSlots > 0) {
    return viaSlots;
  }
  return Array.isArray(player.mugicHand) ? player.mugicHand.length : 0;
}

function shuffleArrayInPlace(list) {
  for (let idx = list.length - 1; idx > 0; idx -= 1) {
    const swapIndex = Math.floor(Math.random() * (idx + 1));
    const hold = list[idx];
    list[idx] = list[swapIndex];
    list[swapIndex] = hold;
  }
  return list;
}

function shuffleAttackDeckWithDiscardForPlayer(player) {
  if (!player) {
    return;
  }
  const merged = [...(player.attackDeck || []), ...(player.attackDiscard || [])];
  player.attackDeck = shuffleArrayInPlace(merged);
  player.attackDiscard = [];
}

function exileOneFromGeneralDiscard(board, playerIndex) {
  const player = board.players[playerIndex];
  if (!player) {
    return null;
  }
  const zones = ["creatureDiscard", "battlegearDiscard", "mugicDiscard", "attackDiscard", "locationDiscard"];
  for (const zone of zones) {
    const pile = player[zone];
    if (Array.isArray(pile) && pile.length) {
      const removed = pile.pop();
      return { zone, removed };
    }
  }
  return null;
}

function unitHasGearKeyword(unit, keyword) {
  const key = normalizeCreatureTypeKey(keyword);
  if (!unit?.gearCard || !key) {
    return false;
  }
  const haystack = `${unit.gearCard?.name || ""} ${unit.gearCard?.ability || ""}`;
  return normalizeCardNameKey(haystack).includes(key);
}

function evaluateAttackDamageCondition(board, attackerIndex, attacker, defender, condition, exchange) {
  if (!condition || typeof condition !== "object") {
    return true;
  }
  const kind = String(condition.type || "").trim();
  const value = condition.value;
  const defenderIndex = targetPlayer(attackerIndex);
  if (!kind) {
    return true;
  }
  if (kind === "attackerHasCreatureType") {
    return unitHasCreatureType(attacker, value);
  }
  if (kind === "defenderHasCreatureType") {
    return unitHasCreatureType(defender, value);
  }
  if (kind === "defenderHasElement") {
    const element = String(value || "").toLowerCase();
    return ELEMENT_KEYS.includes(element) && unitStat(board, defenderIndex, defender, element, exchange) > 0;
  }
  if (kind === "attackerHasElement") {
    const element = String(value || "").toLowerCase();
    return ELEMENT_KEYS.includes(element) && unitStat(board, attackerIndex, attacker, element, exchange) > 0;
  }
  if (kind === "opponentControlsActiveLocation") {
    return Number(board.locationOwnerIndex) === defenderIndex;
  }
  if (kind === "controllerHasNonTribeCreature") {
    return controllerHasNonTribeCreature(board, attackerIndex, value);
  }
  if (kind === "defenderEquipped") {
    return Boolean(defender?.gearCard);
  }
  if (kind === "attackerEquipped") {
    return Boolean(attacker?.gearCard);
  }
  if (kind === "attackerEquippedWithKeyword") {
    return unitHasGearKeyword(attacker, value);
  }
  if (kind === "attackerHasStatus") {
    return Number(attacker?.statuses?.[String(value || "").toLowerCase()] || 0) > 0
      || Boolean(attacker?.statuses?.[String(value || "").toLowerCase()]);
  }
  if (kind === "defenderMugicCountersGte") {
    return Number(defender?.mugicCounters || 0) >= Number(value || 0);
  }
  if (kind === "attackDiscardContainsName") {
    const wanted = normalizeCardNameKey(value);
    if (!wanted) {
      return false;
    }
    return (board.players[attackerIndex]?.attackDiscard || [])
      .some((card) => normalizeCardNameKey(card?.name) === wanted);
  }
  return false;
}

function resolveComparatorStatValue(board, playerIndex, unit, statKey, exchange) {
  const stat = String(statKey || "").toLowerCase().trim();
  if (stat === "mugiccounters") {
    return Number(unit?.mugicCounters || 0);
  }
  return unitStat(board, playerIndex, unit, stat, exchange);
}

function evaluateInitiativeWinner(board) {
  const attackerIndex = board.activePlayerIndex;
  const defenderIndex = targetPlayer(attackerIndex);
  const attacker = unitForPlayer(board, attackerIndex);
  const defender = unitForPlayer(board, defenderIndex);
  if (!attacker || !defender) {
    return attackerIndex;
  }

  const attackerSurprise =
    Boolean(attacker.statuses?.plainSurprise) || (Boolean(attacker.statuses?.invisibilitySurprise) && hasInvisibilityAdvantage(attacker, defender));
  const defenderSurprise =
    Boolean(defender.statuses?.plainSurprise) || (Boolean(defender.statuses?.invisibilitySurprise) && hasInvisibilityAdvantage(defender, attacker));
  if (attackerSurprise !== defenderSurprise) {
    return attackerSurprise ? attackerIndex : defenderIndex;
  }

  const initiativeKey = parseInitiativeKey(board.locationCard);
  if (SIMPLE_STATS.includes(initiativeKey)) {
    const a = unitStat(board, attackerIndex, attacker, initiativeKey);
    const d = unitStat(board, defenderIndex, defender, initiativeKey);
    if (a > d) {
      return attackerIndex;
    }
    if (d > a) {
      return defenderIndex;
    }
  }

  if (ELEMENT_KEYS.includes(initiativeKey)) {
    const aHas = unitHasElement(attacker, (unit, stat) => unitStat(board, attackerIndex, unit, stat), initiativeKey);
    const dHas = unitHasElement(defender, (unit, stat) => unitStat(board, defenderIndex, unit, stat), initiativeKey);
    if (aHas !== dHas) {
      return aHas ? attackerIndex : defenderIndex;
    }
  }

  if (supportsTribe(attacker, initiativeKey) !== supportsTribe(defender, initiativeKey)) {
    return supportsTribe(attacker, initiativeKey) ? attackerIndex : defenderIndex;
  }

  return attackerIndex;
}

function makeExchangeContext(board) {
  return {
    attackerSlots: {
      0: slotForPlayer(board, 0),
      1: slotForPlayer(board, 1),
    },
    chosenAttacks: { 0: null, 1: null },
    statAdjustments: {
      0: createTempStatMap(),
      1: createTempStatMap(),
    },
    damageToCreature: zeroAttackMap(),
    healToCreature: zeroAttackMap(),
    attackDamageAdd: zeroAttackMap(),
    attackDamageReduce: zeroAttackMap(),
    attackDamageSet: { 0: null, 1: null },
    firstAttackZero: { 0: false, 1: false },
    forceFirstAttackForPlayer: { 0: false, 1: false },
    forceRandomAttack: { 0: false, 1: false },
    healBlocked: { 0: false, 1: false },
    preventElementGain: { 0: false, 1: false },
    preventMugicCounterGain: { 0: false, 1: false },
    statSetValues: {
      0: {},
      1: {},
    },
    allowAnyTribeMugic: { 0: false, 1: false },
    allowSpecificTribeMugic: { 0: new Set(), 1: new Set() },
    nextAttackDamageBonusThisTurn: { 0: 0, 1: 0 },
    conditionalDamageTriggered: {
      0: new Set(),
      1: new Set(),
    },
    mugicCounterDelta: zeroAttackMap(),
    mugicCostIncrease: zeroAttackMap(),
    activatedAbilityUsed: { 0: false, 1: false },
    disableMugic: false,
    disableBattlegear: false,
    battlegearIndestructible: false,
    forceRevealLocation: false,
    replaceAttackDamageWithDisciplineLoss: { 0: false, 1: false },
    replaceMugicOrAbilityDamageWithEnergyGainUnitIds: new Set(),
    attackReflectByStackIndex: new Map(),
    destroyIfAllDisciplinesZero: false,
    countDiscardCreaturesAsControlledType: { 0: new Set(), 1: new Set() },
    elementSuppressed: {
      0: new Set(),
      1: new Set(),
    },
    pendingTempMods: [],
    mugicWindow: null,
    abilityWindow: null,
    runtime: {
      appliedEffects: [],
    },
    damageEvents: [],
  };
}

function allPlayersHaveAttackChoice(board) {
  return board.pendingAttacks[0] !== null && board.pendingAttacks[1] !== null;
}

function scoreAttack(board, playerIndex, attackCard, exchange) {
  const attacker = unitForPlayer(board, playerIndex);
  const defender = unitForPlayer(board, targetPlayer(playerIndex));
  if (!attacker || !defender || !attackCard) {
    return -Infinity;
  }

  let score = Number(attackCard.stats?.base || 0);
  ELEMENT_KEYS.forEach((element) => {
    const attackDamage = Number(attackCard.stats?.[`${element}Attack`] || 0);
    if (!attackDamage) {
      return;
    }
    if (exchange.elementSuppressed[playerIndex].has(element)) {
      return;
    }
    if (unitStat(board, playerIndex, attacker, element, exchange) > 0) {
      score += attackDamage;
    }
  });

  const effects = attackCard.parsedEffects || [];
  effects.forEach((effect) => {
    if (effect.kind === "conditionalDamage" && effect.stat) {
      const threshold = Number(effect.threshold || 0);
      const attackerStatValue = unitStat(board, playerIndex, attacker, effect.stat, exchange);
      const defenderStatValue = unitStat(board, targetPlayer(playerIndex), defender, effect.stat, exchange);
      const diff = attackerStatValue - defenderStatValue;
      const comparator = effect.comparator || "diffGte";
      const autoStatCheck = effect.mode === "stat_check" && attackerHasStatCheckAutoSuccess(board, playerIndex, attacker, exchange);
      const triggered =
        autoStatCheck ||
        (comparator === "selfGte" && attackerStatValue >= threshold) ||
        (comparator === "selfLte" && attackerStatValue <= threshold) ||
        (comparator === "diffGte" && diff >= threshold);
      if (triggered) {
        score += Number(effect.amount || 0);
      }
    }
    if (effect.kind === "dealDamage") {
      score += Number(effect.amount || 0);
    }
  });

  return score;
}

function chooseBestAttack(board, playerIndex, exchange) {
  const player = board.players[playerIndex];
  if (!player.attackHand.length) {
    return -1;
  }
  let bestIndex = 0;
  let bestScore = -Infinity;
  player.attackHand.forEach((attackCard, index) => {
    const score = scoreAttack(board, playerIndex, attackCard, exchange);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function chooseRandomAttackIndex(player) {
  if (!player?.attackHand?.length) {
    return -1;
  }
  return Math.floor(Math.random() * player.attackHand.length);
}

function shouldForceRandomAttackChoice(board, playerIndex, exchange) {
  if (exchange?.forceRandomAttack?.[playerIndex]) {
    return true;
  }
  const unit = unitForPlayer(board, playerIndex);
  const opposingUnit = unitForPlayer(board, targetPlayer(playerIndex));
  if (!unit || !opposingUnit) {
    return false;
  }
  const opposingEffects = combinedParsedEffects(opposingUnit);
  return opposingEffects.some((effect) => {
    if (!effect || !effect.kind) {
      return false;
    }
    if (effect.kind === "forceOpponentRandomAttack") {
      return true;
    }
    if (effect.kind !== "forceOpponentRandomAttackIfHigherMugic") {
      return false;
    }
    return Number(opposingUnit.mugicCounters || 0) > Number(unit.mugicCounters || 0);
  });
}

function aliveUnitsForPlayer(board, playerIndex) {
  return (board.players[playerIndex]?.creatures || []).filter((unit) => unit && !unit.defeated);
}

function availableMugicSlots(player) {
  return (player?.mugicSlots || []).filter(
    (entry) => entry && entry.available && !entry.queued && !entry.spent && entry.card
  );
}

function setMugicSlotState(slotEntry, nextState = {}) {
  if (!slotEntry) {
    return;
  }
  if (nextState.available !== undefined) {
    slotEntry.available = Boolean(nextState.available);
  }
  if (nextState.queued !== undefined) {
    slotEntry.queued = Boolean(nextState.queued);
  }
  if (nextState.spent !== undefined) {
    slotEntry.spent = Boolean(nextState.spent);
  }
  if (nextState.disabledByEffect !== undefined) {
    slotEntry.disabledByEffect = Boolean(nextState.disabledByEffect);
  }
}

function markQueuedMugicSlot(player, slotIndex) {
  const slotEntry = (player?.mugicSlots || []).find(
    (entry) => entry && Number(entry.slotIndex) === Number(slotIndex)
  );
  if (!slotEntry) {
    return null;
  }
  setMugicSlotState(slotEntry, {
    available: false,
    queued: true,
    spent: false,
    disabledByEffect: false,
  });
  return slotEntry;
}

function markSpentMugicSlot(board, playerIndex, slotIndex) {
  const player = board?.players?.[playerIndex];
  const slotEntry = (player?.mugicSlots || []).find(
    (entry) => entry && Number(entry.slotIndex) === Number(slotIndex)
  );
  if (!slotEntry) {
    return;
  }
  setMugicSlotState(slotEntry, {
    available: false,
    queued: false,
    spent: true,
    disabledByEffect: false,
  });
}

function mugicCostForUnit(board, playerIndex, unit, mugicCard, exchange) {
  const baseCost = Math.max(0, Number(mugicCard?.stats?.cost || 0));
  const addedCost = Math.max(0, Number(exchange?.mugicCostIncrease?.[playerIndex] || 0));
  const parsedReductionEntries = combinedParsedEffects(unit).filter(
    (effect) => effect?.kind === "mugicCostReduction" && effectCreatureNameMatchesUnit(effect, unit)
  );
  const parsedReductionAmount = parsedReductionEntries.reduce(
    (sum, effect) => sum + Math.max(0, Number(effect.amount || 0)),
    0
  );
  const parsedMinimum = parsedReductionEntries.reduce(
    (max, effect) => Math.max(max, Math.max(0, Number(effect.minimum || 0))),
    0
  );
  const reductionPayload = unit?.statuses?.mugicCostReduction;
  const reduction = Math.max(0, Number(reductionPayload?.amount || 0), parsedReductionAmount);
  const minimum = Math.max(0, Number(reductionPayload?.minimum || 0), parsedMinimum);
  return Math.max(minimum, baseCost + addedCost - reduction);
}

function eligibleMugicCasters(board, playerIndex, mugicCard, exchange, preferredUnitId = null) {
  const list = aliveUnitsForPlayer(board, playerIndex)
    .filter((unit) => canCreaturePlayMugicCard(board, playerIndex, unit, mugicCard))
    .filter((unit) => Number(unit.mugicCounters || 0) >= mugicCostForUnit(board, playerIndex, unit, mugicCard, exchange))
    .sort((a, b) => {
      const preferredA = preferredUnitId && a.unitId === preferredUnitId ? 1 : 0;
      const preferredB = preferredUnitId && b.unitId === preferredUnitId ? 1 : 0;
      if (preferredA !== preferredB) {
        return preferredB - preferredA;
      }
      const engagedA = isUnitCurrentlyEngaged(board, playerIndex, a) ? 1 : 0;
      const engagedB = isUnitCurrentlyEngaged(board, playerIndex, b) ? 1 : 0;
      if (engagedA !== engagedB) {
        return engagedB - engagedA;
      }
      return Number(b.mugicCounters || 0) - Number(a.mugicCounters || 0);
    });
  return {
    cost: list.length ? mugicCostForUnit(board, playerIndex, list[0], mugicCard, exchange) : Infinity,
    units: list,
  };
}

function resolveActivationCasterUnit(board, playerIndex, preferredUnitId = null) {
  if (preferredUnitId) {
    const found = findUnitById(board, preferredUnitId);
    if (found?.playerIndex === playerIndex && found.unit && !found.unit.defeated) {
      return found.unit;
    }
  }
  const engaged = unitForPlayer(board, playerIndex);
  if (engaged && !engaged.defeated) {
    return engaged;
  }
  return aliveUnitsForPlayer(board, playerIndex)[0] || null;
}

function chooseBestMugicCaster(board, playerIndex, mugicCard, exchange, preferredUnitId = null) {
  const casterPool = eligibleMugicCasters(board, playerIndex, mugicCard, exchange, preferredUnitId);
  if (!casterPool.units.length) {
    return null;
  }
  return {
    unit: casterPool.units[0],
    cost: casterPool.cost,
  };
}

function collectPlayableMugicCards(board, playerIndex, exchange) {
  const player = board.players[playerIndex];
  if (!player) {
    return [];
  }
  return availableMugicSlots(player)
    .map((slotEntry) => {
      const card = slotEntry.card;
      const casterPool = eligibleMugicCasters(board, playerIndex, card, exchange);
      if (!casterPool.units.length) {
        return null;
      }
      return casterPool.units.map((unit) => ({
        mugicIndex: Number(slotEntry.slotIndex),
        card,
        cost: mugicCostForUnit(board, playerIndex, unit, card, exchange),
        casterUnitId: unit.unitId,
        casterSlot: unit.slot,
      }));
    })
    .filter(Boolean);
}

function flattenPlayableMugicEntries(playableEntries) {
  return playableEntries.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
}

function pickDisciplineForChoice(board, sourcePlayerIndex, targetPlayerIndex, targetUnit, exchange, amount) {
  if (!targetUnit) {
    return "courage";
  }
  const pool = ["courage", "power", "wisdom", "speed"].map((stat) => ({
    stat,
    value: unitStat(board, targetPlayerIndex, targetUnit, stat, exchange),
  }));
  const isBuff = Number(amount) >= 0;
  const targetIsSource = sourcePlayerIndex === targetPlayerIndex;
  const sortDesc = (a, b) => b.value - a.value;
  const sortAsc = (a, b) => a.value - b.value;
  const sorted = [...pool].sort(
    isBuff
      ? (targetIsSource ? sortDesc : sortAsc)
      : (targetIsSource ? sortAsc : sortDesc)
  );
  return sorted[0]?.stat || "courage";
}

function getEngagementCandidates(board, playerIndex) {
  const occupancy = getOccupancyByLetter(board);
  const list = [];
  board.players[playerIndex].creatures.forEach((unit) => {
    if (!unit || unit.defeated) {
      return;
    }
    const attackerLetter = unitPositionLetter(playerIndex, unit);
    (BOARD_ADJACENCY[attackerLetter] || []).forEach((adjacentLetter) => {
      const enemyEntry = occupancy.get(adjacentLetter);
      if (enemyEntry && enemyEntry.playerIndex !== playerIndex && !enemyEntry.unit.defeated) {
        list.push({
          attackerSlot: unit.slot,
          defenderSlot: enemyEntry.unit.slot,
          attackerLetter,
          defenderLetter: adjacentLetter,
          attackerUnitId: unit.unitId,
          score: 1000 - Number(enemyEntry.unit.currentEnergy || 0),
        });
      }
    });
  });
  return list.sort((a, b) => b.score - a.score);
}

function findBestMoveForEngagement(board, playerIndex) {
  const player = board.players[playerIndex];
  const enemy = board.players[targetPlayer(playerIndex)];
  let best = null;
  player.creatures.forEach((unit) => {
    if (!unit || unit.defeated) {
      return;
    }
    if (unit.movedThisAction) {
      return;
    }
    const from = unit.slot;
    ownAdjacentSlots(playerIndex, from).forEach((to) => {
      const destinationUnit = player.creatures[to];
      if (!destinationUnit || !destinationUnit.defeated) {
        return;
      }
      const enemySlots = enemyAdjacentSlots(playerIndex, to);
      const targets = enemySlots
        .map((slot) => enemy.creatures[slot])
        .filter((targetUnit) => targetUnit && !targetUnit.defeated);
      const engageScore = targets.length
        ? 1200 - Math.min(...targets.map((targetUnit) => Number(targetUnit.currentEnergy || 0)))
        : 0;
      const score = engageScore + (to >= 3 ? 50 : 0);
      if (!best || score > best.score) {
        best = { from, to, score };
      }
    });
  });
  return best;
}

function parseActivationCost(text) {
  const raw = String(text || "");
  const normalizedRaw = raw
    .replace(/\{\{MC\}\}/gi, "MC")
    .replace(/\bMP\b/gi, "MC");
  const prefixSegment = normalizedRaw.split(":")[0] || "";
  const compactPrefix = prefixSegment.replace(/[^A-Za-z0-9]/g, "");
  const mcMatch = normalizedRaw.match(/^(?:\s*(\d+)\s*)?(MC+)\b/i);
  if (mcMatch) {
    const explicit = Number(mcMatch[1] || NaN);
    const counted = (String(mcMatch[2]).match(/C/gi) || []).length;
    const amount = Number.isFinite(explicit) ? explicit : Math.max(1, counted);
    return { type: "mugic", amount: Math.max(0, amount), label: `MC x${Math.max(0, amount)}` };
  }
  if (/^MC\d+$/i.test(compactPrefix)) {
    const amount = Number(compactPrefix.slice(2) || 0);
    return { type: "mugic", amount: Math.max(0, amount), label: `MC x${Math.max(0, amount)}` };
  }
  const compactMc = compactPrefix.match(/^M(CM?)+$/i);
  if (compactMc && compactPrefix.toUpperCase().includes("MC")) {
    const amount = (compactPrefix.toUpperCase().match(/MC/g) || []).length;
    return { type: "mugic", amount: Math.max(1, amount), label: `MC x${Math.max(1, amount)}` };
  }
  const explicitSpend = normalizedRaw.match(/\bspend\s+(\d+)\s+MC\b/i);
  if (explicitSpend) {
    const amount = Number(explicitSpend[1] || 0);
    return { type: "mugic", amount: Math.max(0, amount), label: `MC x${Math.max(0, amount)}` };
  }
  const expendMatch = normalizedRaw.match(/\bExpend\s+(Fire|Air|Earth|Water)\b/i);
  if (expendMatch) {
    return { type: "expendElement", element: String(expendMatch[1]).toLowerCase(), amount: 1, label: `Expend ${expendMatch[1]}` };
  }
  if (/\bExpend\s+any Elemental Type\b/i.test(normalizedRaw)) {
    return { type: "expendAnyElement", amount: 1, label: "Expend any Elemental Type" };
  }
  const expendAllMatch = normalizedRaw.match(/\bExpend\s+all Disciplines\s*(\d+)?\b/i);
  if (expendAllMatch) {
    const amount = Number(expendAllMatch[1] || 1);
    return { type: "expendAllDisciplines", amount, label: `Expend all Disciplines ${amount}` };
  }
  const discardMatch = normalizedRaw.match(/\bDiscard\s+((?:a|an|one|two|\d+))\s+Mugic\s+Cards?\b/i);
  if (discardMatch) {
    const token = String(discardMatch[1] || "").toLowerCase();
    const amountMap = { a: 1, an: 1, one: 1, two: 2 };
    const amount = Number.isFinite(Number(token))
      ? Number(token)
      : (amountMap[token] || 1);
    return { type: "discardMugic", amount: Math.max(1, amount), label: `Discard ${Math.max(1, amount)} Mugic` };
  }
  return null;
}

function normalizeRuleText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractActivationBodies(text) {
  const raw = String(text || "");
  if (!raw) {
    return [];
  }
  const prefixRegex =
    /\b(?:\d*\s*M(?:C)+|\bspend\s+\d+\s+M(?:P|C)\b|Expend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines(?:\s+\d+)?|any Elemental Type))?|Discard\s+(?:a|an|one|two|\d+)\s+Mugic\s+Cards?)\s*:/gi;
  const matches = [...raw.matchAll(prefixRegex)];
  if (!matches.length) {
    return [];
  }
  const bodies = [];
  matches.forEach((match, index) => {
    const start = Number(match.index || 0) + String(match[0] || "").length;
    const end = index + 1 < matches.length ? Number(matches[index + 1].index || raw.length) : raw.length;
    const body = normalizeRuleText(raw.slice(start, end));
    if (body) {
      bodies.push(body);
    }
  });
  return bodies;
}

function splitCardEffectsByActivation(card) {
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const activationBodies = extractActivationBodies(card?.ability);
  
  const activated = [];
  const triggered = [];
  const passive = [];
  const passive_continuous = [];

  effects.forEach((effect) => {
    const sourceText = normalizeRuleText(effect?.sourceText || "");
    const lowerSource = sourceText.toLowerCase();
    const timing = EFFECT_RUNTIME_REGISTRY.get(effect.kind)?.timing || "";
    
    // 1. Activated Check
    if (sourceText && activationBodies.length && activationBodies.some((body) => body.includes(sourceText))) {
      activated.push({ ...effect, activationType: "activated" });
      return;
    }
    
    // 2. Triggered Check
    if (
      timing === "triggered" ||
      timing === "begin_turn" ||
      timing === "begin_combat" ||
      timing === "setup" ||
      effect.kind === "infectTargetedOpposingUninfectedCreature" ||
      effect.kind === "onTakesAttackDamageGrantAttackBonus" ||
      effect.kind === "onNextAttackDamageReduceOpposingDisciplinesByDamage" ||
      effect.kind === "gainElementsFromIncomingAttack" ||
      effect.kind === "onGainElementGainElementValue" ||
      lowerSource.startsWith("when") ||
      lowerSource.startsWith("whenever") ||
      lowerSource.startsWith("at the beginning") ||
      lowerSource.startsWith("at the end")
    ) {
      const triggeredEffect = { ...effect, activationType: "triggered" };
      triggered.push(triggeredEffect);
      passive.push(triggeredEffect);
      return;
    }
    
    // 3. Passive Continuous
    const passiveEffect = { ...effect, activationType: "passive_continuous" };
    passive_continuous.push(passiveEffect);
    passive.push(passiveEffect);
  });

  if (!activated.length && activationBodies.length) {
    const fallbackActivated = passive_continuous
      .filter((effect) => ACTIVATABLE_EFFECT_KINDS.has(effect?.kind))
      .filter((effect) => {
        const source = normalizeRuleText(effect?.sourceText || "");
        if (!source) return true;
        if (source.startsWith("support") || source.startsWith("intimidate") || source.startsWith("outperform")) {
          return false;
        }
        if (source.includes("creatures you control") || source.includes("other creatures you control") || source.includes("all creatures")) {
          return false;
        }
        return true;
      });
      
    if (fallbackActivated.length) {
      const activatedSet = new Set(fallbackActivated);
      const remainingPassive = passive_continuous.filter((effect) => !activatedSet.has(effect));
      return {
        activated: fallbackActivated.map(e => ({ ...e, activationType: "activated" })),
        triggered,
        passive_continuous: remainingPassive,
        passive: remainingPassive.concat(triggered),
      };
    }
  }

  return { activated, triggered, passive_continuous, passive };
}

function canPayActivationCost(board, playerIndex, unit, player, exchange, cost) {
  if (!cost) {
    return false;
  }
  if (cost.type === "mugic") {
    return Number(unit?.mugicCounters || 0) >= Number(cost.amount || 0);
  }
  if (cost.type === "discardMugic") {
    return availableMugicSlots(player).length >= Number(cost.amount || 1);
  }
  if (cost.type === "expendElement") {
    return unitStat(board, playerIndex, unit, cost.element, exchange) > 0;
  }
  if (cost.type === "expendAnyElement") {
    return ELEMENT_KEYS.some((element) => unitStat(board, playerIndex, unit, element, exchange) > 0);
  }
  if (cost.type === "expendAllDisciplines") {
    const amount = Number(cost.amount || 1);
    return ["courage", "power", "wisdom", "speed"].every((stat) => unitStat(board, playerIndex, unit, stat, exchange) >= amount);
  }
  return false;
}

function payActivationCost(board, playerIndex, unit, player, exchange, cost, battle = null) {
  if (cost.type === "mugic") {
    unit.mugicCounters = Math.max(0, Number(unit.mugicCounters || 0) - Number(cost.amount || 0));
    return true;
  }
  if (cost.type === "discardMugic") {
    const amount = Number(cost.amount || 1);
    for (let i = 0; i < amount; i += 1) {
      const nextSlot = availableMugicSlots(player)[0];
      if (!nextSlot) {
        break;
      }
      nextSlot.available = false;
      player.mugicDiscard.push(nextSlot.card);
    }
    return true;
  }
  if (cost.type === "expendElement") {
    const before = Number(unitStat(board, playerIndex, unit, cost.element, exchange) || 0);
    exchange.statAdjustments[playerIndex][cost.element] -= Number(cost.amount || 1);
    const after = Number(unitStat(board, playerIndex, unit, cost.element, exchange) || 0);
    if (battle && before > 0 && after <= 0) {
      triggerAllyElementLossHooks(board, battle, playerIndex, unit, [cost.element], "activation_cost");
    }
    return true;
  }
  if (cost.type === "expendAnyElement") {
    const picked = ELEMENT_KEYS
      .map((element) => ({ element, value: Number(unitStat(board, playerIndex, unit, element, exchange) || 0) }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)[0];
    if (!picked) {
      return false;
    }
    const before = Number(unitStat(board, playerIndex, unit, picked.element, exchange) || 0);
    exchange.statAdjustments[playerIndex][picked.element] -= Number(cost.amount || 1);
    cost.expendedElement = picked.element;
    const after = Number(unitStat(board, playerIndex, unit, picked.element, exchange) || 0);
    if (battle && before > 0 && after <= 0) {
      triggerAllyElementLossHooks(board, battle, playerIndex, unit, [picked.element], "activation_cost");
    }
    return true;
  }
  if (cost.type === "expendAllDisciplines") {
    const amount = Number(cost.amount || 1);
    ["courage", "power", "wisdom", "speed"].forEach((stat) => {
      exchange.statAdjustments[playerIndex][stat] -= amount;
    });
    return true;
  }
  return false;
}

function buildActivatedOptions(board, playerIndex, exchange) {
  const runtimeExchange = exchange || makeExchangeContext(board);
  const player = board.players[playerIndex];
  if (!player || runtimeExchange.activatedAbilityUsed?.[playerIndex]) {
    return [];
  }
  const minionActivatedGateActive = aliveUnitsForPlayer(board, playerIndex).some((sourceUnit) =>
    combinedParsedEffects(sourceUnit).some((effect) => effect.kind === "minionActivatedBlockedByChieftain")
  );
  const options = [];
  aliveUnitsForPlayer(board, playerIndex).forEach((unit) => {
    if (
      minionActivatedGateActive
      && unitHasCreatureType(unit, "minion")
      && playerControlsChieftain(board, playerIndex)
      && !unit.statuses?.ignoreChieftainGate
    ) {
      return;
    }
    const sources = [
      { key: "creature", card: activeCreatureCard(unit), label: activeCreatureCard(unit)?.name || "Creature" },
      { key: "gear", card: activeGearCard(unit), label: activeGearCard(unit)?.name || "Battlegear" },
    ].filter((source) => source.card);
    sources.forEach((source) => {
      const cost = parseActivationCost(source.card?.ability);
      if (!cost) {
        return;
      }
      if (!canPayActivationCost(board, playerIndex, unit, player, runtimeExchange, cost)) {
        return;
      }
      const effectBuckets = splitCardEffectsByActivation(source.card);
      const effects = (effectBuckets.activated || []).filter((effect) => ACTIVATABLE_EFFECT_KINDS.has(effect.kind));
      if (!effects.length) {
        return;
      }
      options.push({
        id: `${source.key}:${source.label}:${unit.unitId}`,
        sourceKey: source.key,
        sourceLabel: source.label,
        sourceUnitId: unit.unitId,
        sourceSlot: unit.slot,
        cost,
        effects,
      });
    });
  });
  return options;
}

function applyEffectAsDelta(board, exchange, sourcePlayerIndex, effect, runtimeContext = null) {
  if (!effect || !effect.stat || !Number.isFinite(effect.amount)) {
    return;
  }
  const amount = Number(effect.amount || 0);
  if (!amount) {
    return;
  }
  const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
  if (isInvalidTargetUnitSelection(selectedUnit)) {
    return;
  }
  if (selectedUnit && !selectedUnit.defeated) {
    selectedUnit.tempMods[effect.stat] = Number(selectedUnit.tempMods?.[effect.stat] || 0) + amount;
    return;
  }
  const affectedPlayerIndex = resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
  exchange.statAdjustments[affectedPlayerIndex][effect.stat] += amount;
}

function resolveKeywordGrantAmount(effect, runtimeContext = null) {
  if (Number.isFinite(Number(effect?.amount))) {
    return Math.max(0, Number(effect.amount));
  }
  if (String(effect?.amountFrom || "").toLowerCase() === "sourcemugiccounters") {
    const sourceUnit = runtimeContext?.sourceUnit || null;
    return Math.max(0, Number(sourceUnit?.mugicCounters || 0));
  }
  return 0;
}

function grantTemporaryKeywordToUnit(unit, keyword, amount = 0, sourceText = "") {
  if (!unit || unit.defeated || !keyword) {
    return false;
  }
  if (!Array.isArray(unit.tempEffects)) {
    unit.tempEffects = [];
  }
  const entry = {
    kind: "keyword",
    keyword: String(keyword).toLowerCase(),
    sourceText: String(sourceText || "").trim(),
  };
  if (Number.isFinite(Number(amount)) && Number(amount) > 0) {
    entry.amount = Number(amount);
  }
  unit.tempEffects.push(entry);
  recalculateUnitDerivedState(unit);
  return true;
}

function normalizeEffectForRuntime(effect, timing = "runtime") {
  if (!effect || !effect.kind) {
    return null;
  }
  const kind = String(effect.kind).trim();
  const registryMeta = EFFECT_RUNTIME_REGISTRY.get(kind) || null;
  return {
    ...effect,
    kind,
    target: effect.target ?? null,
    scope: effect.scope ?? registryMeta?.scope ?? null,
    timing: effect.timing ?? registryMeta?.timing ?? timing,
    sourceText: String(effect.sourceText || "").trim(),
  };
}

function applyParsedEffectsToExchange(board, sourcePlayerIndex, effects, exchange, logPrefix, battle, runtimeContext = null) {
  const runtimeSourcePlayerIndex = Number.isInteger(runtimeContext?.sourcePlayerIndex)
    ? runtimeContext.sourcePlayerIndex
    : sourcePlayerIndex;
  const runtimeSourceUnit = runtimeContext?.sourceUnit && !runtimeContext.sourceUnit.defeated
    ? runtimeContext.sourceUnit
    : null;
  const attacker = runtimeSourceUnit || unitForPlayer(board, runtimeSourcePlayerIndex) || unitForPlayer(board, sourcePlayerIndex);
  const defender = unitForPlayer(board, targetPlayer(runtimeSourcePlayerIndex));
  effects.forEach((rawEffect) => {
    const runtimeEffect = normalizeEffectForRuntime(rawEffect, battle?.phase || "runtime");
    if (!runtimeEffect) {
      return;
    }
    const effect = runtimeEffect;
    if (exchange?.runtime?.appliedEffects) {
      exchange.runtime.appliedEffects.push({
        kind: effect.kind,
        sourcePlayerIndex,
        timing: effect.timing,
      });
    }
    if ((effect.kind === "statModifier" || effect.kind === "elementModifier") && effect.stat) {
      applyEffectAsDelta(board, exchange, sourcePlayerIndex, effect, runtimeContext);
      return;
    }
    if (effect.kind === "grantRangeAndSwiftFromSourceMugicCounters") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit) {
        battle.log.push("[noop_filtered_context] grantRangeAndSwiftFromSourceMugicCounters: alvo invalido.");
        return;
      }
      const swiftAmount = resolveKeywordGrantAmount(effect, runtimeContext);
      const grantedRange = grantTemporaryKeywordToUnit(
        selectedUnit,
        "range",
        0,
        `${String(effect.sourceText || "").trim()} [Range]`
      );
      const grantedSwift = grantTemporaryKeywordToUnit(
        selectedUnit,
        "swift",
        swiftAmount,
        `${String(effect.sourceText || "").trim()} [Swift ${swiftAmount}]`
      );
      if (grantedRange || grantedSwift) {
        battle.log.push(`${unitDisplayName(selectedUnit)} ganha Range e Swift ${swiftAmount} ate o fim do turno.`);
        logEffect(battle, {
          type: "ability",
          source: runtimeContext?.sourceItem?.source || runtimeContext?.sourceUnit?.card?.name || "Habilidade",
          effectKind: "grantRangeAndSwiftFromSourceMugicCounters",
          targets: [unitDisplayName(selectedUnit)],
          description: `Range + Swift ${swiftAmount} ate o fim do turno`,
        });
      }
      return;
    }
    if (effect.kind === "keyword") {
      const spec = effectTargetSpec(effect);
      if (!spec?.required) {
        return;
      }
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit) {
        battle.log.push(`[noop_filtered_context] keyword.${String(effect.keyword || "").toLowerCase()}: alvo invalido.`);
        return;
      }
      const keyword = String(effect.keyword || "").toLowerCase();
      const amount = resolveKeywordGrantAmount(effect, runtimeContext);
      const applied = grantTemporaryKeywordToUnit(selectedUnit, keyword, amount, effect.sourceText || "");
      if (applied) {
        const suffix = Number(amount) > 0 ? ` ${amount}` : "";
        battle.log.push(`${unitDisplayName(selectedUnit)} ganha ${keyword}${suffix} ate o fim do turno.`);
      }
      return;
    }
    if (
      effect.kind === "conditionalStatModifier"
      && effect.stat
      && Number.isFinite(effect.amount)
      && !effect.requiresElement
    ) {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] conditionalStatModifier: alvo invalido.");
        return;
      }
      if (selectedUnit && !selectedUnit.defeated) {
        selectedUnit.tempMods[effect.stat] = Number(selectedUnit.tempMods?.[effect.stat] || 0) + Number(effect.amount || 0);
        return;
      }
      const targetIndex = resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      exchange.statAdjustments[targetIndex][effect.stat] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "disciplineChoiceModifier" && Number.isFinite(effect.amount)) {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] disciplineChoiceModifier: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
      if (!targetUnit) {
        return;
      }
      const chosenStat = pickDisciplineForChoice(
        board,
        sourcePlayerIndex,
        targetIndex,
        targetUnit,
        exchange,
        Number(effect.amount || 0)
      );
      exchange.statAdjustments[targetIndex][chosenStat] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "setDisciplinesToScanned") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] setDisciplinesToScanned: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
      if (!targetUnit) {
        return;
      }
      ["courage", "power", "wisdom", "speed"].forEach((stat) => {
        const current = unitStat(board, targetIndex, targetUnit, stat, exchange);
        const scanned = Number(activeCreatureCard(targetUnit)?.stats?.[stat] || 0);
        exchange.statAdjustments[targetIndex][stat] += scanned - current;
      });
      return;
    }
    if (effect.kind === "beginCombatGainLowestDiscipline" && Number.isFinite(effect.amount)) {
      if (board.combat.exchangeCount > 0) {
        return;
      }
      const targetIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      const targetUnit = unitForPlayer(board, targetIndex);
      if (!targetUnit) {
        return;
      }
      const low = ["courage", "power", "wisdom", "speed"]
        .map((stat) => ({ stat, value: unitStat(board, targetIndex, targetUnit, stat, exchange) }))
        .sort((a, b) => a.value - b.value)[0];
      if (low?.stat) {
        exchange.statAdjustments[targetIndex][low.stat] += Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "removeElement" && effect.element) {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] removeElement: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
      if (!targetUnit) {
        return;
      }
      const currentElementValue = unitStat(board, targetIndex, targetUnit, effect.element, exchange);
      exchange.statAdjustments[targetIndex][effect.element] -= Math.max(0, currentElementValue);
      if (currentElementValue > 0) {
        triggerAllyElementLossHooks(
          board,
          battle,
          targetIndex,
          targetUnit,
          [effect.element],
          effect.sourceText || "removeElement"
        );
      }
      return;
    }
    if (effect.kind === "removeInvisibility") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] removeInvisibility: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
      if (targetUnit?.statuses) {
        targetUnit.statuses.invisibility = false;
        targetUnit.statuses.invisibilityStrike = 0;
        targetUnit.statuses.invisibilitySurprise = false;
      }
      return;
    }
    if (effect.kind === "attackDamageModifier") {
      const modifierValue = Number(effect.amount || 0);
      if (effect.modifier === "add") {
        exchange.attackDamageAdd[sourcePlayerIndex] += modifierValue;
      }
      if (effect.modifier === "reduce") {
        exchange.attackDamageReduce[targetPlayer(sourcePlayerIndex)] += modifierValue;
      }
      return;
    }
    if (effect.kind === "targetAttackDamageSet") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      const targetIndex = Number.isInteger(selectedAttack?.playerIndex)
        ? Number(selectedAttack.playerIndex)
        : effect.target === "opponent"
          ? targetPlayer(sourcePlayerIndex)
          : sourcePlayerIndex;
      exchange.attackDamageSet[targetIndex] = Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "targetAttackDamageModify") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      const targetIndex = Number.isInteger(selectedAttack?.playerIndex)
        ? Number(selectedAttack.playerIndex)
        : effect.target === "opponent"
          ? targetPlayer(sourcePlayerIndex)
          : sourcePlayerIndex;
      const amount = Number(effect.amount || 0);
      if (!amount) {
        return;
      }
      if (String(effect.modifier || "").toLowerCase() === "reduce") {
        exchange.attackDamageReduce[targetIndex] += amount;
      } else {
        exchange.attackDamageAdd[targetIndex] += amount;
      }
      return;
    }
    if (effect.kind === "targetAttackCountsAsFirst") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      const targetIndex = Number.isInteger(selectedAttack?.playerIndex)
        ? Number(selectedAttack.playerIndex)
        : sourcePlayerIndex;
      exchange.forceFirstAttackForPlayer[targetIndex] = true;
      return;
    }
    if (effect.kind === "mugicCounterModifier") {
      const amount = Number(effect.amount || 0);
      if (!amount) {
        return;
      }
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] mugicCounterModifier: alvo invalido.");
        return;
      }
      if (selectedUnit && !selectedUnit.defeated) {
        const owner = findUnitById(board, selectedUnit.unitId);
        if (amount > 0 && owner && !canGainMugicCounter(board, owner.playerIndex, selectedUnit, exchange)) {
          return;
        }
        selectedUnit.mugicCounters = Math.max(0, Number(selectedUnit.mugicCounters || 0) + amount);
        if (amount > 0 && owner) {
          triggerMugicCounterAddedHooks(board, battle, owner.playerIndex, selectedUnit, amount, effect.sourceText || "mugicCounterModifier");
        }
        return;
      }
      const target = effect.target || "self";
      if (effect.scope === "allCreatures") {
        const affected = target === "opponent" ? [targetPlayer(sourcePlayerIndex)] : target === "all" ? [0, 1] : [sourcePlayerIndex];
        affected.forEach((playerIndex) => {
          board.players[playerIndex].creatures.forEach((unit) => {
            if (!unit.defeated) {
              if (effect.noCountersOnly && Number(unit.mugicCounters || 0) > 0) {
                return;
              }
              if (amount > 0 && !canGainMugicCounter(board, playerIndex, unit, exchange)) {
                return;
              }
              unit.mugicCounters = Math.max(0, unit.mugicCounters + amount);
              if (amount > 0) {
                triggerMugicCounterAddedHooks(board, battle, playerIndex, unit, amount, effect.sourceText || "mugicCounterModifier");
              }
            }
          });
        });
        return;
      }
      const targetIndex = target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      exchange.mugicCounterDelta[targetIndex] += amount;
      return;
    }
    if (effect.kind === "preventMugicCounterGain") {
      const targetIndex = resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      exchange.preventMugicCounterGain[targetIndex] = true;
      const engagedTarget = unitForPlayer(board, targetIndex);
      if (engagedTarget) {
        engagedTarget.preventMugicCounterGain = true;
      }
      return;
    }
    if (effect.kind === "mugicCounterSet" && Number.isFinite(effect.amount)) {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] mugicCounterSet: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
      if (targetUnit && !targetUnit.defeated) {
        if (Number(effect.amount || 0) > Number(targetUnit.mugicCounters || 0) && !canGainMugicCounter(board, targetIndex, targetUnit, exchange)) {
          return;
        }
        const previous = Number(targetUnit.mugicCounters || 0);
        targetUnit.mugicCounters = Math.max(0, Number(effect.amount || 0));
        const gained = Math.max(0, Number(targetUnit.mugicCounters || 0) - previous);
        if (gained > 0) {
          triggerMugicCounterAddedHooks(board, battle, targetIndex, targetUnit, gained, effect.sourceText || "mugicCounterSet");
        }
      }
      return;
    }
    if (effect.kind === "conditionalStatSet") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] conditionalStatSet: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      if (effect.requiresElement) {
        const unit = unitForPlayer(board, sourcePlayerIndex);
        if (unitStat(board, sourcePlayerIndex, unit, effect.requiresElement, exchange) <= 0) {
          return;
        }
      }
      if (!effect.stat || !Number.isFinite(Number(effect.value))) {
        return;
      }
      exchange.statSetValues[targetIndex][effect.stat] = Number(effect.value);
      exchange.statAdjustments[targetIndex][effect.stat] = 0;
      return;
    }
    if (effect.kind === "mugicCounterMirrorRemove") {
      const sourceUnit = unitForPlayer(board, sourcePlayerIndex);
      const removeAmount = Math.max(0, Number(sourceUnit?.mugicCounters || 0));
      if (!removeAmount) {
        return;
      }
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] mugicCounterMirrorRemove: alvo invalido.");
        return;
      }
      const targetUnit =
        selectedUnit
        || unitForPlayer(board, effect.target === "self" ? sourcePlayerIndex : targetPlayer(sourcePlayerIndex));
      if (!targetUnit || targetUnit.defeated) {
        return;
      }
      targetUnit.mugicCounters = Math.max(0, Number(targetUnit.mugicCounters || 0) - removeAmount);
      return;
    }
    if (effect.kind === "mugicCounterRemoveTotal") {
      const totalToRemove = Math.max(0, Number(effect.total || 0));
      if (!totalToRemove) {
        return;
      }
      const targetIndex =
        effect.target === "self"
          ? sourcePlayerIndex
          : effect.target === "all"
            ? null
            : targetPlayer(sourcePlayerIndex);
      const targetPlayers = targetIndex === null ? [0, 1] : [targetIndex];
      targetPlayers.forEach((playerIndex) => {
        let remaining = totalToRemove;
        const units = (board.players[playerIndex]?.creatures || [])
          .filter((unit) => unit && !unit.defeated && Number(unit.mugicCounters || 0) > 0)
          .sort((a, b) => Number(b.mugicCounters || 0) - Number(a.mugicCounters || 0));
        units.forEach((unit) => {
          if (remaining <= 0) {
            return;
          }
          const available = Math.max(0, Number(unit.mugicCounters || 0));
          const removed = Math.min(available, remaining);
          unit.mugicCounters = available - removed;
          remaining -= removed;
        });
      });
      return;
    }
    if (effect.kind === "mugicCounterRemoveByStatThreshold") {
      const threshold = Number(effect.threshold || 0);
      const amount = Math.max(0, Number(effect.amount || 1));
      const stats = Array.isArray(effect.stats) ? effect.stats.filter(Boolean) : [];
      if (!amount || !stats.length) {
        return;
      }
      const candidates = [];
      if (String(effect.scope || "").toLowerCase() === "engagedall") {
        [0, 1].forEach((playerIndex) => {
          const unit = unitForPlayer(board, playerIndex);
          if (unit && !unit.defeated) {
            candidates.push({ playerIndex, unit });
          }
        });
      } else {
        const resolved = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
        if (resolved && !resolved.defeated && !isInvalidTargetUnitSelection(resolved)) {
          const owner = findUnitById(board, resolved.unitId);
          if (owner) {
            candidates.push({ playerIndex: owner.playerIndex, unit: resolved });
          }
        }
      }
      candidates.forEach(({ playerIndex, unit }) => {
        const failsThreshold = stats.some((stat) => Number(unitStat(board, playerIndex, unit, stat, exchange)) < threshold);
        if (!failsThreshold) {
          return;
        }
        unit.mugicCounters = Math.max(0, Number(unit.mugicCounters || 0) - amount);
      });
      return;
    }
    if (effect.kind === "mugicCostIncrease" && Number.isFinite(effect.amount)) {
      const targetIndex = effect.target === "self" ? sourcePlayerIndex : targetPlayer(sourcePlayerIndex);
      exchange.mugicCostIncrease[targetIndex] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "forceOpponentRandomAttack") {
      exchange.forceRandomAttack[targetPlayer(sourcePlayerIndex)] = true;
      return;
    }
    if (effect.kind === "forceOpponentRandomAttackIfHigherMugic") {
      if (Number(attacker?.mugicCounters || 0) > Number(defender?.mugicCounters || 0)) {
        exchange.forceRandomAttack[targetPlayer(sourcePlayerIndex)] = true;
      }
      return;
    }
    if (effect.kind === "negateMugic" || effect.kind === "disableTribalMugic") {
      exchange.disableMugic = true;
      return;
    }
    if (effect.kind === "negateMugicOrAbilityTargeting") {
      exchange.disableMugic = true;
      return;
    }
    if (effect.kind === "battlegearNoAbilities" || effect.kind === "suppressOpposingBattlegear") {
      exchange.disableBattlegear = true;
      return;
    }
    if (effect.kind === "battlegearIndestructible") {
      exchange.battlegearIndestructible = true;
      return;
    }
    if (effect.kind === "flipBattlegear") {
      const flipTo = String(effect.flipTo || effect.mode || "down").toLowerCase();
      const targets = collectBattlegearTargetsByScope(board, sourcePlayerIndex, effect, runtimeContext);
      if (!targets.length) {
        battle.log.push("[noop_filtered_context] flipBattlegear: alvo de battlegear invalido.");
        return;
      }
      targets.forEach((entry) => {
        destroyEngagedBattlegear(
          board,
          entry.playerIndex,
          battle,
          flipTo === "up" ? "face-up" : flipTo === "toggle" ? "alternado" : "face-down",
          "flip",
          entry.unit,
          flipTo
        );
      });
      return;
    }
    if (effect.kind === "flipBattlegearPair") {
      const engagedTargets = collectBattlegearTargetsByScope(
        board,
        sourcePlayerIndex,
        { ...effect, target: "all", scope: "engagedAll" },
        runtimeContext
      );
      const faceDown = engagedTargets.find((entry) => entry.unit?.gearCard && entry.unit.gearState === "face_down");
      const faceUp = engagedTargets.find((entry) => entry.unit?.gearCard && entry.unit.gearState !== "face_down");
      if (faceDown) {
        destroyEngagedBattlegear(board, faceDown.playerIndex, battle, "face-up", "flip", faceDown.unit, "up");
      }
      if (faceUp) {
        destroyEngagedBattlegear(board, faceUp.playerIndex, battle, "face-down", "flip", faceUp.unit, "down");
      }
      return;
    }
    if (effect.kind === "destroyBattlegear") {
      const targets = collectBattlegearTargetsByScope(board, sourcePlayerIndex, effect, runtimeContext);
      if (!targets.length) {
        battle.log.push("[noop_filtered_context] destroyBattlegear: alvo de battlegear invalido.");
        return;
      }
      targets.forEach((entry) => {
        destroyEngagedBattlegear(board, entry.playerIndex, battle, "foi destruido", "destroy", entry.unit);
      });
      return;
    }
    if (effect.kind === "destroyBattlegearByStatThreshold") {
      const threshold = Number(effect.threshold || 0);
      const stats = Array.isArray(effect.stats) ? effect.stats.filter(Boolean) : [];
      const targets = collectBattlegearTargetsByScope(board, sourcePlayerIndex, effect, runtimeContext);
      if (!targets.length || !stats.length) {
        return;
      }
      targets.forEach((entry) => {
        const belowThreshold = stats.some((stat) => Number(unitStat(board, entry.playerIndex, entry.unit, stat, exchange)) < threshold);
        if (!belowThreshold) {
          return;
        }
        destroyEngagedBattlegear(
          board,
          entry.playerIndex,
          battle,
          "Battlegear destruido por threshold.",
          "destroy",
          entry.unit
        );
      });
      return;
    }
    if (effect.kind === "healBlocked") {
      const targetIndex = resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      exchange.healBlocked[targetIndex] = true;
      return;
    }
    if (effect.kind === "revealNewLocation") {
      exchange.forceRevealLocation = true;
      return;
    }
    if (effect.kind === "treatCurrentAttackAsFirst") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      if (Number.isInteger(selectedAttack?.playerIndex)) {
        exchange.forceFirstAttackForPlayer[Number(selectedAttack.playerIndex)] = true;
      } else {
        exchange.forceFirstAttackForPlayer[sourcePlayerIndex] = true;
      }
      return;
    }
    if (effect.kind === "nextAttackThisCombatSetDamage") {
      battle.board.combat = battle.board.combat || {};
      battle.board.combat.nextAttackSetDamage = Number(effect.amount || 0);
      battle.board.combat.nextAttackSetBy = sourcePlayerIndex;
      return;
    }
    if (effect.kind === "attackUntargetable") {
      exchange.attackUntargetable = exchange.attackUntargetable || { 0: false, 1: false };
      exchange.attackUntargetable[sourcePlayerIndex] = true;
      return;
    }
    if (effect.kind === "gainElement" && Array.isArray(effect.elements)) {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] gainElement: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : resolveEffectTargetPlayerIndex(board, sourcePlayerIndex, effect, runtimeContext);
      if (selectedUnit?.preventElementGain) {
        return;
      }
      if (exchange.preventElementGain[targetIndex]) {
        return;
      }
      if (selectedUnit) {
        effect.elements.forEach((element) => {
          if (ELEMENT_KEYS.includes(element)) {
            selectedUnit.tempMods[element] = Number(selectedUnit.tempMods?.[element] || 0) + Number(effect.amount || 1);
          }
        });
      } else {
        effect.elements.forEach((element) => {
          if (ELEMENT_KEYS.includes(element)) {
            exchange.statAdjustments[targetIndex][element] += Number(effect.amount || 1);
          }
        });
      }
      return;
    }
    if (effect.kind === "cannotGainElementTypes") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] cannotGainElementTypes: alvo invalido.");
        return;
      }
      const selectedOwner = selectedUnit ? findUnitById(board, selectedUnit.unitId)?.playerIndex : null;
      const targetIndex = Number.isInteger(selectedOwner)
        ? selectedOwner
        : (effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex);
      if (effect.stat && Number.isFinite(effect.threshold)) {
        const targetUnit = selectedUnit || unitForPlayer(board, targetIndex);
        if (!targetUnit) {
          return;
        }
        const value = unitStat(board, targetIndex, targetUnit, effect.stat, exchange);
        if (value < Number(effect.threshold || 0)) {
          exchange.preventElementGain[targetIndex] = true;
          if (selectedUnit) {
            selectedUnit.preventElementGain = true;
          }
        }
        return;
      }
      exchange.preventElementGain[targetIndex] = true;
      if (selectedUnit) {
        selectedUnit.preventElementGain = true;
      }
      return;
    }
    if (effect.kind === "canPlayAnyTribeMugic") {
      const targetIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      exchange.allowAnyTribeMugic[targetIndex] = true;
      return;
    }
    if (effect.kind === "canPlaySpecificTribeMugic") {
      const targetIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      if (!(exchange.allowSpecificTribeMugic[targetIndex] instanceof Set)) {
        exchange.allowSpecificTribeMugic[targetIndex] = new Set();
      }
      const mugicTribe = normalizeTribeKey(effect.mugicTribe || effect.tribe);
      if (mugicTribe) {
        exchange.allowSpecificTribeMugic[targetIndex].add(mugicTribe);
      }
      return;
    }
    if (effect.kind === "playMugicFromGeneralDiscard") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit) {
        selectedUnit.canPlayMugicFromDiscard = true;
      }
      return;
    }
    if (effect.kind === "mugicPlayedFromDiscardExileOnResolve") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit) {
        selectedUnit.exileMugicPlayedFromDiscard = true;
      }
      return;
    }
    if (effect.kind === "nextAttackThisTurnDamageAdd") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit && selectedUnit.combat) {
        selectedUnit.combat.nextAttackBonus = Number(selectedUnit.combat.nextAttackBonus || 0) + Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "onTakesAttackDamageGrantAttackBonus") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit && selectedUnit.combat) {
        selectedUnit.combat.onTakesDamageAttackBonus = Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "playMugicOnAttackDamage") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit) {
        selectedUnit.freeMugicOnAttackDamage = {
          maxCost: Number(effect.maxCost || 0),
          ignoreCost: true,
        };
      }
      return;
    }
    if (effect.kind === "namedCounterOnCombatWin") {
      const counterKey = String(effect.counterKey || "").toLowerCase();
      if (!counterKey) {
        return;
      }
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit) {
        selectedUnit.pendingNamedCounterOnWin = {
          counterKey,
          amount: Number(effect.amount || 1),
          creatureName: String(effect.creatureName || "").trim(),
        };
      }
      return;
    }
    if (effect.kind === "alliedStatModifier" && effect.stat && Number.isFinite(effect.amount)) {
      const targetOwner = sourcePlayerIndex;
      const engagedUnit = unitForPlayer(board, targetOwner);
      if (!engagedUnit || engagedUnit.defeated) {
        return;
      }
      if (effect.excludeSelf && runtimeContext?.sourceUnit && engagedUnit.unitId === runtimeContext.sourceUnit.unitId) {
        return;
      }
      exchange.statAdjustments[targetOwner][effect.stat] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "discardPresenceStatAura" && effect.stat && Number.isFinite(effect.amount)) {
      const ownerIndex = sourcePlayerIndex;
      const sourceName = String(effect.sourceName || "").trim();
      const existsInDiscard = (board.players[ownerIndex]?.creatureDiscard || []).some((card) =>
        cardNameMatches(card?.name, sourceName)
      );
      if (!existsInDiscard) {
        return;
      }
      const requiredType = String(effect.requiredCreatureType || "").trim();
      const engagedUnit = unitForPlayer(board, ownerIndex);
      if (!engagedUnit || engagedUnit.defeated) {
        return;
      }
      if (requiredType && !unitHasCreatureType(engagedUnit, requiredType)) {
        return;
      }
      exchange.statAdjustments[ownerIndex][effect.stat] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "alliesStatPerNamedCounter" && effect.stat && Number.isFinite(effect.amountPerCounter)) {
      const ownerIndex = sourcePlayerIndex;
      const sourceName = String(effect.sourceCreatureName || "").trim();
      const sourceUnit = (board.players[ownerIndex]?.creatures || []).find((unit) =>
        unit && !unit.defeated && cardNameMatches(activeCreatureCard(unit)?.name, sourceName)
      );
      if (!sourceUnit) {
        return;
      }
      const total = unitNamedCounterValue(sourceUnit, String(effect.counterKey || "").toLowerCase());
      if (!total) {
        return;
      }
      const delta = total * Number(effect.amountPerCounter || 0);
      if (!delta) {
        return;
      }
      const engagedUnit = unitForPlayer(board, ownerIndex);
      if (!engagedUnit || engagedUnit.defeated) {
        return;
      }
      if (effect.excludeSelf && engagedUnit.unitId === sourceUnit.unitId) {
        return;
      }
      exchange.statAdjustments[ownerIndex][effect.stat] += delta;
      return;
    }
    if (effect.kind === "startsFaceUp") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (selectedUnit && selectedUnit.gearCard && selectedUnit.gearState === "face_down") {
        selectedUnit.gearState = "face_up";
      }
      return;
    }
    if (effect.kind === "boardMove") {
      applyBoardMoveByEffect(board, sourcePlayerIndex, effect, battle);
      return;
    }
    if (effect.kind === "relocateEffect") {
      applyRelocateEffect(board, sourcePlayerIndex, effect, battle);
      return;
    }
    if (effect.kind === "copyMugic") {
      applyCopyMugicEffect(board, sourcePlayerIndex, effect, battle);
      return;
    }
    if (effect.kind === "copyCreatureProfile") {
      applyCopyCreatureProfileEffect(board, sourcePlayerIndex, effect, battle, runtimeContext);
      return;
    }
    if (effect.kind === "infectTargetCreature") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] infectTargetCreature: alvo invalido.");
        return;
      }
      const targetUnit = selectedUnit || unitForPlayer(board, targetPlayer(sourcePlayerIndex));
      if (!targetUnit || targetUnit.defeated) {
        battle.log.push("[noop_filtered_context] infectTargetCreature: sem criatura alvo valida.");
        return;
      }
      if (effect?.targetSpec?.requireUninfected && isUnitInfected(targetUnit)) {
        return;
      }
      const owner = findUnitById(board, targetUnit.unitId);
      if (!owner) {
        return;
      }
      infectUnit(board, owner.playerIndex, targetUnit, effect.sourceText || "Infect", battle);
      return;
    }
    if (effect.kind === "uninfectOpposingThenInfectOwn") {
      const opposingIndex = targetPlayer(sourcePlayerIndex);
      const opposingUnits = aliveUnitsForPlayer(board, opposingIndex).filter((unit) => isUnitInfected(unit));
      let uninfectedCount = 0;
      opposingUnits.forEach((unit) => {
        if (uninfectUnit(board, opposingIndex, unit, effect.sourceText || "Uninfect", battle)) {
          uninfectedCount += 1;
        }
      });
      if (!uninfectedCount) {
        return;
      }
      const ownCandidates = aliveUnitsForPlayer(board, sourcePlayerIndex).filter((unit) => !isUnitInfected(unit));
      for (let index = 0; index < Math.min(uninfectedCount, ownCandidates.length); index += 1) {
        infectUnit(board, sourcePlayerIndex, ownCandidates[index], effect.sourceText || "Infect", battle);
      }
      return;
    }
    if (effect.kind === "infectTargetedOpposingUninfectedCreature") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        return;
      }
      const owner = findUnitById(board, selectedUnit.unitId);
      if (!owner || owner.playerIndex !== targetPlayer(sourcePlayerIndex) || isUnitInfected(selectedUnit)) {
        return;
      }
      infectUnit(board, owner.playerIndex, selectedUnit, effect.sourceText || "Infect", battle);
      return;
    }
    if (effect.kind === "nonDanianAttackDamageVsInfected") {
      const engagedAttacker = unitForPlayer(board, sourcePlayerIndex);
      const engagedDefender = unitForPlayer(board, targetPlayer(sourcePlayerIndex));
      if (!engagedAttacker || !engagedDefender || engagedAttacker.defeated || engagedDefender.defeated) {
        return;
      }
      const attackerTribe = normalizeTribeKey(activeCreatureCard(engagedAttacker)?.tribe);
      if (attackerTribe === "danian" || !isUnitInfected(engagedDefender)) {
        return;
      }
      exchange.attackDamageAdd[sourcePlayerIndex] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "beginCombatGainElementsFromInfectedCreatures") {
      if (Number(board?.combat?.exchangeCount || 0) > 0) {
        return;
      }
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        return;
      }
      const targetUnit = selectedUnit || resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (!targetUnit || targetUnit.defeated) {
        return;
      }
      const owner = findUnitById(board, targetUnit.unitId);
      if (!owner) {
        return;
      }
      const gained = new Set();
      [0, 1].forEach((playerIndex) => {
        aliveUnitsForPlayer(board, playerIndex)
          .filter((unit) => isUnitInfected(unit))
          .forEach((unit) => {
            ELEMENT_KEYS.forEach((element) => {
              if (unitStat(board, playerIndex, unit, element, exchange) > 0) {
                gained.add(element);
              }
            });
          });
      });
      if (!gained.size || exchange.preventElementGain[owner.playerIndex]) {
        return;
      }
      gained.forEach((element) => {
        if (unitStat(board, owner.playerIndex, targetUnit, element, exchange) <= 0) {
          targetUnit.tempMods[element] = Number(targetUnit.tempMods?.[element] || 0) + 1;
        }
      });
      return;
    }
    if (effect.kind === "minionActivatedBlockedByChieftain") {
      exchange.minionActivatedBlockedByChieftain = exchange.minionActivatedBlockedByChieftain || { 0: false, 1: false };
      exchange.minionActivatedBlockedByChieftain[sourcePlayerIndex] = true;
      return;
    }
    if (effect.kind === "targetMinionIgnoreChieftainRestriction") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        return;
      }
      if (!unitHasCreatureType(selectedUnit, "minion")) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.ignoreChieftainGate = true;
      return;
    }
    if (effect.kind === "incomingFirstAttackDamageReduction") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      if (!Array.isArray(selectedUnit.statuses.incomingDamageReductions)) {
        selectedUnit.statuses.incomingDamageReductions = [];
      }
      selectedUnit.statuses.incomingDamageReductions.push({
        amount: Number(effect.amount || 0),
        source: "attack",
        firstAttackOnly: true,
      });
      return;
    }
    if (effect.kind === "replaceAttackDamageWithDisciplineLoss") {
      exchange.replaceAttackDamageWithDisciplineLoss[sourcePlayerIndex] = true;
      return;
    }
    if (effect.kind === "destroyCreatureIfAllDisciplinesZero") {
      exchange.destroyIfAllDisciplinesZero = true;
      return;
    }
    if (effect.kind === "targetAttackReflectDamage") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      if (!selectedAttack || selectedAttack.type !== "attack_stack") {
        battle.log.push("[noop_filtered_context] targetAttackReflectDamage: sem Attack alvo valido na pilha.");
        return;
      }
      const stackIndex = Number(selectedAttack.stackIndex);
      if (!Number.isInteger(stackIndex) || stackIndex < 0) {
        battle.log.push("[noop_filtered_context] targetAttackReflectDamage: stackIndex invalido.");
        return;
      }
      exchange.attackReflectByStackIndex.set(stackIndex, {
        byPlayerIndex: sourcePlayerIndex,
        amountMultiplier: Number(effect.amountMultiplier || 1) || 1,
      });
      return;
    }
    if (effect.kind === "incomingNextAttackReduction") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] incomingNextAttackReduction: alvo invalido.");
        return;
      }
      addIncomingDamageReduction(selectedUnit, Number(effect.amount || 0), "attack", {
        firstAttackOnly: false,
        consumeOnMatch: true,
      });
      return;
    }
    if (effect.kind === "replaceMugicOrAbilityDamageWithEnergyGain") {
      const selectedUnit =
        resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext)
        || resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        return;
      }
      exchange.replaceMugicOrAbilityDamageWithEnergyGainUnitIds.add(selectedUnit.unitId);
      return;
    }
    if (effect.kind === "moveAsIfAdjacent") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.moveAsIfAdjacent = true;
      return;
    }
    if (effect.kind === "mustEngageIfPossible") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.mustEngageIfPossible = true;
      return;
    }
    if (effect.kind === "replaceMoveIntoOpposingWithRelocate") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.replaceMoveIntoOpposingWithRelocate = true;
      return;
    }
    if (effect.kind === "replaceBecomeEngagedBySwapWithUnderworld") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.replaceBecomeEngagedBySwapWithUnderworld = true;
      return;
    }
    if (effect.kind === "flipTargetBattlegearOnMugicCounterGain") {
      const selectedTarget = effectSelectionFromRuntime(effect, runtimeContext);
      if (!selectedTarget || selectedTarget.type !== "battlegear") {
        return;
      }
      const found = resolveUnitFromSelection(board, selectedTarget);
      if (!found?.unit || !found.unit.gearCard || found.unit.gearState === "face_down") {
        return;
      }
      destroyEngagedBattlegear(board, found.playerIndex, battle, "face-down", "flip", found.unit, "down");
      return;
    }
    if (effect.kind === "gainElementsFromIncomingAttack") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.gainElementsFromIncomingAttack = true;
      return;
    }
    if (effect.kind === "onGainElementGainElementValue") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.onGainElementGainElementValue = Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "gainInitiativeElementType") {
      if (Number(board?.combat?.exchangeCount || 0) > 0) {
        return;
      }
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      const owner = findUnitById(board, selectedUnit.unitId);
      if (!owner) {
        return;
      }
      const initiativeKey = parseInitiativeKey(board.locationCard);
      if (!ELEMENT_KEYS.includes(initiativeKey) || exchange.preventElementGain[owner.playerIndex]) {
        return;
      }
      if (unitStat(board, owner.playerIndex, selectedUnit, initiativeKey, exchange) <= 0) {
        selectedUnit.tempMods[initiativeKey] = Number(selectedUnit.tempMods?.[initiativeKey] || 0) + Number(effect.amount || 1);
      }
      return;
    }
    if (effect.kind === "engagedVsScoutNoInvisibility") {
      const sourceUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      const opposingUnit = unitForPlayer(board, targetPlayer(sourcePlayerIndex));
      if (!sourceUnit || !opposingUnit || sourceUnit.defeated || opposingUnit.defeated) {
        return;
      }
      if (!unitHasCreatureType(sourceUnit, "scout")) {
        return;
      }
      opposingUnit.statuses.invisibility = false;
      opposingUnit.statuses.invisibilityStrike = 0;
      opposingUnit.statuses.invisibilitySurprise = false;
      return;
    }
    if (effect.kind === "alliedStatModifierByElement" && effect.stat && Number.isFinite(effect.amount)) {
      const ownerIndex = sourcePlayerIndex;
      const engagedUnit = unitForPlayer(board, ownerIndex);
      if (!engagedUnit || engagedUnit.defeated) {
        return;
      }
      const requiredElement = String(effect.element || "").toLowerCase();
      if (requiredElement && unitStat(board, ownerIndex, engagedUnit, requiredElement, exchange) <= 0) {
        return;
      }
      const sourceUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (effect.excludeSelf && sourceUnit && engagedUnit.unitId === sourceUnit.unitId) {
        return;
      }
      exchange.statAdjustments[ownerIndex][effect.stat] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "countDiscardCreaturesAsControlledType") {
      const key = normalizeCreatureTypeKey(effect.creatureType);
      if (!key) {
        return;
      }
      exchange.countDiscardCreaturesAsControlledType[sourcePlayerIndex].add(key);
      return;
    }
    if (effect.kind === "mugicCostReduction") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.mugicCostReduction = {
        amount: Math.max(0, Number(effect.amount || 0)),
        minimum: Math.max(0, Number(effect.minimum || 0)),
      };
      return;
    }
    if (effect.kind === "onFirstAttackDamageGainSameEnergyIfControlTribe") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.onFirstAttackDamageGainSameEnergyIfControlTribe = {
        requiredTribe: normalizeTribeKey(effect.requiredTribe),
      };
      return;
    }
    if (effect.kind === "onPlayAttackWhileEquippedGainEnergy") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.onPlayAttackWhileEquippedGainEnergy = Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "onMugicCounterAddedLoseEnergy") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.onMugicCounterAddedLoseEnergy = Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "onTakeDamageSourceLosesEnergy") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || selectedUnit.defeated || !effectCreatureNameMatchesUnit(effect, selectedUnit)) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.onTakeDamageSourceLosesEnergy = Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "grantChosenElementValueToRecentDamager") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] grantChosenElementValueToRecentDamager: alvo invalido.");
        return;
      }
      const owner = findUnitById(board, selectedUnit.unitId);
      if (!owner) {
        return;
      }
      if (!selectedUnit?.statuses?.dealtAttackDamageThisTurn) {
        return;
      }
      const element = String(effect.chosenElement || effect.element || "fire").toLowerCase();
      if (!ELEMENT_KEYS.includes(element) || exchange.preventElementGain[owner.playerIndex]) {
        return;
      }
      selectedUnit.tempMods[element] = Number(selectedUnit.tempMods?.[element] || 0) + Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "removeChosenElementFromCreatureWithZeroDiscipline") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] removeChosenElementFromCreatureWithZeroDiscipline: alvo invalido.");
        return;
      }
      const owner = findUnitById(board, selectedUnit.unitId);
      if (!owner) {
        return;
      }
      const hasZeroDiscipline = ["courage", "power", "wisdom", "speed"].some(
        (stat) => Number(unitStat(board, owner.playerIndex, selectedUnit, stat, exchange)) <= 0
      );
      if (!hasZeroDiscipline) {
        return;
      }
      const chosenElement = ELEMENT_KEYS.find(
        (element) => Number(unitStat(board, owner.playerIndex, selectedUnit, element, exchange)) > 0
      );
      if (!chosenElement) {
        return;
      }
      const current = Number(unitStat(board, owner.playerIndex, selectedUnit, chosenElement, exchange) || 0);
      exchange.statAdjustments[owner.playerIndex][chosenElement] -= Math.max(0, current);
      if (current > 0) {
        triggerAllyElementLossHooks(
          board,
          battle,
          owner.playerIndex,
          selectedUnit,
          [chosenElement],
          effect.sourceText || "removeChosenElementFromCreatureWithZeroDiscipline"
        );
      }
      return;
    }
    if (effect.kind === "returnCreatureFromDiscardToBoard") {
      const selected = effectSelectionFromRuntime(effect, runtimeContext);
      const resurrected = resurrectCreatureFromDiscardSelection(board, selected);
      if (!resurrected) {
        battle.log.push("[noop_filtered_context] returnCreatureFromDiscardToBoard: sem carta/espaco valido.");
        return;
      }
      battle.log.push(
        `[resolved_effect] returnCreatureFromDiscardToBoard: ${resurrected.card.name} retorna para ${resurrected.letter}.`
      );
      return;
    }
    if (effect.kind === "swapBattlegearBetweenControlledCreatures") {
      const candidates = aliveUnitsForPlayer(board, sourcePlayerIndex).filter((unit) => {
        if (!unit?.gearCard) {
          return false;
        }
        if (effect.battlegearKeyword && !unitHasGearKeyword(unit, effect.battlegearKeyword)) {
          return false;
        }
        if (Array.isArray(effect.requiredCreatureTypes) && effect.requiredCreatureTypes.length) {
          return effect.requiredCreatureTypes.some((type) => unitHasCreatureType(unit, type));
        }
        return true;
      });
      if (candidates.length < 2) {
        battle.log.push("[noop_filtered_context] swapBattlegearBetweenControlledCreatures: faltam 2 alvos com gear.");
        return;
      }
      const [a, b] = candidates;
      const cardA = a.gearCard;
      const stateA = a.gearState;
      const modsA = a.gearPassiveMods;
      a.gearCard = b.gearCard;
      a.gearState = b.gearState;
      a.gearPassiveMods = b.gearPassiveMods;
      b.gearCard = cardA;
      b.gearState = stateA;
      b.gearPassiveMods = modsA;
      recalculateUnitDerivedState(a);
      recalculateUnitDerivedState(b);
      return;
    }
    if (effect.kind === "flipSelfBattlegearFaceUp") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(
        board,
        sourcePlayerIndex,
        effect,
        runtimeContext
      );
      if (!selectedUnit || !selectedUnit.gearCard || selectedUnit.gearState === "face_up") {
        return;
      }
      selectedUnit.gearState = "face_up";
      recalculateUnitDerivedState(selectedUnit);
      return;
    }
    if (effect.kind === "countsAsMugicBurst") {
      exchange.countsAsMugicBurst = exchange.countsAsMugicBurst || { 0: false, 1: false };
      exchange.countsAsMugicBurst[sourcePlayerIndex] = true;
      return;
    }
    if (effect.kind === "redirectNonAttackDamageToSelf") {
      const sourceUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (!sourceUnit || sourceUnit.defeated || isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] redirectNonAttackDamageToSelf: alvo invalido.");
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.nonAttackDamageRedirectToUnitId = sourceUnit.unitId;
      return;
    }
    if (effect.kind === "keywordIfControlTribe") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      const requiredTribe = normalizeTribeKey(effect.requiredTribe);
      if (!requiredTribe) {
        return;
      }
      const controlsRequired = aliveUnitsForPlayer(board, sourcePlayerIndex).some(
        (unit) => normalizeTribeKey(activeCreatureCard(unit)?.tribe) === requiredTribe
      );
      if (!controlsRequired) {
        return;
      }
      const keyword = String(effect.keyword || "").toLowerCase().trim();
      if (!keyword) {
        return;
      }
      grantTemporaryKeywordToUnit(selectedUnit, keyword, Number(effect.amount || 0), effect.sourceText || "");
      return;
    }
    if (effect.kind === "targetCreatureCountsAsChosenTribe") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] targetCreatureCountsAsChosenTribe: alvo invalido.");
        return;
      }
      const chosen = String(effect.chosenTribe || effect.tribe || "danian").trim();
      if (!chosen) {
        return;
      }
      addTemporaryCreatureType(selectedUnit, chosen);
      return;
    }
    if (effect.kind === "targetAttackLoseAllAbilities") {
      const selectedAttack = effectSelectionFromRuntime(effect, runtimeContext);
      if (!selectedAttack || selectedAttack.type !== "attack_stack") {
        battle.log.push("[noop_filtered_context] targetAttackLoseAllAbilities: sem Attack alvo valido na pilha.");
        return;
      }
      const stackIndex = Number(selectedAttack.stackIndex);
      const stackItem = Array.isArray(battle.burstStack) ? battle.burstStack[stackIndex] : null;
      if (!stackItem || stackItem.kind !== "attack") {
        battle.log.push("[noop_filtered_context] targetAttackLoseAllAbilities: stackIndex invalido.");
        return;
      }
      if (Array.isArray(stackItem.effectPayload)) {
        stackItem.effectPayload = [];
      }
      if (stackItem.attackCard && Array.isArray(stackItem.attackCard.parsedEffects)) {
        stackItem.attackCard = {
          ...stackItem.attackCard,
          parsedEffects: [],
        };
      }
      return;
    }
    if (effect.kind === "retargetSingleTargetMugic") {
      const selected = effectSelectionFromRuntime(effect, runtimeContext);
      if (!selected || selected.type !== "mugic_stack") {
        battle.log.push("[noop_filtered_context] retargetSingleTargetMugic: alvo de Mugic invalido.");
        return;
      }
      const stackIndex = Number(selected.stackIndex);
      const item = Array.isArray(battle.burstStack) ? battle.burstStack[stackIndex] : null;
      if (!item || (item.kind !== "mugic" && item.kind !== "mugic_copy")) {
        return;
      }
      item.allowRetarget = true;
      const sourceOwner = Number.isInteger(item.playerIndex) ? item.playerIndex : sourcePlayerIndex;
      const sourceUnit = resolveActivationCasterUnit(board, sourceOwner, item.sourceUnitId || null);
      const steps = buildTargetStepsForEffects(
        battle,
        sourceOwner,
        cloneEffectsWithRuntimeIndex(item.effectPayload || []),
        sourceUnit
      );
      if (!steps.length) {
        return;
      }
      const previousTargets = item.targetsSnapshot && typeof item.targetsSnapshot === "object" ? item.targetsSnapshot : {};
      const replacementTargets = {};
      steps.forEach((step) => {
        const previous = previousTargets[step.effectIndex] || previousTargets[String(step.effectIndex)] || null;
        const picked = (step.candidates || []).find((candidate) => {
          if (!previous) {
            return true;
          }
          return candidate.id !== previous.id;
        }) || null;
        if (picked) {
          replacementTargets[step.effectIndex] = picked;
        }
      });
      if (Object.keys(replacementTargets).length) {
        item.targetsSnapshot = replacementTargets;
        battle.log.push("[resolved_effect] retargetSingleTargetMugic: alvo(s) da Mugic alvo alterado(s).");
      }
      return;
    }
    if (effect.kind === "discardAttackReturnByBuildPointsOrDraw") {
      const owner = board.players[sourcePlayerIndex];
      const discarded = owner.attackHand.pop();
      if (!discarded) {
        drawCards(owner, "attackDeck", "attackDiscard", "attackHand", 1);
        return;
      }
      owner.attackDiscard.push(discarded);
      const discardedBp = Number(discarded?.stats?.bp || 0);
      const matchIndex = owner.attackDiscard.findIndex((card) =>
        card && card !== discarded && Number(card?.stats?.bp || 0) <= discardedBp
      );
      if (matchIndex >= 0) {
        const [recovered] = owner.attackDiscard.splice(matchIndex, 1);
        if (recovered) {
          owner.attackHand.push(recovered);
        }
      } else {
        drawCards(owner, "attackDeck", "attackDiscard", "attackHand", 1);
      }
      return;
    }
    if (effect.kind === "sacrificeFriendlyTribeForHeal") {
      const requiredTribe = normalizeTribeKey(effect.requiredTribe);
      const sourceUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (!sourceUnit || sourceUnit.defeated) {
        return;
      }
      if (sourceUnit.combat?.sacrificeFriendlyTribeForHealUsed) {
        return;
      }
      const sacrifice = aliveUnitsForPlayer(board, sourcePlayerIndex).find((unit) => {
        if (!unit || unit.unitId === sourceUnit.unitId || unit.defeated) {
          return false;
        }
        return !requiredTribe || normalizeTribeKey(activeCreatureCard(unit)?.tribe) === requiredTribe;
      });
      if (!sacrifice) {
        battle.log.push("[noop_filtered_context] sacrificeFriendlyTribeForHeal: sem criatura valida para sacrificar.");
        return;
      }
      sacrifice.currentEnergy = 0;
      sacrifice.defeated = true;
      sacrifice.positionLetter = null;
      board.players[sourcePlayerIndex].creatureDiscard.push(sacrifice.card);
      if (sacrifice.gearCard) {
        board.players[sourcePlayerIndex].battlegearDiscard.push(sacrifice.gearCard);
        stripUnitBattlegear(sacrifice);
      }
      exchange.healToCreature[sourcePlayerIndex] += Number(effect.amount || 0);
      sourceUnit.combat.sacrificeFriendlyTribeForHealUsed = true;
      return;
    }
    if (effect.kind === "targetDanianGainsExpendedElement") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit) || !selectedUnit || selectedUnit.defeated) {
        battle.log.push("[noop_filtered_context] targetDanianGainsExpendedElement: alvo invalido.");
        return;
      }
      const owner = findUnitById(board, selectedUnit.unitId);
      if (!owner || normalizeTribeKey(activeCreatureCard(selectedUnit)?.tribe) !== "danian") {
        return;
      }
      const expendedElement = String(runtimeContext?.costsPaid?.expendedElement || "").toLowerCase();
      if (!ELEMENT_KEYS.includes(expendedElement) || exchange.preventElementGain[owner.playerIndex]) {
        return;
      }
      if (unitStat(board, owner.playerIndex, selectedUnit, expendedElement, exchange) <= 0) {
        selectedUnit.tempMods[expendedElement] = Number(selectedUnit.tempMods?.[expendedElement] || 0) + 1;
      }
      return;
    }
    if (effect.kind === "onNextAttackDamageReduceOpposingDisciplinesByDamage") {
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      if (!selectedUnit.statuses || typeof selectedUnit.statuses !== "object") {
        selectedUnit.statuses = {};
      }
      selectedUnit.statuses.pendingNextAttackDisciplineLoss = true;
      return;
    }
    if (effect.kind === "beginCombatGainLowestScannedEnergyFromAllies") {
      if (Number(board?.combat?.exchangeCount || 0) > 0) {
        return;
      }
      const selectedUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      if (!selectedUnit || selectedUnit.defeated) {
        return;
      }
      const others = aliveUnitsForPlayer(board, sourcePlayerIndex).filter((unit) => unit.unitId !== selectedUnit.unitId);
      if (!others.length) {
        return;
      }
      const lowest = Math.min(
        ...others.map((unit) => Number(activeCreatureCard(unit)?.stats?.energy || 0))
      );
      if (lowest > 0) {
        selectedUnit.currentEnergy = clamp(
          Number(selectedUnit.currentEnergy || 0) + lowest,
          0,
          unitMaxEnergy(selectedUnit)
        );
      }
      return;
    }
    if (effect.kind === "beginCombatStealOpposingEngagedBattlegearIfUnequipped") {
      if (Number(board?.combat?.exchangeCount || 0) > 0) {
        return;
      }
      const sourceUnit = resolveEffectSourceCreatureForUnitScopedEffect(board, sourcePlayerIndex, effect, runtimeContext);
      const opposing = unitForPlayer(board, targetPlayer(sourcePlayerIndex));
      if (!sourceUnit || !opposing || sourceUnit.defeated || opposing.defeated) {
        return;
      }
      if (sourceUnit.gearCard) {
        return;
      }
      if (!opposing.gearCard) {
        return;
      }
      sourceUnit.gearCard = cloneCardForRuntime(opposing.gearCard);
      sourceUnit.gearState = opposing.gearState || "face_up";
      opposing.gearCard = null;
      opposing.gearState = null;
      opposing.gearPassiveMods = createTempStatMap();
      recalculateUnitDerivedState(opposing);
      recalculateUnitDerivedState(sourceUnit);
      return;
    }
    if (effect.kind === "preventDamage") {
      exchange.healToCreature[sourcePlayerIndex] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "preventHealingIfLowerStat" && effect.stat) {
      const targetIndex = effect.target === "self" ? sourcePlayerIndex : targetPlayer(sourcePlayerIndex);
      const targetUnit = unitForPlayer(board, targetIndex);
      const threshold = Number(effect.threshold || 0);
      if (targetUnit && unitStat(board, targetIndex, targetUnit, effect.stat, exchange) < threshold) {
        exchange.healBlocked[targetIndex] = true;
      }
      return;
    }
    if (effect.kind === "tribeStatModifier" && effect.tribe && effect.stat) {
      const targetIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      const unit = unitForPlayer(board, targetIndex);
      if (!unit) {
        return;
      }
      const tribe = String(activeCreatureCard(unit)?.tribe || "").toLowerCase();
      const required = String(effect.tribe || "").toLowerCase();
      if (tribe.includes(required)) {
        exchange.statAdjustments[targetIndex][effect.stat] += Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "activateHive") {
      board.combat.hiveActive = true;
      return;
    }
    if (effect.kind === "conditionalDealDamageIfStatus" && effect.status) {
      if (attacker && attacker.statuses && attacker.statuses[effect.status]) {
        const amount = Number(effect.amount || 0);
        const targetIndex = targetPlayer(sourcePlayerIndex);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "elementproof" && effect.element) {
      if (!attacker || !defender) {
        return;
      }
      if (board.combat.exchangeCount > 0) {
        return;
      }
      const defenderElementValue = unitStat(board, targetPlayer(sourcePlayerIndex), defender, effect.element, exchange);
      if (defenderElementValue > 0) {
        exchange.healToCreature[sourcePlayerIndex] += Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "beginCombatMugicCounterHigherStat" && effect.stat) {
      if (!attacker || !defender) {
        return;
      }
      const attackerValue = unitStat(board, sourcePlayerIndex, attacker, effect.stat, exchange);
      const defenderValue = unitStat(board, targetPlayer(sourcePlayerIndex), defender, effect.stat, exchange);
      if (attackerValue > defenderValue) {
        exchange.mugicCounterDelta[sourcePlayerIndex] += Number(effect.amount || 0);
      }
      if (defenderValue > attackerValue) {
        exchange.mugicCounterDelta[targetPlayer(sourcePlayerIndex)] += Number(effect.amount || 0);
      }
      return;
    }
    if (effect.kind === "disableMugicAndActivated") {
      exchange.disableMugic = true;
      return;
    }
    if (effect.kind === "conditionalDealDamageByStatusValue" && effect.status) {
      const statusValue = Number(attacker?.statuses?.[effect.status] || 0);
      if (statusValue > 0) {
        const multiplier = Number(effect.multiplier || 1);
        const amount = statusValue * multiplier;
        const targetIndex = targetPlayer(sourcePlayerIndex);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "dealDamage") {
      const amount = Math.max(0, Number(effect.amount || 0));
      if (!amount) {
        return;
      }
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] dealDamage: alvo invalido.");
        return;
      }
      if (selectedUnit && !selectedUnit.defeated) {
        if (exchange.replaceMugicOrAbilityDamageWithEnergyGainUnitIds.has(selectedUnit.unitId)) {
          selectedUnit.currentEnergy = clamp(
            Number(selectedUnit.currentEnergy || 0) + amount,
            0,
            unitMaxEnergy(selectedUnit)
          );
          return;
        }
        selectedUnit.currentEnergy = clamp(
          Number(selectedUnit.currentEnergy || 0) - amount,
          0,
          unitMaxEnergy(selectedUnit)
        );
        const selectedOwner = findUnitById(board, selectedUnit.unitId)?.playerIndex;
        if (Number.isInteger(selectedOwner)) {
          queueDamageEvent(
            exchange,
            selectedOwner,
            amount,
            "mugic",
            sourcePlayerIndex,
            runtimeSourceUnit?.unitId || null
          );
        }
        return;
      }
      const targetIndex = targetPlayer(sourcePlayerIndex);
      exchange.damageToCreature[targetIndex] += amount;
      queueDamageEvent(
        exchange,
        targetIndex,
        amount,
        "mugic",
        sourcePlayerIndex,
        runtimeSourceUnit?.unitId || null
      );
      return;
    }
    if (effect.kind === "healDamage") {
      const selectedUnit = resolveEffectTargetUnit(board, sourcePlayerIndex, effect, runtimeContext);
      if (isInvalidTargetUnitSelection(selectedUnit)) {
        battle.log.push("[noop_filtered_context] healDamage: alvo invalido.");
        return;
      }
      if (selectedUnit && !selectedUnit.defeated) {
        selectedUnit.currentEnergy = clamp(
          Number(selectedUnit.currentEnergy || 0) + Number(effect.amount || 0),
          0,
          unitMaxEnergy(selectedUnit)
        );
        return;
      }
      exchange.healToCreature[sourcePlayerIndex] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "drawDiscardAttack") {
      const drawAmount = Math.max(0, Number(effect.draw || 0));
      const discardAmount = Math.max(0, Number(effect.discard || 0));
      const targets =
        effect.target === "both"
          ? [0, 1]
          : effect.target === "opponent"
            ? [targetPlayer(sourcePlayerIndex)]
            : [sourcePlayerIndex];
      targets.forEach((playerIndex) => {
        const player = board.players[playerIndex];
        drawCards(player, "attackDeck", "attackDiscard", "attackHand", drawAmount);
        for (let i = 0; i < discardAmount && player.attackHand.length; i += 1) {
          const card = player.attackHand.shift();
          player.attackDiscard.push(card);
        }
      });
      return;
    }
    if (effect.kind === "discardNamedAttackForBonus") {
      const player = board.players[sourcePlayerIndex];
      const wanted = normalizeCardNameKey(effect.cardName || "");
      const idx = (player.attackHand || []).findIndex((card) => normalizeCardNameKey(card?.name || "") === wanted);
      if (idx < 0) {
        return;
      }
      const discarded = player.attackHand.splice(idx, 1)[0];
      if (discarded) {
        player.attackDiscard.push(discarded);
      }
      exchange.attackDamageAdd[sourcePlayerIndex] += Number(effect.bonusDamage || 0);
      drawCards(player, "attackDeck", "attackDiscard", "attackHand", Math.max(0, Number(effect.draw || 0)));
      return;
    }
    if (effect.kind === "shuffleAttackDeckWithDiscard") {
      const targets =
        effect.target === "both"
          ? [0, 1]
          : effect.target === "opponent"
            ? [targetPlayer(sourcePlayerIndex)]
            : [sourcePlayerIndex];
      targets.forEach((playerIndex) => {
        shuffleAttackDeckWithDiscardForPlayer(board.players[playerIndex]);
      });
      return;
    }
    if (effect.kind === "delayedOnDestroyedDrawDiscard") {
      if (!Array.isArray(battle.turnDelayedEffects)) {
        battle.turnDelayedEffects = [];
      }
      battle.turnDelayedEffects.push({
        kind: "onEngagedDestroyedDrawDiscard",
        owner: sourcePlayerIndex,
        draw: Math.max(0, Number(effect.draw || 0)),
        discard: Math.max(0, Number(effect.discard || 0)),
        expiresTurn: Number(board.turn || 0),
      });
      return;
    }
    if (effect.kind === "scryDeck") {
      const ownerIndex = effect.owner === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      const owner = board.players[ownerIndex];
      const deckType = String(effect.deckType || "").toLowerCase() === "location" ? "locationDeck" : "attackDeck";
      const deck = owner?.[deckType];
      if (!Array.isArray(deck) || !deck.length) {
        return;
      }
      if (effect.moveTopToBottom) {
        // Deck top is at array end; move top card to bottom (array start).
        const top = deck.pop();
        if (top) {
          deck.unshift(top);
        }
      }
      return;
    }
    if (effect.kind === "returnFromDiscard") {
      const ownerIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      const owner = board.players[ownerIndex];
      const cardType = String(effect.cardType || "").toLowerCase();
      if (!owner) {
        return;
      }
      if (cardType.includes("attack")) {
        const card = owner.attackDiscard.pop();
        if (card) {
          owner.attackHand.push(card);
        }
        return;
      }
      if (cardType.includes("mugic")) {
        const card = owner.mugicDiscard.pop();
        if (card) {
          const matchingSlot = (owner.mugicSlots || []).find(
            (entry) =>
              entry
              && (entry.spent || entry.queued || !entry.available)
              && (
                entry.card === card
                || entry.card?.id === card?.id
                || (entry.card?.name && entry.card?.name === card?.name)
              )
          );
          if (matchingSlot) {
            setMugicSlotState(matchingSlot, {
              available: true,
              queued: false,
              spent: false,
              disabledByEffect: false,
            });
          } else {
            const firstClosedSlot = (owner.mugicSlots || []).find(
              (entry) => entry && (!entry.available || entry.spent || entry.queued)
            );
            if (firstClosedSlot) {
              firstClosedSlot.card = card;
              setMugicSlotState(firstClosedSlot, {
                available: true,
                queued: false,
                spent: false,
                disabledByEffect: false,
              });
            } else {
              owner.mugicDiscard.push(card);
            }
          }
        }
        return;
      }
      if (cardType.includes("location")) {
        const card = owner.locationDiscard.pop();
        if (card) {
          owner.locationDeck.unshift(card);
        }
      }
      return;
    }
    if (effect.kind === "searchDeckToDiscard" && String(effect.deckType || "").toLowerCase() === "attack") {
      const player = board.players[sourcePlayerIndex];
      const count = Math.max(0, Number(effect.count || 0));
      for (let i = 0; i < count && player.attackDeck.length; i += 1) {
        const card = player.attackDeck.pop();
        if (card) {
          player.attackDiscard.push(card);
        }
      }
      return;
    }
    if (effect.kind === "beginCombatEnergy") {
      exchange.healToCreature[0] += Number(effect.amount || 0);
      exchange.healToCreature[1] += Number(effect.amount || 0);
      return;
    }
    if (effect.kind === "beginCombatDamage") {
      const amount = Number(effect.amount || 0);
      exchange.damageToCreature[0] += amount;
      exchange.damageToCreature[1] += amount;
      queueDamageEvent(exchange, 0, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      queueDamageEvent(exchange, 1, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      return;
    }
    if (effect.kind === "beginCombatAttackDiscardDraw") {
      if (board.combat.exchangeCount > 0) {
        return;
      }
      const targetIndex = effect.target === "self" ? sourcePlayerIndex : targetPlayer(sourcePlayerIndex);
      const targetPlayerState = board.players[targetIndex];
      if (!targetPlayerState.attackHand.length) {
        return;
      }
      let discardIndex = 0;
      let bestValue = -Infinity;
      targetPlayerState.attackHand.forEach((card, idx) => {
        const value = Number(card?.stats?.base || 0)
          + ELEMENT_KEYS.reduce((sum, element) => sum + Number(card?.stats?.[`${element}Attack`] || 0), 0);
        if (value > bestValue) {
          bestValue = value;
          discardIndex = idx;
        }
      });
      const discarded = targetPlayerState.attackHand.splice(discardIndex, 1)[0];
      if (discarded) {
        targetPlayerState.attackDiscard.push(discarded);
        drawCards(targetPlayerState, "attackDeck", "attackDiscard", "attackHand", Number(effect.draw || 1));
        battle.log.push(
          `${board.players[sourcePlayerIndex].label} forca descarte de ${discarded.name} de ${board.players[targetIndex].label}.`
        );
      }
      return;
    }
    if (effect.kind === "beginCombatDamagePerMissingElements") {
      if (board.combat.exchangeCount > 0 || !defender) {
        return;
      }
      const missing = ELEMENT_KEYS.filter(
        (element) => unitStat(board, targetPlayer(sourcePlayerIndex), defender, element, exchange) <= 0
      ).length;
      if (missing > 0) {
        const amount = missing * Number(effect.amount || 0);
        const targetIndex = targetPlayer(sourcePlayerIndex);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "beginCombatDamagePerLowDisciplines") {
      if (board.combat.exchangeCount > 0 || !defender) {
        return;
      }
      const threshold = Number(effect.threshold || 30);
      const lowCount = ["courage", "power", "wisdom", "speed"].filter(
        (stat) => unitStat(board, targetPlayer(sourcePlayerIndex), defender, stat, exchange) < threshold
      ).length;
      if (lowCount > 0) {
        const amount = lowCount * Number(effect.amount || 0);
        const targetIndex = targetPlayer(sourcePlayerIndex);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "setDisciplinesToOpposingScanned") {
      if (board.combat.exchangeCount > 0 || !attacker || !defender) {
        return;
      }
      ["courage", "power", "wisdom", "speed"].forEach((stat) => {
        const current = unitStat(board, sourcePlayerIndex, attacker, stat, exchange);
        const target = Number(activeCreatureCard(defender)?.stats?.[stat] || 0);
        exchange.statAdjustments[sourcePlayerIndex][stat] += target - current;
      });
      return;
    }
    if (effect.kind === "beginCombatLoseEnergyIfLower" && effect.stat) {
      if (!attacker || !defender) {
        return;
      }
      const threshold = Number(effect.threshold || 0);
      if (threshold > 0) {
        const defenderValue = unitStat(board, targetPlayer(sourcePlayerIndex), defender, effect.stat, exchange);
        if (defenderValue < threshold) {
          const amount = Number(effect.amount || 0);
          const targetIndex = targetPlayer(sourcePlayerIndex);
          exchange.damageToCreature[targetIndex] += amount;
          queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
        }
        return;
      }
      const attackerValue = unitStat(board, sourcePlayerIndex, attacker, effect.stat, exchange);
      const defenderValue = unitStat(board, targetPlayer(sourcePlayerIndex), defender, effect.stat, exchange);
      const amount = Number(effect.amount || 0);
      if (attackerValue < defenderValue) {
        exchange.damageToCreature[sourcePlayerIndex] += amount;
        queueDamageEvent(exchange, sourcePlayerIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      if (defenderValue < attackerValue) {
        const targetIndex = targetPlayer(sourcePlayerIndex);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "beginCombatGainElementsFromAllies") {
      if (!attacker) {
        return;
      }
      const candidateSlots = effect.adjacentOnly
        ? ownAdjacentSlots(sourcePlayerIndex, attacker.slot)
        : board.players[sourcePlayerIndex].creatures.map((unit) => unit.slot);
      const allyElements = new Set();
      candidateSlots.forEach((slot) => {
        const ally = board.players[sourcePlayerIndex].creatures[slot];
        if (!ally || ally.defeated || ally.slot === attacker.slot) {
          return;
        }
        ELEMENT_KEYS.forEach((element) => {
          if (unitStat(board, sourcePlayerIndex, ally, element, exchange) > 0) {
            allyElements.add(element);
          }
        });
      });
      allyElements.forEach((element) => {
        if (exchange.preventElementGain[sourcePlayerIndex]) {
          return;
        }
        if (unitStat(board, sourcePlayerIndex, attacker, element, exchange) <= 0) {
          exchange.statAdjustments[sourcePlayerIndex][element] += 1;
        }
      });
      return;
    }
    if (effect.kind === "firstAttackZeroIfLower" && effect.stat) {
      if (!attacker || !defender) {
        return;
      }
      const attackerValue = unitStat(board, sourcePlayerIndex, attacker, effect.stat, exchange);
      const defenderValue = unitStat(board, targetPlayer(sourcePlayerIndex), defender, effect.stat, exchange);
      if (attackerValue < defenderValue) {
        exchange.firstAttackZero[sourcePlayerIndex] = true;
      }
      if (defenderValue < attackerValue) {
        exchange.firstAttackZero[targetPlayer(sourcePlayerIndex)] = true;
      }
      return;
    }
    if (effect.kind === "destroyCreatureIfStatZero" && effect.stat) {
      const targetIndex = effect.target === "self" ? sourcePlayerIndex : targetPlayer(sourcePlayerIndex);
      const targetUnit = unitForPlayer(board, targetIndex);
      if (!targetUnit) {
        return;
      }
      const value = unitStat(board, targetIndex, targetUnit, effect.stat, exchange);
      if (value <= 0) {
        const amount = unitMaxEnergy(targetUnit);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "firstAttackZeroIfHigherCourageAndWisdom") {
      if (!attacker || !defender) {
        return;
      }
      const attackerCourage = Number(unitStat(board, sourcePlayerIndex, attacker, "courage", exchange) || 0);
      const attackerWisdom = Number(unitStat(board, sourcePlayerIndex, attacker, "wisdom", exchange) || 0);
      const defenderCourage = Number(unitStat(board, targetPlayer(sourcePlayerIndex), defender, "courage", exchange) || 0);
      const defenderWisdom = Number(unitStat(board, targetPlayer(sourcePlayerIndex), defender, "wisdom", exchange) || 0);
      if (attackerCourage > defenderCourage && attackerWisdom > defenderWisdom) {
        exchange.firstAttackZero[targetPlayer(sourcePlayerIndex)] = true;
      }
      return;
    }
    if (effect.kind === "sacrificeOpponentCreature") {
      const targetIndex = targetPlayer(sourcePlayerIndex);
      const targetUnit = unitForPlayer(board, targetIndex);
      if (targetUnit) {
        const amount = unitMaxEnergy(targetUnit);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
    if (effect.kind === "sacrificeCreature") {
      const targetIndex = effect.target === "opponent" ? targetPlayer(sourcePlayerIndex) : sourcePlayerIndex;
      const targetUnit = unitForPlayer(board, targetIndex);
      if (targetUnit) {
        const amount = unitMaxEnergy(targetUnit);
        exchange.damageToCreature[targetIndex] += amount;
        queueDamageEvent(exchange, targetIndex, amount, "ability", sourcePlayerIndex, runtimeSourceUnit?.unitId || null);
      }
      return;
    }
  });
  if (effects.length && logPrefix) {
    battle.log.push(logPrefix);
  }
}

function damageFromAttackCard(board, attackerIndex, attackCard, exchange) {
  const attacker = unitForPlayer(board, attackerIndex);
  const defenderIndex = targetPlayer(attackerIndex);
  const defender = unitForPlayer(board, defenderIndex);
  if (!attacker || !defender || !attackCard) {
    return 0;
  }

  const treatAsFirstAttack =
    attacker.combat.attacksMade === 0
    || Boolean(exchange.forceFirstAttackForPlayer?.[attackerIndex]);

  if (exchange.firstAttackZero[attackerIndex] && treatAsFirstAttack) {
    return 0;
  }

  const fixedDamage = exchange.attackDamageSet[attackerIndex];
  let damage = Number.isFinite(fixedDamage) ? Number(fixedDamage) : Number(attackCard.stats?.base || 0);
  const triggeredConditionalStats = new Set();
  const isElementalAttack = ELEMENT_KEYS.some((element) => Number(attackCard.stats?.[`${element}Attack`] || 0) > 0);
  const attackBuildPoints = Number(attackCard.stats?.bp || 0);

  if (!Number.isFinite(fixedDamage)) {
    ELEMENT_KEYS.forEach((element) => {
      const amount = Number(attackCard.stats?.[`${element}Attack`] || 0);
      if (!amount) {
        return;
      }
      if (exchange.elementSuppressed[attackerIndex].has(element)) {
        return;
      }
      const attackerElementStat = unitStat(board, attackerIndex, attacker, element, exchange);
      if (attackerElementStat > 0) {
        damage += amount;
      }
    });
  }

  const staticEffects = combinedParsedEffects(attacker);
  const defenderTribe = String(activeCreatureCard(defender)?.tribe || "").toLowerCase();
  staticEffects
    .filter((effect) => effect.kind === "attackDamageVsTribe" && effect.tribe)
    .forEach((effect) => {
      if (defenderTribe.includes(String(effect.tribe).toLowerCase())) {
        damage += Number(effect.amount || 0);
      }
    });
  staticEffects
    .filter((effect) => effect.kind === "attackDamageIfAlliesHaveElement" && effect.element)
    .forEach((effect) => {
      const playerUnits = board.players[attackerIndex].creatures.filter((unit) => !unit.defeated);
      const allHaveElement = playerUnits.length > 0
        && playerUnits.every((unit) => unitStat(board, attackerIndex, unit, effect.element, exchange) > 0);
      if (allHaveElement) {
        damage += Number(effect.amount || 0);
      }
    });
  staticEffects
    .filter((effect) => effect.kind === "attackDamageVsLowerMugicCounters")
    .forEach((effect) => {
      const requiredSubtype = String(effect.subtype || "").toLowerCase();
      const subtypeMatch = !requiredSubtype || unitHasSubtype(attacker, requiredSubtype);
      if (!subtypeMatch) {
        return;
      }
      if (Number(attacker.mugicCounters || 0) > Number(defender.mugicCounters || 0)) {
        damage += Number(effect.amount || 0);
      }
    });
  staticEffects
    .filter((effect) => effect.kind === "attackDamageBonusIfSameNameInDiscard")
    .forEach((effect) => {
      const wanted = normalizeCardNameKey(attackCard?.name || "");
      if (!wanted) {
        return;
      }
      const exists = (board.players[attackerIndex]?.attackDiscard || []).some(
        (card) => normalizeCardNameKey(card?.name) === wanted
      );
      if (exists) {
        damage += Number(effect.amount || 0);
      }
    });

  if (!Number.isFinite(fixedDamage)) {
    const attackEffects = attackCard.parsedEffects || [];
    attackEffects.forEach((effect) => {
      if (effect.kind === "attackDamageSetIfDefenderHasElement" && effect.element) {
        const defenderElement = unitStat(board, defenderIndex, defender, effect.element, exchange);
        if (defenderElement > 0) {
          damage = Number(effect.amount || 0);
        }
        return;
      }
      if (
        effect.kind === "conditionalDamage" &&
        (effect.stat || effect.comparator === "statusGte" || effect.status)
      ) {
        const threshold = Number(effect.threshold || 0);
        const attackerStatValue = resolveComparatorStatValue(board, attackerIndex, attacker, effect.stat, exchange);
        const defenderStatValue = resolveComparatorStatValue(board, defenderIndex, defender, effect.stat, exchange);
        const diff = attackerStatValue - defenderStatValue;
        const comparator = effect.comparator || "diffGte";
        const autoStatCheck = effect.mode === "stat_check" && attackerHasStatCheckAutoSuccess(board, attackerIndex, attacker, exchange);
        const statusValue = Number(attacker?.statuses?.[String(effect.status || "").toLowerCase()] || 0);
        const triggered =
          autoStatCheck ||
          (comparator === "selfGte" && attackerStatValue >= threshold) ||
          (comparator === "selfLte" && attackerStatValue <= threshold) ||
          (comparator === "diffGte" && diff >= threshold) ||
          (comparator === "statusGte" && statusValue >= threshold) ||
          (comparator === "defenderLte" && defenderStatValue <= threshold) ||
          (comparator === "defenderLt" && defenderStatValue < threshold);
        if (triggered) {
          damage += Number(effect.amount || 0);
          triggeredConditionalStats.add(effect.stat);
        }
        return;
      }
      if (effect.kind === "attackDamageConditionalModifier") {
        const conditions = Array.isArray(effect.conditions) ? effect.conditions : [];
        const matched = conditions.every((condition) =>
          evaluateAttackDamageCondition(board, attackerIndex, attacker, defender, condition, exchange)
        );
        if (!matched) {
          return;
        }
        const amount = Number(effect.amount || 0);
        if (effect.modifier === "add") {
          damage += amount;
          return;
        }
        if (effect.modifier === "reduce") {
          damage -= amount;
          return;
        }
        if (effect.modifier === "set") {
          damage = amount;
        }
        return;
      }
      if (effect.kind === "attackDamagePerMugicCounter") {
        const per = Number(effect.amountPerCounter || 0);
        if (!per) {
          return;
        }
        damage += per * Math.max(0, Number(attacker?.mugicCounters || 0));
        return;
      }
      if (effect.kind === "attackDamagePerElementType") {
        const per = Number(effect.amountPerElement || 0);
        if (!per) {
          return;
        }
        damage += per * countActiveElementTypes(board, attackerIndex, attacker, exchange);
        return;
      }
      if (effect.kind === "attackDamagePerSharedElementType") {
        const per = Number(effect.amountPerElement || 0);
        if (!per) {
          return;
        }
        damage += per * countSharedElementTypes(board, attackerIndex, attacker, defender, exchange);
        return;
      }
      if (effect.kind === "attackDamagePerControlledTribe") {
        const per = Number(effect.amountPerTribe || 0);
        if (!per) {
          return;
        }
        const aliveUnits = (board.players[attackerIndex]?.creatures || []).filter((unit) => unit && !unit.defeated);
        const tribeCount = new Set(
          aliveUnits
            .map((unit) => normalizeTribeKey(activeCreatureCard(unit)?.tribe))
            .filter(Boolean)
        ).size;
        const effectiveCount = Math.max(0, tribeCount - (effect.subtractFirst ? 1 : 0));
        damage += per * effectiveCount;
        return;
      }
      if (effect.kind === "attackDamagePerControlledCreatureType") {
        const per = Number(effect.amountPerCreature || 0);
        if (!per) {
          return;
        }
        const count = countControlledCreatureTypes(
          board,
          attackerIndex,
          effect.creatureType,
          effect.adjacentToEngaged ? attacker : null
        );
        damage += per * count;
        return;
      }
      if (effect.kind === "attackDamagePerAttackDiscard") {
        const per = Number(effect.amountPerCard || 0);
        if (!per) {
          return;
        }
        const count = Number(board.players[attackerIndex]?.attackDiscard?.length || 0);
        damage += per * count;
        return;
      }
      if (effect.kind === "attackDamageSetIfAttackDiscardGt") {
        const threshold = Number(effect.threshold || 0);
        const count = Number(board.players[attackerIndex]?.attackDiscard?.length || 0);
        if (count > threshold) {
          damage = Number(effect.amount || 0);
        }
        return;
      }
      if (effect.kind === "attackDamageSetIfFewerMugicCards") {
        const attackerMugic = countAccessibleMugicCards(board, attackerIndex);
        const defenderMugic = countAccessibleMugicCards(board, defenderIndex);
        if (attackerMugic < defenderMugic) {
          damage = Number(effect.amount || 0);
        }
        return;
      }
      if (effect.kind === "attackDamageFromLastAttack") {
        const previous = Number(board.combat?.lastResolvedAttackDamage || 0);
        if (previous > 0) {
          damage += previous;
        }
        return;
      }
      if (effect.kind === "attackDamagePerDefenderDisciplineOver") {
        const per = Number(effect.amountPerDiscipline || 0);
        if (!per) {
          return;
        }
        const count = countDisciplinesAboveThreshold(
          board,
          defenderIndex,
          defender,
          Number(effect.threshold || 0),
          exchange
        );
        damage -= per * count;
        return;
      }
      if (effect.kind === "dealDamage") {
        damage += Number(effect.amount || 0);
        return;
      }
      if (effect.kind === "attackDamageCap") {
        damage = Math.min(damage, Number(effect.amount || damage));
      }
    });
  }

  if (treatAsFirstAttack) {
    damage += Number(attacker.statuses?.strike || 0);
    if (hasInvisibilityAdvantage(attacker, defender)) {
      damage += Number(attacker.statuses?.invisibilityStrike || 0);
    }
  }

  const outperformEffects = combinedParsedEffects(attacker).filter(
    (effect) => effect.kind === "outperform" && effect.stat
  );
  outperformEffects.forEach((effect) => {
    if (triggeredConditionalStats.has(effect.stat)) {
      damage += Number(effect.amount || 0);
    }
  });

  exchange.conditionalDamageTriggered[attackerIndex] = triggeredConditionalStats;
  damage += Number(attacker?.combat?.nextAttackBonus || 0);
  damage += Number(exchange.attackDamageAdd[attackerIndex] || 0);
  damage -= Number(exchange.attackDamageReduce[attackerIndex] || 0);
  const damageReductionContext = {
    attackBuildPoints,
    attacksReceived: Number(defender?.combat?.attacksReceived || 0),
    isElementalAttack,
  };
  damage -= incomingDamageReductionForUnit(defender, "attack", damageReductionContext);
  consumeIncomingReductionEntries(defender, "attack", damageReductionContext);
  return Math.max(0, damage);
}

function resetTurnUnits(board) {
  board.players.forEach((player) => {
    player.creatures.forEach((unit) => {
      unit.tempMods = createTempStatMap();
      unit.tempEffects = [];
      unit.currentEnergy = clamp(unit.currentEnergy, 0, unitMaxEnergy(unit));
      unit.combat.attacksMade = 0;
      unit.combat.attacksReceived = 0;
      unit.combat.activatedAbilityUsed = false;
      unit.combat.nextAttackBonus = 0;
      unit.combat.onTakesDamageAttackBonus = 0;
      unit.combat.sacrificeFriendlyTribeForHealUsed = false;
      if (unit.statuses && typeof unit.statuses === "object") {
        unit.statuses.ignoreChieftainGate = false;
        unit.statuses.incomingDamageReductions = [];
        unit.statuses.dealtAttackDamageThisTurn = false;
        unit.statuses.lastAttackDamagerUnitId = null;
        unit.statuses.lastAttackDamagerPlayerIndex = null;
        unit.statuses.temporaryCreatureTypes = [];
        unit.statuses.nonAttackDamageRedirectToUnitId = null;
        unit.statuses.pendingNextAttackDisciplineLoss = false;
      }
      recalculateUnitDerivedState(unit);
    });
  });
}

function initializeExchange(battle) {
  const board = battle.board;
  board.exchange = makeExchangeContext(board);
}

function rotateActiveLocationToBottom(board) {
  if (!board || !board.locationCard) {
    return false;
  }
  const ownerIndex = Number(board.locationOwnerIndex);
  const owner = Number.isInteger(ownerIndex) ? board.players?.[ownerIndex] : null;
  if (owner) {
    owner.locationDeck = Array.isArray(owner.locationDeck) ? owner.locationDeck : [];
    // Deck top is the array end (pop), so bottom insertion uses unshift.
    owner.locationDeck.unshift(board.locationCard);
  }
  board.locationCard = null;
  board.locationOwnerIndex = null;
  return true;
}

function attackHandTargetSize(battle = null) {
  const configured = Number(battle?.ruleConfig?.attackHandSize || 2);
  return Math.max(1, configured);
}

function attackHandStrikeTargetSize(battle = null) {
  const base = attackHandTargetSize(battle);
  if (String(battle?.ruleProfile || RULE_PROFILE_DEFAULT) === "official_master") {
    return base + 1;
  }
  return base;
}

function normalizeAttackHandToRuleTarget(player, battle = null, label = "Jogador", explicitTarget = null) {
  if (!player) {
    return;
  }
  const target = Number.isFinite(explicitTarget)
    ? Math.max(1, Number(explicitTarget))
    : attackHandTargetSize(battle);
  if (player.attackHand.length < target) {
    drawCards(player, "attackDeck", "attackDiscard", "attackHand", target - player.attackHand.length);
  }
  while (player.attackHand.length > target) {
    const dropped = player.attackHand.pop();
    if (dropped) {
      player.attackDiscard.push(dropped);
      if (battle) {
        battle.log.push(`${label} descarta ${dropped.name} para manter ${target} Attacks na mao.`);
      }
    }
  }
}

function applyLocationCardForTurn(board) {
  const activePlayerIndex = board.activePlayerIndex;
  const activePlayer = board.players[activePlayerIndex];
  if (!activePlayer) {
    return;
  }

  rotateActiveLocationToBottom(board);

  board.locationCard = activePlayer.locationDeck.length ? activePlayer.locationDeck.pop() : null;
  board.locationOwnerIndex = board.locationCard ? activePlayerIndex : null;
}

function revealNewLocationDuringCombat(battle) {
  const board = battle.board;
  if (!board.exchange?.forceRevealLocation) {
    return;
  }
  board.exchange.forceRevealLocation = false;
  applyLocationCardForTurn(board);
  applyLocationEnterEffects(battle);
  board.combat.startResolved = false;
  if (board.locationCard) {
    battle.log.push(`Nova Location revelada no combate: ${board.locationCard.name}.`);
  }
}

function applyLocationEnterEffects(battle) {
  const board = battle.board;
  const location = board.locationCard;
  if (!location) {
    return;
  }
  const effects = location.parsedEffects || [];
  effects.forEach((effect) => {
    if (effect.kind !== "locationEnterRemoveAllElements") {
      return;
    }
    board.players.forEach((player) => {
      player.creatures.forEach((unit) => {
        if (unit.defeated) {
          return;
        }
        ELEMENT_KEYS.forEach((element) => {
          const current = Number(activeCreatureCard(unit)?.stats?.[element] || 0) + Number(unit.passiveMods?.[element] || 0);
          if (current > 0) {
            unit.tempMods[element] -= current;
          }
        });
      });
    });
    battle.log.push(`Location ${location.name}: criaturas perderam todos os elementos.`);
  });
}

function autoSelectEngagement(board) {
  const activeIndex = board.activePlayerIndex;
  const active = board.players[activeIndex];
  const enemy = board.players[targetPlayer(activeIndex)];
  const ownAlive = getAliveSlots(active);
  const enemyAlive = getAliveSlots(enemy);
  if (!ownAlive.length || !enemyAlive.length) {
    board.engagement.attackerSlot = null;
    board.engagement.defenderSlot = null;
    return;
  }

  const directEngagements = getEngagementCandidates(board, activeIndex);
  if (directEngagements.length) {
    board.action.movedThisTurn = true;
    board.engagement.attackerSlot = directEngagements[0].attackerSlot;
    board.engagement.defenderSlot = directEngagements[0].defenderSlot;
    return;
  }

  if (!board.action.movedThisTurn) {
    const move = findBestMoveForEngagement(board, activeIndex);
    if (move && moveUnitToAdjacentEmptySlot(board, activeIndex, move.from, move.to)) {
      board.action.movedThisTurn = true;
      board.action.selectedMoverSlot = move.to;
    } else {
      board.action.movedThisTurn = true;
    }
  }

  const afterMoveEngagements = getEngagementCandidates(board, activeIndex);
  if (afterMoveEngagements.length) {
    board.engagement.attackerSlot = afterMoveEngagements[0].attackerSlot;
    board.engagement.defenderSlot = afterMoveEngagements[0].defenderSlot;
    return;
  }
  board.engagement.attackerSlot = null;
  board.engagement.defenderSlot = null;
}

function maybeAutoAttackChoices(battle, forceAutoHuman) {
  const board = battle.board;
  if (!board.exchange) {
    initializeExchange(battle);
  }
  [0, 1].forEach((playerIndex) => {
    if (board.pendingAttacks[playerIndex] !== null) {
      return;
    }
    const forceRandomChoice = shouldForceRandomAttackChoice(board, playerIndex, board.exchange);
    if (forceRandomChoice) {
      board.pendingAttacks[playerIndex] = chooseRandomAttackIndex(board.players[playerIndex]);
      if (board.pendingAttacks[playerIndex] >= 0) {
        battle.log.push(`${board.players[playerIndex].label} precisa revelar Attack aleatorio nesta troca.`);
      }
      return;
    }
    const isHuman = isHumanControlledPlayer(battle, playerIndex, forceAutoHuman);
    if (isHuman && board.players[playerIndex].attackHand.length > 0) {
      return;
    }
    board.pendingAttacks[playerIndex] = chooseBestAttack(board, playerIndex, board.exchange);
  });
}

function revealChosenAttacks(battle) {
  const board = battle.board;
  [0, 1].forEach((playerIndex) => {
    const handIndex = board.pendingAttacks[playerIndex];
    const player = board.players[playerIndex];
    if (handIndex === null || handIndex === undefined || handIndex < 0 || !player.attackHand[handIndex]) {
      board.revealedAttacks[playerIndex] = null;
      return;
    }
    const card = player.attackHand.splice(handIndex, 1)[0];
    player.attackDiscard.push(card);
    board.revealedAttacks[playerIndex] = card;
    board.exchange.chosenAttacks[playerIndex] = card;
  });
  const nameA = board.revealedAttacks[0]?.name || "No Attack";
  const nameB = board.revealedAttacks[1]?.name || "No Attack";
  battle.log.push(`Revelacao simultanea: Jogador 1 -> ${nameA} | Jogador 2 -> ${nameB}.`);
}

function applyLocationEffects(battle) {
  const board = battle.board;
  const location = board.locationCard;
  if (!location) {
    return;
  }
  const effects = location.parsedEffects || [];
  const beginCombatKinds = new Set([
    "beginCombatEnergy",
    "beginCombatDamage",
    "beginCombatMugicCounterHigherStat",
    "firstAttackZeroIfLower",
    "beginCombatGainLowestDiscipline",
  ]);
  const beginEffects = effects.filter((effect) => beginCombatKinds.has(effect.kind));
  const ongoingEffects = effects.filter(
    (effect) => !beginCombatKinds.has(effect.kind) && effect.kind !== "locationEnterRemoveAllElements"
  );

  if (!board.combat.startResolved && beginEffects.length) {
    applyParsedEffectsToExchange(board, board.activePlayerIndex, beginEffects, board.exchange, `Location ativa: ${location.name}.`, battle);
  }
  if (ongoingEffects.length) {
    applyParsedEffectsToExchange(board, board.activePlayerIndex, ongoingEffects, board.exchange, "", battle);
  }
  revealNewLocationDuringCombat(battle);
  board.combat.startResolved = true;
}

function ensureExchangeContext(battle) {
  if (!battle?.board?.exchange) {
    initializeExchange(battle);
  }
  return battle.board.exchange;
}

function filterCoreEffects(effects, battle, sourceLabel) {
  if (!Array.isArray(effects) || !effects.length) {
    return [];
  }
  const accepted = [];
  effects.forEach((effect) => {
    const runtimeEffect = normalizeEffectForRuntime(effect, battle?.phase || "runtime");
    if (!runtimeEffect?.kind) {
      return;
    }
    if (CORE_EFFECT_KINDS.has(runtimeEffect.kind)) {
      accepted.push(runtimeEffect);
      return;
    }
    battle.log.push(`[noop_pending_kind] ${sourceLabel}: efeito '${runtimeEffect.kind}' ainda nao implementado nesta v1.`);
  });
  return accepted;
}

function queueStackItem(battle, item) {
  if (!Array.isArray(battle.burstStack)) {
    battle.burstStack = [];
  }
  const stackIndex = battle.burstStack.length;
  item.stackIndex = stackIndex;
  battle.burstStack.push(item);
  battle.effectStack = battle.burstStack;
}

function applyPostAttackEffects(battle, attackerIndex, attackCard) {
  const board = battle.board;
  const defenderIndex = targetPlayer(attackerIndex);
  const dealtDamage = Number(board.exchange?.damageToCreature?.[defenderIndex] || 0);
  if (dealtDamage <= 0) {
    return;
  }
  const effects = attackCard?.parsedEffects || [];
  effects.forEach((effect) => {
    if (effect.kind === "exileGeneralDiscardOnDamage") {
      const targetIdx = effect.target === "self" ? attackerIndex : defenderIndex;
      const removed = exileOneFromGeneralDiscard(board, targetIdx);
      if (removed) {
        battle.log.push(
          `[resolved_effect] exileGeneralDiscardOnDamage: ${board.players[targetIdx].label} remove 1 carta de ${removed.zone} do jogo.`
        );
      }
    }
  });
}

function resolveAttackStackItem(battle, item) {
  const board = battle.board;
  const attackPlayer = Number(item?.owner);
  const attackCard = item?.attackCard || null;
  if (!Number.isInteger(attackPlayer) || !attackCard) {
    return;
  }
  ensureExchangeContext(battle);
  board.exchange.chosenAttacks[0] = null;
  board.exchange.chosenAttacks[1] = null;
  board.exchange.chosenAttacks[attackPlayer] = attackCard;
  board.revealedAttacks[attackPlayer] = attackCard;
  board.pendingAttacks[attackPlayer] = null;
  if (Number.isFinite(Number(board.combat?.nextAttackSetDamage))) {
    board.exchange.attackDamageSet[attackPlayer] = Number(board.combat.nextAttackSetDamage);
    board.combat.nextAttackSetDamage = null;
    board.combat.nextAttackSetBy = null;
  }
  (attackCard.parsedEffects || []).forEach((effect) => {
    if (
      effect?.kind
      && !ATTACK_EFFECT_KINDS_SUPPORTED.has(effect.kind)
      && !EFFECT_RUNTIME_REGISTRY.has(effect.kind)
    ) {
      battle.log.push(`[noop_pending_kind] Attack ${attackCard.name}: efeito '${effect.kind}' ainda nao implementado nesta v1.`);
    }
  });
  const attackStackEffects = filterCoreEffects(
    (attackCard.parsedEffects || []).filter(
      (effect) => ATTACK_STACK_EFFECT_KINDS.has(effect?.kind) || EFFECT_RUNTIME_REGISTRY.has(effect?.kind)
    ),
    battle,
    `Attack ${attackCard.name}`
  );
  if (attackStackEffects.length) {
    applyParsedEffectsToExchange(
      board,
      attackPlayer,
      attackStackEffects,
      board.exchange,
      "",
      battle,
      {
        sourceItem: item,
        sourceUnit: unitForPlayer(board, attackPlayer),
        sourcePlayerIndex: attackPlayer,
      }
    );
  }

  compareElements(battle);
  calculateDamage(battle);
  const reflectConfig = board.exchange?.attackReflectByStackIndex?.get(Number(item.stackIndex));
  if (reflectConfig) {
    const reflected = Math.max(0, Number(board.combat?.lastResolvedAttackDamage || 0) * Number(reflectConfig.amountMultiplier || 1));
    if (reflected > 0) {
      board.exchange.damageToCreature[attackPlayer] += reflected;
      queueDamageEvent(
        board.exchange,
        attackPlayer,
        reflected,
        "ability",
        Number.isInteger(reflectConfig.byPlayerIndex) ? reflectConfig.byPlayerIndex : targetPlayer(attackPlayer),
        null
      );
      battle.log.push(`[resolved_effect] targetAttackReflectDamage: ${reflected} dano refletido para ${board.players[attackPlayer].label}.`);
    }
  }
  applyPostAttackEffects(battle, attackPlayer, attackCard);
  queueTempEffectsFromAttacks(battle);
  applyPendingTempMods(board);
  applyEnergyUpdate(battle);
  emitBattleEvent("damage", { flash: battle.flash });
  battle.log.push(`Ataque resolvido: ${board.players[attackPlayer].label} -> ${attackCard.name}.`);
  logEffect(battle, { type: "attack", source: attackCard.name, effectKind: "attackResolved", targets: [unitDisplayName(unitForPlayer(board, targetPlayer(attackPlayer))) || "oponente"], description: `${attackCard.name} resolvido por ${board.players[attackPlayer].label}`, effects: (attackCard.parsedEffects || []).map(e => e.kind).filter(Boolean) });
}

function resolveEffectStack(battle, forceAutoHuman = false) {
  if (!Array.isArray(battle.burstStack) || !battle.burstStack.length) {
    return true;
  }
  while (battle.burstStack.length) {
    const item = battle.burstStack.pop();
    if (!item) {
      continue;
    }
    if (item.kind === "mugic" && Number.isInteger(item.owner) && Number.isInteger(item.mugicSlotIndex)) {
      markSpentMugicSlot(battle.board, Number(item.owner), Number(item.mugicSlotIndex));
    }
    if (item.kind === "attack") {
      resolveAttackStackItem(battle, item);
      if (battle.stackNeedsPriorityReopen && battle.burstStack.length) {
        battle.stackNeedsPriorityReopen = false;
        const starter = Number.isInteger(item.owner) ? targetPlayer(item.owner) : battle.board.activePlayerIndex;
        const resolved = runPriorityWindow(battle, "stack_response", forceAutoHuman, starter, true);
        if (!resolved) {
          battle.effectStack = battle.burstStack;
          return false;
        }
      }
      continue;
    }
    if (!Array.isArray(item.effectPayload) || !item.effectPayload.length) {
      continue;
    }
    const board = battle.board;
    const sourceUnitEntry = findUnitById(board, item.sourceUnitId);
    const runtimeContext = {
      sourceItem: item,
      sourceUnit: sourceUnitEntry?.unit || null,
      sourcePlayerIndex: Number.isInteger(sourceUnitEntry?.playerIndex) ? sourceUnitEntry.playerIndex : item.playerIndex,
      targetsByEffect: item.targetsSnapshot || null,
      choicesByEffect: item.choicesSnapshot || null,
      costsPaid: item.costsPaid || null,
    };
    battle.log.push(`Resolve (LIFO): ${item.source}.`);
    logEffect(battle, { type: item.kind || "effect", source: item.source, effectKind: "stackResolve", targets: [], description: `Resolvendo: ${item.source}`, effects: (item.effectPayload || []).map(e => e.kind).filter(Boolean) });
    applyParsedEffectsToExchange(board, item.playerIndex, item.effectPayload, board.exchange, "", battle, runtimeContext);
    if (battle.stackNeedsPriorityReopen && battle.burstStack.length) {
      battle.stackNeedsPriorityReopen = false;
      const starter = Number.isInteger(item.playerIndex) ? targetPlayer(item.playerIndex) : board.activePlayerIndex;
      const resolved = runPriorityWindow(battle, "stack_response", forceAutoHuman, starter, true);
      if (!resolved) {
        battle.effectStack = battle.burstStack;
        return false;
      }
    }
  }
  battle.effectStack = battle.burstStack;
  return true;
}

function effectTargetSpec(effect) {
  const sourceText = String(effect?.sourceText || "");
  const requiredCreatureTypesFromText = collectRequiredCreatureTypesFromText(sourceText);
  if (effect?.targetSpec && effect.targetSpec.type) {
    if (effect.targetSpec.type !== "creature") {
      return effect.targetSpec;
    }
    const requiredCreatureTypes =
      Array.isArray(effect.targetSpec.requiredCreatureTypes) && effect.targetSpec.requiredCreatureTypes.length
        ? effect.targetSpec.requiredCreatureTypes.map((entry) => normalizeCreatureTypeKey(entry)).filter(Boolean)
        : requiredCreatureTypesFromText;
    return {
      ...effect.targetSpec,
      ...(requiredCreatureTypes.length ? { requiredCreatureTypes } : {}),
    };
  }
  const text = sourceText.toLowerCase();
  if (!text.includes("target")) {
    return null;
  }
  let type = null;
  if (text.includes("target battlegear")) {
    type = "battlegear";
  } else if (text.includes("target mugic")) {
    type = "mugic";
  } else if (text.includes("target attack")) {
    type = "attack";
  } else if (/\btarget\s+[^.;:]*\bcreature card\b[^.;:]*\bgeneral discard pile\b/.test(text)) {
    type = "creature_discard";
  } else if (/\btarget\b[^.;:]*\bplayer\b/.test(text) || /\btarget player's\b/.test(text)) {
    type = "player";
  } else if (text.includes("target location")) {
    type = "location";
  } else if (
    /\btarget\s+[^.;:]*\s+creature\b/.test(text)
    || text.includes("engaged creature")
    || text.includes("that creature")
    || text.includes("opposing creature")
  ) {
    type = "creature";
  }
  if (!type) {
    return null;
  }
  return {
    type,
    required: true,
    scope: String(effect?.target || "self").toLowerCase(),
    ...(type === "creature" && requiredCreatureTypesFromText.length
      ? { requiredCreatureTypes: requiredCreatureTypesFromText }
      : {}),
  };
}

function collectRequiredCreatureTypesFromText(sourceText) {
  const text = String(sourceText || "");
  if (!/\btarget\b/i.test(text) || !/\bcreature\b/i.test(text)) {
    return [];
  }
  const output = [];
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
      .map((entry) => normalizeCreatureTypeKey(entry))
      .filter(Boolean);
    pieces.forEach((piece) => {
      const filtered = piece
        .split(/\s+/)
        .filter((token) => token && !CREATURE_TYPE_TARGET_STOPWORDS.has(token) && !/^\d+$/.test(token));
      if (!filtered.length) {
        return;
      }
      output.push(filtered.join(" "));
    });
    match = regex.exec(text);
  }
  return [...new Set(output)];
}

function targetPlayersFromScope(sourcePlayerIndex, scopeHint, sourceText = "") {
  const scope = String(scopeHint || "self").toLowerCase();
  const text = String(sourceText || "").toLowerCase();
  if (text.includes("opposing") || text.includes("opponent")) {
    return [targetPlayer(sourcePlayerIndex)];
  }
  if (text.includes("you control") || text.includes("your")) {
    return [sourcePlayerIndex];
  }
  if (scope === "opponent") {
    return [targetPlayer(sourcePlayerIndex)];
  }
  if (scope === "all" || scope === "both" || scope === "either" || scope === "any") {
    return [sourcePlayerIndex, targetPlayer(sourcePlayerIndex)];
  }
  if (text.includes("target")) {
    return [sourcePlayerIndex, targetPlayer(sourcePlayerIndex)];
  }
  return [sourcePlayerIndex];
}

function buildTargetCandidatesForEffect(battle, sourcePlayerIndex, effect, sourceUnit) {
  const board = battle.board;
  const spec = effectTargetSpec(effect);
  if (!spec?.type) {
    return [];
  }
  const text = String(effect?.sourceText || "").toLowerCase();
  const players = targetPlayersFromScope(sourcePlayerIndex, spec.scope || effect?.target, text);
  const candidates = [];

  if (spec.type === "creature") {
    const engagedOnly = text.includes("engaged creature");
    const unengagedOnly = text.includes("unengaged creature");
    const adjacentOnly = text.includes("adjacent");
    const requiredCreatureTypes = (spec.requiredCreatureTypes || [])
      .map((entry) => normalizeCreatureTypeKey(entry))
      .filter(Boolean);
    const requiredTribes = (spec.requiredTribes || [])
      .map((entry) => normalizeTribeKey(entry))
      .filter(Boolean);
    const requireUninfected = Boolean(spec.requireUninfected);
    const requireInfected = Boolean(spec.requireInfected);
    const sourceLetter = sourceUnit ? unitPositionLetter(sourcePlayerIndex, sourceUnit) : null;
    players.forEach((playerIndex) => {
      (board.players[playerIndex]?.creatures || []).forEach((unit) => {
        if (!unit || unit.defeated) {
          return;
        }
        const letter = unitPositionLetter(playerIndex, unit);
        const engaged = isUnitCurrentlyEngaged(board, playerIndex, unit);
        if (engagedOnly && !engaged) {
          return;
        }
        if (unengagedOnly && engaged) {
          return;
        }
        if (adjacentOnly && sourceLetter && !canLettersEngage(sourceLetter, letter)) {
          return;
        }
        if (
          requiredCreatureTypes.length
          && !requiredCreatureTypes.some((requiredType) => unitHasCreatureType(unit, requiredType))
        ) {
          return;
        }
        if (requiredTribes.length) {
          const tribe = normalizeTribeKey(activeCreatureCard(unit)?.tribe);
          if (!tribe || !requiredTribes.includes(tribe)) {
            return;
          }
        }
        if (requireUninfected && isUnitInfected(unit)) {
          return;
        }
        if (requireInfected && !isUnitInfected(unit)) {
          return;
        }
        candidates.push({
          id: `creature:${unit.unitId}`,
          type: "creature",
          label: `${board.players[playerIndex].label} - ${unitDisplayName(unit)}`,
          playerIndex,
          unitId: unit.unitId,
          slot: unit.slot,
          letter,
          card: activeCreatureCard(unit),
        });
      });
    });
    return candidates;
  }

  if (spec.type === "battlegear") {
    const engagedOnly = text.includes("engaged");
    players.forEach((playerIndex) => {
      (board.players[playerIndex]?.creatures || []).forEach((unit) => {
        if (!unit || unit.defeated || !unit.gearCard) {
          return;
        }
        if (engagedOnly && !isUnitCurrentlyEngaged(board, playerIndex, unit)) {
          return;
        }
        const isFaceDown = (unit.gearState || "face_up") === "face_down";
        const hideIdentity = isFaceDown && playerIndex !== sourcePlayerIndex;
        const label = hideIdentity
          ? `${board.players[playerIndex].label} - Battlegear face-down`
          : `${board.players[playerIndex].label} - ${unit.gearCard.name}`;
        candidates.push({
          id: `battlegear:${unit.unitId}`,
          type: "battlegear",
          label,
          playerIndex,
          unitId: unit.unitId,
          slot: unit.slot,
          letter: unitPositionLetter(playerIndex, unit),
          card: hideIdentity ? null : unit.gearCard,
          gearState: unit.gearState || "face_up",
          hiddenIdentity: hideIdentity,
        });
      });
    });
    return candidates;
  }

  if (spec.type === "attack") {
    const requiresElemental = /\belemental attack\b/i.test(String(effect?.sourceText || ""));
    (battle.burstStack || []).forEach((entry, index) => {
      if (!entry || entry.kind !== "attack" || !entry.attackCard) {
        return;
      }
      if (requiresElemental) {
        const hasElemental = ELEMENT_KEYS.some((element) => Number(entry.attackCard?.stats?.[`${element}Attack`] || 0) > 0);
        if (!hasElemental) {
          return;
        }
      }
      if (players.length && Number.isInteger(entry.owner) && !players.includes(Number(entry.owner))) {
        return;
      }
      const ownerIndex = Number.isInteger(entry.owner) ? Number(entry.owner) : sourcePlayerIndex;
      const ownerLabel = board.players[ownerIndex]?.label || `Jogador ${ownerIndex + 1}`;
      candidates.push({
        id: `attack_stack:${index}`,
        type: "attack_stack",
        label: `${ownerLabel} - ${entry.attackCard.name}`,
        playerIndex: ownerIndex,
        stackIndex: index,
        card: entry.attackCard,
      });
    });
    return candidates;
  }

  if (spec.type === "player") {
    players.forEach((playerIndex) => {
      candidates.push({
        id: `player:${playerIndex}`,
        type: "player",
        label: `${board.players[playerIndex]?.label || `Jogador ${playerIndex + 1}`}`,
        playerIndex,
      });
    });
    return candidates;
  }

  if (spec.type === "creature_discard") {
    const requiredCreatureTypes = (spec.requiredCreatureTypes || [])
      .map((entry) => normalizeCreatureTypeKey(entry))
      .filter(Boolean);
    players.forEach((playerIndex) => {
      (board.players[playerIndex]?.creatureDiscard || []).forEach((card, discardIndex) => {
        if (!card) {
          return;
        }
        if (
          requiredCreatureTypes.length
          && !requiredCreatureTypes.some((requiredType) =>
            unitCardHasCreatureType(card, requiredType)
          )
        ) {
          return;
        }
        candidates.push({
          id: `creature_discard:${playerIndex}:${discardIndex}`,
          type: "creature_discard",
          label: `${board.players[playerIndex].label} - ${card.name}`,
          playerIndex,
          discardIndex,
          card,
        });
      });
    });
    return candidates;
  }

  if (spec.type === "mugic") {
    const scope = String(spec.scope || "").toLowerCase();
    if (scope !== "stack") {
      players.forEach((playerIndex) => {
        (board.players[playerIndex]?.mugicSlots || [])
          .filter((entry) => entry && entry.available && entry.card)
          .forEach((entry) => {
            const card = entry.card;
            candidates.push({
              id: `mugic:${playerIndex}:${entry.slotIndex}`,
              type: "mugic",
              label: `${board.players[playerIndex].label} - ${card.name}`,
              playerIndex,
              mugicIndex: Number(entry.slotIndex),
              card,
            });
          });
      });
    }
    (battle.burstStack || []).forEach((entry, index) => {
      if (entry?.kind !== "mugic" && entry?.kind !== "mugic_copy") {
        return;
      }
      candidates.push({
        id: `mugic_stack:${index}`,
        type: "mugic_stack",
        label: `Pilha - ${entry.source || "Mugic"}`,
        stackIndex: index,
        playerIndex: Number(entry.owner),
        card: null,
      });
    });
    return candidates;
  }

  if (spec.type === "location") {
    if (board.locationCard) {
      candidates.push({
        id: "location:active",
        type: "location",
        label: `Location ativa - ${board.locationCard.name}`,
        card: board.locationCard,
        ownerIndex: Number(board.locationOwnerIndex),
      });
    }
    players.forEach((playerIndex) => {
      const topCard = board.players[playerIndex]?.locationDeck?.[board.players[playerIndex].locationDeck.length - 1];
      if (!topCard) {
        return;
      }
      candidates.push({
        id: `location:deck_top:${playerIndex}`,
        type: "location_deck_top",
        label: `${board.players[playerIndex].label} - topo do deck`,
        playerIndex,
        card: topCard,
      });
    });
    return candidates;
  }

  return [];
}

function buildTargetStepsForEffects(battle, sourcePlayerIndex, effects, sourceUnit) {
  const steps = [];
  effects.forEach((effect, effectIndex) => {
    const spec = effectTargetSpec(effect);
    if (!spec?.required || !spec.type) {
      return;
    }
    const candidates = buildTargetCandidatesForEffect(battle, sourcePlayerIndex, effect, sourceUnit);
    steps.push({
      effectIndex,
      effectKind: effect.kind,
      label: String(effect.sourceText || effect.kind || "Selecione um alvo"),
      spec,
      candidates,
    });
  });
  return steps;
}

function effectChoiceSpec(effect) {
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
        { id: "down", label: "Virar face-down", value: "down" },
        { id: "up", label: "Virar face-up", value: "up" },
      ],
    };
  }
  if (
    (effect.kind === "grantChosenElementValueToRecentDamager" || effect.kind === "removeChosenElementFromCreatureWithZeroDiscipline")
    && sourceText.includes("of your choice")
  ) {
    return {
      type: "elementChoice",
      required: true,
      options: ELEMENT_KEYS.map((element) => ({
        id: element,
        value: element,
        label: element,
      })),
    };
  }
  if (effect.kind === "targetCreatureCountsAsChosenTribe") {
    return {
      type: "tribeChoice",
      required: true,
      options: ["overworld", "underworld", "mipedian", "danian", "m'arrillian"].map((tribe) => ({
        id: tribe,
        value: tribe,
        label: tribe,
      })),
    };
  }
  return null;
}

function buildChoiceStepsForEffects(effects) {
  const steps = [];
  (effects || []).forEach((effect, effectIndex) => {
    const spec = effectChoiceSpec(effect);
    if (!spec?.required || !Array.isArray(spec.options) || !spec.options.length) {
      return;
    }
    steps.push({
      effectIndex,
      effectKind: effect.kind,
      label: String(effect.sourceText || effect.kind || "Escolha uma opcao"),
      spec,
      options: spec.options.map((option) => ({ ...option })),
    });
  });
  return steps;
}

function aiPickTargetCandidate(step) {
  if (!step?.candidates?.length) {
    return null;
  }
  const sorted = [...step.candidates].sort((a, b) => {
    const aOpp = Number(a.playerIndex === 1);
    const bOpp = Number(b.playerIndex === 1);
    return bOpp - aOpp;
  });
  return sorted[0];
}

function cloneEffectsWithRuntimeIndex(effects) {
  return (effects || []).map((effect, index) => ({ ...effect, _runtimeIndex: index }));
}

function selectedTargetsForAi(steps) {
  const selected = {};
  for (const step of steps) {
    const picked = aiPickTargetCandidate(step);
    if (!picked) {
      return null;
    }
    selected[step.effectIndex] = picked;
  }
  return selected;
}

function aiPickChoiceOption(step) {
  if (!step?.options?.length) {
    return null;
  }
  if (step.spec?.type === "flipMode") {
    return step.options.find((option) => option.value === "down") || step.options[0];
  }
  return step.options[0];
}

function selectedChoicesForAi(steps) {
  const selected = {};
  for (const step of steps || []) {
    const picked = aiPickChoiceOption(step);
    if (!picked) {
      return null;
    }
    selected[step.effectIndex] = picked;
  }
  return selected;
}

function formatChoiceLabel(choice) {
  if (!choice) {
    return null;
  }
  if (typeof choice === "string") {
    return choice;
  }
  if (typeof choice === "object") {
    return choice.label || choice.value || choice.id || null;
  }
  return null;
}

function summarizeSelectedChoices(selectedChoices = null) {
  if (!selectedChoices || typeof selectedChoices !== "object") {
    return [];
  }
  const summary = [];
  Object.keys(selectedChoices).forEach((key) => {
    const label = formatChoiceLabel(selectedChoices[key]);
    if (label) {
      summary.push(`${key}:${label}`);
    }
  });
  return summary;
}

function applyChoiceSelectionsToEffects(effects, selectedChoices = null) {
  if (!selectedChoices || typeof selectedChoices !== "object") {
    return effects;
  }
  return (effects || []).map((effect) => {
    const idx = Number(effect?._runtimeIndex);
    const selected = selectedChoices[idx] || selectedChoices[String(idx)] || null;
    if (!selected) {
      return effect;
    }
    if (effect.kind === "flipBattlegear" && String(effect.mode || "").toLowerCase() === "toggle") {
      return {
        ...effect,
        mode: String(selected.value || selected.id || "down").toLowerCase(),
        flipTo: String(selected.value || selected.id || "down").toLowerCase(),
      };
    }
    if (effect.kind === "grantChosenElementValueToRecentDamager") {
      return {
        ...effect,
        chosenElement: String(selected.value || selected.id || "fire").toLowerCase(),
      };
    }
    if (effect.kind === "removeChosenElementFromCreatureWithZeroDiscipline") {
      return {
        ...effect,
        chosenElement: String(selected.value || selected.id || "fire").toLowerCase(),
      };
    }
    if (effect.kind === "targetCreatureCountsAsChosenTribe") {
      return {
        ...effect,
        chosenTribe: String(selected.value || selected.id || "overworld"),
      };
    }
    return effect;
  });
}

function setPriorityPendingChoiceAfterTargetResolution(battle, playerIndex, windowType, played) {
  battle.pendingAction = {
    type: "priority",
    windowType: windowType || battle?.burstState?.windowType || battle.phase,
    playerIndex,
    options: [],
    choice: played ? { kind: "target_resolved_played" } : { kind: "pass" },
    priorityPlayer: playerIndex,
  };
}

function queueInfectTriggersFromMugicTargeting(battle, sourcePlayerIndex, selectedTargets, sourceLabel = "Mugic") {
  const board = battle?.board;
  if (!board || !selectedTargets) {
    return 0;
  }
  const opposingIndex = targetPlayer(sourcePlayerIndex);
  const targetedOpposingCreatures = Object.values(selectedTargets)
    .filter((entry) => entry && entry.type === "creature" && Number(entry.playerIndex) === opposingIndex && entry.unitId)
    .map((entry) => resolveUnitFromSelection(board, entry)?.unit)
    .filter((unit) => unit && !unit.defeated && !isUnitInfected(unit));
  if (!targetedOpposingCreatures.length) {
    return 0;
  }
  const triggerSources = aliveUnitsForPlayer(board, sourcePlayerIndex).filter((unit) =>
    combinedParsedEffects(unit).some((effect) => effect?.kind === "infectTargetedOpposingUninfectedCreature")
  );
  if (!triggerSources.length) {
    return 0;
  }
  let queued = 0;
  triggerSources.forEach((sourceUnit) => {
    targetedOpposingCreatures.forEach((targetUnit) => {
      const owner = findUnitById(board, targetUnit.unitId);
      if (!owner || owner.playerIndex !== opposingIndex || targetUnit.defeated || isUnitInfected(targetUnit)) {
        return;
      }
      const targetSnapshot = {
        0: {
          id: `creature:${targetUnit.unitId}`,
          type: "creature",
          playerIndex: owner.playerIndex,
          unitId: targetUnit.unitId,
          slot: targetUnit.slot,
          letter: unitPositionLetter(owner.playerIndex, targetUnit),
          label: `${board.players[owner.playerIndex].label} - ${unitDisplayName(targetUnit)}`,
        },
      };
      queueStackItem(battle, {
        kind: "ability",
        source: `Triggered Infect - ${unitDisplayName(sourceUnit)}`,
        owner: sourcePlayerIndex,
        playerIndex: sourcePlayerIndex,
        sourceUnitId: sourceUnit.unitId,
        costsPaid: { type: "triggered", amount: 0 },
        effectPayload: cloneEffectsWithRuntimeIndex([
          {
            kind: "infectTargetCreature",
            sourceText: `Triggered by ${sourceLabel}`,
            targetSpec: {
              type: "creature",
              required: true,
              scope: "opponent",
              requireUninfected: true,
            },
          },
        ]),
        targetsSnapshot: targetSnapshot,
        timing: "triggered",
      });
      queued += 1;
    });
  });
  if (queued > 0) {
    battle.log.push(`[trigger] ${queued} efeito(s) de Infect colocados na pilha.`);
  }
  return queued;
}

function resolveMugicForPlayer(battle, playerIndex, mugicIndex, selectedTargets = null, options = {}) {
  const board = battle.board;
  const player = board.players[playerIndex];
  if (!player || mugicIndex < 0) {
    return false;
  }
  if (board.exchange?.disableMugic) {
    return false;
  }
  const prepaid = options.prepaidActivation || null;
  let mugicSlot = null;
  let mugicCard = null;
  let unit = null;
  let cost = 0;
  let mugicEffects = [];

  if (prepaid && prepaid.kind === "mugic") {
    mugicCard = prepaid.mugicCard || null;
    unit = resolveActivationCasterUnit(board, playerIndex, prepaid.sourceUnitId || null);
    cost = Number(prepaid.cost || 0);
    mugicEffects = cloneEffectsWithRuntimeIndex(prepaid.effectPayload || []);
    if (!mugicCard || !unit || unit.defeated) {
      return false;
    }
  } else {
    mugicSlot = (player.mugicSlots || []).find(
      (entry) =>
        entry
        && entry.available
        && !entry.queued
        && !entry.spent
        && Number(entry.slotIndex) === Number(mugicIndex)
    );
    mugicCard = mugicSlot?.card || null;
    if (!mugicCard) {
      return false;
    }
    const caster = chooseBestMugicCaster(
      board,
      playerIndex,
      mugicCard,
      board.exchange,
      options.casterUnitId || null
    );
    unit = caster?.unit || resolveActivationCasterUnit(board, playerIndex, options.casterUnitId || null);
    if (!unit || !canCreaturePlayMugicCard(board, playerIndex, unit, mugicCard)) {
      return false;
    }
    cost = mugicCostForUnit(board, playerIndex, unit, mugicCard, board.exchange);
    if (unit.mugicCounters < cost) {
      return false;
    }
    const staticMugicBonus = combinedParsedEffects(unit)
      .filter((effect) => effect.kind === "mugicDamageModifier")
      .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
    const mugicEffectsRaw = (mugicCard.parsedEffects || []).map((effect) => {
      if (effect.kind === "dealDamage" && staticMugicBonus) {
        return { ...effect, amount: Number(effect.amount || 0) + staticMugicBonus };
      }
      return effect;
    });
    mugicEffects = cloneEffectsWithRuntimeIndex(
      filterCoreEffects(mugicEffectsRaw, battle, `Mugic ${mugicCard.name}`)
    );
  }

  const targetSteps = buildTargetStepsForEffects(battle, playerIndex, mugicEffects, unit);
  if (targetSteps.some((step) => !step.candidates?.length)) {
    battle.log.push(`[noop_filtered_context] Mugic ${mugicCard.name}: sem alvo valido para ${targetSteps.find((step) => !step.candidates?.length)?.effectKind || "efeito"}.`);
    return false;
  }

  if (!prepaid) {
    markSpentMugicSlot(board, playerIndex, Number(mugicSlot.slotIndex));
    player.mugicDiscard.push(mugicCard);
    unit.mugicCounters = Math.max(0, unit.mugicCounters - cost);
    battle.log.push(`${player.label} ativa ${mugicCard.name} (custo pago ${cost} MC, slot ${Number(mugicSlot.slotIndex) + 1}).`);
    logEffect(battle, {
      type: "mugic",
      source: mugicCard.name,
      effectKind: "mugicCostPaid",
      targets: [unitDisplayName(unit)],
      description: `${mugicCard.name} ativado: custo ${cost} MC pago`,
      result: "cost_paid",
    });
  }

  if (!selectedTargets && targetSteps.length) {
    if (options.allowPrompt) {
      battle.pendingAction = {
        type: "target_select",
        windowType: battle?.burstState?.windowType || battle.phase,
        playerIndex,
        sourceKind: "mugic",
        sourceLabel: mugicCard.name,
        mugicIndex: Number(mugicIndex),
        sourceUnitId: unit.unitId,
        targetSteps,
        currentStep: 0,
        selectedTargets: {},
        activationContext: {
          kind: "mugic",
          sourceLabel: mugicCard.name,
          mugicIndex: Number(mugicIndex),
          mugicCard,
          sourceUnitId: unit.unitId,
          cost,
          effectPayload: mugicEffects,
        },
      };
      return "await_target";
    }
    selectedTargets = selectedTargetsForAi(targetSteps);
    if (!selectedTargets) {
      battle.log.push(`[noop_filtered_context] Mugic ${mugicCard.name}: sem alvo valido.`);
      return false;
    }
  }

  const choiceSteps = buildChoiceStepsForEffects(mugicEffects);
  let selectedChoices = options.selectedChoices || null;
  if (!selectedChoices && choiceSteps.length) {
    if (options.allowPrompt) {
      battle.pendingAction = {
        type: "choice_select",
        windowType: battle?.burstState?.windowType || battle.phase,
        playerIndex,
        sourceKind: "mugic",
        sourceLabel: mugicCard.name,
        mugicIndex: Number(mugicIndex),
        sourceUnitId: unit.unitId,
        targetSteps,
        selectedTargets: selectedTargets || {},
        choiceSteps,
        currentChoiceStep: 0,
        selectedChoices: {},
        activationContext: {
          kind: "mugic",
          sourceLabel: mugicCard.name,
          mugicIndex: Number(mugicIndex),
          mugicCard,
          sourceUnitId: unit.unitId,
          cost,
          effectPayload: mugicEffects,
        },
      };
      return "await_choice";
    }
    selectedChoices = selectedChoicesForAi(choiceSteps);
    if (!selectedChoices) {
      battle.log.push(`[noop_filtered_context] Mugic ${mugicCard.name}: sem escolha valida.`);
      return false;
    }
  }

  const queuedEffects = applyChoiceSelectionsToEffects(mugicEffects, selectedChoices);
  battle.log.push(`${player.label} coloca ${mugicCard.name} na pilha.`);
  const choiceSummary = summarizeSelectedChoices(selectedChoices);
  logEffect(battle, {
    type: "mugic",
    source: mugicCard.name,
    effectKind: "mugicCast",
    targets: [unitDisplayName(unit)],
    description: `${mugicCard.name} entrou na pilha`,
    effects: (queuedEffects || []).map((e) => e.kind).filter(Boolean),
    choices: choiceSummary,
    result: "queued",
  });
  queueStackItem(battle, {
    kind: "mugic",
    source: `Mugic ${mugicCard.name}`,
    owner: playerIndex,
    playerIndex,
    mugicSlotIndex: Number(prepaid?.mugicSlotIndex ?? mugicSlot?.slotIndex ?? mugicIndex),
    sourceUnitId: unit.unitId,
    costsPaid: { type: "mugic", amount: cost },
    effectPayload: queuedEffects,
    targetsSnapshot: selectedTargets || null,
    choicesSnapshot: selectedChoices || null,
    targets: {
      attackerSlot: board.engagement.attackerSlot,
      defenderSlot: board.engagement.defenderSlot,
    },
    effectRef: mugicCard.id || mugicCard.name,
    timing: battle.phase,
  });
  queueInfectTriggersFromMugicTargeting(battle, playerIndex, selectedTargets || null, mugicCard.name);
  return true;
}

function resolveAbilityForPlayer(battle, playerIndex, option, selectedTargets = null, options = {}) {
  const board = battle.board;
  const player = board.players[playerIndex];
  const prepaid = options.prepaidActivation || null;
  const resolvedOption = prepaid?.option || option || null;
  const unit = resolveActivationCasterUnit(
    board,
    playerIndex,
    resolvedOption?.sourceUnitId || options.casterUnitId || prepaid?.sourceUnitId || null
  );
  if (!resolvedOption || !player || !unit || !board.exchange) {
    return false;
  }
  if (!prepaid && !canPayActivationCost(board, playerIndex, unit, player, board.exchange, resolvedOption.cost)) {
    return false;
  }
  const abilityEffects = cloneEffectsWithRuntimeIndex(
    filterCoreEffects(prepaid?.effectPayload || resolvedOption.effects || [], battle, `Ability ${resolvedOption.sourceLabel}`)
  );
  const targetSteps = buildTargetStepsForEffects(battle, playerIndex, abilityEffects, unit);
  if (targetSteps.some((step) => !step.candidates?.length)) {
    battle.log.push(`[noop_filtered_context] Ability ${resolvedOption.sourceLabel}: sem alvo valido para ${targetSteps.find((step) => !step.candidates?.length)?.effectKind || "efeito"}.`);
    return false;
  }
  if (!prepaid) {
    if (!payActivationCost(board, playerIndex, unit, player, board.exchange, resolvedOption.cost, battle)) {
      return false;
    }
    board.exchange.activatedAbilityUsed[playerIndex] = true;
    unit.combat.activatedAbilityUsed = true;
    battle.log.push(`${player.label} ativa habilidade de ${resolvedOption.sourceLabel} (${resolvedOption.cost.label}).`);
    logEffect(battle, {
      type: "ability",
      source: resolvedOption.sourceLabel,
      effectKind: "abilityCostPaid",
      targets: [unitDisplayName(unit)],
      description: `Custo pago: ${resolvedOption.cost.label}`,
      result: "cost_paid",
    });
  }
  if (!selectedTargets && targetSteps.length) {
    if (options.allowPrompt) {
      battle.pendingAction = {
        type: "target_select",
        windowType: battle?.burstState?.windowType || battle.phase,
        playerIndex,
        sourceKind: "ability",
        sourceLabel: resolvedOption.sourceLabel,
        sourceUnitId: unit.unitId,
        option: resolvedOption,
        targetSteps,
        currentStep: 0,
        selectedTargets: {},
        activationContext: {
          kind: "ability",
          sourceLabel: resolvedOption.sourceLabel,
          sourceUnitId: unit.unitId,
          option: resolvedOption,
          effectPayload: abilityEffects,
          cost: { ...(resolvedOption.cost || {}) },
        },
      };
      return "await_target";
    }
    selectedTargets = selectedTargetsForAi(targetSteps);
    if (!selectedTargets) {
      battle.log.push(`[noop_filtered_context] Ability ${resolvedOption.sourceLabel}: sem alvo valido.`);
      return false;
    }
  }

  const choiceSteps = buildChoiceStepsForEffects(abilityEffects);
  let selectedChoices = options.selectedChoices || null;
  if (!selectedChoices && choiceSteps.length) {
    if (options.allowPrompt) {
      battle.pendingAction = {
        type: "choice_select",
        windowType: battle?.burstState?.windowType || battle.phase,
        playerIndex,
        sourceKind: "ability",
        sourceLabel: resolvedOption.sourceLabel,
        sourceUnitId: unit.unitId,
        option: resolvedOption,
        targetSteps,
        selectedTargets: selectedTargets || {},
        choiceSteps,
        currentChoiceStep: 0,
        selectedChoices: {},
        activationContext: {
          kind: "ability",
          sourceLabel: resolvedOption.sourceLabel,
          sourceUnitId: unit.unitId,
          option: resolvedOption,
          effectPayload: abilityEffects,
          cost: { ...(resolvedOption.cost || {}) },
        },
      };
      return "await_choice";
    }
    selectedChoices = selectedChoicesForAi(choiceSteps);
    if (!selectedChoices) {
      battle.log.push(`[noop_filtered_context] Ability ${resolvedOption.sourceLabel}: sem escolha valida.`);
      return false;
    }
  }
  const queuedEffects = applyChoiceSelectionsToEffects(abilityEffects, selectedChoices);
  const countsAsMugicBurst = queuedEffects.some((entry) => entry?.kind === "countsAsMugicBurst");
  battle.log.push(`${player.label} coloca habilidade de ${resolvedOption.sourceLabel} na pilha.`);
  const choiceSummary = summarizeSelectedChoices(selectedChoices);
  logEffect(battle, {
    type: "ability",
    source: resolvedOption.sourceLabel,
    effectKind: "abilityActivated",
    targets: [unitDisplayName(unit)],
    description: `Habilidade de ${resolvedOption.sourceLabel} entrou na pilha`,
    effects: (queuedEffects || []).map((e) => e.kind).filter(Boolean),
    choices: choiceSummary,
    result: "queued",
  });
  queueStackItem(battle, {
    kind: countsAsMugicBurst ? "mugic" : "ability",
    source: `Ability ${resolvedOption.sourceLabel}`,
    owner: playerIndex,
    playerIndex,
    sourceUnitId: unit.unitId,
    costsPaid: { ...(resolvedOption.cost || {}) },
    effectPayload: queuedEffects,
    targetsSnapshot: selectedTargets || null,
    choicesSnapshot: selectedChoices || null,
    targets: {
      attackerSlot: board.engagement.attackerSlot,
      defenderSlot: board.engagement.defenderSlot,
    },
    effectRef: resolvedOption.id || resolvedOption.sourceLabel,
    timing: battle.phase,
  });
  return true;
}

function scorePriorityOption(option) {
  const effects = option.kind === "mugic" ? option.card?.parsedEffects || [] : option.option?.effects || [];
  return effects.reduce((sum, effect) => {
    if (effect.kind === "dealDamage" || effect.kind === "attackDamageModifier") {
      return sum + Math.abs(Number(effect.amount || 0)) + 2;
    }
    if (effect.kind === "healDamage" || effect.kind === "statModifier" || effect.kind === "elementModifier") {
      return sum + Math.abs(Number(effect.amount || 0));
    }
    return sum + 0.4;
  }, 0);
}

function pickPriorityActionForAi(options) {
  if (!options.length) {
    return { kind: "pass" };
  }
  const scored = options
    .map((option) => ({ option, score: scorePriorityOption(option) }))
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score <= 0) {
    return { kind: "pass" };
  }
  const best = scored[0].option;
  if (best.kind === "mugic") {
    return { kind: "mugic", mugicIndex: best.mugicIndex, casterUnitId: best.casterUnitId || null };
  }
  return { kind: "ability", optionIndex: best.optionIndex };
}

function buildPriorityOptionsForPlayer(board, playerIndex, windowType) {
  const options = [];
  (board.players[playerIndex]?.mugicSlots || []).forEach((slotEntry) => {
    if (slotEntry && slotEntry.card) {
      slotEntry.disabledByEffect = Boolean(board.exchange?.disableMugic);
    }
  });
  if (!board.exchange?.disableMugic) {
    const playableMugic = flattenPlayableMugicEntries(
      collectPlayableMugicCards(board, playerIndex, board.exchange)
    );
    playableMugic.forEach((entry) => {
      options.push({
        id: `mugic:${playerIndex}:${entry.mugicIndex}:${entry.casterUnitId || "none"}`,
        kind: "mugic",
        mugicIndex: entry.mugicIndex,
        card: entry.card,
        cost: entry.cost,
        casterUnitId: entry.casterUnitId || null,
        casterSlot: Number.isInteger(entry.casterSlot) ? entry.casterSlot : null,
      });
    });
  }
  if (!board.exchange?.disableMugic) {
    const abilityOptions = buildActivatedOptions(board, playerIndex, board.exchange);
    abilityOptions.forEach((option, optionIndex) => {
      options.push({
        id: `ability:${playerIndex}:${optionIndex}`,
        kind: "ability",
        optionIndex,
        option,
      });
    });
  }
  return options;
}

function resolvePriorityChoice(battle, playerIndex, options, choice, executionOptions = {}) {
  if (!choice || choice.kind === "pass") {
    return false;
  }
  if (choice.kind === "target_resolved_played") {
    return true;
  }
  if (choice.kind === "mugic") {
    const mugicIndex = Number(
      choice.mugicIndex !== undefined && choice.mugicIndex !== null
        ? choice.mugicIndex
        : choice.handIndex
    );
    const matchingOptions = options.filter(
      (option) => option.kind === "mugic" && option.mugicIndex === mugicIndex
    );
    let selectedOption = null;
    if (choice.casterUnitId) {
      selectedOption = matchingOptions.find(
        (option) => option.casterUnitId === choice.casterUnitId
      );
    }
    if (!selectedOption && matchingOptions.length > 1 && executionOptions.allowPrompt) {
      battle.pendingAction = {
        type: "mugic_caster_select",
        playerIndex,
        windowType: battle?.burstState?.windowType || battle.phase,
        mugicIndex,
        options: matchingOptions.map((option) => ({
          casterUnitId: option.casterUnitId,
          casterSlot: option.casterSlot,
          cost: option.cost,
          card: option.card,
        })),
        choice: null,
      };
      return "await_caster";
    }
    if (!selectedOption && matchingOptions.length) {
      selectedOption = matchingOptions[0];
    }
    if (!selectedOption) {
      return false;
    }
    return resolveMugicForPlayer(battle, playerIndex, mugicIndex, null, {
      allowPrompt: Boolean(executionOptions.allowPrompt),
      casterUnitId: selectedOption.casterUnitId || null,
    });
  }
  if (choice.kind === "ability") {
    const optionIndex = Number(choice.optionIndex);
    const selected = options.find((option) => option.kind === "ability" && option.optionIndex === optionIndex)?.option || null;
    return resolveAbilityForPlayer(battle, playerIndex, selected, null, {
      allowPrompt: Boolean(executionOptions.allowPrompt),
    });
  }
  return false;
}

function runPriorityWindow(battle, windowType, forceAutoHuman = false, priorityStarter = null, skipStackResolve = false) {
  ensureExchangeContext(battle);
  const board = battle.board;
  if (
    battle.pendingAction?.type === "priority"
    && battle.pendingAction.windowType
    && battle.pendingAction.windowType !== windowType
  ) {
    windowType = battle.pendingAction.windowType;
  }
  const startPriority = Number.isInteger(priorityStarter)
    ? priorityStarter
    : (Number.isInteger(board.initiativeWinner) ? board.initiativeWinner : board.activePlayerIndex);
  if (!battle.burstState || battle.burstState.windowType !== windowType) {
    battle.burstState = {
      activePlayer: startPriority,
      passesInRow: 0,
      windowType,
    };
    battle.priorityState = battle.burstState;
  }

  let guard = 0;
  while (battle.burstState.passesInRow < 2 && guard < 24) {
    guard += 1;
    const playerIndex = battle.burstState.activePlayer;
    const options = buildPriorityOptionsForPlayer(board, playerIndex, windowType);
    const isHuman = isHumanControlledPlayer(battle, playerIndex, forceAutoHuman);

    if (isHuman) {
      if (
        battle.pendingAction?.type === "mugic_caster_select"
        && battle.pendingAction.playerIndex === playerIndex
        && Number(battle.pendingAction.mugicIndex) >= 0
      ) {
        if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
          return false;
        }
        const selectedIndex = Number(battle.pendingAction.choice);
        if (selectedIndex < 0) {
          battle.log.push(`${board.players[playerIndex].label} cancela a selecao do caster de Mugic e passa prioridade.`);
          battle.pendingAction = null;
          battle.burstState.passesInRow += 1;
          battle.burstState.activePlayer = targetPlayer(playerIndex);
          continue;
        }
        const selectedCaster = battle.pendingAction.options?.[selectedIndex] || null;
        const mugicChoice = {
          kind: "mugic",
          mugicIndex: Number(battle.pendingAction.mugicIndex),
          casterUnitId: selectedCaster?.casterUnitId || null,
        };
        const played = resolvePriorityChoice(
          battle,
          0,
          options,
          mugicChoice,
          { allowPrompt: true }
        );
        if (played === "await_target" || played === "await_caster" || played === "await_choice") {
          return false;
        }
        if (played) {
          battle.burstState.passesInRow = 0;
        } else {
          battle.burstState.passesInRow += 1;
          battle.log.push(`${board.players[playerIndex].label} passa prioridade.`);
        }
        battle.pendingAction = null;
        battle.burstState.activePlayer = targetPlayer(playerIndex);
        continue;
      }
      if (
        battle.pendingAction?.type === "priority"
        && battle.pendingAction.playerIndex === playerIndex
        && battle.pendingAction.windowType === windowType
      ) {
        if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
          return false;
        }
        const played = resolvePriorityChoice(
          battle,
          0,
          options,
          battle.pendingAction.choice,
          { allowPrompt: true }
        );
        if (played === "await_target" || played === "await_caster" || played === "await_choice") {
          return false;
        }
        if (played) {
          battle.burstState.passesInRow = 0;
        } else {
          battle.burstState.passesInRow += 1;
          battle.log.push(`${board.players[playerIndex].label} passa prioridade.`);
        }
        battle.pendingAction = null;
        battle.burstState.activePlayer = targetPlayer(playerIndex);
        continue;
      }

      if (options.length) {
      battle.pendingAction = {
        type: "priority",
        windowType,
        playerIndex,
        options,
        choice: null,
        priorityPlayer: playerIndex,
      };
      battle.log.push(`Janela de prioridade (${windowType}): escolha um efeito ou passe.`);
      return false;
    }
      battle.burstState.passesInRow += 1;
      battle.burstState.activePlayer = targetPlayer(playerIndex);
      continue;
    }

    const aiChoice = pickPriorityActionForAi(options);
    const played = resolvePriorityChoice(battle, playerIndex, options, aiChoice, { allowPrompt: false });
    if (played === "await_target" || played === "await_caster" || played === "await_choice") {
      return false;
    }
    if (played) {
      battle.burstState.passesInRow = 0;
    } else {
      battle.burstState.passesInRow += 1;
    }
    battle.burstState.activePlayer = targetPlayer(playerIndex);
  }

  battle.burstState = null;
  battle.priorityState = null;
  if (battle.pendingAction?.type === "priority") {
    battle.pendingAction = null;
  }
  if (!skipStackResolve) {
    const resolved = resolveEffectStack(battle, forceAutoHuman);
    if (!resolved) {
      return false;
    }
  }
  revealNewLocationDuringCombat(battle);
  return true;
}

function isGlobalPassiveEffectScope(effect) {
  const target = String(effect?.target || "").toLowerCase();
  const scope = String(effect?.scope || "").toLowerCase();
  const text = String(effect?.sourceText || "").toLowerCase();
  if (target === "all" || target === "both") {
    return true;
  }
  if (scope === "allcreatures" || scope === "all" || scope === "global") {
    return true;
  }
  return (
    text.includes("creatures you control")
    || text.includes("other creatures you control")
    || text.includes("all creatures")
    || text.includes("opposing creatures")
    || text.includes("your attacks")
    || text.includes("attacks played by creatures you control")
    || text.includes("you control have")
  );
}

function applyPassiveAbilities(battle, forceAutoHuman = false) {
  const board = battle.board;
  // Combat-pair specific keywords still resolve from the engaged pair.
  [0, 1].forEach((playerIndex) => {
    const engagedUnit = unitForPlayer(board, playerIndex);
    const opposingUnit = unitForPlayer(board, targetPlayer(playerIndex));
    if (!engagedUnit || engagedUnit.defeated) {
      return;
    }
    const intimidate = engagedUnit.statuses?.intimidate || [];
    intimidate.forEach((item) => {
      if (!item.stat || !Number.isFinite(item.amount)) {
        return;
      }
      board.exchange.statAdjustments[targetPlayer(playerIndex)][item.stat] -= Number(item.amount || 0);
    });
    if (engagedUnit.statuses?.disarm && hasInvisibilityAdvantage(engagedUnit, opposingUnit) && activeGearCard(opposingUnit)) {
      ELEMENT_KEYS.concat(["courage", "power", "wisdom", "speed", "energy", "mugicability"]).forEach((stat) => {
        const loss = Number(opposingUnit.gearPassiveMods?.[stat] || 0);
        if (loss !== 0) {
          board.exchange.statAdjustments[targetPlayer(playerIndex)][stat] -= loss;
        }
      });
    }
  });

  // Passive auras/continuous effects can come from non-engaged units too.
  for (let playerIndex = 0; playerIndex <= 1; playerIndex += 1) {
    for (const unit of aliveUnitsForPlayer(board, playerIndex)) {
      const sourceEngaged = isUnitCurrentlyEngaged(board, playerIndex, unit);
      const sourceEffects = [];
      const creatureEffectBuckets = splitCardEffectsByActivation(activeCreatureCard(unit));
      sourceEffects.push(
        ...(creatureEffectBuckets.passive || []).filter((effect) => PASSIVE_EFFECT_KINDS.has(effect.kind))
      );
      const gearCard = activeGearCard(unit);
      if (gearCard) {
        const gearEffectBuckets = splitCardEffectsByActivation(gearCard);
        sourceEffects.push(
          ...(gearEffectBuckets.passive || []).filter((effect) => BATTLEGEAR_PHASE_EFFECT_KINDS.has(effect.kind))
        );
      }
      const applicableEffects = sourceEffects.filter(
        (effect) => sourceEngaged || isGlobalPassiveEffectScope(effect)
      );
      if (!applicableEffects.length) {
        continue;
      }
      const runtimeEffects = cloneEffectsWithRuntimeIndex(applicableEffects);
      const sourceLabel = sourceEngaged
        ? `${board.players[playerIndex].label} - ${unitDisplayName(unit)}`
        : `${board.players[playerIndex].label} - ${unitDisplayName(unit)} (fora do combate)`;
      const targetSteps = buildTargetStepsForEffects(battle, playerIndex, runtimeEffects, unit);
      if (targetSteps.some((step) => !step.candidates?.length)) {
        const missing = targetSteps.find((step) => !step.candidates?.length);
        battle.log.push(
          `[noop_filtered_context] Passivo ${sourceLabel}: sem alvo valido para ${missing?.effectKind || "efeito"}.`
        );
        continue;
      }
      let selectedTargets = null;
      if (targetSteps.length) {
        // Continuous passives resolve targets automatically based on context / AI heuristics.
        selectedTargets = selectedTargetsForAi(targetSteps);
        if (!selectedTargets) {
          battle.log.push(`[noop_filtered_context] Passivo ${sourceLabel}: sem alvo valido para aplicacao continua.`);
          continue;
        }
      }
      applyParsedEffectsToExchange(
        board,
        playerIndex,
        runtimeEffects,
        board.exchange,
        `[passive] ${sourceLabel}: ${runtimeEffects.length} efeito(s) aplicado(s) automaticamente.`,
        battle,
        {
          sourceUnit: unit,
          sourcePlayerIndex: playerIndex,
          targetsByEffect: selectedTargets,
        }
      );
    }
  }
  return true;
}

function compareElements(battle) {
  const board = battle.board;
  [0, 1].forEach((playerIndex) => {
    const attack = board.exchange.chosenAttacks[playerIndex];
    const attacker = unitForPlayer(board, playerIndex);
    if (!attack || !attacker) {
      return;
    }
    let activeElements = 0;
    ELEMENT_KEYS.forEach((element) => {
      const amount = Number(attack.stats?.[`${element}Attack`] || 0);
      if (!amount) {
        return;
      }
      if (board.exchange.elementSuppressed[playerIndex].has(element)) {
        return;
      }
      if (unitStat(board, playerIndex, attacker, element, board.exchange) > 0) {
        activeElements += 1;
      }
    });
    battle.log.push(`${board.players[playerIndex].label} ativa ${activeElements} elemento(s) no ataque.`);
  });
}

function calculateDamage(battle) {
  const board = battle.board;
  [0, 1].forEach((attackerIndex) => {
    const attackCard = board.exchange.chosenAttacks[attackerIndex];
    const attackerUnit = unitForPlayer(board, attackerIndex);
    if (!attackCard || !attackerUnit || attackerUnit.defeated) {
      return;
    }
    let damage = damageFromAttackCard(board, attackerIndex, attackCard, board.exchange);
    const defenderIndex = targetPlayer(attackerIndex);
    const defenderUnit = unitForPlayer(board, defenderIndex);

    if (board.exchange.replaceAttackDamageWithDisciplineLoss?.[attackerIndex] && defenderUnit && !defenderUnit.defeated) {
      applyDisciplineLossFromDamage(board, defenderIndex, defenderUnit, damage, board.exchange);
      battle.log.push(
        `[resolved_effect] replaceAttackDamageWithDisciplineLoss: ${unitDisplayName(defenderUnit)} perde ${damage} em todas as disciplinas.`
      );
      damage = 0;
    }

    board.exchange.damageToCreature[defenderIndex] += damage;
    queueDamageEvent(
      board.exchange,
      defenderIndex,
      damage,
      "attack",
      attackerIndex,
      attackerUnit.unitId || null
    );
    const selfDamage = (attackCard.parsedEffects || [])
      .filter((effect) => effect.kind === "selfDamage")
      .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
    if (selfDamage > 0) {
      board.exchange.damageToCreature[attackerIndex] += selfDamage;
      queueDamageEvent(
        board.exchange,
        attackerIndex,
        selfDamage,
        "attack",
        attackerIndex,
        attackerUnit.unitId || null
      );
    }

    const playWhileEquippedGain = combinedParsedEffects(attackerUnit)
      .filter((effect) => effect?.kind === "onPlayAttackWhileEquippedGainEnergy" && effectCreatureNameMatchesUnit(effect, attackerUnit))
      .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
    const playWhileEquippedAmount = Math.max(0, Number(attackerUnit?.statuses?.onPlayAttackWhileEquippedGainEnergy || 0), playWhileEquippedGain);
    if (attackerUnit?.gearCard && playWhileEquippedAmount > 0) {
      board.exchange.healToCreature[attackerIndex] += playWhileEquippedAmount;
    }

    const firstAttackTribeEffect = combinedParsedEffects(attackerUnit).find(
      (effect) => effect?.kind === "onFirstAttackDamageGainSameEnergyIfControlTribe" && effectCreatureNameMatchesUnit(effect, attackerUnit)
    );
    const requiredTribe = normalizeTribeKey(
      attackerUnit?.statuses?.onFirstAttackDamageGainSameEnergyIfControlTribe?.requiredTribe
      || firstAttackTribeEffect?.requiredTribe
    );
    if (damage > 0 && (requiredTribe || firstAttackTribeEffect)) {
      const tribe = requiredTribe;
      const controlsRequired = !tribe
        || aliveUnitsForPlayer(board, attackerIndex).some((unit) => normalizeTribeKey(activeCreatureCard(unit)?.tribe) === tribe);
      if (controlsRequired && Number(attackerUnit?.combat?.attacksMade || 0) === 0) {
        board.exchange.healToCreature[attackerIndex] += damage;
      }
    }

    if (damage > 0 && defenderUnit && !defenderUnit.defeated) {
      if (attackerUnit?.statuses?.pendingNextAttackDisciplineLoss) {
        applyDisciplineLossFromDamage(board, defenderIndex, defenderUnit, damage, board.exchange);
        attackerUnit.statuses.pendingNextAttackDisciplineLoss = false;
        battle.log.push(
          `[resolved_effect] onNextAttackDamageReduceOpposingDisciplinesByDamage: ${unitDisplayName(defenderUnit)} perde ${damage} em todas as disciplinas.`
        );
      }
      const sourceLosesEnergyParsed = combinedParsedEffects(defenderUnit)
        .filter((effect) => effect?.kind === "onTakeDamageSourceLosesEnergy" && effectCreatureNameMatchesUnit(effect, defenderUnit))
        .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
      const sourceLosesEnergyAmount = Math.max(0, Number(defenderUnit?.statuses?.onTakeDamageSourceLosesEnergy || 0), sourceLosesEnergyParsed);
      if (sourceLosesEnergyAmount > 0) {
        board.exchange.damageToCreature[attackerIndex] += sourceLosesEnergyAmount;
        queueDamageEvent(
          board.exchange,
          attackerIndex,
          sourceLosesEnergyAmount,
          "ability",
          defenderIndex,
          defenderUnit.unitId || null
        );
      }
      const gainIncomingEffectActive = Boolean(defenderUnit.statuses?.gainElementsFromIncomingAttack)
        || combinedParsedEffects(defenderUnit).some(
          (effect) => effect?.kind === "gainElementsFromIncomingAttack" && effectCreatureNameMatchesUnit(effect, defenderUnit)
        );
      if (gainIncomingEffectActive) {
        const gainedElements = [];
        ELEMENT_KEYS.forEach((element) => {
          const amount = Number(attackCard.stats?.[`${element}Attack`] || 0);
          if (amount <= 0) {
            return;
          }
          if (unitStat(board, defenderIndex, defenderUnit, element, board.exchange) <= 0) {
            defenderUnit.tempMods[element] = Number(defenderUnit.tempMods?.[element] || 0) + 1;
            gainedElements.push(element);
          }
        });
        const bonusFromParsed = combinedParsedEffects(defenderUnit)
          .filter((effect) => effect?.kind === "onGainElementGainElementValue" && effectCreatureNameMatchesUnit(effect, defenderUnit))
          .reduce((sum, effect) => sum + Number(effect.amount || 0), 0);
        const bonus = Math.max(0, Number(defenderUnit.statuses?.onGainElementGainElementValue || 0), bonusFromParsed);
        if (gainedElements.length && bonus > 0) {
          gainedElements.forEach((element) => {
            defenderUnit.tempMods[element] = Number(defenderUnit.tempMods?.[element] || 0) + bonus;
          });
        }
      }
    }

    if (damage > 0 && attackerUnit && !attackerUnit.defeated) {
      const postDamageSelfMods = combinedParsedEffects(attackerUnit).filter(
        (effect) => effect?.kind === "conditionalStatModifier"
          && String(effect?.timing || "").toLowerCase() === "on_attack_damage_dealt"
          && String(effect?.target || "self").toLowerCase() === "self"
      );
      postDamageSelfMods.forEach((effect) => {
        const stat = String(effect.stat || "").toLowerCase();
        if (!["courage", "power", "wisdom", "speed", ...ELEMENT_KEYS].includes(stat)) {
          return;
        }
        attackerUnit.tempMods[stat] = Number(attackerUnit.tempMods?.[stat] || 0) + Number(effect.amount || 0);
      });
      const destroyByPower = combinedParsedEffects(attackerUnit).filter(
        (effect) => effect?.kind === "destroySelfIfPowerAboveThreshold" && effectCreatureNameMatchesUnit(effect, attackerUnit)
      );
      const powerNow = Number(unitStat(board, attackerIndex, attackerUnit, "power", board.exchange) || 0);
      if (destroyByPower.some((effect) => powerNow > Number(effect.threshold || 0))) {
        const fatalDamage = unitMaxEnergy(attackerUnit);
        board.exchange.damageToCreature[attackerIndex] += fatalDamage;
        queueDamageEvent(
          board.exchange,
          attackerIndex,
          fatalDamage,
          "ability",
          attackerIndex,
          attackerUnit.unitId || null
        );
        battle.log.push(`[resolved_effect] destroySelfIfPowerAboveThreshold: ${unitDisplayName(attackerUnit)} destruida.`);
      }
    }

    if (defenderUnit && !defenderUnit.defeated) {
      defenderUnit.combat.attacksReceived += 1;
    }
    if (attackerUnit.statuses?.recklessness) {
      const baseRecklessness = Number(attackerUnit.statuses.recklessness || 0);
      const reduced = Math.max(0, baseRecklessness - incomingDamageReductionForUnit(attackerUnit, "recklessness"));
      board.exchange.damageToCreature[attackerIndex] += reduced;
    }
    battle.log.push(`${board.players[attackerIndex].label} prepara ${damage} dano com ${attackCard.name}.`);
    if (selfDamage > 0) {
      battle.log.push(`${board.players[attackerIndex].label} recebe ${selfDamage} auto-dano de ${attackCard.name}.`);
    }

    if (board.exchange.destroyIfAllDisciplinesZero) {
      [0, 1].forEach((candidatePlayerIndex) => {
        const candidateUnit = unitForPlayer(board, candidatePlayerIndex);
        if (!candidateUnit || candidateUnit.defeated) {
          return;
        }
        if (!unitHasZeroInAllDisciplines(board, candidatePlayerIndex, candidateUnit, board.exchange)) {
          return;
        }
        const fatalDamage = unitMaxEnergy(candidateUnit);
        board.exchange.damageToCreature[candidatePlayerIndex] += fatalDamage;
        queueDamageEvent(
          board.exchange,
          candidatePlayerIndex,
          fatalDamage,
          "ability",
          attackerIndex,
          attackerUnit.unitId || null
        );
        battle.log.push(
          `[resolved_effect] destroyCreatureIfAllDisciplinesZero: ${unitDisplayName(candidateUnit)} destruida.`
        );
      });
    }
    board.combat.lastResolvedAttackDamage = Math.max(0, Number(damage || 0));
    board.combat.lastResolvedAttackName = attackCard.name;
    board.combat.lastResolvedAttackPlayer = attackerIndex;
  });
}

function queueTempEffectsFromAttacks(battle) {
  const board = battle.board;
  [0, 1].forEach((attackerIndex) => {
    const attackCard = board.exchange.chosenAttacks[attackerIndex];
    if (!attackCard) {
      return;
    }
    (attackCard.parsedEffects || []).forEach((effect) => {
      if (!effect || !effect.kind) {
        return;
      }

      if ((effect.kind === "statModifier" || effect.kind === "elementModifier") && effect.stat && Number.isFinite(effect.amount)) {
        const targetIndex = effect.target === "opponent" || effect.amount < 0 ? targetPlayer(attackerIndex) : attackerIndex;
        const slot = slotForPlayer(board, targetIndex);
        if (slot === null || slot === undefined) {
          return;
        }
        board.exchange.pendingTempMods.push({
          playerIndex: targetIndex,
          slot,
          stat: effect.stat,
          amount: Number(effect.amount || 0),
        });
        return;
      }

      if (effect.kind === "conditionalStatModifier" && effect.stat && Number.isFinite(effect.amount)) {
        if (effect.requiresElement) {
          const attackElementAmount = Number(attackCard.stats?.[`${effect.requiresElement}Attack`] || 0);
          if (attackElementAmount <= 0) {
            return;
          }
        }
        const targetIndex = effect.target === "opponent" || effect.amount < 0 ? targetPlayer(attackerIndex) : attackerIndex;
        const slot = slotForPlayer(board, targetIndex);
        if (slot === null || slot === undefined) {
          return;
        }
        board.exchange.pendingTempMods.push({
          playerIndex: targetIndex,
          slot,
          stat: effect.stat,
          amount: Number(effect.amount || 0),
        });
        return;
      }

      if (effect.kind === "removeElement" && effect.element) {
        const targetIndex = effect.target === "opponent" ? targetPlayer(attackerIndex) : attackerIndex;
        const targetUnit = unitForPlayer(board, targetIndex);
        if (!targetUnit) {
          return;
        }
        const currentElementValue = unitStat(board, targetIndex, targetUnit, effect.element, board.exchange);
        const slot = slotForPlayer(board, targetIndex);
        if (slot === null || slot === undefined) {
          return;
        }
        board.exchange.pendingTempMods.push({
          playerIndex: targetIndex,
          slot,
          stat: effect.element,
          amount: -Math.max(0, currentElementValue),
        });
        return;
      }
    });
  });
}

function applyEnergyUpdate(battle) {
  const board = battle.board;
  battle.flash = [];
  [0, 1].forEach((playerIndex) => {
    const unit = unitForPlayer(board, playerIndex);
    if (!unit || unit.defeated) {
      return;
    }
      const outgoingAttack = board.exchange.chosenAttacks[playerIndex];
      if (outgoingAttack) {
        unit.combat.attacksMade += 1;
        if (Number(unit.combat?.nextAttackBonus || 0) > 0) {
          unit.combat.nextAttackBonus = 0;
        }
      }

    let incomingDamage = Math.max(0, Number(board.exchange.damageToCreature[playerIndex] || 0));
    const incomingHealRaw = Math.max(0, Number(board.exchange.healToCreature[playerIndex] || 0));
    const healBlocked = Boolean(board.exchange.healBlocked?.[playerIndex]);
    let incomingHeal = healBlocked ? 0 : incomingHealRaw;
    const damageEvents = Array.isArray(board.exchange?.damageEvents)
      ? board.exchange.damageEvents.filter((entry) => Number(entry?.targetPlayerIndex) === playerIndex)
      : [];
    const attackEvents = damageEvents.filter((entry) => String(entry?.sourceKind || "").toLowerCase() === "attack" && Number(entry?.amount || 0) > 0);
    if (attackEvents.length) {
      const recent = attackEvents[attackEvents.length - 1];
      unit.statuses.lastAttackDamagerUnitId = recent.sourceUnitId || null;
      unit.statuses.lastAttackDamagerPlayerIndex = Number.isInteger(recent.sourcePlayerIndex) ? recent.sourcePlayerIndex : null;
      if (recent.sourceUnitId) {
        const sourceEntry = findUnitById(board, recent.sourceUnitId);
        if (sourceEntry?.unit?.statuses) {
          sourceEntry.unit.statuses.dealtAttackDamageThisTurn = true;
        }
      }
    }
    const redirectToUnitId = unit?.statuses?.nonAttackDamageRedirectToUnitId || null;
    if (redirectToUnitId) {
      const redirected = damageEvents
        .filter((entry) => String(entry?.sourceKind || "").toLowerCase() !== "attack")
        .reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
      if (redirected > 0) {
        const redirectOwner = findUnitById(board, redirectToUnitId);
        if (redirectOwner?.unit && !redirectOwner.unit.defeated) {
          incomingDamage = Math.max(0, incomingDamage - redirected);
          board.exchange.damageToCreature[redirectOwner.playerIndex] += redirected;
          queueDamageEvent(
            board.exchange,
            redirectOwner.playerIndex,
            redirected,
            "ability",
            playerIndex,
            unit.unitId || null
          );
          battle.log.push(
            `[resolved_effect] redirectNonAttackDamageToSelf: ${redirected} dano redirecionado para ${unitDisplayName(redirectOwner.unit)}.`
          );
        }
      }
    }
    if (board.exchange?.replaceMugicOrAbilityDamageWithEnergyGainUnitIds?.has(unit.unitId)) {
      const prevented = damageEvents
        .filter((entry) => String(entry?.sourceKind || "").toLowerCase() !== "attack")
        .reduce((sum, entry) => sum + Math.max(0, Number(entry?.amount || 0)), 0);
      if (prevented > 0) {
        incomingDamage = Math.max(0, incomingDamage - prevented);
        incomingHeal += prevented;
        battle.log.push(
          `[resolved_effect] replaceMugicOrAbilityDamageWithEnergyGain: ${unitDisplayName(unit)} converte ${prevented} dano em cura.`
        );
      }
    }
    const mugicGain = Math.max(0, Number(board.exchange.mugicCounterDelta[playerIndex] || 0));
    unit.currentEnergy = clamp(unit.currentEnergy - incomingDamage + incomingHeal, 0, unitMaxEnergy(unit));
    if (mugicGain > 0) {
      unit.mugicCounters += mugicGain;
      battle.log.push(`${unitDisplayName(unit)} ganha ${mugicGain} contador(es) de Mugic.`);
      triggerMugicCounterAddedHooks(board, battle, playerIndex, unit, mugicGain, "mugicCounterDelta");
    }
      if (incomingDamage > 0 || incomingHeal > 0) {
        battle.log.push(`${board.players[playerIndex].label} recebe ${incomingDamage} dano e ${incomingHeal} cura.`);
      }
      if (incomingDamage > 0 && Number(unit.combat?.onTakesDamageAttackBonus || 0) > 0) {
        const gained = Number(unit.combat.onTakesDamageAttackBonus || 0);
        unit.combat.nextAttackBonus = Number(unit.combat.nextAttackBonus || 0) + gained;
        battle.log.push(`${unitDisplayName(unit)} ganha +${gained} para o proximo Attack neste turno.`);
      }
    if (healBlocked && incomingHealRaw > 0) {
      battle.log.push(`${board.players[playerIndex].label}: cura bloqueada por habilidade ativa.`);
    }
    if (incomingDamage > 0) {
      const slot = slotForPlayer(board, playerIndex);
      if (slot !== null && slot !== undefined) {
        battle.flash.push({
          playerIndex,
          slot,
          until: Date.now() + 450,
        });
      }
    }
    if (unit.currentEnergy <= 0 && !unit.defeatRecorded) {
      unit.defeated = true;
      unit.defeatRecorded = true;
      emitBattleEvent("defeat", { playerIndex, unitId: unit.unitId });
      unit.positionLetter = null;
      unit.copyRuntime = null;
      if (battle.copyRuntimeByUnit && unit.unitId) {
        delete battle.copyRuntimeByUnit[unit.unitId];
      }
      board.players[playerIndex].creatureDiscard.push(unit.card);
      if (unit.gearCard) {
        const defeatedGear = unit.gearCard;
        board.players[playerIndex].battlegearDiscard.push(defeatedGear);
        stripUnitBattlegear(unit);
      }
      if (unit.statuses && typeof unit.statuses === "object") {
        unit.statuses.infected = false;
        delete unit.statuses.infectSource;
        delete unit.statuses.infectTurn;
      }
      battle.log.push(`${unitDisplayName(unit)} foi derrotada.`);
  logEffect(battle, { type: "defeat", source: "combat", effectKind: "defeat", targets: [unitDisplayName(unit)], description: `${unitDisplayName(unit)} foi derrotada` });
    }
  });
}

function applyPendingTempMods(board) {
  (board.exchange.pendingTempMods || []).forEach((item) => {
    const unit = board.players[item.playerIndex]?.creatures?.[item.slot];
    if (!unit || unit.defeated) {
      return;
    }
    unit.tempMods[item.stat] = Number(unit.tempMods[item.stat] || 0) + Number(item.amount || 0);
  });
}

function hasWinner(battle) {
  const aliveA = getAliveSlots(battle.board.players[0]).length;
  const aliveB = getAliveSlots(battle.board.players[1]).length;
  if (aliveA > 0 && aliveB > 0) {
    return false;
  }
  battle.finished = true;
  battle.phase = "finished";
  battle.turnStep = "finished";
  battle.winner = aliveA > 0 ? battle.board.players[0].label : battle.board.players[1].label;
  battle.log.push(`Vitoria de ${battle.winner}.`);
  return true;
}

function clearExchange(board) {
  board.pendingAttacks = { 0: null, 1: null };
  board.revealedAttacks = { 0: null, 1: null };
  board.exchange = null;
}

function endTurnCleanup(board) {
  board.players.forEach((player) => {
    player.creatures.forEach((unit) => {
      if (unit.defeated) {
        return;
      }
      unit.currentEnergy = unitMaxEnergy(unit);
      unit.tempMods = createTempStatMap();
      unit.tempEffects = [];
      unit.combat.attacksMade = 0;
      unit.combat.attacksReceived = 0;
      unit.combat.activatedAbilityUsed = false;
    });
  });
}

function queueBeginTurnTriggeredEffects(battle) {
  const board = battle.board;
  let queued = 0;
  board.players.forEach((player, playerIndex) => {
    player.creatures.forEach((unit) => {
      if (!unit || unit.defeated) {
        return;
      }
      const sources = [
        { label: unitDisplayName(unit), card: activeCreatureCard(unit), sourceUnitId: unit.unitId },
        { label: activeGearCard(unit)?.name || "Battlegear", card: activeGearCard(unit), sourceUnitId: unit.unitId },
      ].filter((source) => source.card);
      sources.forEach((source) => {
        const timedEffects = (source.card?.parsedEffects || []).filter(
          (effect) => String(effect?.timing || "").toLowerCase() === "begin_turn"
        );
        if (!timedEffects.length) {
          return;
        }
        const payload = filterCoreEffects(timedEffects, battle, `${source.label} (begin_turn)`);
        if (!payload.length) {
          return;
        }
        queueStackItem(battle, {
          kind: "triggered",
          source: `${source.label} (inicio do turno)`,
          owner: playerIndex,
          playerIndex,
          sourceUnitId: source.sourceUnitId,
          costsPaid: null,
          effectPayload: payload,
          targetsSnapshot: null,
          effectRef: source.card.id || source.card.name || source.label,
          timing: "begin_turn",
        });
        queued += 1;
      });
    });
  });

  if (board.locationCard) {
    const locationEffects = (board.locationCard.parsedEffects || []).filter(
      (effect) => String(effect?.timing || "").toLowerCase() === "begin_turn"
    );
    if (locationEffects.length) {
      const payload = filterCoreEffects(locationEffects, battle, `Location ${board.locationCard.name}`);
      if (payload.length) {
        queueStackItem(battle, {
          kind: "triggered_location",
          source: `Location ${board.locationCard.name} (inicio do turno)`,
          owner: board.activePlayerIndex,
          playerIndex: board.activePlayerIndex,
          sourceUnitId: null,
          costsPaid: null,
          effectPayload: payload,
          targetsSnapshot: null,
          effectRef: board.locationCard.id || board.locationCard.name,
          timing: "begin_turn",
        });
        queued += 1;
      }
    }
  }

  return queued;
}

function beginStartTurn(battle, forceAutoHuman = false) {
  const board = battle.board;
  if (battle.locationStepInitialized) {
    if (Array.isArray(battle.burstStack) && battle.burstStack.length) {
      const resolved = runPriorityWindow(battle, "turn_start_burst", forceAutoHuman, board.activePlayerIndex);
      if (!resolved) {
        return false;
      }
    }
    clearExchange(board);
    return true;
  }
  battle.locationStepInitialized = true;
  ensureBattleUnitMetadata(board);
  board.engagement.attackerSlot = null;
  board.engagement.defenderSlot = null;
  board.engagement.attackerLetter = null;
  board.engagement.defenderLetter = null;
  board.action.movedThisTurn = false;
  board.action.selectedMoverSlot = null;
  board.combat.active = false;
  board.combat.startResolved = false;
  board.combat.exchangeCount = 0;
  battle.combatsThisTurn = 0;
  battle.priorityState = null;
  battle.burstState = null;
  battle.burstStack = [];
  battle.effectStack = battle.burstStack;
  battle.stackNeedsPriorityReopen = false;
  battle.resolveDeclareNow = false;
  battle.pendingAction = null;
  clearExchange(board);
  resetTurnUnits(board);
  battle.combatState = {
    active: false,
    fromShowdown: false,
    attackerSlot: null,
    defenderSlot: null,
    initiativePlayer: null,
    strikePlayer: null,
    currentAttack: null,
    step: "idle",
    startTriggersApplied: false,
    exchangesResolved: 0,
    strikeContextPrepared: false,
  };
  battle.movementState = {
    hasMovedCreatureThisTurn: false,
    movedSlots: new Set(),
    movedUnitIdsThisTurn: new Set(),
    movedUnitMoveCountsThisTurn: new Map(),
    combatStarted: false,
  };
  battle.showdownTracker.combatOccurredThisTurn = false;
  // Reset per-creature movement tracking for the new turn
  board.players.forEach((player) => {
    player.creatures.forEach((unit) => {
      unit.movedThisAction = false;
    });
  });
  applyLocationCardForTurn(board);
  applyLocationEnterEffects(battle);
  const activePlayer = board.players[board.activePlayerIndex];
  normalizeAttackHandToRuleTarget(activePlayer, battle, activePlayer.label);
  battle.log.push(`Turno ${board.turn} - ${activePlayer.label}.`);
  if (board.locationCard) {
    battle.log.push(`Location: ${board.locationCard.name}.`);
  }
  const queuedBeginTurnEffects = queueBeginTurnTriggeredEffects(battle);
  if (queuedBeginTurnEffects > 0) {
    battle.log.push(`Burst de inicio de turno: ${queuedBeginTurnEffects} efeito(s) na pilha.`);
    const resolved = runPriorityWindow(battle, "turn_start_burst", forceAutoHuman, board.activePlayerIndex);
    if (!resolved) {
      return false;
    }
  }
  clearExchange(board);
  battle.turnStep = "location_step";
  return true;
}

function nextTurn(battle) {
  const board = battle.board;
  endTurnCleanup(board);
  battle.turnMeta.isFirstTurnOfMatch = false;
  board.turn += 1;
  board.activePlayerIndex = targetPlayer(board.activePlayerIndex);
}

function shouldPauseForHumanInput(battle, forceAutoHuman) {
  if (forceAutoHuman || battle.finished) {
    return false;
  }
  if (
    battle.pendingAction
    && isHumanControlledPlayer(battle, Number(battle.pendingAction.playerIndex), forceAutoHuman)
  ) {
    // Only pause if the human hasn't made a choice yet
    if (battle.pendingAction.type === "target_select" || battle.pendingAction.type === "choice_select") {
      return true;
    }
    if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
      return true;
    }
  }
  if (battle.phase === "move_action" && isHumanControlledPlayer(battle, battle.board.activePlayerIndex, forceAutoHuman)) {
    if (battle.mode === "1v1") {
      return false;
    }
    // Human controls move/engagement timing through board + confirm button.
    if (battle.resolveDeclareNow) {
      battle.resolveDeclareNow = false;
      return false;
    }
    return true;
  }
  if (
    battle.pendingAction?.type === "strike_attack"
    && isHumanControlledPlayer(battle, Number(battle.pendingAction.playerIndex), forceAutoHuman)
  ) {
    if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
      return true;
    }
  }
  // Pause for human during post-combat movement phase
  if (battle.phase === "additional_movement" && isHumanControlledPlayer(battle, battle.board.activePlayerIndex, forceAutoHuman)) {
    if (battle.mode === "1v1") {
      return false;
    }
    return true;
  }
  return false;
}

export function isHumanTurn(battle) {
  return isHumanControlledPlayer(battle, battle?.board?.activePlayerIndex ?? null, false);
}

export function createBattleState(deckAByType, deckBByType, mode = "casual") {
  let options = {};
  if (mode && typeof mode === "object") {
    options = mode;
    mode = options.mode || "casual";
  }
  const requestedProfile = String(options.ruleProfile || RULE_PROFILE_DEFAULT);
  const ruleProfile = RULE_PROFILE_CONFIG[requestedProfile] ? requestedProfile : RULE_PROFILE_DEFAULT;
  const oneVsOneMode = String(mode || "").toLowerCase() === "1v1";
  const board = createBoardState(deckAByType, deckBByType, {
    creatureSlots: oneVsOneMode ? 1 : 6,
    mugicSlots: oneVsOneMode ? 1 : 6,
  });
  ensureBattleUnitMetadata(board);
  if (oneVsOneMode) {
    const playerZeroUnit = board.players[0]?.creatures?.[0];
    const playerOneUnit = board.players[1]?.creatures?.[0];
    if (playerZeroUnit && !playerZeroUnit.defeated) {
      playerZeroUnit.positionLetter = ONE_VS_ONE_START_LETTERS[0];
    }
    if (playerOneUnit && !playerOneUnit.defeated) {
      playerOneUnit.positionLetter = ONE_VS_ONE_START_LETTERS[1];
    }
  }
  board.engagement.attackerLetter = null;
  board.engagement.defenderLetter = null;
  const startingPlayerIndex = Math.random() < 0.5 ? 0 : 1;
  board.activePlayerIndex = startingPlayerIndex;
  const battle = {
    mode,
    ruleProfile,
    ruleConfig: { ...RULE_PROFILE_CONFIG[ruleProfile] },
    phase: "location_step",
    turnStep: "location_step",
    finished: false,
    winner: null,
    log: ["Partida iniciada."],
    effectLog: [],
    flash: null,
    pendingAction: null,
    turnMeta: {
      startingPlayerIndex,
      isFirstTurnOfMatch: true,
    },
    priorityState: null,
    burstState: null,
    burstStack: [],
    effectStack: [],
    stackNeedsPriorityReopen: false,
    copyRuntimeByUnit: {},
    combatState: {
      active: false,
      fromShowdown: false,
      attackerSlot: null,
      defenderSlot: null,
      initiativePlayer: null,
      strikePlayer: null,
      currentAttack: null,
      step: "idle",
      startTriggersApplied: false,
      exchangesResolved: 0,
      strikeContextPrepared: false,
    },
    movementState: {
      hasMovedCreatureThisTurn: false,
      movedSlots: new Set(),
      movedUnitIdsThisTurn: new Set(),
      movedUnitMoveCountsThisTurn: new Map(),
      combatStarted: false,
    },
    showdownTracker: {
      noCombatStreakByPlayer: { 0: 0, 1: 0 },
      combatOccurredThisTurn: false,
    },
    combatsThisTurn: 0,
    resolveDeclareNow: false,
    locationStepInitialized: false,
    board,
  };
  battle.effectStack = battle.burstStack;

  battle.log.push(`${board.players[startingPlayerIndex].label} comeca a partida.`);
  battle.log.push(`Perfil de regras: ${ruleProfile}.`);

  board.players.forEach((player) => {
    drawCards(player, "attackDeck", "attackDiscard", "attackHand", attackHandTargetSize(battle));
  });

  return battle;
}

export function chooseEngagement(battle, attackerSlot, defenderSlot) {
  if (!battle || battle.finished || battle.phase !== "move_action") {
    return;
  }
  const board = battle.board;
  const activeIndex = board.activePlayerIndex;
  const ownUnit = resolveUnitSelection(board, activeIndex, attackerSlot);
  const enemyUnit = resolveUnitSelection(board, targetPlayer(activeIndex), defenderSlot);
  if (!ownUnit || ownUnit.defeated || !enemyUnit || enemyUnit.defeated) {
    return;
  }
  const ownLetter = unitPositionLetter(activeIndex, ownUnit);
  const enemyLetter = unitPositionLetter(targetPlayer(activeIndex), enemyUnit);
  if (!ownLetter || !enemyLetter) {
    return;
  }
  // Compatibility wrapper: engagement now follows move-into-occupied-space rules.
  chooseMove(battle, ownLetter, enemyLetter);
}

export function chooseMove(battle, fromSlot, toSlot) {
  if (!battle || battle.finished || battle.phase !== "move_action") {
    return false;
  }
  const board = battle.board;
  const activeIndex = board.activePlayerIndex;
  const movingUnit = resolveUnitSelection(board, activeIndex, fromSlot);
  const targetLetter = typeof toSlot === "string"
    ? normalizeBoardLetter(toSlot)
    : normalizeBoardLetter(slotLetter(activeIndex, toSlot) || slotLetter(targetPlayer(activeIndex), toSlot));
  if (!movingUnit || movingUnit.defeated || !unitHasMoveCapacity(battle, movingUnit)) {
    return false;
  }
  const fromLetter = unitPositionLetter(activeIndex, movingUnit);
  const remainingMoves = Math.max(0, moveLimitForUnit(movingUnit) - movesUsedByUnitThisTurn(battle, movingUnit.unitId));
  const canIgnoreAdjacency = Boolean(movingUnit?.statuses?.moveAsIfAdjacent) || unitHasEffectKind(movingUnit, "moveAsIfAdjacent");
  const hasRange = Boolean(movingUnit?.statuses?.range);
  if (!targetLetter || !fromLetter || targetLetter === fromLetter || remainingMoves <= 0) {
    return false;
  }
  let stepsToTarget = null;
  if (canIgnoreAdjacency) {
    stepsToTarget = 1;
  } else {
    const reachable = reachableLettersForUnit(
      board,
      battle,
      activeIndex,
      movingUnit,
      remainingMoves,
      hasRange
    );
    stepsToTarget = reachable.get(targetLetter);
  }
  if (!Number.isFinite(stepsToTarget) || Number(stepsToTarget) < 1) {
    return false;
  }
  const targetEntry = getUnitAtLetter(board, targetLetter);

  // Empty destination -> normal move.
  if (!targetEntry) {
    movingUnit.positionLetter = targetLetter;
    board.action.movedThisTurn = true;
    board.action.selectedMoverSlot = movingUnit.slot;
    board.engagement.attackerSlot = null;
    board.engagement.defenderSlot = null;
    board.engagement.attackerLetter = null;
    board.engagement.defenderLetter = null;
    registerUnitMoveUsage(battle, movingUnit, Number(stepsToTarget));
    battle.log.push(`${board.players[activeIndex].label} move ${unitDisplayName(movingUnit)} para ${targetLetter}.`);
    return true;
  }

  // Occupied destination must be an enemy creature to initiate combat.
  if (targetEntry.playerIndex === activeIndex || targetEntry.unit?.defeated) {
    return false;
  }
  if (movingUnit?.statuses?.replaceMoveIntoOpposingWithRelocate || unitHasEffectKind(movingUnit, "replaceMoveIntoOpposingWithRelocate")) {
    const defenderUnit = targetEntry.unit;
    defenderUnit.positionLetter = fromLetter;
    movingUnit.positionLetter = targetLetter;
    board.action.movedThisTurn = true;
    board.action.selectedMoverSlot = movingUnit.slot;
    board.engagement.attackerSlot = null;
    board.engagement.defenderSlot = null;
    board.engagement.attackerLetter = null;
    board.engagement.defenderLetter = null;
    registerUnitMoveUsage(battle, movingUnit, Number(stepsToTarget));
    battle.log.push(
      `${board.players[activeIndex].label} reposiciona ${unitDisplayName(defenderUnit)} para ${fromLetter} e ocupa ${targetLetter}.`
    );
    return true;
  }
  if (battle.combatsThisTurn >= 1) {
    battle.log.push("Limite de 1 combate por turno atingido.");
    return false;
  }

  let attackerUnitForEngage = movingUnit;
  const defenderUnit = targetEntry.unit;
  if (movingUnit?.statuses?.replaceBecomeEngagedBySwapWithUnderworld || unitHasEffectKind(movingUnit, "replaceBecomeEngagedBySwapWithUnderworld")) {
    const underworldAlly = aliveUnitsForPlayer(board, activeIndex).find((candidate) => {
      if (!candidate || candidate.unitId === movingUnit.unitId || candidate.defeated) {
        return false;
      }
      if (normalizeTribeKey(activeCreatureCard(candidate)?.tribe) !== "underworld") {
        return false;
      }
      return true;
    });
    if (underworldAlly) {
      const allyLetter = unitPositionLetter(activeIndex, underworldAlly);
      underworldAlly.positionLetter = fromLetter;
      movingUnit.positionLetter = allyLetter;
      attackerUnitForEngage = underworldAlly;
      registerUnitMoveUsage(battle, underworldAlly, Number(stepsToTarget));
      battle.log.push(
        `${unitDisplayName(movingUnit)} troca de lugar com ${unitDisplayName(underworldAlly)} para engajar em seu lugar.`
      );
    }
  }
  board.engagement.attackerSlot = attackerUnitForEngage.slot;
  board.engagement.defenderSlot = defenderUnit.slot;
  board.engagement.attackerLetter = unitPositionLetter(activeIndex, attackerUnitForEngage);
  board.engagement.defenderLetter = targetLetter;
  board.action.movedThisTurn = true;
  board.action.selectedMoverSlot = attackerUnitForEngage.slot;
  battle.resolveDeclareNow = true;
  battle.movementState.combatStarted = true;
  registerUnitMoveUsage(battle, movingUnit, Number(stepsToTarget));
  battle.log.push(`${board.players[activeIndex].label} move ${unitDisplayName(movingUnit)} para ${targetLetter} e inicia combate.`);
  return true;
}

export function chooseMugic(battle, mugicIndex = null, casterUnitId = null) {
  if (!battle || battle.finished) {
    return;
  }
  if (!battle.pendingAction) {
    return;
  }
  if (battle.pendingAction.type === "mugic_caster_select") {
    battle.pendingAction.choice = mugicIndex === null ? -1 : Number(mugicIndex);
    return;
  }
  if (battle.pendingAction.type === "mugic") {
    battle.pendingAction.choice = mugicIndex === null ? -1 : Number(mugicIndex);
    return;
  }
  if (battle.pendingAction.type !== "priority") {
    return;
  }
  battle.pendingAction.choice = mugicIndex === null
    ? { kind: "pass" }
    : { kind: "mugic", mugicIndex: Number(mugicIndex), casterUnitId: casterUnitId || null };
}

export function chooseActivatedAbility(battle, optionIndex = null) {
  if (!battle || battle.finished) {
    return;
  }
  if (!battle.pendingAction) {
    return;
  }
  if (battle.pendingAction.type === "ability") {
    battle.pendingAction.choice = optionIndex === null ? -1 : Number(optionIndex);
    return;
  }
  if (battle.pendingAction.type !== "priority") {
    return;
  }
  battle.pendingAction.choice = optionIndex === null
    ? { kind: "pass" }
    : { kind: "ability", optionIndex: Number(optionIndex) };
}

function resolvePendingTargetSelection(battle, candidateId = null) {
  if (!battle?.pendingAction || battle.pendingAction.type !== "target_select") {
    return false;
  }
  const pending = battle.pendingAction;
  const step = pending.targetSteps?.[pending.currentStep];
  if (!step) {
    setPriorityPendingChoiceAfterTargetResolution(battle, pending.playerIndex, pending.windowType, false);
    return false;
  }

  if (candidateId === null || candidateId === undefined || candidateId === "") {
    if (pending.sourceKind === "passive_auto") {
      battle.log.push(`Selecao de alvo cancelada para ${pending.sourceLabel || "efeito passivo"}.`);
      battle.pendingAction = null;
      return false;
    }
    if (pending.sourceKind === "mugic" || pending.sourceKind === "ability") {
      battle.log.push("Ativacao em andamento: selecione um alvo para continuar.");
      return false;
    }
    setPriorityPendingChoiceAfterTargetResolution(battle, pending.playerIndex, pending.windowType, false);
    return false;
  }

  const selected = (step.candidates || []).find((candidate) => String(candidate.id) === String(candidateId));
  if (!selected) {
    return false;
  }

  pending.selectedTargets[step.effectIndex] = selected;
  pending.currentStep += 1;
  if (pending.currentStep < (pending.targetSteps?.length || 0)) {
    return false;
  }

  let played = false;
  const allowPrompt = isHumanControlledPlayer(battle, Number(pending.playerIndex), false);
  if (pending.sourceKind === "mugic") {
    played = resolveMugicForPlayer(
      battle,
      pending.playerIndex,
      Number(pending.mugicIndex),
      pending.selectedTargets,
      {
        allowPrompt,
        prepaidActivation: pending.activationContext || null,
      }
    );
  } else if (pending.sourceKind === "ability") {
    played = resolveAbilityForPlayer(
      battle,
      pending.playerIndex,
      pending.option,
      pending.selectedTargets,
      {
        allowPrompt,
        prepaidActivation: pending.activationContext || null,
      }
    );
  } else if (pending.sourceKind === "passive_auto") {
    const sourceEntry = findUnitById(battle.board, pending.sourceUnitId);
    const runtimeEffects = cloneEffectsWithRuntimeIndex(pending.passiveEffects || []);
    applyParsedEffectsToExchange(
      battle.board,
      Number.isInteger(pending.sourcePlayerIndex) ? pending.sourcePlayerIndex : pending.playerIndex,
      runtimeEffects,
      battle.board.exchange,
      pending.logPrefix || `[passive] ${pending.sourceLabel || "efeito passivo"} resolvido.`,
      battle,
      {
        sourceUnit: sourceEntry?.unit || null,
        sourcePlayerIndex: Number.isInteger(sourceEntry?.playerIndex)
          ? sourceEntry.playerIndex
          : pending.sourcePlayerIndex,
        targetsByEffect: pending.selectedTargets,
      }
    );
    battle.pendingAction = null;
    return true;
  }

  if (played === "await_target" || played === "await_choice") {
    return true;
  }

  setPriorityPendingChoiceAfterTargetResolution(
    battle,
    pending.playerIndex,
    pending.windowType,
    Boolean(played)
  );
  return Boolean(played);
}

export function chooseEffectTarget(battle, candidateId = null) {
  if (!battle || battle.finished || !battle.pendingAction || battle.pendingAction.type !== "target_select") {
    return false;
  }
  return resolvePendingTargetSelection(battle, candidateId);
}

function resolvePendingChoiceSelection(battle, choiceId = null) {
  if (!battle?.pendingAction || battle.pendingAction.type !== "choice_select") {
    return false;
  }
  const pending = battle.pendingAction;
  const step = pending.choiceSteps?.[pending.currentChoiceStep];
  if (!step) {
    setPriorityPendingChoiceAfterTargetResolution(battle, pending.playerIndex, pending.windowType, false);
    return false;
  }

  if (choiceId === null || choiceId === undefined || choiceId === "") {
    if (pending.sourceKind === "passive_auto") {
      battle.log.push(`Selecao de escolha cancelada para ${pending.sourceLabel || "efeito passivo"}.`);
      battle.pendingAction = null;
      return false;
    }
    if (pending.sourceKind === "mugic" || pending.sourceKind === "ability") {
      battle.log.push("Ativacao em andamento: escolha obrigatoria antes de empilhar o efeito.");
      return false;
    }
    setPriorityPendingChoiceAfterTargetResolution(battle, pending.playerIndex, pending.windowType, false);
    return false;
  }

  const selected = (step.options || []).find((option) => {
    const optionId = option?.id ?? option?.value;
    return String(optionId) === String(choiceId);
  });
  if (!selected) {
    return false;
  }

  pending.selectedChoices[step.effectIndex] = selected;
  pending.currentChoiceStep += 1;
  if (pending.currentChoiceStep < (pending.choiceSteps?.length || 0)) {
    return false;
  }

  let played = false;
  if (pending.sourceKind === "mugic") {
    played = resolveMugicForPlayer(
      battle,
      pending.playerIndex,
      Number(pending.mugicIndex),
      pending.selectedTargets || null,
      {
        allowPrompt: false,
        selectedChoices: pending.selectedChoices || null,
        prepaidActivation: pending.activationContext || null,
      }
    );
  } else if (pending.sourceKind === "ability") {
    played = resolveAbilityForPlayer(
      battle,
      pending.playerIndex,
      pending.option,
      pending.selectedTargets || null,
      {
        allowPrompt: false,
        selectedChoices: pending.selectedChoices || null,
        prepaidActivation: pending.activationContext || null,
      }
    );
  } else if (pending.sourceKind === "passive_auto") {
    const sourceEntry = findUnitById(battle.board, pending.sourceUnitId);
    const runtimeEffects = applyChoiceSelectionsToEffects(
      cloneEffectsWithRuntimeIndex(pending.passiveEffects || []),
      pending.selectedChoices || null
    );
    applyParsedEffectsToExchange(
      battle.board,
      Number.isInteger(pending.sourcePlayerIndex) ? pending.sourcePlayerIndex : pending.playerIndex,
      runtimeEffects,
      battle.board.exchange,
      pending.logPrefix || `[passive] ${pending.sourceLabel || "efeito passivo"} resolvido.`,
      battle,
      {
        sourceUnit: sourceEntry?.unit || null,
        sourcePlayerIndex: Number.isInteger(sourceEntry?.playerIndex)
          ? sourceEntry.playerIndex
          : pending.sourcePlayerIndex,
        targetsByEffect: pending.selectedTargets || null,
      }
    );
    battle.pendingAction = null;
    return true;
  }

  if (played === "await_target" || played === "await_choice") {
    return true;
  }

  setPriorityPendingChoiceAfterTargetResolution(
    battle,
    pending.playerIndex,
    pending.windowType,
    Boolean(played)
  );
  return Boolean(played);
}

export function chooseEffectChoice(battle, choiceId = null) {
  if (!battle || battle.finished || !battle.pendingAction || battle.pendingAction.type !== "choice_select") {
    return false;
  }
  return resolvePendingChoiceSelection(battle, choiceId);
}

export function chooseDefenderRedirect(battle, targetSlot = null) {
  if (!battle || battle.finished) {
    return;
  }
  if (!battle.pendingAction || battle.pendingAction.type !== "defender_redirect") {
    return;
  }
  battle.pendingAction.choice = targetSlot === null ? -1 : Number(targetSlot);
}

export function endActionWithoutCombat(battle) {
  if (!battle || battle.finished || battle.phase !== "move_action") {
    return;
  }
  const hasAnyMove = getLegalMoves(battle).length > 0;
  if (hasAnyMove && !battle.movementState.hasMovedCreatureThisTurn) {
    battle.log.push("Voce precisa mover ao menos uma criatura se houver movimento legal.");
    return;
  }
  const engageMoves = getLegalMoves(battle).filter((move) => move.type === "move_engage");
  const mustEngageViolation = engageMoves.some((move) => {
    const unit = battle.board.players[battle.board.activePlayerIndex]?.creatures?.[move.attackerSlot];
    return Boolean(unit?.statuses?.mustEngageIfPossible) || unitHasEffectKind(unit, "mustEngageIfPossible");
  });
  if (mustEngageViolation) {
    battle.log.push("Uma criatura com efeito obrigatorio deve engajar se houver alvo valido.");
    return;
  }
  battle.board.engagement.attackerSlot = null;
  battle.board.engagement.defenderSlot = null;
  battle.board.engagement.attackerLetter = null;
  battle.board.engagement.defenderLetter = null;
  battle.phase = "showdown_check";
  battle.turnStep = battle.phase;
}

export function choosePostCombatMove(battle, fromSlot, toSlot) {
  if (!battle || battle.finished || battle.phase !== "additional_movement") {
    return false;
  }
  const board = battle.board;
  const activeIndex = board.activePlayerIndex;
  const unit = resolveUnitSelection(board, activeIndex, fromSlot);
  const targetLetter = typeof toSlot === "string"
    ? normalizeBoardLetter(toSlot)
    : normalizeBoardLetter(slotLetter(activeIndex, toSlot) || slotLetter(targetPlayer(activeIndex), toSlot));
  if (!unit || unit.defeated || !unitHasMoveCapacity(battle, unit)) {
    return false;
  }
  if (!targetLetter || !isLetterEmpty(board, targetLetter)) {
    return false;
  }
  const fromLetter = unitPositionLetter(activeIndex, unit);
  const remainingMoves = Math.max(0, moveLimitForUnit(unit) - movesUsedByUnitThisTurn(battle, unit.unitId));
  const canIgnoreAdjacency = Boolean(unit?.statuses?.moveAsIfAdjacent) || unitHasEffectKind(unit, "moveAsIfAdjacent");
  const hasRange = Boolean(unit?.statuses?.range);
  const steps = canIgnoreAdjacency
    ? 1
    : reachableLettersForUnit(board, battle, activeIndex, unit, remainingMoves, hasRange).get(targetLetter);
  if (!Number.isFinite(steps) || Number(steps) < 1) {
    return false;
  }
  unit.positionLetter = targetLetter;
  registerUnitMoveUsage(battle, unit, Number(steps));
  battle.log.push(`${unitDisplayName(unit)} se move para ${targetLetter}.`);
  return true;
}

export function confirmEndPostCombatMove(battle) {
  if (!battle || battle.finished || battle.phase !== "additional_movement") {
    return;
  }
  battle.log.push(`${battle.board.players[battle.board.activePlayerIndex].label} finaliza movimentacao pos-combate.`);
  battle.phase = "showdown_check";
  battle.turnStep = battle.phase;
}

export function chooseAttack(battle, playerIndex, handIndex) {
  if (!battle || battle.finished) {
    return;
  }
  if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === playerIndex) {
    battle.pendingAction.choice = Number(handIndex);
    return;
  }
  if (battle.phase !== "combat_sequence") {
    return;
  }
  const board = battle.board;
  const player = board.players[playerIndex];
  if (!player || !player.attackHand[handIndex]) {
    return;
  }
  board.pendingAttacks[playerIndex] = handIndex;
}

export function startTurnStep(battle, forceAutoHuman = false) {
  if (!battle || battle.finished) {
    return;
  }
  if (battle.phase === "location_step") {
    advanceBattle(battle, forceAutoHuman);
  }
}

export function declareMove(battle, fromSlot, toSlot) {
  if (!battle || battle.finished) {
    return false;
  }
  if (battle.phase === "move_action") {
    return chooseMove(battle, fromSlot, toSlot);
  }
  if (battle.phase === "additional_movement") {
    return choosePostCombatMove(battle, fromSlot, toSlot);
  }
  return false;
}

export function playMugic(battle, mugicIndex = null) {
  chooseMugic(battle, mugicIndex);
}

export function activateAbility(battle, optionIndex = null) {
  chooseActivatedAbility(battle, optionIndex);
}

export function playAttack(battle, handIndex) {
  const playerIndex = battle?.pendingAction?.type === "strike_attack"
    ? battle.pendingAction.playerIndex
    : battle?.board?.activePlayerIndex;
  chooseAttack(battle, playerIndex, handIndex);
}

export function passPriority(battle) {
  if (!battle || battle.finished || !battle.pendingAction) {
    return;
  }
  if (battle.pendingAction.type === "target_select") {
    chooseEffectTarget(battle, null);
    return;
  }
  if (battle.pendingAction.type === "choice_select") {
    chooseEffectChoice(battle, null);
    return;
  }
  if (battle.pendingAction.type === "priority") {
    battle.pendingAction.choice = { kind: "pass" };
    return;
  }
  if (battle.pendingAction.type === "defender_redirect" || battle.pendingAction.type === "strike_attack") {
    battle.pendingAction.choice = -1;
  }
}

export function confirmAdditionalMovement(battle) {
  confirmEndPostCombatMove(battle);
}

function legalMovesForPlayer(battle, playerIndex) {
  const moves = [];
  const board = battle.board;
  const occupancy = getOccupancyByLetter(board);
  const player = board.players[playerIndex];
  player.creatures.forEach((unit) => {
    if (!unit || unit.defeated || !unitHasMoveCapacity(battle, unit)) {
      return;
    }
    const fromLetter = unitPositionLetter(playerIndex, unit);
    const remainingMoves = Math.max(0, moveLimitForUnit(unit) - movesUsedByUnitThisTurn(battle, unit.unitId));
    if (remainingMoves <= 0) {
      return;
    }
    const canIgnoreAdjacency = Boolean(unit?.statuses?.moveAsIfAdjacent) || unitHasEffectKind(unit, "moveAsIfAdjacent");
    const hasRange = Boolean(unit?.statuses?.range);
    const reachable = canIgnoreAdjacency
      ? new Map(Object.keys(BOARD_ADJACENCY).filter((letter) => letter !== fromLetter).map((letter) => [letter, 1]))
      : reachableLettersForUnit(board, battle, playerIndex, unit, remainingMoves, hasRange);
    reachable.forEach((stepsNeeded, adjacentLetter) => {
      const occupied = occupancy.get(adjacentLetter);
      if (!occupied) {
        moves.push({
          from: unit.slot,
          to: adjacentLetter,
          fromLetter,
          toLetter: adjacentLetter,
          steps: Number(stepsNeeded),
          type: "move_empty",
          attackerSlot: unit.slot,
          attackerLetter: fromLetter,
          attackerUnitId: unit.unitId,
          score: 200 - Number(stepsNeeded),
        });
        return;
      }
      if (occupied.playerIndex === playerIndex || occupied.unit?.defeated) {
        return;
      }
      moves.push({
        from: unit.slot,
        to: adjacentLetter,
        fromLetter,
        toLetter: adjacentLetter,
        steps: Number(stepsNeeded),
        type: "move_engage",
        attackerSlot: unit.slot,
        attackerLetter: fromLetter,
        attackerUnitId: unit.unitId,
        defenderSlot: occupied.unit.slot,
        defenderLetter: adjacentLetter,
        defenderUnitId: occupied.unit.unitId,
        score: 1200 - Number(occupied.unit.currentEnergy || 0) - Number(stepsNeeded),
      });
    });
  });
  return moves.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function legalEngagementsForPlayer(battle, playerIndex) {
  return legalMovesForPlayer(battle, playerIndex)
    .filter((move) => move.type === "move_engage")
    .map((move) => ({
      attackerSlot: move.attackerSlot,
      defenderSlot: move.defenderSlot,
      attackerLetter: move.attackerLetter,
      defenderLetter: move.defenderLetter,
      attackerUnitId: move.attackerUnitId,
      score: move.score,
    }));
}

export function getLegalMoves(battle, playerIndex = battle?.board?.activePlayerIndex ?? 0) {
  if (!battle?.board?.players?.[playerIndex]) {
    return [];
  }
  const isActivePlayer = playerIndex === battle.board.activePlayerIndex;
  const includeEngage = !(
    (battle.phase === "move_action" && battle.combatsThisTurn >= 1 && isActivePlayer)
    || (battle.phase === "additional_movement" && isActivePlayer)
  );
  const baseMoves = legalMovesForPlayer(battle, playerIndex);
  if (includeEngage) {
    return baseMoves;
  }
  return baseMoves.filter((move) => move.type !== "move_engage");
}

export function getLegalEngagements(battle, playerIndex = battle?.board?.activePlayerIndex ?? 0) {
  if (!battle?.board?.players?.[playerIndex]) {
    return [];
  }
  if (battle.phase === "additional_movement" && playerIndex === battle.board.activePlayerIndex) {
    return [];
  }
  if (
    battle.phase === "move_action"
    && battle.combatsThisTurn >= 1
    && playerIndex === battle.board.activePlayerIndex
  ) {
    return [];
  }
  return legalEngagementsForPlayer(battle, playerIndex);
}

export function getPriorityActions(battle, playerIndex = battle?.burstState?.activePlayer ?? battle?.board?.activePlayerIndex ?? 0) {
  if (!battle?.board) {
    return [];
  }
  return buildPriorityOptionsForPlayer(battle.board, playerIndex, battle.burstState?.windowType || battle.phase);
}

export function isShowdownRequired(battle) {
  if (!battle?.showdownTracker) {
    return false;
  }
  const activeIndex = battle.board.activePlayerIndex;
  const streak = Number(battle.showdownTracker.noCombatStreakByPlayer?.[activeIndex] || 0);
  return streak >= 3;
}

function markCombatOccurred(battle) {
  battle.showdownTracker.combatOccurredThisTurn = true;
  battle.showdownTracker.noCombatStreakByPlayer[0] = 0;
  battle.showdownTracker.noCombatStreakByPlayer[1] = 0;
}

function finalizeShowdownTrackerForNoCombatTurn(battle) {
  battle.showdownTracker.noCombatStreakByPlayer[0] += 1;
  battle.showdownTracker.noCombatStreakByPlayer[1] += 1;
}

function prepareCombatStateFromEngagement(battle, fromShowdown = false) {
  const board = battle.board;
  const attackerLetter = normalizeBoardLetter(board.engagement.attackerLetter);
  const defenderLetter = normalizeBoardLetter(board.engagement.defenderLetter);
  if (!attackerLetter || !defenderLetter) {
    return false;
  }
  markCombatOccurred(battle);
  battle.combatState = {
    active: true,
    fromShowdown,
    attackerSlot: board.engagement.attackerSlot,
    defenderSlot: board.engagement.defenderSlot,
    attackerLetter,
    defenderLetter,
    initiativePlayer: null,
    strikePlayer: null,
    currentAttack: null,
    step: "defender_window",
    startTriggersApplied: false,
    exchangesResolved: 0,
    strikeContextPrepared: false,
  };
  return true;
}

function pushAttackToBurst(battle, playerIndex, attackCard) {
  const sourceUnit = unitForPlayer(battle.board, playerIndex);
  queueStackItem(battle, {
    kind: "attack",
    source: `Attack ${attackCard.name}`,
    owner: playerIndex,
    sourceUnitId: sourceUnit?.unitId || null,
    costsPaid: null,
    targets: {
      attackerSlot: slotForPlayer(battle.board, playerIndex),
      defenderSlot: slotForPlayer(battle.board, targetPlayer(playerIndex)),
    },
    effectRef: attackCard.id || attackCard.name,
    timing: "attack_burst",
    attackCard,
  });
}

function resolveStrikeSelectionForPlayer(battle, playerIndex, forceAutoHuman = false) {
  const board = battle.board;
  const player = board.players[playerIndex];
  if (!player) {
    return false;
  }
  normalizeAttackHandToRuleTarget(
    player,
    battle,
    player.label,
    attackHandStrikeTargetSize(battle)
  );
  if (!player.attackHand.length) {
    battle.log.push(`${player.label} sem Attack disponivel para Strike.`);
    battle.combatState.currentAttack = null;
    return true;
  }
  const isHuman = isHumanControlledPlayer(battle, playerIndex, forceAutoHuman);
  if (isHuman) {
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === playerIndex) {
      if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
        return false;
      }
      const idx = Number(battle.pendingAction.choice);
      if (idx < 0) {
        battle.log.push("Strike passado por falta de escolha de Attack.");
        battle.combatState.currentAttack = null;
        battle.pendingAction = null;
        return true;
      }
      if (!player.attackHand[idx]) {
        battle.log.push("Attack invalido para o Strike. Passe novamente.");
        battle.pendingAction = null;
        return false;
      }
      board.pendingAttacks[playerIndex] = idx;
      battle.pendingAction = null;
    } else {
      battle.pendingAction = {
        type: "strike_attack",
        playerIndex,
        choice: null,
      };
      return false;
    }
  } else {
    const picked = chooseBestAttack(board, playerIndex, board.exchange || makeExchangeContext(board));
    board.pendingAttacks[playerIndex] = picked >= 0 ? picked : 0;
  }

  const chosenIndex = Number(board.pendingAttacks[playerIndex]);
  const card = player.attackHand.splice(chosenIndex, 1)[0];
  if (!card) {
    return false;
  }
  player.attackDiscard.push(card);
  board.pendingAttacks[playerIndex] = null;
  battle.combatState.currentAttack = { playerIndex, card };
  battle.log.push(`${player.label} joga ${card.name}.`);
  return true;
}

function beginCombatSequence(battle) {
  const board = battle.board;
  battle.board.combat.active = true;
  battle.board.combat.startResolved = false;
  battle.board.combat.exchangeCount = 0;
  battle.board.combat.lastResolvedAttackDamage = 0;
  battle.board.combat.lastResolvedAttackName = null;
  battle.board.combat.lastResolvedAttackPlayer = null;
  battle.combatState.strikeContextPrepared = false;
  revealEngagedBattlegearAtCombatStart(battle);
  battle.board.initiativeWinner = evaluateInitiativeWinner(board);
  battle.log.push(`${board.players[board.initiativeWinner].label} vence a iniciativa.`);
  battle.combatState.initiativePlayer = board.initiativeWinner;
  battle.combatState.strikePlayer = board.initiativeWinner;
  battle.combatState.startTriggersApplied = true;
}

function resolveCombatStep(battle, forceAutoHuman = false) {
  const combat = battle.combatState;
  if (!combat?.active) {
    return true;
  }

  if (combat.step === "defender_window") {
    if (!runDefenderResponseWindow(battle, forceAutoHuman)) {
      return false;
    }
    combat.step = "start";
    return true;
  }

  if (combat.step === "start") {
    beginCombatSequence(battle);
    combat.step = "strike_choose";
    return true;
  }

  if (combat.step === "strike_choose") {
    if (!combat.strikeContextPrepared) {
      initializeExchange(battle);
      // Rebuild strike context every exchange so ongoing location/passive effects
      // stay active across the whole combat.
      applyLocationEffects(battle);
      combat.strikeContextPrepared = true;
      if (!applyPassiveAbilities(battle, forceAutoHuman)) {
        return false;
      }
    }
    if (!resolveStrikeSelectionForPlayer(battle, combat.strikePlayer, forceAutoHuman)) {
      return false;
    }
    if (!combat.currentAttack?.card) {
      clearExchange(battle.board);
      combat.strikeContextPrepared = false;
      combat.strikePlayer = targetPlayer(combat.strikePlayer);
      combat.step = "strike_choose";
      return true;
    }
    pushAttackToBurst(battle, combat.strikePlayer, combat.currentAttack.card);
    combat.step = "strike_burst";
    return true;
  }

  if (combat.step === "strike_burst") {
    if (!runPriorityWindow(battle, "attack_burst", forceAutoHuman, combat.strikePlayer)) {
      return false;
    }
    battle.board.combat.exchangeCount += 1;
    combat.exchangesResolved += 1;
    if (hasWinner(battle)) {
      emitBattleEvent("finished", { winner: battle.winner });
      return true;
    }
    const activeIndex = battle.board.activePlayerIndex;
    const attackerSlot = Number.isInteger(combat.attackerSlot)
      ? combat.attackerSlot
      : battle.board.engagement.attackerSlot;
    const defenderSlot = Number.isInteger(combat.defenderSlot)
      ? combat.defenderSlot
      : battle.board.engagement.defenderSlot;
    const attackerUnit = Number.isInteger(attackerSlot)
      ? battle.board.players[activeIndex]?.creatures?.[attackerSlot]
      : null;
    const defenderUnit = Number.isInteger(defenderSlot)
      ? battle.board.players[targetPlayer(activeIndex)]?.creatures?.[defenderSlot]
      : null;
    if (attackerUnit?.defeated || defenderUnit?.defeated) {
      const winner =
        attackerUnit?.defeated && !defenderUnit?.defeated
          ? defenderUnit
          : defenderUnit?.defeated && !attackerUnit?.defeated
            ? attackerUnit
            : null;
      if (winner?.pendingNamedCounterOnWin) {
        const payload = winner.pendingNamedCounterOnWin;
        const sourceName = String(payload.creatureName || "").trim();
        const canApply = !sourceName || cardNameMatches(activeCreatureCard(winner)?.name, sourceName);
        if (canApply) {
          const nextValue = addUnitNamedCounter(
            winner,
            payload.counterKey,
            Number(payload.amount || 1)
          );
          battle.log.push(`${unitDisplayName(winner)} recebe ${payload.counterKey} counter (${nextValue}).`);
        }
      }
      if (defenderUnit?.defeated && !attackerUnit?.defeated) {
        moveAttackerToDefeatedDefenderSlot(battle.board, battle);
      }
      clearExchange(battle.board);
      combat.strikeContextPrepared = false;
      battle.board.combat.active = false;
      combat.active = false;
      if (!combat.fromShowdown) {
        const selectedSlot = battle.board.action?.selectedMoverSlot;
        const selectedUnit = Number.isInteger(selectedSlot)
          ? battle.board.players[battle.board.activePlayerIndex]?.creatures?.[selectedSlot]
          : null;
        if (!selectedUnit || selectedUnit.defeated || !unitHasMoveCapacity(battle, selectedUnit)) {
          battle.board.action.selectedMoverSlot = null;
        }
      }
      battle.phase = combat.fromShowdown ? "end_of_turn_recovery" : "additional_movement";
      battle.turnStep = battle.phase;
      return true;
    }
    clearExchange(battle.board);
    combat.strikeContextPrepared = false;
    combat.strikePlayer = targetPlayer(combat.strikePlayer);
    combat.step = "strike_choose";
    return true;
  }

  return true;
}

function chooseShowdownEngagement(battle) {
  const board = battle.board;
  const activeIndex = board.activePlayerIndex;
  const opponentIndex = targetPlayer(activeIndex);
  const activeCandidates = board.players[activeIndex].creatures.filter((unit) => unit && !unit.defeated);
  const opponentCandidates = board.players[opponentIndex].creatures.filter((unit) => unit && !unit.defeated);
  if (!activeCandidates.length || !opponentCandidates.length) {
    return false;
  }
  const chosenActive = activeCandidates[0];
  const chosenOpponent = opponentCandidates[0];
  const attackerLetter = unitPositionLetter(activeIndex, chosenActive);
  const defenderLetter = unitPositionLetter(opponentIndex, chosenOpponent);
  board.engagement.attackerSlot = chosenActive.slot;
  board.engagement.defenderSlot = chosenOpponent.slot;
  board.engagement.attackerLetter = attackerLetter;
  board.engagement.defenderLetter = defenderLetter;
  battle.log.push(`Showdown: ${board.players[activeIndex].label} desafia ${unitDisplayName(chosenOpponent)}.`);
  return true;
}

function findDefenderRedirectCandidates(board) {
  const attackerIndex = board.activePlayerIndex;
  const defenderIndex = targetPlayer(attackerIndex);
  const attackerLetter = normalizeBoardLetter(board.engagement.attackerLetter);
  const currentDefenderLetter = normalizeBoardLetter(board.engagement.defenderLetter);
  if (!attackerLetter || !currentDefenderLetter) {
    return [];
  }
  return board.players[defenderIndex].creatures
    .filter((unit) => unit && !unit.defeated)
    .filter((unit) => unitPositionLetter(defenderIndex, unit) !== currentDefenderLetter)
    .filter((unit) => unit.statuses?.defender)
    .filter((unit) => canLettersEngage(attackerLetter, unitPositionLetter(defenderIndex, unit)))
    .map((unit) => unit.slot);
}

function applyDefenderRedirect(battle, selectedSlot) {
  const board = battle.board;
  const attackerIndex = board.activePlayerIndex;
  const defenderIndex = targetPlayer(board.activePlayerIndex);
  const selectedUnit = board.players[defenderIndex].creatures[selectedSlot];
  const currentLetter = normalizeBoardLetter(board.engagement.defenderLetter);
  const selectedLetter = unitPositionLetter(defenderIndex, selectedUnit);
  if (!Number.isInteger(selectedSlot) || !selectedUnit || selectedLetter === currentLetter) {
    return false;
  }
  const candidates = findDefenderRedirectCandidates(board);
  if (!candidates.includes(selectedSlot)) {
    return false;
  }
  const currentDefender = resolveUnitSelection(board, defenderIndex, board.engagement.defenderSlot);
  if (currentDefender && !currentDefender.defeated && currentLetter && selectedLetter) {
    currentDefender.positionLetter = selectedLetter;
    selectedUnit.positionLetter = currentLetter;
    battle.log.push(
      `Defender: ${unitDisplayName(selectedUnit)} troca de lugar com ${unitDisplayName(currentDefender)} (${selectedLetter}↔${currentLetter}).`
    );
  }
  board.engagement.defenderSlot = selectedSlot;
  board.engagement.defenderLetter = currentLetter || selectedLetter;
  board.engagement.attackerLetter = unitPositionLetter(attackerIndex, resolveUnitSelection(board, attackerIndex, board.engagement.attackerSlot));
  if (battle.combatState?.active) {
    battle.combatState.defenderSlot = selectedSlot;
    battle.combatState.defenderLetter = board.engagement.defenderLetter;
  }
  const redirectedTo = selectedUnit;
  if (redirectedTo) {
    battle.log.push(`Defender: combate redirecionado para ${unitDisplayName(redirectedTo)}.`);
  }
  return true;
}

function runDefenderResponseWindow(battle, forceAutoHuman = false) {
  const board = battle.board;
  const defenderIndex = targetPlayer(board.activePlayerIndex);
  const candidates = findDefenderRedirectCandidates(board);
  if (!candidates.length) {
    if (battle.pendingAction?.type === "defender_redirect") {
      battle.pendingAction = null;
    }
    return true;
  }

  const isHumanDefender = isHumanControlledPlayer(battle, defenderIndex, forceAutoHuman);
  if (isHumanDefender) {
    if (battle.pendingAction?.type === "defender_redirect" && battle.pendingAction.playerIndex === defenderIndex) {
      if (battle.pendingAction.choice === null || battle.pendingAction.choice === undefined) {
        return false;
      }
      if (battle.pendingAction.choice >= 0) {
        const redirectSlot = Number(battle.pendingAction.choice);
        if (!applyDefenderRedirect(battle, redirectSlot)) {
          battle.log.push("Redirecionamento invalido. Mantendo alvo original.");
        }
      } else {
        battle.log.push(`${board.players[defenderIndex].label} nao redireciona o alvo do combate.`);
      }
      battle.pendingAction = null;
      return true;
    }
    battle.pendingAction = {
      type: "defender_redirect",
      playerIndex: defenderIndex,
      options: candidates,
      choice: null,
    };
    battle.log.push("Janela de resposta defensiva: escolha uma criatura com Defender ou passe.");
    return false;
  }

  const bestSlot = [...candidates]
    .sort((a, b) => {
      const unitA = board.players[defenderIndex].creatures[a];
      const unitB = board.players[defenderIndex].creatures[b];
      return Number(unitB?.currentEnergy || 0) - Number(unitA?.currentEnergy || 0);
    })[0];
  applyDefenderRedirect(battle, bestSlot);
  return true;
}

export function advanceBattle(battle, forceAutoHuman = false) {
  if (!battle || battle.finished) {
    return;
  }

  const maxIterations = 512;
  let iterations = 0;
  while (!battle.finished) {
    iterations += 1;
    if (iterations > maxIterations) {
      battle.log.push("Pausa de seguranca da engine: limite de iteracoes atingido.");
      return;
    }
    if (shouldPauseForHumanInput(battle, forceAutoHuman)) {
      return;
    }

    switch (battle.phase) {
      case "location_step":
        if (!beginStartTurn(battle, forceAutoHuman)) {
          return;
        }
        battle.locationStepInitialized = false;
        battle.phase = "action_step_pre_move";
        battle.turnStep = battle.phase;
        break;

      case "action_step_pre_move": {
        const activeIndex = battle.board.activePlayerIndex;
        const resolved = runPriorityWindow(
          battle,
          "pre_move_priority",
          forceAutoHuman,
          activeIndex
        );
        if (!resolved) {
          return;
        }
        battle.phase = "move_action";
        battle.turnStep = battle.phase;
        break;
      }

      case "move_action": {
        const activeIndex = battle.board.activePlayerIndex;
        const oneVsOneMode = battle.mode === "1v1";
        const humanTurn = oneVsOneMode ? false : isHumanControlledPlayer(battle, activeIndex, forceAutoHuman);

        if (
          oneVsOneMode
          && battle.board.engagement.attackerSlot === null
          && battle.board.engagement.defenderSlot === null
        ) {
          const attacker = battle.board.players[activeIndex]?.creatures?.find((unit) => unit && !unit.defeated) || null;
          const defenderIndex = targetPlayer(activeIndex);
          const defender = battle.board.players[defenderIndex]?.creatures?.find((unit) => unit && !unit.defeated) || null;
          if (attacker && defender) {
            battle.board.engagement.attackerSlot = attacker.slot;
            battle.board.engagement.defenderSlot = defender.slot;
            battle.board.engagement.attackerLetter = unitPositionLetter(activeIndex, attacker);
            battle.board.engagement.defenderLetter = unitPositionLetter(defenderIndex, defender);
            battle.log.push("Modo 1v1: combate iniciado automaticamente.");
          }
        }

        if (!humanTurn) {
          if (battle.board.engagement.attackerSlot === null || battle.board.engagement.defenderSlot === null) {
            const moves = getLegalMoves(battle, activeIndex);
            const engageMove = battle.combatsThisTurn < 1
              ? moves.find((move) => move.type === "move_engage")
              : null;
            if (engageMove) {
              chooseMove(battle, engageMove.from, engageMove.toLetter || engageMove.to);
            } else if (moves.length) {
              const moveOption = moves.find((move) => move.type === "move_empty") || moves[0];
              chooseMove(battle, moveOption.from, moveOption.toLetter || moveOption.to);
            } else {
              endActionWithoutCombat(battle);
            }
          }
        }

        if (battle.board.engagement.attackerSlot !== null && battle.board.engagement.defenderSlot !== null) {
          if (battle.combatsThisTurn >= 1) {
            battle.log.push("Limite de 1 combate por turno atingido.");
            battle.phase = "additional_movement";
            battle.turnStep = battle.phase;
            break;
          }
          battle.combatsThisTurn += 1;
          if (prepareCombatStateFromEngagement(battle, false)) {
            battle.phase = "combat_sequence";
            battle.turnStep = battle.phase;
            break;
          }
        }

        if (!humanTurn) {
          const hasAnyMove = getLegalMoves(battle, activeIndex).length > 0;
          if (!hasAnyMove || battle.movementState.hasMovedCreatureThisTurn) {
            battle.phase = "showdown_check";
            battle.turnStep = battle.phase;
            break;
          }
        }

        return;
      }

      case "combat_sequence": {
        if (!resolveCombatStep(battle, forceAutoHuman)) {
          return;
        }
        if (battle.finished) {
          return;
        }
        if (battle.phase !== "combat_sequence") {
          break;
        }
        // Continue combat loop until waiting for input or combat ends.
        continue;
      }

      case "additional_movement": {
        const activeIdx = battle.board.activePlayerIndex;
        const isHumanPostMove = battle.mode === "1v1"
          ? false
          : isHumanControlledPlayer(battle, activeIdx, forceAutoHuman);
        if (isHumanPostMove) {
          return;
        }
        autoPostCombatMoves(battle.board, battle);
        battle.log.push(`${battle.board.players[activeIdx].label} finaliza movimentacao adicional.`);
        battle.phase = "showdown_check";
        battle.turnStep = battle.phase;
        break;
      }

      case "showdown_check":
        if (isShowdownRequired(battle)) {
          battle.log.push("Condicao de Showdown atingida.");
          if (chooseShowdownEngagement(battle) && prepareCombatStateFromEngagement(battle, true)) {
            battle.phase = "combat_sequence";
            battle.turnStep = battle.phase;
            break;
          }
        }
        battle.phase = "end_of_turn_recovery";
        battle.turnStep = battle.phase;
        break;

      case "end_of_turn_recovery":
        if (!battle.showdownTracker.combatOccurredThisTurn) {
          finalizeShowdownTrackerForNoCombatTurn(battle);
        }
        rotateActiveLocationToBottom(battle.board);
        nextTurn(battle);
        battle.phase = "location_step";
        battle.turnStep = battle.phase;
        break;

      default:
        return;
    }
  }
}

export function phaseHelpText(battle) {
  if (!battle) {
    return "Inicie uma batalha para comecar.";
  }
  if (battle.finished) {
    return `Partida finalizada. ${battle.winner} venceu.`;
  }
  if (battle.pendingAction?.type === "priority" && Number.isInteger(battle.pendingAction.playerIndex)) {
    return "Janela de prioridade: jogue Mugic/habilidade ou passe. Resolucao em pilha (LIFO).";
  }
  if (battle.pendingAction?.type === "target_select" && Number.isInteger(battle.pendingAction.playerIndex)) {
    return "Selecione o alvo do efeito para colocar a jogada na pilha.";
  }
  if (battle.pendingAction?.type === "choice_select" && Number.isInteger(battle.pendingAction.playerIndex)) {
    return "Selecione a opcao do efeito para finalizar a ativacao.";
  }
  if (battle.pendingAction?.type === "defender_redirect" && Number.isInteger(battle.pendingAction.playerIndex)) {
    return "Resposta defensiva: escolha um Defender para redirecionar o combate ou passe.";
  }
  if (battle.pendingAction?.type === "strike_attack" && Number.isInteger(battle.pendingAction.playerIndex)) {
    return "Strike: compre/jogue um Attack para sua criatura engajada.";
  }
  if (battle.phase === "action_step_pre_move") {
    return isHumanTurn(battle)
      ? "Brecha pre-movimento: jogue Mugic/habilidades ou passe para liberar o movimento."
      : "Oponente na janela pre-movimento.";
  }
  if (battle.phase === "move_action") {
    if (battle.mode === "1v1") {
      return "Modo 1v1: combate inicia automaticamente ao entrar nesta fase.";
    }
    const hasAnyMove = getLegalMoves(battle).length > 0;
    return isHumanTurn(battle)
      ? (hasAnyMove
        ? "Action Step: mova ao menos uma criatura. Combate inicia ao mover para um espaco inimigo ocupado adjacente."
        : "Sem movimento legal disponivel. Voce pode encerrar para recovery.")
      : "Oponente selecionando criaturas para o combate.";
  }
  if (battle.phase === "combat_sequence") {
    return "Combate oficial: strike alternado, burst em LIFO e derrota encerra o combate.";
  }
  if (battle.phase === "showdown_check") {
    return "Verificando condicao de Showdown antes do Recovery.";
  }
  if (battle.phase === "additional_movement") {
    return isHumanTurn(battle)
      ? "Movimentacao adicional: mova criaturas que ainda nao se moveram para espacos vazios adjacentes."
      : "Oponente realizando movimentacao adicional.";
  }
  return `Fase ${PHASE_LABEL[battle.phase] || battle.phase} em execucao.`;
}

export function debugBuildTargetCandidatesForEffect(battle, sourcePlayerIndex, effect, sourceUnitId = null) {
  if (!battle?.board) {
    return [];
  }
  const sourceEntry = sourceUnitId ? findUnitById(battle.board, sourceUnitId) : null;
  return buildTargetCandidatesForEffect(
    battle,
    Number.isInteger(sourcePlayerIndex) ? sourcePlayerIndex : battle.board.activePlayerIndex,
    effect,
    sourceEntry?.unit || null
  );
}
