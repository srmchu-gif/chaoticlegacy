const test = require("node:test");
const assert = require("node:assert/strict");
const { parseAbilityEffects } = require("../lib/effect-parser");

test("parseAbilityEffects extrai dano condicional e cura", () => {
  const text =
    "Challenge Power 15: Deal 10 damage. Air attacks deal an additional 5 damage. Heal 5 damage.";
  const effects = parseAbilityEffects(text);

  assert.ok(effects.some((effect) => effect.kind === "conditionalDamage" && effect.stat === "power" && effect.amount === 10));
  assert.ok(
    effects.some(
      (effect) => effect.kind === "attackDamageModifier" && effect.modifier === "add" && effect.amount === 5 && effect.elements.includes("air")
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "healDamage" && effect.amount === 5));
});

test("parseAbilityEffects reconhece bonus de status", () => {
  const text = "Support: Power 5. Fire 5. Gain 10 Courage.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === "power" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "elementModifier" && effect.stat === "fire" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === "courage" && effect.amount === 10));
});

test("parseAbilityEffects reconhece lose e additional", () => {
  const text = "Lose 10 Speed. Equipped Creature has an additional 5 Energy.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === "speed" && effect.amount === -10));
  assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === "energy" && effect.amount === 5));
});

test("parseAbilityEffects reconhece fluxo de combate de location", () => {
  const text =
    "At the beginning of combat, deal 5 damage to engaged Creatures. If an engaged Creature has lower Speed than the opposing engaged Creature, it deals 0 damage on its first attack each combat.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "beginCombatDamage" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "firstAttackZeroIfLower" && effect.stat === "speed"));
});

test("parseAbilityEffects reconhece perda condicional por elemento", () => {
  const text = "Fire: Opposing engaged Creature loses 25 Wisdom. Your engaged Creature loses Fire.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "conditionalStatModifier" &&
        effect.requiresElement === "fire" &&
        effect.stat === "wisdom" &&
        effect.amount === -25
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "removeElement" && effect.element === "fire"));
});

test("parseAbilityEffects reconhece palavras-chave comuns", () => {
  const text = "Swift 1. Strike 15. Recklessness 5. Range. Defender. Untargetable.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "swift" && effect.amount === 1));
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "strike" && effect.amount === 15));
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "recklessness" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "range"));
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "defender"));
  assert.ok(effects.some((effect) => effect.kind === "keyword" && effect.keyword === "untargetable"));
});

test("parseAbilityEffects reconhece invisibility, outperform e bloqueio de mugic", () => {
  const text =
    "Invisibility: Surprise. Invisibility: Disarm. Invisibility: Strike 15. Outperform Power 5. Mugic and activated abilities cannot be played.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "invisibilitySurprise"));
  assert.ok(effects.some((effect) => effect.kind === "invisibilityDisarm"));
  assert.ok(effects.some((effect) => effect.kind === "invisibilityStrike" && effect.amount === 15));
  assert.ok(effects.some((effect) => effect.kind === "outperform" && effect.stat === "power" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "disableMugicAndActivated"));
});

test("parseAbilityEffects reconhece ganhos/perdas em lista de stats", () => {
  const text = "Target Creature gains 5 Courage, Power, Wisdom, Speed, and Energy. Opposing engaged Creature loses 10 to all Disciplines.";
  const effects = parseAbilityEffects(text);
  const gainStats = ["courage", "power", "wisdom", "speed", "energy"];
  gainStats.forEach((stat) => {
    assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === stat && effect.amount === 5));
  });
  ["courage", "power", "wisdom", "speed"].forEach((stat) => {
    assert.ok(effects.some((effect) => effect.kind === "statModifier" && effect.stat === stat && effect.amount === -10));
  });
});

test("parseAbilityEffects reconhece efeitos de mugic counter e bloqueio de battlegear", () => {
  const text =
    "Put a Mugic counter on target Creature you control. Put a Mugic counter on each Creature controlled by an opponent. Battlegear have no abilities. Negate target Mugic.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some((effect) => effect.kind === "mugicCounterModifier" && effect.target === "self" && effect.amount === 1)
  );
  assert.ok(
    effects.some(
      (effect) => effect.kind === "mugicCounterModifier" && effect.target === "opponent" && effect.scope === "allCreatures"
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "battlegearNoAbilities"));
  assert.ok(effects.some((effect) => effect.kind === "negateMugic"));
});

test("parseAbilityEffects reconhece condicional de Recklessness e destruicao por stat zero", () => {
  const text =
    "If your engaged Creature has Recklessness, deal damage equal to twice its Recklessness value. Destroy target engaged Creature with 0 Courage.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "conditionalDealDamageByStatusValue" &&
        effect.status === "recklessness" &&
        effect.multiplier === 2
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "destroyCreatureIfStatZero" && effect.stat === "courage"));
});

test("parseAbilityEffects reconhece efeitos de combate avancados", () => {
  const text =
    "When Bo'aam becomes engaged, the opposing engaged Creature loses 5 Energy for each Elemental Type it does not have. " +
    "If your engaged Creature has more Mugic counters than the opposing engaged Creature, your opponent must play Attack Cards at random.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "beginCombatDamagePerMissingElements" && effect.amount === 5));
  assert.ok(effects.some((effect) => effect.kind === "forceOpponentRandomAttackIfHigherMugic"));
});

test("parseAbilityEffects reconhece protecao de cura e battlegear", () => {
  const text =
    "If any Creature engaged with Galmedar has Power less than 65, that Creature cannot be healed or gain Energy from non-innate abilities. " +
    "Battlegear cannot be destroyed.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "preventHealingIfLowerStat" &&
        effect.stat === "power" &&
        effect.threshold === 65 &&
        effect.target === "opponent"
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "battlegearIndestructible"));
});

test("parseAbilityEffects reconhece escolhas de disciplina e ajuste para scanned", () => {
  const text =
    "MC: Target Creature gains 25 to a Discipline of your choice. " +
    "MC: Target Creature gains 25 to a Discipline and loses 10 to another. " +
    "Expend Fire: Target Creature gains or loses all Disciplines so they become their scanned values.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "disciplineChoiceModifier" && effect.amount === 25));
  assert.ok(effects.some((effect) => effect.kind === "disciplineChoiceModifier" && effect.amount === -10));
  assert.ok(effects.some((effect) => effect.kind === "setDisciplinesToScanned"));
});

test("parseAbilityEffects reconhece regras avancadas de mugic e dano de ataque", () => {
  const text =
    "The opposing engaged Creature must pay an additional Mugic counter to play abilities which cost one or more Mugic counters. " +
    "Remove all Mugic counters from target engaged Creature. " +
    "If the opposing engaged Creature has Air, damage dealt by Airize is reduced to 0. " +
    "If Burning Rain would deal more than 10 damage, it deals 10 damage instead.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "mugicCostIncrease" && effect.amount === 1));
  assert.ok(effects.some((effect) => effect.kind === "mugicCounterSet" && effect.amount === 0));
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "attackDamageSetIfDefenderHasElement" &&
        effect.element === "air" &&
        effect.amount === 0
    )
  );
  assert.ok(effects.some((effect) => effect.kind === "attackDamageCap" && effect.amount === 10));
});

test("parseAbilityEffects reconhece scry de carta unica com opcao de fundo", () => {
  const text = "Look at the top card of your Location Deck. You can put that card on the bottom of that deck.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "scryDeck"
        && effect.count === 1
        && effect.owner === "self"
        && effect.deckType === "location"
        && effect.moveTopToBottom === true
    )
  );
});

test("parseAbilityEffects reconhece bloqueio de ganho de elementos por threshold", () => {
  const text =
    "If any Creature engaged with Lord Van Bloot has less than 65 Courage, it does not have and cannot gain any Elemental Types.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "cannotGainElementTypes"
        && effect.target === "opponent"
        && effect.stat === "courage"
        && effect.threshold === 65
    )
  );
});

test("parseAbilityEffects reconhece troca de posicoes entre criaturas", () => {
  const text =
    "Expend Water: The controller of target unengaged Creature chooses another unengaged Creature they control. Those two creatures swap spaces.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "boardMove"
        && effect.operation === "swap_positions"
        && effect.includeEngaged === false
    )
  );
});

test("parseAbilityEffects reconhece dano direto em criatura alvo com targetSpec global", () => {
  const text = "Deal 20 damage to target Creature.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "dealDamage"
        && effect.amount === 20
        && effect.targetSpec
        && effect.targetSpec.type === "creature"
        && effect.targetSpec.scope === "all"
    )
  );
});

test("parseAbilityEffects reconhece Castle Bodhran para retorno de mugic no inicio do combate", () => {
  const text = "At the beginning of combat, each player can return a Mugic Card from their general discard pile to their hand.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "returnFromDiscard"
        && effect.cardType === "mugic"
        && effect.target === "both"
        && effect.destination === "mugic_slots"
        && effect.timing === "begin_combat"
    )
  );
});

test("parseAbilityEffects reconhece Coil Crush com destruicao por stat check", () => {
  const text = "Stat Check Power 75: Choose a Battlegear equipped to an opposing Creature and destroy it.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "destroyBattlegearIfAttackerStatGte"
        && effect.stat === "power"
        && effect.threshold === 75
        && effect.target === "opponent"
    )
  );
  assert.equal(effects.some((effect) => effect.kind === "statModifier" && effect.stat === "power" && effect.amount === 75), false);
});

test("parseAbilityEffects reconhece begin combat energy com filtro elemental e escopo engajado", () => {
  const text = "At the beginning of combat, Creatures with Water gain 10 Energy.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "beginCombatEnergy"
        && effect.amount === 10
        && effect.scope === "engaged"
        && effect.requiresElement === "water"
        && effect.duration === "end_turn"
    )
  );
});

test("parseAbilityEffects reconhece Ekuud com bonus de energia por Mandiblor quando Hive ativa", () => {
  const text = "Hive: Ekuud has an additional 5 Energy for each Mandiblor you control and each Infected Creature in play.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "hiveEnergyPerControlledCreatureType"
        && effect.creatureType === "mandiblor"
        && effect.stat === "energy"
        && effect.amountPerCreature === 5
        && effect.requireHiveActive === true
    )
  );
});

test("parseAbilityEffects reconhece mugic counter no inicio do turno para ambos os jogadores", () => {
  const text = "At the beginning of your turn, each player puts a Mugic counter on a Creature they control with no Mugic counters.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "mugicCounterModifier"
        && effect.target === "all"
        && effect.scope === "allCreatures"
        && effect.noCountersOnly === true
        && effect.timing === "begin_turn"
    )
  );
});

test("parseAbilityEffects reconhece copy de Mugic com retarget", () => {
  const text = "MC: Copy target Mugic played by a Creature you control. You may choose new targets for the copy.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "copyMugic"
        && effect.target === "self"
        && effect.allowRetarget === true
    )
  );
});

test("parseAbilityEffects reconhece copy de perfil de criatura no inicio do turno", () => {
  const text =
    "At the beginning of each turn, Iparu becomes a copy of target opposing Creature. (Iparu's scanned characteristics become the same as the target's including Disciplines, Elemental Types, Energy, and abilities.)";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "copyCreatureProfile"
        && effect.target === "self"
        && effect.source === "opponent"
        && effect.timing === "begin_turn"
    )
  );
});

test("parseAbilityEffects reconhece relocate de ambas as criaturas engajadas", () => {
  const text = "Air: Relocate both engaged Creatures to any unoccupied space adjacent to either of them.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "relocateEffect"
        && effect.operation === "move_engaged_both_to_empty"
        && effect.target === "all"
    )
  );
});

test("parseAbilityEffects emite requiredCreatureTypes para alvo por subtipo", () => {
  const text = "Target Danian Muge Creature gains 10 Courage.";
  const effects = parseAbilityEffects(text);
  const statEffect = effects.find((effect) => effect.kind === "statModifier" && effect.stat === "courage");
  assert.ok(statEffect);
  assert.equal(statEffect.targetSpec?.type, "creature");
  assert.ok(Array.isArray(statEffect.targetSpec?.requiredCreatureTypes));
  assert.ok(statEffect.targetSpec.requiredCreatureTypes.includes("danian muge"));
});

test("parseAbilityEffects reconhece familias avancadas de dano de Attack", () => {
  const text =
    "Challenge Mugic counters 3: Deal 20 damage. " +
    "Deal 5 damage for each Tribe you control beyond the first. " +
    "Deal 5 damage for each Mandiblor Creature you control adjacent to your engaged Creature. " +
    "Deal 5 damage for each Elemental Type shared by both engaged Creatures.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "conditionalDamage"
        && effect.comparator === "diffGte"
        && effect.stat === "mugiccounters"
        && effect.amount === 20
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "attackDamagePerControlledTribe"
        && effect.amountPerTribe === 5
        && effect.subtractFirst === true
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "attackDamagePerControlledCreatureType"
        && effect.amountPerCreature === 5
        && effect.creatureType === "mandiblor"
        && effect.adjacentToEngaged === true
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "attackDamagePerSharedElementType"
        && effect.amountPerElement === 5
    )
  );
});

test("parseAbilityEffects reconhece checks condicionais por status da criatura atacante", () => {
  const text =
    "If your engaged Creature has Defender, deal 10 damage. " +
    "If your engaged Creature has Recklessness, deal damage equal to its Recklessness value.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "conditionalDamage"
        && effect.comparator === "statusGte"
        && effect.status === "defender"
        && effect.amount === 10
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "conditionalDealDamageByStatusValue"
        && effect.status === "recklessness"
        && effect.multiplier === 1
    )
  );
});

test("parseAbilityEffects reconhece bloqueio de cura e regras avancadas de counters/gear em attacks", () => {
  const text =
    "Opposing engaged Creature cannot be healed. " +
    "If you have fewer Mugic Cards in hand than your opponent, damage dealt by Poison Steam is reduced to 0. " +
    "Remove a Mugic counter from engaged Creatures with less than 50 Wisdom or Courage. " +
    "Destroy all Battlegear equipped to engaged Creatures with less than 50 Power or Speed.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "healBlocked"
        && effect.target === "opponent"
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "attackDamageSetIfFewerMugicCards"
        && effect.amount === 0
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "mugicCounterRemoveByStatThreshold"
        && effect.threshold === 50
        && Array.isArray(effect.stats)
        && effect.stats.includes("wisdom")
        && effect.stats.includes("courage")
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "destroyBattlegearByStatThreshold"
        && effect.threshold === 50
        && effect.stats.includes("power")
        && effect.stats.includes("speed")
    )
  );
});

test("parseAbilityEffects reconhece variacoes de texto para Poison Steam e Flaming Coals", () => {
  const poisonEffects = parseAbilityEffects(
    "If you have fewer Mugic Cards in your hand than your opponent, damage dealt by Poison Steam is reduced to 0."
  );
  assert.ok(
    poisonEffects.some(
      (effect) =>
        effect.kind === "attackDamageSetIfFewerMugicCards"
        && effect.amount === 0
    )
  );

  const flamingEffects = parseAbilityEffects("Untargetable.");
  assert.ok(
    flamingEffects.some(
      (effect) => effect.kind === "attackUntargetable"
    )
  );
});

test("parseAbilityEffects reconhece permissoes tribais de Mugic em criaturas", () => {
  const text = "Danian Creatures you control can play OverWorld Mugic.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "canPlaySpecificTribeMugic"
        && effect.casterTribe === "danian"
        && effect.mugicTribe === "overworld"
    )
  );
});

test("parseAbilityEffects reconhece contadores de leadership e bonus por contador", () => {
  const text =
    "When Kiru wins combat put a Leadership Counter on it. " +
    "Other Creatures you control have an additional 10 Energy for each Leadership Counter on Kiru.";
  const effects = parseAbilityEffects(text);
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "namedCounterOnCombatWin"
        && effect.counterKey === "leadership"
        && effect.amount === 1
    )
  );
  assert.ok(
    effects.some(
      (effect) =>
        effect.kind === "alliesStatPerNamedCounter"
        && effect.counterKey === "leadership"
        && effect.stat === "energy"
        && effect.amountPerCounter === 10
    )
  );
});

test("parseAbilityEffects cobre padroes novos dos sets DOP/ZOTH/SS", () => {
  const text =
    "Deactivate Hive. " +
    "Target Creature gains an Elemental Type of your choice. " +
    "Target Creature loses an Elemental Type of your choice. If that Creature has no Elemental Types, it cannot move instead. " +
    "The active Location loses all abilities. " +
    "When this becomes the active Location, each player discards a Mugic Card.";
  const effects = parseAbilityEffects(text);
  assert.ok(effects.some((effect) => effect.kind === "deactivateHive"));
  assert.ok(effects.some((effect) => effect.kind === "targetCreatureGainChosenElement"));
  assert.ok(effects.some((effect) => effect.kind === "removeChosenElementFromCreature"));
  assert.ok(effects.some((effect) => effect.kind === "suppressActiveLocationAbilities"));
  assert.ok(effects.some((effect) => effect.kind === "discardMugicFromEachPlayer"));
});
