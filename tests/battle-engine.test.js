const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function creatureCard(name, speed = 50) {
  return {
    id: name,
    name,
    tribe: "OverWorld",
    ability: "",
    parsedEffects: [],
    stats: {
      courage: 50,
      power: 50,
      wisdom: 50,
      speed,
      energy: 40,
      mugicability: 1,
      fire: 0,
      air: 0,
      earth: 0,
      water: 0,
    },
  };
}

function attackCard(name, base = 5) {
  return {
    id: name,
    name,
    ability: "",
    parsedEffects: [],
    stats: {
      base,
      bp: 0,
      fireAttack: 0,
      airAttack: 0,
      earthAttack: 0,
      waterAttack: 0,
    },
  };
}

function locationCard(name, initiative = "speed") {
  return {
    id: name,
    name,
    ability: "",
    parsedEffects: [],
    stats: { initiative },
  };
}

function gearCard(name) {
  return {
    id: name,
    name,
    ability: "",
    parsedEffects: [],
    stats: {},
  };
}

function mugicCard(name, cost = 1) {
  return {
    id: name,
    name,
    ability: "",
    parsedEffects: [],
    stats: { cost },
  };
}

function makeDeck(seed) {
  return {
    creatures: Array.from({ length: 6 }, (_, idx) => creatureCard(`C-${seed}-${idx + 1}`, 40 + idx)),
    attacks: Array.from({ length: 20 }, (_, idx) => attackCard(`A-${seed}-${idx + 1}`, 4 + (idx % 3))),
    battlegear: Array.from({ length: 6 }, (_, idx) => gearCard(`G-${seed}-${idx + 1}`)),
    locations: Array.from({ length: 10 }, (_, idx) => locationCard(`L-${seed}-${idx + 1}`)),
    mugic: Array.from({ length: 6 }, (_, idx) => mugicCard(`M-${seed}-${idx + 1}`)),
  };
}

function setPlayerMugicSlots(player, cards) {
  const list = Array.isArray(cards) ? cards.slice(0, 6) : [];
  player.mugicSlots = Array.from({ length: 6 }, (_, idx) => ({
    id: `test-mugic-slot:${idx}:${list[idx]?.id || list[idx]?.name || "empty"}`,
    slotIndex: idx,
    card: list[idx] || null,
    available: Boolean(list[idx]),
    queued: false,
    spent: false,
    disabledByEffect: false,
  }));
  player.mugicHand = [];
  player.mugicDeck = [];
}

async function loadEngine() {
  const enginePath = path.resolve(__dirname, "../public/js/battle/engine.js");
  return import(pathToFileURL(enginePath).href);
}

async function setupMovePhase(seedA = "A", seedB = "B") {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck(seedA), makeDeck(seedB), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  battle.phase = "location_step";
  battle.turnStep = "location_step";
  let guard = 0;
  while (battle.phase !== "move_action" && guard < 16) {
    guard += 1;
    engine.advanceBattle(battle, false);
    if (battle.phase === "action_step_pre_move" && battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
      continue;
    }
    if (battle.phase === "move_action") {
      break;
    }
    if (!resolveHumanPendingAction(engine, battle)) {
      continue;
    }
  }
  assert.equal(battle.phase, "move_action");
  return { engine, battle };
}

function resolveHumanPendingAction(engine, battle) {
  if (battle.pendingAction?.type === "target_select") {
    const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
    const candidate = step?.candidates?.[0] || null;
    engine.chooseEffectTarget(battle, candidate?.id || null);
    return true;
  }
  if (battle.pendingAction?.type === "choice_select") {
    const step = battle.pendingAction.choiceSteps?.[battle.pendingAction.currentChoiceStep];
    const option = step?.options?.[0] || null;
    const optionId = option?.id ?? option?.value ?? null;
    engine.chooseEffectChoice(battle, optionId);
    return true;
  }
  if (battle.pendingAction?.type === "priority") {
    engine.passPriority(battle);
    return true;
  }
  if (battle.pendingAction?.type === "strike_attack") {
    const actor = Number(battle.pendingAction.playerIndex || 0);
    const handIndex = battle.board.players[actor].attackHand.length ? 0 : -1;
    engine.chooseAttack(battle, actor, handIndex);
    return true;
  }
  return false;
}

test("createBattleState usa perfil oficial por padrao", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("A"), makeDeck("B"), { mode: "casual" });
  assert.equal(battle.ruleProfile, "official_master");
  assert.equal(battle.phase, "location_step");
  assert.ok(Array.isArray(battle.burstStack));
  assert.equal(battle.turnStep, "location_step");
  assert.equal(battle.board.players[0].attackHand.length, 2);
  assert.equal(battle.board.players[1].attackHand.length, 2);
  assert.equal((battle.board.players[0].mugicSlots || []).filter((entry) => entry?.available).length, 6);
  assert.equal(battle.board.players[0].mugicHand.length, 0);
});

test("location_step normaliza a mao do jogador ativo para 2 attacks no perfil oficial", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("C"), makeDeck("D"), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  battle.board.players[0].attackHand = battle.board.players[0].attackHand.slice(0, 2);
  battle.phase = "location_step";
  battle.turnStep = "location_step";
  let guard = 0;
  while (battle.phase !== "move_action" && guard < 16) {
    guard += 1;
    engine.advanceBattle(battle, false);
    if (battle.phase === "action_step_pre_move" && battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
      continue;
    }
    if (battle.phase !== "move_action") {
      resolveHumanPendingAction(engine, battle);
    }
  }
  assert.equal(battle.board.players[0].attackHand.length, 2);
  assert.equal(battle.phase, "move_action");
});

test("location_step entra na janela pre_move e depois avanca para move_action", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("P1"), makeDeck("P2"), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  battle.phase = "location_step";
  battle.turnStep = "location_step";

  engine.advanceBattle(battle, false);
  assert.equal(battle.phase, "action_step_pre_move");
  assert.equal(battle.pendingAction?.type, "priority");
  let guard = 0;
  while (battle.phase !== "move_action" && guard < 16) {
    guard += 1;
    if (!resolveHumanPendingAction(engine, battle)) {
      engine.advanceBattle(battle, false);
      continue;
    }
    engine.advanceBattle(battle, false);
  }
  assert.equal(battle.phase, "move_action");
  assert.notEqual(battle.pendingAction?.windowType, "pre_move_priority");
});

test("normalizacao recompõe attackDeck a partir do descarte quando deck zera", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("R3"), makeDeck("R4"), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  const player = battle.board.players[0];
  player.attackHand = [];
  player.attackDeck = [];
  player.attackDiscard = [attackCard("D-1"), attackCard("D-2"), attackCard("D-3"), attackCard("D-4"), attackCard("D-5")];
  battle.phase = "location_step";
  battle.turnStep = "location_step";

  engine.advanceBattle(battle, false);
  assert.equal(player.attackHand.length, 2);
  assert.equal(player.attackDeck.length, 3);
  assert.equal(player.attackDiscard.length, 0);
});

test("location ativa substituida entra no fundo do deck no location_step", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("L1"), makeDeck("L2"), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  const owner = battle.board.players[0];
  const previousLocation = locationCard("Previous Active");
  const topLocation = locationCard("Top Next");
  const middleLocation = locationCard("Middle");
  owner.locationDeck = [middleLocation, topLocation];
  battle.board.locationCard = previousLocation;
  battle.board.locationOwnerIndex = 0;
  battle.phase = "location_step";
  battle.turnStep = "location_step";

  engine.advanceBattle(battle, false);
  assert.equal(battle.board.locationCard?.name, "Top Next");
  assert.equal(owner.locationDeck[0]?.name, "Previous Active");
});

test("reveal de nova location no turno move a anterior para o fundo", async () => {
  const { engine, battle } = await setupMovePhase("R1", "R2");
  const owner = battle.board.players[0];
  const previousLocation = locationCard("Current");
  const nextLocation = locationCard("From Deck");
  const otherLocation = locationCard("Other");
  owner.locationDeck = [otherLocation, nextLocation];
  battle.board.locationCard = previousLocation;
  battle.board.locationOwnerIndex = 0;
  engine.chooseEngagement(battle, 4, 3);
  battle.phase = "combat_sequence";
  battle.turnStep = "combat_sequence";
  battle.board.exchange = { forceRevealLocation: true };
  battle.combatState = {
    active: true,
    fromShowdown: false,
    attackerSlot: battle.board.engagement.attackerSlot,
    defenderSlot: battle.board.engagement.defenderSlot,
    attackerLetter: battle.board.engagement.attackerLetter,
    defenderLetter: battle.board.engagement.defenderLetter,
    initiativePlayer: 0,
    strikePlayer: 0,
    currentAttack: null,
    step: "strike_burst",
    startTriggersApplied: true,
    exchangesResolved: 0,
  };

  let guard = 0;
  while (guard < 96 && battle.board.locationCard?.name !== "From Deck") {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    guard += 1;
  }
  assert.equal(battle.board.locationCard?.name, "From Deck");
  assert.equal(owner.locationDeck[0]?.name, "Current");
});

test("fim de turno recicla location ativa para o fundo do deck do dono", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("T1"), makeDeck("T2"), { mode: "casual" });
  const owner = battle.board.players[1];
  const activeLocation = locationCard("Turn Location");
  owner.locationDeck = [locationCard("Owner Bottom"), locationCard("Owner Top")];
  battle.board.locationCard = activeLocation;
  battle.board.locationOwnerIndex = 1;
  battle.board.activePlayerIndex = 1;
  battle.phase = "end_of_turn_recovery";
  battle.turnStep = "end_of_turn_recovery";

  engine.advanceBattle(battle, false);
  assert.equal(owner.locationDeck[0]?.name, "Turn Location");
});

test("permite mover para casa vazia adjacente no lado inimigo", async () => {
  const { engine, battle } = await setupMovePhase("E", "F");
  const enemyUnit = battle.board.players[1].creatures[4];
  enemyUnit.defeated = true;
  enemyUnit.positionLetter = null;
  const legalMoves = engine.getLegalMoves(battle, 0);
  assert.ok(legalMoves.some((move) => move.from === 5 && move.toLetter === "H"));

  const moved = engine.chooseMove(battle, 5, "H");
  assert.equal(moved, true);
  assert.equal(battle.board.players[0].creatures[5].positionLetter, "H");
});

test("getLegalMoves identifica movimentos de engage por entrada em espaco inimigo ocupado", async () => {
  const { engine, battle } = await setupMovePhase("E1", "F1");
  const legalMoves = engine.getLegalMoves(battle, 0);
  assert.ok(legalMoves.some((move) => move.type === "move_engage"));
  assert.ok(legalMoves.some((move) => move.type === "move_engage" && move.from === 4 && move.toLetter === "G"));
});

test("declareMove para espaco inimigo ocupado inicia combate no proximo advanceBattle", async () => {
  const { engine, battle } = await setupMovePhase("AUTO", "START");
  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);
  assert.equal(battle.resolveDeclareNow, true);
  assert.equal(battle.board.engagement.attackerLetter, "E");
  assert.equal(battle.board.engagement.defenderLetter, "G");

  engine.advanceBattle(battle, false);
  assert.equal(battle.phase, "combat_sequence");
  assert.equal(battle.combatsThisTurn, 1);
});

test("criatura que se moveu no turno nao pode iniciar combate", async () => {
  const { engine, battle } = await setupMovePhase("G", "H");
  const enemyUnit = battle.board.players[1].creatures[4];
  enemyUnit.defeated = true;
  enemyUnit.positionLetter = null;

  const moved = engine.chooseMove(battle, 5, "H");
  assert.equal(moved, true);
  engine.chooseEngagement(battle, 5, 5);
  assert.equal(battle.board.engagement.attackerSlot, null);
  assert.equal(battle.board.engagement.defenderSlot, null);
  const legalEngagements = engine.getLegalEngagements(battle, 0);
  assert.ok(!legalEngagements.some((item) => item.attackerSlot === 5));
});

test("attack usado sai da mao e vai para descarte sem reposicao imediata", async () => {
  const { engine, battle } = await setupMovePhase("I", "J");
  battle.board.players[0].attackHand = battle.board.players[0].attackHand.slice(0, 2);
  engine.chooseEngagement(battle, 4, 3);
  engine.advanceBattle(battle, false);

  assert.equal(battle.phase, "combat_sequence");
  assert.equal(battle.pendingAction?.type, "strike_attack");
  assert.equal(battle.pendingAction?.playerIndex, 0);
  assert.equal(battle.board.players[0].attackHand.length, 3);

  const handBefore = 3;
  const discardBefore = battle.board.players[0].attackDiscard.length;
  engine.chooseAttack(battle, 0, 0);
  engine.advanceBattle(battle, false);

  assert.equal(battle.board.players[0].attackHand.length, handBefore - 1);
  assert.equal(battle.board.players[0].attackDiscard.length, discardBefore + 1);
});

test("limite de um combate por turno permanece ativo", async () => {
  const { engine, battle } = await setupMovePhase("K", "L");
  engine.chooseEngagement(battle, 4, 3);
  battle.combatsThisTurn = 1;
  engine.advanceBattle(battle, false);
  assert.ok(battle.combatsThisTurn <= 1);
});

test("apos derrotar criatura, fase vai para additional_movement e permite mover outra criatura", async () => {
  const { engine, battle } = await setupMovePhase("W1", "W2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  defender.currentEnergy = 1;
  battle.board.players[0].attackHand = [attackCard("Finisher", 30)];
  battle.board.players[0].attackDeck = [];
  battle.board.players[0].attackDiscard = [];

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);
  let guard = 0;
  while (!battle.finished && battle.phase !== "additional_movement" && guard < 320) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    guard += 1;
  }
  assert.equal(battle.phase, "additional_movement");
  assert.equal(defender.defeated, true);

  const postMoves = engine.getLegalMoves(battle, 0).filter((move) => move.type === "move_empty");
  assert.ok(postMoves.length > 0);
  const moved = engine.choosePostCombatMove(battle, postMoves[0].from, postMoves[0].toLetter);
  assert.equal(moved, true);
});

test("apos perder combate no turno ativo, ainda entra em additional_movement para mover outras criaturas", async () => {
  const { engine, battle } = await setupMovePhase("X1", "X2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 1;
  defender.card.stats.speed = 120;
  attacker.currentEnergy = 1;
  battle.board.players[1].attackHand = [attackCard("Counter", 30)];
  battle.board.players[1].attackDeck = [];
  battle.board.players[1].attackDiscard = [];

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);
  let guard = 0;
  while (!battle.finished && battle.phase !== "additional_movement" && guard < 320) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    guard += 1;
  }
  assert.equal(battle.phase, "additional_movement");
  assert.equal(attacker.defeated, true);
  assert.equal(defender.defeated, false);

  const postMoves = engine.getLegalMoves(battle, 0).filter((move) => move.type === "move_empty");
  assert.ok(postMoves.length > 0);
  const moved = engine.choosePostCombatMove(battle, postMoves[0].from, postMoves[0].toLetter);
  assert.equal(moved, true);
});

test("efeito boardMove.swap_positions troca criaturas sem consumir movimento normal", async () => {
  const { engine, battle } = await setupMovePhase("BM1", "BM2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  battle.board.players[0].attackHand = [
    {
      ...attackCard("Swap Strike", 0),
      parsedEffects: [
        {
          kind: "boardMove",
          operation: "swap_positions",
          target: "self",
          includeEngaged: false,
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];
  const unitA = battle.board.players[0].creatures[0];
  const unitB = battle.board.players[0].creatures[1];
  const letterA = unitA.positionLetter;
  const letterB = unitB.positionLetter;

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let swapped = false;
  let guard = 0;
  while (!battle.finished && guard < 120) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    if (battle.log.some((line) => line.includes("[resolved_effect] boardMove.swap_positions"))) {
      swapped = true;
      break;
    }
    guard += 1;
  }

  assert.equal(swapped, true);
  assert.equal(unitA.positionLetter, letterB);
  assert.equal(unitB.positionLetter, letterA);
  assert.equal(unitA.movedThisAction, false);
  assert.equal(unitB.movedThisAction, false);
});

test("Mugic tribal bloqueia carta de outra tribo sem permissao de any tribe", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("TR1"), makeDeck("TR2"), { mode: "casual" });
  const board = battle.board;
  board.activePlayerIndex = 0;
  board.engagement.attackerSlot = 4;
  board.engagement.defenderSlot = 3;
  board.engagement.attackerLetter = "E";
  board.engagement.defenderLetter = "G";

  const unit = board.players[0].creatures[4];
  unit.mugicCounters = 3;
  setPlayerMugicSlots(board.players[0], [
    {
      ...mugicCard("Enemy Tribe Song", 1),
      tribe: "UnderWorld",
      parsedEffects: [{ kind: "dealDamage", amount: 5 }],
    },
  ]);

  const optionsBlocked = engine.getPriorityActions(battle, 0);
  assert.ok(!optionsBlocked.some((option) => option.kind === "mugic"));

  unit.card.parsedEffects = [...(unit.card.parsedEffects || []), { kind: "canPlayAnyTribeMugic" }];
  const optionsAllowed = engine.getPriorityActions(battle, 0);
  assert.ok(optionsAllowed.some((option) => option.kind === "mugic"));
});

test("passivo global de criatura nao engajada afeta a troca em combate", async () => {
  const { engine, battle } = await setupMovePhase("GP1", "GP2");
  const auraUnit = battle.board.players[0].creatures[0];
  auraUnit.card.parsedEffects = [
    {
      kind: "attackDamageModifier",
      amount: 4,
      modifier: "add",
      target: "self",
      sourceText: "Attacks played by creatures you control deal 4 additional damage.",
    },
  ];
  auraUnit.card.ability = "Attacks played by creatures you control deal 4 additional damage.";

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let strikeBonus = null;
  let guard = 0;
  while (guard < 220 && strikeBonus === null) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    if (battle.phase === "combat_sequence" && battle.combatState?.step === "strike_burst" && battle.board.exchange) {
      strikeBonus = Number(battle.board.exchange.attackDamageAdd?.[0] || 0);
    }
    guard += 1;
  }

  assert.equal(strikeBonus, 4);
});

test("Mugic pode ser ativado por criatura nao engajada quando elegivel", async () => {
  const { engine, battle } = await setupMovePhase("MU1", "MU2");
  const engagedUnit = battle.board.players[0].creatures[4];
  const supportCaster = battle.board.players[0].creatures[0];
  engagedUnit.mugicCounters = 0;
  supportCaster.mugicCounters = 3;
  setPlayerMugicSlots(battle.board.players[0], [
    {
      ...mugicCard("Support Song", 1),
      tribe: supportCaster.card.tribe,
      parsedEffects: [{ kind: "dealDamage", amount: 3, target: "opponent" }],
    },
  ]);

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let usedSupportCaster = false;
  let guard = 0;
  while (guard < 260 && !usedSupportCaster) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === 0) {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const candidate = step?.candidates?.[0] || null;
      engine.chooseEffectTarget(battle, candidate?.id || null);
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      const mugicOption = (battle.pendingAction.options || []).find((option) => option.kind === "mugic");
      if (!mugicOption) {
        engine.passPriority(battle);
        guard += 1;
        continue;
      }
      assert.equal(mugicOption.casterUnitId, supportCaster.unitId);
      const countersBefore = supportCaster.mugicCounters;
      engine.chooseMugic(battle, mugicOption.mugicIndex, mugicOption.casterUnitId);
      engine.advanceBattle(battle, false);
      assert.equal(supportCaster.mugicCounters, countersBefore - 1);
      assert.equal(engagedUnit.mugicCounters, 0);
      assert.equal(battle.board.players[0].mugicDiscard.length > 0, true);
      const usedSlot = battle.board.players[0].mugicSlots.find(
        (entry) => entry?.slotIndex === mugicOption.mugicIndex
      );
      assert.ok(usedSlot);
      assert.equal(Boolean(usedSlot.available), false);
      assert.equal(Boolean(usedSlot.queued), false);
      assert.equal(Boolean(usedSlot.spent), true);
      assert.equal(
        battle.board.players[0].mugicSlots.some(
          (entry) => entry?.slotIndex === mugicOption.mugicIndex && entry?.available
        ),
        false
      );
      usedSupportCaster = true;
      break;
    }
    guard += 1;
  }

  assert.equal(usedSupportCaster, true);
});

test("ativacao de Mugic paga custo antes da selecao de alvo", async () => {
  const { engine, battle } = await setupMovePhase("MU5", "MU6");
  const engagedUnit = battle.board.players[0].creatures[4];
  const supportCaster = battle.board.players[0].creatures[0];
  engagedUnit.mugicCounters = 0;
  supportCaster.mugicCounters = 3;
  setPlayerMugicSlots(battle.board.players[0], [
    {
      ...mugicCard("Target Song", 1),
      tribe: supportCaster.card.tribe,
      parsedEffects: [
        {
          kind: "statModifier",
          stat: "power",
          amount: -10,
          duration: "until_end_of_combat",
          targetSpec: { type: "creature", required: true, scope: "opponent" },
          sourceText: "Target opposing Creature has Power 10 less.",
        },
      ],
    },
  ]);

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let validated = false;
  let guard = 0;
  while (guard < 260 && !validated) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      const mugicOption = (battle.pendingAction.options || []).find((option) => option.kind === "mugic");
      if (!mugicOption) {
        engine.passPriority(battle);
        guard += 1;
        continue;
      }
      const countersBefore = supportCaster.mugicCounters;
      engine.chooseMugic(battle, mugicOption.mugicIndex, mugicOption.casterUnitId);
      engine.advanceBattle(battle, false);
      assert.equal(battle.pendingAction?.type, "target_select");
      assert.equal(supportCaster.mugicCounters, countersBefore - 1);
      const slot = battle.board.players[0].mugicSlots.find(
        (entry) => Number(entry?.slotIndex) === Number(mugicOption.mugicIndex)
      );
      assert.ok(slot);
      assert.equal(Boolean(slot.available), false);
      assert.equal(Boolean(slot.spent), true);
      validated = true;
      break;
    }
    if (battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === 0) {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const candidate = step?.candidates?.[0] || null;
      engine.chooseEffectTarget(battle, candidate?.id || null);
    }
    guard += 1;
  }

  assert.equal(validated, true);
});

test("target_select filtra candidatos por creature type requerido", async () => {
  const { engine, battle } = await setupMovePhase("TY1", "TY2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.creatureTypeKeywords = ["overworld", "warrior"];
  battle.board.players[0].creatures[0].card.creatureTypeKeywords = ["overworld", "scout"];
  defender.card.creatureTypeKeywords = ["danian muge", "danian", "muge"];
  battle.board.players[1].creatures[0].card.creatureTypeKeywords = ["underworld", "warbeast"];
  const candidates = engine.debugBuildTargetCandidatesForEffect(
    battle,
    0,
    {
      kind: "statModifier",
      stat: "courage",
      amount: 10,
      sourceText: "Target Danian Muge Creature gains 10 Courage.",
      targetSpec: {
        type: "creature",
        required: true,
        scope: "self",
        requiredCreatureTypes: ["danian muge"],
      },
    },
    attacker.unitId
  );
  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((candidate) => candidate.unitId === defender.unitId));
  assert.ok(!candidates.some((candidate) => candidate.unitId === attacker.unitId));
  assert.ok(!candidates.some((candidate) => candidate.unitId === battle.board.players[0].creatures[0].unitId));
  assert.ok(!candidates.some((candidate) => candidate.unitId === battle.board.players[1].creatures[0].unitId));
});

test("Mugic com multiplos casters abre selecao de criatura antes de entrar na pilha", async () => {
  const { engine, battle } = await setupMovePhase("MU3", "MU4");
  const engagedUnit = battle.board.players[0].creatures[4];
  const supportCaster = battle.board.players[0].creatures[0];
  engagedUnit.mugicCounters = 3;
  supportCaster.mugicCounters = 3;
  setPlayerMugicSlots(battle.board.players[0], [
    {
      ...mugicCard("Shared Song", 1),
      tribe: engagedUnit.card.tribe,
      parsedEffects: [{ kind: "dealDamage", amount: 2, target: "opponent" }],
    },
  ]);

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let selectedSupportCaster = false;
  let guard = 0;
  while (guard < 280 && !selectedSupportCaster) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      const mugicOption = (battle.pendingAction.options || []).find((option) => option.kind === "mugic");
      if (mugicOption) {
        engine.chooseMugic(battle, mugicOption.mugicIndex);
      } else {
        engine.passPriority(battle);
      }
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "mugic_caster_select" && battle.pendingAction.playerIndex === 0) {
      const idx = (battle.pendingAction.options || []).findIndex(
        (entry) => entry?.casterUnitId === supportCaster.unitId
      );
      assert.ok(idx >= 0);
      const countersBefore = supportCaster.mugicCounters;
      engine.chooseMugic(battle, idx);
      engine.advanceBattle(battle, false);
      assert.equal(supportCaster.mugicCounters, countersBefore - 1);
      assert.equal(engagedUnit.mugicCounters, 3);
      const usedSlot = battle.board.players[0].mugicSlots.find((entry) => Number(entry?.slotIndex) === 0);
      assert.ok(usedSlot);
      assert.equal(Boolean(usedSlot.available), false);
      assert.equal(Boolean(usedSlot.spent), true);
      selectedSupportCaster = true;
      break;
    }
    if (battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === 0) {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const candidate = step?.candidates?.[0] || null;
      engine.chooseEffectTarget(battle, candidate?.id || null);
    }
    guard += 1;
  }

  assert.equal(selectedSupportCaster, true);
});

test("efeito com choice_select empilha Mugic com escolhas e alvo definidos", async () => {
  const { engine, battle } = await setupMovePhase("MU7", "MU8");
  const supportCaster = battle.board.players[0].creatures[0];
  supportCaster.mugicCounters = 3;
  setPlayerMugicSlots(battle.board.players[0], [
    {
      ...mugicCard("Gear Choice Song", 1),
      tribe: supportCaster.card.tribe,
      parsedEffects: [
        {
          kind: "flipBattlegear",
          mode: "toggle",
          targetSpec: { type: "battlegear", required: true, scope: "all" },
          choiceSpec: {
            type: "flipMode",
            required: true,
            options: [
              { id: "down", value: "down", label: "Virar face-down" },
              { id: "up", value: "up", label: "Virar face-up" },
            ],
          },
          sourceText: "Flip target Battlegear face-up or face-down.",
        },
      ],
    },
  ]);

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let validated = false;
  let guard = 0;
  while (guard < 320 && !validated) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      const mugicOption = (battle.pendingAction.options || []).find((option) => option.kind === "mugic");
      if (mugicOption) {
        engine.chooseMugic(battle, mugicOption.mugicIndex, mugicOption.casterUnitId);
      } else {
        engine.passPriority(battle);
      }
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === 0) {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const candidate = step?.candidates?.find((entry) => Number(entry.playerIndex) === 1) || step?.candidates?.[0] || null;
      assert.ok(candidate);
      engine.chooseEffectTarget(battle, candidate.id);
      assert.equal(battle.pendingAction?.type, "choice_select");
      guard += 1;
      continue;
    }
    if (battle.pendingAction?.type === "choice_select" && battle.pendingAction.playerIndex === 0) {
      engine.chooseEffectChoice(battle, "down");
      const stackTop = battle.burstStack[battle.burstStack.length - 1];
      assert.ok(stackTop);
      assert.equal(stackTop.kind, "mugic");
      assert.ok(stackTop.targetsSnapshot);
      assert.ok(stackTop.choicesSnapshot);
      const firstChoice = stackTop.choicesSnapshot?.[0] || stackTop.choicesSnapshot?.["0"];
      assert.ok(firstChoice);
      assert.equal(String(firstChoice.id || firstChoice.value), "down");
      validated = true;
      break;
    }
    guard += 1;
  }

  assert.equal(validated, true);
});

test("battlegear inicia face-down e revela no inicio do combate", async () => {
  const engine = await loadEngine();
  const deckA = makeDeck("BG1");
  const deckB = makeDeck("BG2");
  deckA.battlegear[4] = {
    ...gearCard("Hidden Engine"),
    ability: "Power 10",
    parsedEffects: [{ kind: "statModifier", stat: "power", amount: 10, sourceText: "Power 10" }],
  };
  const battle = engine.createBattleState(deckA, deckB, { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  battle.phase = "location_step";
  battle.turnStep = "location_step";
  let preMoveGuard = 0;
  while (battle.phase !== "move_action" && preMoveGuard < 48) {
    preMoveGuard += 1;
    engine.advanceBattle(battle, false);
    if (battle.phase === "action_step_pre_move" && battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
      continue;
    }
    if (battle.phase !== "move_action") {
      resolveHumanPendingAction(engine, battle);
    }
  }
  assert.equal(battle.phase, "move_action");

  const attacker = battle.board.players[0].creatures[4];
  assert.equal(attacker.gearState, "face_down");
  assert.equal(Number(attacker.passiveMods?.power || 0), 0);

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let revealed = false;
  let guard = 0;
  while (guard < 120 && !revealed) {
    engine.advanceBattle(battle, false);
    if (battle.phase === "combat_sequence" && battle.combatState?.step === "strike_choose") {
      revealed = attacker.gearState === "face_up";
      break;
    }
    guard += 1;
  }

  assert.equal(revealed, true);
  assert.equal(Number(attacker.passiveMods?.power || 0), 10);
});

test("copyCreatureProfile aplica perfil escaneado no inicio do turno", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("CP1"), makeDeck("CP2"), { mode: "casual" });
  battle.board.activePlayerIndex = 0;
  battle.turnMeta.startingPlayerIndex = 0;
  const ownUnit = battle.board.players[0].creatures[0];
  const opposingUnit = battle.board.players[1].creatures[0];
  ownUnit.card.parsedEffects = [
    {
      kind: "copyCreatureProfile",
      target: "self",
      source: "opponent",
      timing: "begin_turn",
    },
  ];
  ownUnit.card.ability = "At the beginning of each turn, this Creature becomes a copy of target opposing Creature.";
  opposingUnit.card.stats.courage = 95;
  opposingUnit.card.stats.fire = 15;

  battle.phase = "location_step";
  battle.turnStep = "location_step";
  let guard = 0;
  while (battle.phase !== "move_action" && guard < 72) {
    engine.advanceBattle(battle, false);
    if (battle.phase === "action_step_pre_move" && battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
      guard += 1;
      continue;
    }
    if (battle.phase !== "move_action") {
      resolveHumanPendingAction(engine, battle);
    }
    guard += 1;
  }

  assert.equal(battle.phase, "move_action");
  assert.ok(ownUnit.copyRuntime);
  assert.equal(ownUnit.copyRuntime.sourceUnitId, opposingUnit.unitId);
  assert.equal(ownUnit.copyRuntime.card.name, opposingUnit.card.name);
});

test("copyMugic coloca a copia na pilha e resolve dano adicional", async () => {
  const { engine, battle } = await setupMovePhase("CM1", "CM2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.mugicCounters = 5;
  attacker.card.ability = "MC: Copy target Mugic played by a Creature you control. You may choose new targets for the copy.";
  attacker.card.parsedEffects = [
    {
      kind: "copyMugic",
      target: "self",
      allowRetarget: true,
    },
  ];
  setPlayerMugicSlots(battle.board.players[0], [
    {
      ...mugicCard("Damage Song", 1),
      tribe: attacker.card.tribe,
      parsedEffects: [{ kind: "dealDamage", amount: 5, target: "opponent" }],
    },
  ]);
  setPlayerMugicSlots(battle.board.players[1], []);
  battle.board.players[0].attackHand = [attackCard("Setup Strike", 0)];
  battle.board.players[0].attackDeck = [];
  const defenderEnergyBefore = defender.currentEnergy;

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let playedMugic = false;
  let usedCopyAbility = false;
  let sawCopyResolution = false;
  let guard = 0;
  while (!battle.finished && guard < 200) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
    } else if (battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === 0) {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const firstCandidate = step?.candidates?.[0] || null;
      engine.chooseEffectTarget(battle, firstCandidate?.id || null);
    } else if (battle.pendingAction?.type === "mugic_caster_select" && battle.pendingAction.playerIndex === 0) {
      engine.chooseMugic(battle, 0);
    } else if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      if (!playedMugic) {
        engine.chooseMugic(battle, 0);
        playedMugic = true;
      } else if (!usedCopyAbility) {
        engine.chooseActivatedAbility(battle, 0);
        usedCopyAbility = true;
      } else {
        engine.passPriority(battle);
      }
    }
    if (battle.log.some((line) => line.includes("[resolved_effect] copyMugic"))) {
      sawCopyResolution = true;
    }
    if (sawCopyResolution) {
      break;
    }
    guard += 1;
  }

  assert.equal(playedMugic, true);
  assert.equal(usedCopyAbility, true);
  assert.equal(sawCopyResolution, true);
  assert.ok(defender.currentEnergy <= defenderEnergyBefore);
});

test("relocateEffect nao consome movimento normal ao trocar posicoes", async () => {
  const { engine, battle } = await setupMovePhase("RL1", "RL2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  battle.board.players[0].attackHand = [
    {
      ...attackCard("Relocate Strike", 0),
      parsedEffects: [
        {
          kind: "relocateEffect",
          operation: "swap_positions",
          target: "self",
          includeEngaged: false,
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];
  const unitA = battle.board.players[0].creatures[0];
  const unitB = battle.board.players[0].creatures[1];
  const letterA = unitA.positionLetter;
  const letterB = unitB.positionLetter;

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let relocated = false;
  let guard = 0;
  while (!battle.finished && guard < 160) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    if (battle.log.some((line) => line.includes("[resolved_effect] relocateEffect.swap_positions"))) {
      relocated = true;
      break;
    }
    guard += 1;
  }

  assert.equal(relocated, true);
  assert.equal(unitA.positionLetter, letterB);
  assert.equal(unitB.positionLetter, letterA);
  assert.equal(unitA.movedThisAction, false);
  assert.equal(unitB.movedThisAction, false);
});

test("passivo de battlegear nao duplica no inicio do combate", async () => {
  const { engine, battle } = await setupMovePhase("PG1", "PG2");
  const attacker = battle.board.players[0].creatures[4];
  attacker.gearCard.parsedEffects = [
    {
      kind: "attackDamageModifier",
      amount: 5,
      modifier: "add",
      sourceText: "Attacks deal 5 additional damage.",
    },
  ];
  attacker.gearCard.ability = "Attacks deal 5 additional damage.";

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let firstStrikeBonus = null;
  let guard = 0;
  while (guard < 180 && firstStrikeBonus === null) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    if (battle.phase === "combat_sequence" && battle.combatState?.step === "strike_burst" && battle.board.exchange) {
      firstStrikeBonus = Number(battle.board.exchange.attackDamageAdd?.[0] || 0);
    }
    guard += 1;
  }

  assert.equal(firstStrikeBonus, 5);
});

test("passivos e location continua reaplicam em toda troca (strikes consecutivos)", async () => {
  const { engine, battle } = await setupMovePhase("PS1", "PS2");
  const attacker = battle.board.players[0].creatures[4];
  attacker.gearCard.parsedEffects = [
    {
      kind: "attackDamageModifier",
      amount: 5,
      modifier: "add",
      sourceText: "Attacks deal 5 additional damage.",
    },
  ];
  attacker.gearCard.ability = "Attacks deal 5 additional damage.";
  battle.board.locationCard = {
    ...locationCard("Persistent Hall"),
    parsedEffects: [
      {
        kind: "attackDamageModifier",
        amount: 2,
        modifier: "add",
        target: "self",
        sourceText: "Your attacks deal 2 additional damage.",
      },
    ],
  };
  battle.board.locationOwnerIndex = 0;
  attacker.currentEnergy = 120;
  battle.board.players[1].creatures[3].currentEnergy = 120;
  battle.board.players[0].attackHand = [attackCard("Ping A", 0), attackCard("Ping B", 0), attackCard("Ping C", 0)];
  battle.board.players[1].attackHand = [attackCard("Ping X", 0), attackCard("Ping Y", 0), attackCard("Ping Z", 0)];
  battle.board.players[0].attackDeck = [];
  battle.board.players[1].attackDeck = [];

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  const seenBurst = new Set();
  const strikeBonuses = [];
  let guard = 0;
  while (guard < 320 && strikeBonuses.length < 2) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);

    if (battle.phase === "combat_sequence" && battle.combatState?.step === "strike_burst" && battle.board.exchange) {
      const strikeKey = `${battle.combatState.exchangesResolved}:${battle.combatState.currentAttack?.card?.id || "none"}`;
      if (!seenBurst.has(strikeKey)) {
        seenBurst.add(strikeKey);
        strikeBonuses.push(Number(battle.board.exchange.attackDamageAdd?.[0] || 0));
      }
    }
    guard += 1;
  }

  assert.equal(strikeBonuses.length >= 2, true);
  assert.equal(strikeBonuses[0], 7);
  assert.equal(strikeBonuses[1], 7);
});

test("efeito begin combat de location dispara apenas na primeira troca", async () => {
  const { engine, battle } = await setupMovePhase("BC1", "BC2");
  battle.board.locationCard = {
    ...locationCard("Opening Shock"),
    parsedEffects: [
      {
        kind: "beginCombatDamage",
        amount: 6,
        timing: "begin_combat",
        sourceText: "At the beginning of combat, each engaged Creature takes 6 damage.",
      },
    ],
  };
  battle.board.locationOwnerIndex = 0;
  battle.board.players[0].creatures[4].currentEnergy = 120;
  battle.board.players[1].creatures[3].currentEnergy = 120;
  battle.board.players[0].attackHand = [attackCard("Zero A", 0), attackCard("Zero B", 0), attackCard("Zero C", 0)];
  battle.board.players[1].attackHand = [attackCard("Zero X", 0), attackCard("Zero Y", 0), attackCard("Zero Z", 0)];
  battle.board.players[0].attackDeck = [];
  battle.board.players[1].attackDeck = [];

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  const seenBurst = new Set();
  const snapshots = [];
  let guard = 0;
  while (guard < 320 && snapshots.length < 2) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);

    if (battle.phase === "combat_sequence" && battle.combatState?.step === "strike_burst" && battle.board.exchange) {
      const strikeKey = `${battle.combatState.exchangesResolved}:${battle.combatState.currentAttack?.card?.id || "none"}`;
      if (!seenBurst.has(strikeKey)) {
        seenBurst.add(strikeKey);
        snapshots.push({
          p0: Number(battle.board.exchange.damageToCreature?.[0] || 0),
          p1: Number(battle.board.exchange.damageToCreature?.[1] || 0),
        });
      }
    }
    guard += 1;
  }

  assert.equal(snapshots.length >= 2, true);
  assert.deepEqual(snapshots[0], { p0: 6, p1: 6 });
  assert.deepEqual(snapshots[1], { p0: 0, p1: 0 });
});

test("conditionalDamage com Mugic counters aplica challenge corretamente", async () => {
  const { engine, battle } = await setupMovePhase("MCX1", "MCX2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  attacker.mugicCounters = 4;
  defender.mugicCounters = 1;
  defender.currentEnergy = 35;

  battle.board.players[0].attackHand = [
    {
      ...attackCard("Counter Challenge", 0),
      parsedEffects: [
        {
          kind: "conditionalDamage",
          comparator: "diffGte",
          stat: "mugiccounters",
          threshold: 2,
          amount: 20,
          sourceText: "Challenge Mugic counters 2: Deal 20 damage.",
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];

  const before = defender.currentEnergy;
  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let guard = 0;
  while (!battle.finished && guard < 180) {
    engine.advanceBattle(battle, false);
    resolveHumanPendingAction(engine, battle);
    if (defender.currentEnergy < before) {
      break;
    }
    guard += 1;
  }

  assert.equal(defender.currentEnergy, before - 20);
});

test("ataques escalam por tribos e tipo de criatura controlada", async () => {
  const { engine, battle } = await setupMovePhase("DMG1", "DMG2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  defender.currentEnergy = 60;

  attacker.card.stats.fire = 5;

  battle.board.players[0].creatures[0].card.tribe = "Danian";
  battle.board.players[0].creatures[1].card.tribe = "Mipedian";
  battle.board.players[0].creatures[1].card.creatureTypeKeywords = ["mandiblor"];
  battle.board.players[0].creatures[3].card.creatureTypeKeywords = ["mandiblor"];

  battle.board.players[0].attackHand = [
    {
      ...attackCard("Scale Strike", 0),
      parsedEffects: [
        { kind: "attackDamagePerControlledTribe", amountPerTribe: 5, subtractFirst: true },
        {
          kind: "attackDamagePerControlledCreatureType",
          amountPerCreature: 5,
          creatureType: "mandiblor",
          adjacentToEngaged: true,
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];

  const before = defender.currentEnergy;
  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let guard = 0;
  while (!battle.finished && guard < 180) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === 0) {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack" && battle.pendingAction.playerIndex === 0) {
      engine.chooseAttack(battle, 0, 0);
    }
    if (defender.currentEnergy < before) {
      break;
    }
    guard += 1;
  }

  assert.equal(defender.currentEnergy, before - 20);
});

test("attack aplica remoção espelhada e total de Mugic counters", async () => {
  const { engine, battle } = await setupMovePhase("MCY1", "MCY2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  const otherOpponent = battle.board.players[1].creatures[0];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;
  attacker.mugicCounters = 3;
  defender.mugicCounters = 6;
  otherOpponent.mugicCounters = 2;

  battle.board.players[0].attackHand = [
    {
      ...attackCard("Solar Drain", 0),
      parsedEffects: [
        {
          kind: "mugicCounterMirrorRemove",
          target: "opponent",
          sourceText: "Remove X Mugic counters from the opposing engaged Creature, where X is the number of Mugic counters on your engaged Creature.",
        },
        {
          kind: "mugicCounterRemoveTotal",
          target: "opponent",
          total: 2,
          sourceText: "Your opponent removes a total of 2 Mugic counters from among any Creatures they control.",
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];

  const declared = engine.declareMove(battle, 4, "G");
  assert.equal(declared, true);

  let guard = 0;
  while (!battle.finished && guard < 260) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack") {
      const actor = battle.pendingAction.playerIndex;
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (defender.mugicCounters < 6 || otherOpponent.mugicCounters < 2) {
      break;
    }
    guard += 1;
  }

  const removedTotal = (6 - defender.mugicCounters) + (2 - otherOpponent.mugicCounters);
  assert.ok(removedTotal >= 3);
  assert.ok(defender.mugicCounters <= 3);
  assert.ok(otherOpponent.mugicCounters <= 2);
});

test("attack aplica set de dano para 0 quando jogador tem menos Mugics acessiveis", async () => {
  const { engine, battle } = await setupMovePhase("PMG1", "PMG2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;

  // Simula "menos Mugics em acesso" para o atacante.
  battle.board.players[0].mugicSlots.slice(2).forEach((slot) => {
    slot.available = false;
    slot.spent = true;
  });

  battle.board.players[0].attackHand = [
    {
      ...attackCard("Poison Steam", 30),
      parsedEffects: [
        {
          kind: "attackDamageSetIfFewerMugicCards",
          amount: 0,
          sourceText: "If you have fewer Mugic Cards in hand than your opponent, damage dealt by Poison Steam is reduced to 0.",
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];

  const defenderBefore = defender.currentEnergy;
  assert.equal(engine.declareMove(battle, 4, "G"), true);

  let guard = 0;
  while (!battle.finished && guard < 220) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack") {
      const actor = battle.pendingAction.playerIndex;
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (battle.log.some((line) => /Ataque resolvido: Jogador 1 -> Poison Steam/i.test(String(line)))) {
      break;
    }
    guard += 1;
  }

  assert.equal(defender.currentEnergy, defenderBefore);
});

test("attack aplica remove counter e destroy gear por threshold nos engajados", async () => {
  const { engine, battle } = await setupMovePhase("THR1", "THR2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  attacker.card.stats.wisdom = 40;
  defender.card.stats.courage = 40;
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;
  attacker.mugicCounters = 3;
  defender.mugicCounters = 2;

  battle.board.players[0].attackHand = [
    {
      ...attackCard("Threshold Crash", 0),
      parsedEffects: [
        {
          kind: "mugicCounterRemoveByStatThreshold",
          target: "all",
          scope: "engagedAll",
          threshold: 50,
          stats: ["wisdom", "courage"],
          amount: 1,
          sourceText: "Remove a Mugic counter from engaged Creatures with less than 50 Wisdom or Courage.",
        },
        {
          kind: "destroyBattlegearByStatThreshold",
          target: "all",
          scope: "engagedAll",
          threshold: 50,
          stats: ["power", "speed"],
          sourceText: "Destroy all Battlegear equipped to engaged Creatures with less than 50 Power or Speed.",
        },
      ],
    },
  ];
  battle.board.players[0].attackDeck = [];

  assert.ok(attacker.gearCard);
  assert.ok(defender.gearCard);
  assert.equal(engine.declareMove(battle, 4, "G"), true);

  let guard = 0;
  while (!battle.finished && guard < 260) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack") {
      const actor = battle.pendingAction.playerIndex;
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (battle.log.some((line) => /Ataque resolvido: Jogador 1 -> Threshold Crash/i.test(String(line)))) {
      break;
    }
    guard += 1;
  }

  assert.equal(attacker.mugicCounters, 2);
  assert.equal(defender.mugicCounters, 1);
  assert.ok(attacker.gearCard);
  assert.equal(defender.gearCard, null);
});

test("criatura recebe Leadership counter ao vencer combate", async () => {
  const { engine, battle } = await setupMovePhase("LDR1", "LDR2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  attacker.card.parsedEffects = [
    {
      kind: "namedCounterOnCombatWin",
      counterKey: "leadership",
      amount: 1,
      creatureName: attacker.card.name,
      timing: "on_combat_win",
      sourceText: `When ${attacker.card.name} wins combat put a Leadership Counter on it.`,
    },
  ];
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;
  battle.board.players[0].attackHand = [{ ...attackCard("Leadership Strike", 120), parsedEffects: [] }];
  battle.board.players[0].attackDeck = [];
  battle.board.players[1].attackHand = [{ ...attackCard("Weak Reply", 0), parsedEffects: [] }];
  battle.board.players[1].attackDeck = [];

  assert.equal(engine.declareMove(battle, 4, "G"), true);
  let guard = 0;
  while (!battle.finished && guard < 260) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack") {
      const actor = battle.pendingAction.playerIndex;
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (defender.defeated) {
      break;
    }
    guard += 1;
  }

  assert.equal(Number(attacker.namedCounters?.leadership || 0), 1);
});

test("replaceAttackDamageWithDisciplineLoss reduz disciplinas e destroyCreatureIfAllDisciplinesZero derrota alvo", async () => {
  const { engine, battle } = await setupMovePhase("RDL1", "RDL2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  attacker.card.stats.fire = 1;
  attacker.card.parsedEffects = [
    {
      kind: "replaceAttackDamageWithDisciplineLoss",
      target: "opponent",
      sourceText:
        "Attacks played by Creatures you control reduce the opposing engaged Creature's Disciplines by an amount equal to the damage they would deal instead of dealing damage.",
    },
    {
      kind: "destroyCreatureIfAllDisciplinesZero",
      target: "opponent",
      sourceText: "If a Creature has 0 in all Disciplines, destroy it.",
    },
  ];
  defender.card.stats.courage = 5;
  defender.card.stats.power = 5;
  defender.card.stats.wisdom = 5;
  defender.card.stats.speed = 5;
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;
  battle.board.players[0].attackHand = [{ ...attackCard("Discipline Break", 12), parsedEffects: [] }];
  battle.board.players[0].attackDeck = [];
  battle.board.players[1].attackHand = [{ ...attackCard("Weak Reply", 0), parsedEffects: [] }];
  battle.board.players[1].attackDeck = [];

  assert.equal(engine.declareMove(battle, 4, "G"), true);
  let guard = 0;
  while (!battle.finished && guard < 220) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority") {
      engine.passPriority(battle);
    }
    if (battle.pendingAction?.type === "strike_attack") {
      const actor = battle.pendingAction.playerIndex;
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (defender.defeated) {
      break;
    }
    guard += 1;
  }

  assert.equal(defender.defeated, true);
  assert.ok(
    battle.log.some((line) => String(line).includes("replaceAttackDamageWithDisciplineLoss"))
  );
});

test("moveAsIfAdjacent permite engajar espaco inimigo nao adjacente", async () => {
  const { engine, battle } = await setupMovePhase("ADJ1", "ADJ2");
  const mover = battle.board.players[0].creatures[5];
  mover.card.parsedEffects = [
    {
      kind: "moveAsIfAdjacent",
      creatureName: mover.card.name,
      sourceText: `${mover.card.name} can move to any space as if it were adjacent.`,
    },
  ];

  const declared = engine.declareMove(battle, 5, "L");
  assert.equal(declared, true);
  assert.equal(battle.board.engagement.attackerSlot, mover.slot);
  assert.equal(battle.board.engagement.defenderLetter, "L");
});

test("replaceMoveIntoOpposingWithRelocate troca posicoes sem iniciar combate", async () => {
  const { engine, battle } = await setupMovePhase("REL1", "REL2");
  const mover = battle.board.players[0].creatures[4];
  const fromLetter = mover.positionLetter;
  const defender = battle.board.players[1].creatures[4];
  const defenderStartLetter = defender.positionLetter;
  mover.card.parsedEffects = [
    {
      kind: "replaceMoveIntoOpposingWithRelocate",
      creatureName: mover.card.name,
      sourceText:
        "If this would move into an opposing Creature's space, it relocates that opposing Creature into this Creature's space instead.",
    },
  ];

  const declared = engine.declareMove(battle, 4, defenderStartLetter);
  assert.equal(declared, true);
  assert.equal(mover.positionLetter, defenderStartLetter);
  assert.equal(defender.positionLetter, fromLetter);
  assert.equal(battle.board.engagement.attackerSlot, null);
  assert.equal(battle.phase, "move_action");
});

test("cannotMove bloqueia movimentacao da criatura", async () => {
  const { engine, battle } = await setupMovePhase("CM1", "CM2");
  const mover = battle.board.players[0].creatures[5];
  mover.statuses = mover.statuses || {};
  mover.statuses.cannotMove = true;

  const legalMoves = engine.getLegalMoves(battle, 0);
  assert.ok(!legalMoves.some((move) => move.from === 5));
  assert.equal(engine.declareMove(battle, 5, "H"), false);
});

test("habilidades ativadas com multiplos custos geram opcoes separadas", async () => {
  const { engine, battle } = await setupMovePhase("ACT1", "ACT2");
  const caster = battle.board.players[0].creatures[4];
  caster.card.ability = "MC: Deal 5 damage to target Creature. MC: Heal 5 damage to target Creature.";
  caster.card.parsedEffects = [
    {
      kind: "dealDamage",
      amount: 5,
      target: "opponent",
      targetSpec: { type: "creature", required: true, scope: "all" },
      sourceText: "Deal 5 damage to target Creature.",
    },
    {
      kind: "healDamage",
      amount: 5,
      target: "self",
      targetSpec: { type: "creature", required: true, scope: "all" },
      sourceText: "Heal 5 damage to target Creature.",
    },
  ];
  caster.mugicCounters = 2;
  battle.pendingAction = { type: "priority", playerIndex: 0, choice: null, windowType: "test_priority" };

  const actions = engine.getPriorityActions(battle, 0).filter((entry) => entry.kind === "ability");
  const casterOptions = actions.filter((entry) => entry.option?.sourceUnitId === caster.unitId);
  assert.equal(casterOptions.length, 2);
  assert.ok(casterOptions.every((entry) => Number(entry.option?.cost?.amount || 0) === 1));
});

test("habilidade once per turn nao reaparece em nova janela do mesmo turno", async () => {
  const { engine, battle } = await setupMovePhase("OPT1", "OPT2");
  const attacker = battle.board.players[0].creatures[4];
  const defender = battle.board.players[1].creatures[3];
  attacker.card.stats.speed = 120;
  defender.card.stats.speed = 1;
  attacker.currentEnergy = 40;
  attacker.card.ability = "MC: Heal 5 damage to target Creature. This ability can only be used once per turn.";
  attacker.card.parsedEffects = [
    {
      kind: "healDamage",
      amount: 5,
      target: "self",
      targetSpec: { type: "creature", required: true, scope: "all" },
      sourceText: "Heal 5 damage to target Creature.",
    },
  ];
  attacker.mugicCounters = 3;

  battle.board.players[0].attackHand = [{ ...attackCard("Low Ping", 0), parsedEffects: [] }];
  battle.board.players[0].attackDeck = [];
  battle.board.players[1].attackHand = [{ ...attackCard("Low Pong", 0), parsedEffects: [] }];
  battle.board.players[1].attackDeck = [];
  battle.board.locationCard = locationCard("Speed Lane", "speed");
  battle.board.locationOwnerIndex = 0;

  assert.equal(engine.declareMove(battle, 4, "G"), true);

  let abilityUsed = false;
  let checkedSecondWindow = false;
  let guard = 0;
  while (!battle.finished && guard < 320) {
    engine.advanceBattle(battle, false);
    if (battle.pendingAction?.type === "priority" && Number(battle.pendingAction.playerIndex) === 0) {
      const actions = engine.getPriorityActions(battle, 0);
      const abilityAction = actions.find(
        (entry) => entry.kind === "ability" && entry.option?.sourceUnitId === attacker.unitId
      );
      if (!abilityUsed && abilityAction) {
        engine.chooseActivatedAbility(battle, abilityAction.optionIndex);
      } else if (abilityUsed) {
        checkedSecondWindow = true;
        assert.equal(Boolean(abilityAction), false);
      } else {
        engine.passPriority(battle);
      }
    }
    if (battle.pendingAction?.type === "target_select") {
      const step = battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep];
      const candidate = step?.candidates?.[0] || null;
      engine.chooseEffectTarget(battle, candidate?.id || null);
    } else if (battle.pendingAction?.type === "choice_select") {
      const step = battle.pendingAction.choiceSteps?.[battle.pendingAction.currentChoiceStep];
      const option = step?.options?.[0] || null;
      engine.chooseEffectChoice(battle, option?.id ?? option?.value ?? null);
    } else if (battle.pendingAction?.type === "priority") {
      if (abilityUsed) {
        engine.passPriority(battle);
      }
    } else if (battle.pendingAction?.type === "strike_attack") {
      const actor = Number(battle.pendingAction.playerIndex || 0);
      const handLength = battle.board.players[actor]?.attackHand?.length || 0;
      engine.chooseAttack(battle, actor, handLength ? 0 : -1);
    }
    if (battle.effectLog.some((entry) => entry?.effectKind === "abilityActivated" && entry?.source === attacker.card.name)) {
      abilityUsed = true;
    }
    if (abilityUsed && checkedSecondWindow) {
      break;
    }
    guard += 1;
  }

  assert.equal(abilityUsed, true);
  assert.equal(checkedSecondWindow, true);
});

test("another target exige alvo diferente na selecao sequencial", async () => {
  const { engine, battle } = await setupMovePhase("AT1", "AT2");
  const firstCandidate = {
    id: `creature:${battle.board.players[0].creatures[0].unitId}`,
    type: "creature",
    playerIndex: 0,
    unitId: battle.board.players[0].creatures[0].unitId,
  };
  const secondCandidate = {
    id: `creature:${battle.board.players[1].creatures[0].unitId}`,
    type: "creature",
    playerIndex: 1,
    unitId: battle.board.players[1].creatures[0].unitId,
  };
  battle.pendingAction = {
    type: "target_select",
    sourceKind: "passive_auto",
    sourceLabel: "Teste another target",
    playerIndex: 0,
    sourcePlayerIndex: 0,
    sourceUnitId: battle.board.players[0].creatures[0].unitId,
    currentStep: 0,
    targetSteps: [
      {
        effectIndex: 0,
        effectKind: "dealDamage",
        label: "Deal 5 damage to target Creature.",
        spec: { type: "creature", required: true, scope: "all" },
        candidates: [firstCandidate, secondCandidate],
      },
      {
        effectIndex: 1,
        effectKind: "gainElement",
        label: "Another target Creature gains Fire 5.",
        spec: { type: "creature", required: true, scope: "all", distinctFromPrevious: true },
        candidates: [firstCandidate, secondCandidate],
      },
    ],
    selectedTargets: {},
    passiveEffects: [],
  };

  assert.ok(firstCandidate?.id);
  assert.equal(engine.chooseEffectTarget(battle, firstCandidate.id), false);
  assert.equal(battle.pendingAction?.currentStep, 1);

  const secondStep = battle.pendingAction.targetSteps?.[1];
  assert.ok(secondStep?.spec?.distinctFromPrevious);
  const denied = engine.chooseEffectTarget(battle, firstCandidate.id);
  assert.equal(denied, false);
  assert.equal(battle.pendingAction?.currentStep, 1);

  assert.ok(secondCandidate?.id);
  const accepted = engine.chooseEffectTarget(battle, secondCandidate.id);
  assert.equal(accepted, true);
});

test("texto com you can target the same Creature permite repetir alvo", async () => {
  const { engine, battle } = await setupMovePhase("AT3", "AT4");
  const sharedCandidate = {
    id: `creature:${battle.board.players[0].creatures[0].unitId}`,
    type: "creature",
    playerIndex: 0,
    unitId: battle.board.players[0].creatures[0].unitId,
  };
  battle.pendingAction = {
    type: "target_select",
    sourceKind: "passive_auto",
    sourceLabel: "Teste same target",
    playerIndex: 0,
    sourcePlayerIndex: 0,
    sourceUnitId: battle.board.players[0].creatures[0].unitId,
    currentStep: 0,
    targetSteps: [
      {
        effectIndex: 0,
        effectKind: "statModifier",
        label: "Target Creature gains 5 Power.",
        spec: { type: "creature", required: true, scope: "all", distinctFromPrevious: false },
        candidates: [sharedCandidate],
      },
      {
        effectIndex: 1,
        effectKind: "statModifier",
        label: "Target Creature gains 5 Wisdom.",
        spec: { type: "creature", required: true, scope: "all", distinctFromPrevious: false },
        candidates: [sharedCandidate],
      },
    ],
    selectedTargets: {},
    passiveEffects: [],
  };

  assert.ok(sharedCandidate?.id);
  assert.equal(engine.chooseEffectTarget(battle, sharedCandidate.id), false);
  assert.equal(battle.pendingAction?.currentStep, 1);

  const accepted = engine.chooseEffectTarget(battle, sharedCandidate.id);
  assert.equal(accepted, true);
});

test("debugBuildTargetCandidatesForEffect prioriza engajados e ordem de tabuleiro", async () => {
  const engine = await loadEngine();
  const battle = engine.createBattleState(makeDeck("TA"), makeDeck("TB"), { mode: "casual" });
  battle.board.engagement.attackerSlot = 0;
  battle.board.engagement.defenderSlot = 0;
  battle.board.engagement.attackerLetter = "A";
  battle.board.engagement.defenderLetter = "L";

  const candidates = engine.debugBuildTargetCandidatesForEffect(
    battle,
    0,
    {
      kind: "dealDamage",
      sourceText: "Deal 5 damage to target Creature.",
      targetSpec: { type: "creature", required: true, scope: "all" },
    },
    battle.board.players[0].creatures[0].unitId
  );

  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length >= 2);
  assert.equal(candidates[0].id, `creature:${battle.board.players[0].creatures[0].unitId}`);
  assert.equal(candidates[1].id, `creature:${battle.board.players[1].creatures[0].unitId}`);
});
