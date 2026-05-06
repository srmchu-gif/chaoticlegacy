const fs = require("fs");
const path = require("path");
const { buildLibrary } = require("../lib/library");
const { sanitizeAbilityText } = require("../lib/effect-parser");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENGINE_FILE = path.join(ROOT_DIR, "public", "js", "battle", "engine.js");
const HABILIDADES_FILE = path.join(ROOT_DIR, "habilidades.json");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");
const REPORT_FILE = path.join(EXPORT_DIR, "habilidades_auditoria.json");
const SUMMARY_FILE = path.join(EXPORT_DIR, "habilidades_auditoria_resumo.json");

function normalizeAbilityKey(value) {
  return sanitizeAbilityText(String(value || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

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

function parseActivationCost(abilityText) {
  const text = String(abilityText || "").trim();
  const mcMatch = text.match(/^(?:([0-9]+)\s*)?(?:\{\{MC\}\}|(M(?:C)+))\s*:/i);
  if (mcMatch) {
    const explicitAmount = Number(mcMatch[1] || 0);
    const mcCount = mcMatch[2] ? (String(mcMatch[2]).match(/C/gi) || []).length : 1;
    const amount = mcMatch[1] ? explicitAmount : Math.max(1, mcCount);
    return { type: "mugic", amount };
  }
  const expendMatch = text.match(/^Expend\s+(Fire|Air|Earth|Water)\s*:/i);
  if (expendMatch) {
    return { type: "expendElement", element: String(expendMatch[1]).toLowerCase(), amount: 1 };
  }
  const expendAllMatch = text.match(/^Expend\s+all Disciplines(?:\s+(\d+))?\s*:/i);
  if (expendAllMatch) {
    return { type: "expendAllDisciplines", amount: Number(expendAllMatch[1] || 1) };
  }
  if (/^Discard\s+(?:a|one)\s+Mugic\s+Card\s*:/i.test(text)) {
    return { type: "discardMugic", amount: 1 };
  }
  if (/^Discard\s+\w+\s+Mugic\s+Cards?\s*:/i.test(text)) {
    return { type: "discardMugic", amount: null };
  }
  return null;
}

function inferActivationType(abilityText) {
  const text = String(abilityText || "");
  if (parseActivationCost(text)) {
    return "activated";
  }
  if (/\b(when|whenever|at the beginning|if .* would|after|before)\b/i.test(text)) {
    return "triggered";
  }
  return "passive_continuous";
}

function inferPriorityWindow(abilityText, activationType) {
  const text = String(abilityText || "").toLowerCase();
  if (activationType === "activated") {
    return "priority_window";
  }
  if (text.includes("at the beginning of combat")) {
    return "begin_combat";
  }
  if (text.includes("at the beginning of your turn") || text.includes("at the beginning of each turn")) {
    return "turn_start";
  }
  if (text.includes("when this becomes the active location") || text.includes("becomes the active location")) {
    return "location_step";
  }
  if (text.includes("attack") || text.includes("burst")) {
    return "attack_burst";
  }
  return activationType === "triggered" ? "triggered_window" : "passive_context";
}

function inferTargetSpecFallback(abilityText) {
  const text = String(abilityText || "").toLowerCase();
  if (!text.includes("target")) {
    return null;
  }
  if (text.includes("target attack")) return { type: "attack" };
  if (text.includes("target battlegear")) return { type: "battlegear" };
  if (text.includes("target mugic")) return { type: "mugic" };
  if (text.includes("target location")) return { type: "location" };
  return { type: "creature" };
}

function buildAbilityAuditReport() {
  const habilidades = readJson(HABILIDADES_FILE, []);
  const library = buildLibrary(ROOT_DIR);
  const supportedKinds = collectSupportedKinds();
  const cardsByAbility = new Map();

  library.cards.forEach((card) => {
    const ability = String(card?.ability || "").trim();
    if (!ability) return;
    const key = normalizeAbilityKey(ability);
    if (!cardsByAbility.has(key)) cardsByAbility.set(key, []);
    cardsByAbility.get(key).push(card);
  });

  const rows = habilidades.map((entry) => {
    const abilityText = String(entry?.ability || "").trim();
    const key = normalizeAbilityKey(abilityText);
    const cards = cardsByAbility.get(key) || [];
    const activationType = inferActivationType(abilityText);
    const activationCost = parseActivationCost(abilityText);
    const priorityWindow = inferPriorityWindow(abilityText, activationType);
    const parsedEffects = cards.flatMap((card) => Array.isArray(card.parsedEffects) ? card.parsedEffects : []);
    const pendingKinds = [...new Set(parsedEffects
      .map((effect) => String(effect?.kind || "").trim())
      .filter((kind) => kind && !supportedKinds.has(kind)))];
    const targetSpecs = parsedEffects
      .map((effect) => effect?.targetSpec || null)
      .filter((spec) => spec && spec.type);
    const targetFallback = inferTargetSpecFallback(abilityText);
    const targetSpec = targetSpecs[0] || targetFallback || null;
    const hasTargetWord = /(^|\W)target(\W|$)/i.test(abilityText);

    let implementationStatus = "implemented";
    if (!cards.length) {
      implementationStatus = "pending";
    } else if (!parsedEffects.length) {
      implementationStatus = "pending";
    } else if (pendingKinds.length) {
      implementationStatus = "parser_only";
    } else if (hasTargetWord && !targetSpec) {
      implementationStatus = "parser_only";
    }

    return {
      number: Number(entry?.number || 0),
      ability: abilityText,
      abilityKey: key,
      cardCount: cards.length,
      cardRefs: cards.slice(0, 20).map((card) => ({
        type: card.type,
        name: card.name,
      })),
      activationType,
      activationCost,
      priorityWindow,
      targetSpec,
      effectKinds: [...new Set(parsedEffects.map((effect) => effect.kind).filter(Boolean))],
      implementationStatus,
      pendingKinds,
      divergence: cards.some((card) => sanitizeAbilityText(card.ability) !== sanitizeAbilityText(abilityText)),
    };
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: {
      habilidadesJson: habilidades.length,
      withCardMatch: rows.filter((row) => row.cardCount > 0).length,
      withoutCardMatch: rows.filter((row) => row.cardCount === 0).length,
    },
    byStatus: rows.reduce((acc, row) => {
      acc[row.implementationStatus] = (acc[row.implementationStatus] || 0) + 1;
      return acc;
    }, {}),
    byActivationType: rows.reduce((acc, row) => {
      acc[row.activationType] = (acc[row.activationType] || 0) + 1;
      return acc;
    }, {}),
  };

  return { summary, rows };
}

function main() {
  const report = buildAbilityAuditReport();
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report.rows, null, 2), "utf8");
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(report.summary, null, 2), "utf8");
  console.log(JSON.stringify({
    ok: true,
    report: REPORT_FILE,
    summary: SUMMARY_FILE,
    ...report.summary,
  }, null, 2));
}

main();
