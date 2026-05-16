const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseDelimitedIntent,
  normalizeBattleIntent,
  mapProtocolIntentToLegacyAction,
  buildBattleStateView,
} = require("../lib/battle-protocol");

test("parseDelimitedIntent converte comandos basicos", () => {
  assert.deepEqual(parseDelimitedIntent("move|2|E"), {
    type: "move",
    fromSlot: 2,
    toLetter: "E",
    raw: "move|2|E",
  });

  assert.deepEqual(parseDelimitedIntent("mugic|1"), {
    type: "priority",
    selection: {
      kind: "mugic",
      mugicIndex: 1,
    },
    raw: "mugic|1",
  });

  assert.deepEqual(parseDelimitedIntent("target|creature|3|player|1"), {
    type: "target",
    selections: [
      { kind: "creature", id: "3", numericId: 3 },
      { kind: "player", id: "1", numericId: 1 },
    ],
    raw: "target|creature|3|player|1",
  });
});

test("normalizeBattleIntent aceita command em objeto", () => {
  const intent = normalizeBattleIntent({ command: "strike|0" }, null);
  assert.equal(intent.type, "strike");
  assert.equal(intent.attackIndex, 0);
});

test("mapProtocolIntentToLegacyAction traduz move/strike/pass", () => {
  const battleMove = { finished: false, phase: "move_action", pendingAction: null };
  assert.deepEqual(
    mapProtocolIntentToLegacyAction({ type: "move", fromSlot: 1, toLetter: "H" }, battleMove, 0),
    { type: "declare_move", fromSlot: 1, toLetter: "H" }
  );

  const battleStrike = { finished: false, phase: "combat_sequence", pendingAction: { type: "strike_attack", playerIndex: 0 } };
  assert.deepEqual(
    mapProtocolIntentToLegacyAction({ type: "strike", attackIndex: 2 }, battleStrike, 0),
    { type: "choose_attack", index: 2 }
  );

  const battlePass = { finished: false, phase: "move_action", pendingAction: null };
  assert.deepEqual(
    mapProtocolIntentToLegacyAction({ type: "pass" }, battlePass, 0),
    { type: "confirm_action_button" }
  );
});

test("mapProtocolIntentToLegacyAction traduz priority de ability por source", () => {
  const battle = {
    finished: false,
    phase: "action_step_pre_move",
    pendingAction: {
      type: "priority",
      playerIndex: 0,
      options: [
        {
          kind: "ability",
          optionIndex: 0,
          option: { sourceKey: "creature", sourceSlot: 4, sourceUnitId: 99 },
        },
      ],
    },
  };

  const action = mapProtocolIntentToLegacyAction(
    {
      type: "priority",
      selection: { kind: "ability", sourceType: "creature", sourceId: 4 },
    },
    battle,
    0
  );
  assert.deepEqual(action, { type: "choose_ability", value: { kind: "ability", optionIndex: 0 } });
});

test("buildBattleStateView expoe estado minimo de combate", () => {
  const battleState = {
    phase: "combat_sequence",
    finished: false,
    winner: null,
    pendingAction: { type: "priority", playerIndex: 1, options: [{}, {}], windowType: "combat_priority" },
    burstStack: [
      { owner: 1, kind: "mugic", source: "M2" },
      { owner: 0, kind: "ability", source: "A1" },
    ],
    board: {
      activePlayerIndex: 1,
      engagement: { attackerSlot: 2, defenderSlot: 5, attackerLetter: "E", defenderLetter: "H" },
      players: [{ attackHand: [] }, { attackHand: [{}, {}] }],
    },
  };
  const view = buildBattleStateView(battleState);
  assert.equal(view.phase, "combat_sequence");
  assert.equal(view.action, "priority");
  assert.equal(view.activePlayerIndex, 1);
  assert.equal(view.attacksAvailable, 2);
  assert.equal(view.burstSize, 2);
  assert.equal(Array.isArray(view.burst), true);
});
