"use strict";

const PROTOCOL_INTENT_TYPES = new Set([
  "move",
  "priority",
  "target",
  "strike",
  "choose",
  "pass",
  "forfeit",
  "request_rematch",
  "respond_rematch",
]);

const LEGACY_ACTION_TO_INTENT = new Map([
  ["declare_move", "move"],
  ["choose_attack", "strike"],
  ["pass_priority", "pass"],
  ["choose_mugic", "priority"],
  ["choose_mugic_caster", "choose"],
  ["choose_ability", "priority"],
  ["choose_target", "target"],
  ["choose_choice", "choose"],
  ["choose_defender", "choose"],
  ["confirm_action_button", "pass"],
  ["cancel_target", "pass"],
  ["cancel_choice", "pass"],
  ["cancel_mugic", "pass"],
  ["cancel_ability", "pass"],
  ["forfeit", "forfeit"],
  ["request_rematch", "request_rematch"],
  ["respond_rematch", "respond_rematch"],
]);

function toInt(value, fallback = null) {
  const n = Number(value);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeTargetKind(value) {
  const token = String(value || "").trim().toLowerCase();
  if (token === "battlegear" || token === "gear") return "battlegear";
  if (token === "space") return "space";
  if (token === "creature") return "creature";
  if (token === "mugic") return "mugic";
  if (token === "mirage") return "mirage";
  if (token === "location") return "location";
  if (token === "burst") return "burst";
  if (token === "player") return "player";
  if (token === "attack") return "attack";
  return token;
}

function parseDelimitedIntent(rawCommand) {
  const raw = String(rawCommand || "").trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split("|").map((item) => String(item || "").trim());
  const opcode = String(parts[0] || "").toLowerCase();
  if (!opcode) {
    return null;
  }
  if (opcode === "pass") {
    return { type: "pass", raw };
  }
  if (opcode === "strike") {
    return { type: "strike", attackIndex: toInt(parts[1], null), raw };
  }
  if (opcode === "choose") {
    return { type: "choose", choiceIndex: toInt(parts[1], null), choiceId: parts[1] || null, raw };
  }
  if (opcode === "move") {
    return {
      type: "move",
      fromSlot: toInt(parts[1], null),
      toLetter: parts[2] || "",
      raw,
    };
  }
  if (opcode === "mugic") {
    return {
      type: "priority",
      selection: {
        kind: "mugic",
        mugicIndex: toInt(parts[1], null),
      },
      raw,
    };
  }
  if (opcode === "ability") {
    return {
      type: "priority",
      selection: {
        kind: "ability",
        sourceType: normalizeTargetKind(parts[1] || ""),
        sourceId: toInt(parts[2], null),
      },
      raw,
    };
  }
  if (opcode === "target") {
    if (String(parts[1] || "").toLowerCase() === "submit") {
      return { type: "target", submit: true, raw };
    }
    const pairs = [];
    for (let idx = 1; idx < parts.length; idx += 2) {
      const kind = normalizeTargetKind(parts[idx]);
      const rawId = parts[idx + 1];
      if (!kind || rawId === undefined) {
        continue;
      }
      pairs.push({
        kind,
        id: rawId,
        numericId: toInt(rawId, null),
      });
    }
    return { type: "target", selections: pairs, raw };
  }
  if (opcode === "forfeit") return { type: "forfeit", raw };
  if (opcode === "request_rematch") return { type: "request_rematch", raw };
  if (opcode === "respond_rematch") return { type: "respond_rematch", accept: String(parts[1] || "").toLowerCase() === "accept", raw };
  return null;
}

function normalizeBattleIntent(intentInput = null, legacyAction = null) {
  if (typeof intentInput === "string") {
    return parseDelimitedIntent(intentInput);
  }
  if (intentInput && typeof intentInput === "object") {
    if (typeof intentInput.command === "string") {
      return parseDelimitedIntent(intentInput.command);
    }
    const type = String(intentInput.type || "").trim().toLowerCase();
    if (PROTOCOL_INTENT_TYPES.has(type)) {
      return { ...intentInput, type };
    }
  }
  if (legacyAction && typeof legacyAction === "object") {
    const legacyType = String(legacyAction.type || "").trim();
    if (legacyType) {
      const mappedIntent = LEGACY_ACTION_TO_INTENT.get(legacyType) || "choose";
      return {
        type: mappedIntent,
        legacy: true,
        legacyActionType: legacyType,
      };
    }
  }
  return null;
}

function pendingPlayerMustAct(battle, actingPlayerIndex) {
  if (!battle || !battle.pendingAction) return false;
  return Number(battle.pendingAction.playerIndex) === Number(actingPlayerIndex);
}

function mapProtocolIntentToLegacyAction(intent, battle, actingPlayerIndex) {
  if (!intent || typeof intent !== "object") {
    return null;
  }
  const type = String(intent.type || "");
  if (type === "forfeit" || type === "request_rematch" || type === "respond_rematch") {
    return { type, accept: Boolean(intent.accept) };
  }
  if (!battle || battle.finished) {
    return null;
  }
  const pending = battle.pendingAction || null;
  if (type === "move") {
    if (battle.phase !== "move_action" && battle.phase !== "additional_movement") return null;
    if (!Number.isInteger(intent.fromSlot) || !String(intent.toLetter || "").trim()) return null;
    return { type: "declare_move", fromSlot: Number(intent.fromSlot), toLetter: String(intent.toLetter) };
  }
  if (type === "strike") {
    if (!pendingPlayerMustAct(battle, actingPlayerIndex) || pending?.type !== "strike_attack") return null;
    if (!Number.isInteger(intent.attackIndex)) return null;
    return { type: "choose_attack", index: Number(intent.attackIndex) };
  }
  if (type === "priority") {
    if (!pendingPlayerMustAct(battle, actingPlayerIndex) || pending?.type !== "priority") return null;
    const selection = intent.selection && typeof intent.selection === "object" ? intent.selection : null;
    if (!selection || !selection.kind) {
      return { type: "pass_priority" };
    }
    if (selection.kind === "mugic") {
      if (!Number.isInteger(selection.mugicIndex)) return null;
      return { type: "choose_mugic", value: { kind: "mugic", mugicIndex: Number(selection.mugicIndex), casterUnitId: selection.casterUnitId || null } };
    }
    if (selection.kind === "ability") {
      const options = Array.isArray(pending.options) ? pending.options : [];
      const sourceType = normalizeTargetKind(selection.sourceType || "");
      const sourceId = Number.isInteger(selection.sourceId) ? Number(selection.sourceId) : null;
      let optionIndex = toInt(selection.optionIndex, null);
      if (!Number.isInteger(optionIndex)) {
        const matched = options.find((option) => {
          if (option?.kind !== "ability") return false;
          const key = String(option?.option?.sourceKey || "").toLowerCase();
          const expectedKey = sourceType === "battlegear" ? "gear" : sourceType;
          if (expectedKey && key !== expectedKey) return false;
          if (!Number.isInteger(sourceId)) return true;
          return Number(option?.option?.sourceSlot) === sourceId || Number(option?.option?.sourceUnitId) === sourceId;
        });
        optionIndex = Number(matched?.optionIndex);
      }
      if (!Number.isInteger(optionIndex)) return null;
      return { type: "choose_ability", value: { kind: "ability", optionIndex } };
    }
    return null;
  }
  if (type === "target") {
    if (!pendingPlayerMustAct(battle, actingPlayerIndex) || pending?.type !== "target_select") return null;
    if (intent.submit) return { type: "cancel_target" };
    const selections = Array.isArray(intent.selections) ? intent.selections : [];
    return { type: "choose_target", value: selections };
  }
  if (type === "choose") {
    if (!pendingPlayerMustAct(battle, actingPlayerIndex)) return null;
    if (pending?.type === "choice_select") {
      const step = pending.choiceSteps?.[pending.currentChoiceStep];
      const options = Array.isArray(step?.options) ? step.options : [];
      let optionId = intent.choiceId;
      if (Number.isInteger(intent.choiceIndex) && options[intent.choiceIndex]) {
        optionId = options[intent.choiceIndex].id ?? options[intent.choiceIndex].value ?? optionId;
      }
      if (optionId === null || optionId === undefined || String(optionId).trim() === "") return null;
      return { type: "choose_choice", value: optionId };
    }
    if (pending?.type === "mugic_caster_select") {
      if (!Number.isInteger(intent.choiceIndex)) return null;
      return { type: "choose_mugic_caster", value: Number(intent.choiceIndex) };
    }
    if (pending?.type === "defender_redirect") {
      if (!Number.isInteger(intent.choiceIndex)) return { type: "choose_defender", value: null };
      return { type: "choose_defender", value: Number(intent.choiceIndex) };
    }
    return null;
  }
  if (type === "pass") {
    if (pendingPlayerMustAct(battle, actingPlayerIndex)) {
      if (pending?.type === "priority") return { type: "pass_priority" };
      if (pending?.type === "target_select") return { type: "cancel_target" };
      if (pending?.type === "choice_select") return { type: "cancel_choice" };
      if (pending?.type === "mugic_caster_select") return { type: "choose_mugic_caster", value: -1 };
      if (pending?.type === "strike_attack" || pending?.type === "defender_redirect") return { type: "pass_priority" };
    }
    if (battle.phase === "move_action" || battle.phase === "additional_movement") {
      return { type: "confirm_action_button" };
    }
    return { type: "pass_priority" };
  }
  return null;
}

function classifyActionFamily(action = null) {
  const type = String(action?.type || "");
  if (type === "priority") return "priority";
  if (type === "target_select") return "target";
  if (type === "choice_select" || type === "defender_redirect" || type === "mugic_caster_select") return "choose";
  if (type === "strike_attack") return "strike";
  if (type === "declare_move") return "move";
  if (type === "choose_attack") return "strike";
  if (type === "choose_target") return "target";
  if (type === "choose_choice" || type === "choose_defender" || type === "choose_mugic_caster") return "choose";
  if (type === "choose_mugic" || type === "choose_ability" || type === "pass_priority") return "priority";
  if (type === "confirm_action_button") return "pass";
  if (type === "forfeit" || type === "request_rematch" || type === "respond_rematch") return type;
  return "unknown";
}

function stableBurstView(burstStack) {
  const list = Array.isArray(burstStack) ? burstStack : [];
  const copied = list.map((entry, index) => ({ ...entry, _index: index }));
  copied.sort((left, right) => {
    const leftOwner = Number(left?.owner ?? left?.playerIndex ?? -1);
    const rightOwner = Number(right?.owner ?? right?.playerIndex ?? -1);
    if (leftOwner !== rightOwner) return leftOwner - rightOwner;
    const leftKind = String(left?.kind || "");
    const rightKind = String(right?.kind || "");
    const byKind = leftKind.localeCompare(rightKind, "en", { sensitivity: "base" });
    if (byKind !== 0) return byKind;
    const leftSource = String(left?.source || left?.effectRef || "");
    const rightSource = String(right?.source || right?.effectRef || "");
    const bySource = leftSource.localeCompare(rightSource, "en", { sensitivity: "base" });
    if (bySource !== 0) return bySource;
    return Number(left._index) - Number(right._index);
  });
  return copied.map((entry) => {
    const output = { ...entry };
    delete output._index;
    return output;
  });
}

function buildBattleStateView(battleState) {
  if (!battleState || typeof battleState !== "object") {
    return null;
  }
  const board = battleState.board || {};
  const pending = battleState.pendingAction || null;
  return {
    phase: String(battleState.phase || ""),
    action: classifyActionFamily({ type: pending?.type }),
    activePlayerIndex: Number.isInteger(board.activePlayerIndex) ? board.activePlayerIndex : null,
    combat: Boolean(battleState.phase === "combat_sequence"),
    engaged: board?.engagement
      ? {
          attackerSlot: Number.isInteger(board.engagement.attackerSlot) ? board.engagement.attackerSlot : null,
          defenderSlot: Number.isInteger(board.engagement.defenderSlot) ? board.engagement.defenderSlot : null,
          attackerLetter: board.engagement.attackerLetter || null,
          defenderLetter: board.engagement.defenderLetter || null,
        }
      : null,
    pendingAction: pending
      ? {
          type: pending.type || "",
          playerIndex: Number.isInteger(pending.playerIndex) ? pending.playerIndex : null,
          windowType: pending.windowType || null,
          optionsCount: Array.isArray(pending.options) ? pending.options.length : 0,
          targetStepIndex: Number.isInteger(pending.currentStep) ? pending.currentStep : null,
          choiceStepIndex: Number.isInteger(pending.currentChoiceStep) ? pending.currentChoiceStep : null,
        }
      : null,
    attacksAvailable: Array.isArray(board.players?.[board.activePlayerIndex]?.attackHand)
      ? board.players[board.activePlayerIndex].attackHand.length
      : 0,
    burstSize: Array.isArray(battleState.burstStack) ? battleState.burstStack.length : 0,
    burst: stableBurstView(battleState.burstStack),
    resolving: battleState.burstStack?.[battleState.burstStack.length - 1] || null,
    finished: Boolean(battleState.finished),
    winner: battleState.winner || null,
  };
}

module.exports = {
  normalizeBattleIntent,
  parseDelimitedIntent,
  mapProtocolIntentToLegacyAction,
  buildBattleStateView,
  classifyActionFamily,
};
