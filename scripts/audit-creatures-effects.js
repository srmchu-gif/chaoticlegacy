const fs = require("fs");
const path = require("path");
const { buildLibrary } = require("../lib/library");
const { sanitizeAbilityText } = require("../lib/effect-parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENGINE_FILE = path.join(ROOT_DIR, "public", "js", "battle", "engine.js");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");
const REPORT_FILE = path.join(EXPORT_DIR, "creatures_effects_audit.json");
const SUMMARY_FILE = path.join(EXPORT_DIR, "creatures_effects_audit_summary.json");
const PENDING_FILE = path.join(EXPORT_DIR, "criaturas_pendentes.txt");

const NATIVE_RUNTIME_KINDS = new Set([
  "keyword",
  "invisibilityStrike",
  "invisibilitySurprise",
  "invisibilityDisarm",
  "outperform",
  "intimidate",
  "hiveGranted",
  "incomingDamageReduction",
  "attackDamageVsLowerMugicCounters",
  "attackDamageIfAlliesHaveElement",
  "statCheckAutoSuccessForElement",
]);

function extractQuotedKindsFromSet(engineText, setName) {
  const matcher = new RegExp(`const ${setName} = new Set\\(\\[([\\s\\S]*?)\\]\\);`, "m");
  const match = matcher.exec(engineText);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => String(item[1] || "").trim()).filter(Boolean);
}

function collectSupportedKinds() {
  if (!fs.existsSync(ENGINE_FILE)) {
    return new Set();
  }
  const engineText = fs.readFileSync(ENGINE_FILE, "utf8");
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

function normalizeToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function classifyCreature(card, supportedKinds) {
  const ability = String(card?.ability || "").trim();
  const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  if (!ability) {
    return {
      status: "sem_habilidade",
      pendingReasons: [],
      pendingKinds: [],
      requiresTargetSpec: false,
      hasTargetSpec: false,
    };
  }
  if (!parsedEffects.length) {
    return {
      status: "pending",
      pendingReasons: ["sem_parse"],
      pendingKinds: [],
      requiresTargetSpec: /\btarget\b/i.test(ability),
      hasTargetSpec: false,
    };
  }
  const pendingKinds = [...new Set(parsedEffects
    .map((effect) => String(effect?.kind || "").trim())
    .filter((kind) => kind && !supportedKinds.has(kind) && !NATIVE_RUNTIME_KINDS.has(kind)))];
  const requiresTargetSpec = /\btarget\b/i.test(ability);
  const hasTargetSpec = parsedEffects.some((effect) => effect?.targetSpec && effect.targetSpec.type);

  const pendingReasons = [];
  if (pendingKinds.length) {
    pendingReasons.push("kind_pendente");
  }
  if (requiresTargetSpec && !hasTargetSpec) {
    pendingReasons.push("targetspec_insuficiente");
  }
  const hasActivatedCost = /\b(?:\d*\s*(?:\{\{MC\}\}|M(?:C)+)|Expend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines(?:\s+\d+)?))?|Discard\s+(?:a|an|one|\w+)\s+Mugic\s+Cards?)\s*:/i.test(ability);
  if (hasActivatedCost && !parsedEffects.length) {
    pendingReasons.push("cost_parse_pendente");
  }

  let status = "implemented_resolver";
  if (pendingReasons.length) {
    status = "parser_only";
  } else {
    const effectKinds = [...new Set(parsedEffects.map((effect) => String(effect?.kind || "").trim()).filter(Boolean))];
    const allNative = effectKinds.length > 0 && effectKinds.every((kind) => NATIVE_RUNTIME_KINDS.has(kind));
    if (allNative) {
      status = "implemented_runtime_native";
    }
  }
  return { status, pendingReasons, pendingKinds, requiresTargetSpec, hasTargetSpec };
}

function main() {
  const library = buildLibrary(ROOT_DIR);
  const supportedKinds = collectSupportedKinds();
  const creatures = (library.cards || []).filter((card) => String(card?.type || "") === "creatures");

  const rows = creatures.map((card) => {
    const ability = String(card?.ability || "").trim();
    const parsedEffects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
    const classification = classifyCreature(card, supportedKinds);
    return {
      id: card.id,
      name: card.name,
      ability,
      abilityKey: sanitizeAbilityText(ability),
      parsedEffectCount: parsedEffects.length,
      effectKinds: [...new Set(parsedEffects.map((effect) => effect.kind).filter(Boolean))],
      status: classification.status,
      pendingReasons: classification.pendingReasons,
      pendingKinds: classification.pendingKinds,
      requiresTargetSpec: classification.requiresTargetSpec,
      hasTargetSpec: classification.hasTargetSpec,
      hasActivatedCost: /\b(?:\d*\s*(?:\{\{MC\}\}|M(?:C)+)|Expend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines(?:\s+\d+)?))?|Discard\s+(?:a|an|one|\w+)\s+Mugic\s+Cards?)\s*:/i.test(ability),
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      creatures: rows.length,
      withAbility: rows.filter((row) => row.ability).length,
      semParse: rows.filter((row) => row.pendingReasons.includes("sem_parse")).length,
      kindPendente: rows.filter((row) => row.pendingReasons.includes("kind_pendente")).length,
      targetSpecInsuficiente: rows.filter((row) => row.pendingReasons.includes("targetspec_insuficiente")).length,
      costParsePendente: rows.filter((row) => row.pendingReasons.includes("cost_parse_pendente")).length,
    },
    byStatus: rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {}),
    topPendingKinds: Object.entries(rows.reduce((acc, row) => {
      row.pendingKinds.forEach((kind) => {
        acc[kind] = (acc[kind] || 0) + 1;
      });
      return acc;
    }, {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30),
  };

  const pendingLines = rows
    .filter((row) => row.pendingReasons.length > 0)
    .map((row) => {
      const reasons = row.pendingReasons.join(",");
      const kinds = row.pendingKinds.length ? row.pendingKinds.join("|") : "-";
      return `[BASE] ${reasons} | Tipo: creatures | Carta: ${row.name} | Kind: ${kinds} | Trecho: ${row.ability}`;
    });

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(rows, null, 2), "utf8");
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(
    PENDING_FILE,
    [
      "Chaotic - Efeitos Pendentes (Creatures)",
      `generatedAt=${summary.generatedAt}`,
      `total=${pendingLines.length}`,
      "---",
      ...pendingLines,
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(JSON.stringify({
    ok: true,
    report: REPORT_FILE,
    summary: SUMMARY_FILE,
    pending: PENDING_FILE,
    ...summary,
  }, null, 2));
}

main();
