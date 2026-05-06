const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { buildLibrary } = require("../lib/library");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENGINE_PATH = path.join(ROOT_DIR, "public", "js", "battle", "engine.js");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "exports", "chaotic-effects-configurados.xlsx");

const SHEET_BY_TYPE = {
  creatures: "Creatures",
  attacks: "Attacks",
  battlegear: "Battlegear",
  locations: "Locations",
  mugic: "Mugic",
};

const ATTACK_FORMULA_KINDS = new Set([
  "conditionalDamage",
  "dealDamage",
  "attackDamageSetIfDefenderHasElement",
  "attackDamageCap",
]);

function parseArgs(argv) {
  const args = { out: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--out" && argv[i + 1]) {
      args.out = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      args.out = path.resolve(token.slice("--out=".length));
    }
  }
  return args;
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
    /\b(?:M(?:C)+|Expend(?:\s+(?:Fire|Air|Earth|Water|all Disciplines(?:\s+\d+)?))?|Discard\s+(?:a|one)\s+Mugic\s+Card|Discard\s+\w+\s+Mugic\s+Cards?)\s*:/gi;
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

function parseSetDefinitions(source) {
  const setMap = new Map();
  const setRegex = /const\s+([A-Z0-9_]+)\s*=\s*new Set\(\[(.*?)\]\);/gs;
  let match = setRegex.exec(source);
  while (match) {
    const setName = String(match[1] || "").trim();
    const body = String(match[2] || "");
    const strings = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const spreads = [...body.matchAll(/\.\.\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    setMap.set(setName, { strings, spreads });
    match = setRegex.exec(source);
  }
  return setMap;
}

function resolveSetEntries(setMap, setName, stack = new Set()) {
  if (!setMap.has(setName) || stack.has(setName)) {
    return new Set();
  }
  stack.add(setName);
  const payload = setMap.get(setName);
  const output = new Set(payload.strings);
  payload.spreads.forEach((spread) => {
    resolveSetEntries(setMap, spread, stack).forEach((entry) => output.add(entry));
  });
  stack.delete(setName);
  return output;
}

function loadConfiguredKinds() {
  const source = fs.readFileSync(ENGINE_PATH, "utf8");
  const setMap = parseSetDefinitions(source);
  const configuredSetNames = [
    "CORE_EFFECT_KINDS",
    "ATTACK_EFFECT_KINDS_SUPPORTED",
    "ACTIVATABLE_EFFECT_KINDS",
    "PASSIVE_EFFECT_KINDS",
    "BATTLEGEAR_PHASE_EFFECT_KINDS",
  ];
  const configuredKinds = new Set();
  configuredSetNames.forEach((name) => {
    resolveSetEntries(setMap, name).forEach((kind) => configuredKinds.add(kind));
  });
  const activatableKinds = resolveSetEntries(setMap, "ACTIVATABLE_EFFECT_KINDS");
  return { configuredKinds, activatableKinds };
}

function isTriggered(effect, sourceText) {
  const timing = String(effect?.timing || "").toLowerCase();
  if (timing && timing !== "burst" && timing !== "runtime") {
    return true;
  }
  const source = String(sourceText || "").toLowerCase();
  return (
    source.startsWith("at the beginning of")
    || source.startsWith("when ")
    || source.startsWith("if ")
    || source.includes(" becomes engaged")
    || source.includes(" wins combat")
  );
}

function inferActivationType(effect, card, activationBodies, activatableKinds) {
  const sourceText = String(effect?.sourceText || "");
  const normalizedSource = normalizeRuleText(sourceText);
  const fromCostBody = Boolean(
    normalizedSource && activationBodies.some((body) => body.includes(normalizedSource) || normalizedSource.includes(body))
  );
  if (fromCostBody || activatableKinds.has(effect.kind)) {
    return "Ativo";
  }
  if (isTriggered(effect, sourceText)) {
    return "Gatilho";
  }
  return "Passivo";
}

function inferActivationWhere(effect, cardType, activationType) {
  const timing = String(effect?.timing || "").toLowerCase();
  const kind = String(effect?.kind || "");
  if (activationType === "Ativo") {
    return "priority_window.activated";
  }
  if (timing === "begin_turn") {
    return "location_step.turn_start_burst";
  }
  if (timing === "begin_combat" || kind.startsWith("beginCombat") || kind === "firstAttackZeroIfLower") {
    return "combat_sequence.start";
  }
  if (cardType === "attacks") {
    return "combat_sequence.attack_burst";
  }
  return "combat_sequence.passive_resolution";
}

function inferPriorityModel(effect, activationType) {
  if (ATTACK_FORMULA_KINDS.has(effect.kind)) {
    return "Immediate Formula";
  }
  if (activationType === "Passivo") {
    return "Passive Continuous";
  }
  return "Burst LIFO";
}

function buildPlaceholderRow(card, status) {
  return {
    card_id: card.id,
    card_name: card.name,
    card_type: card.type,
    tribe: card.tribe || "",
    set: card.set || "",
    rarity: card.rarity || "",
    ability_text: card.ability || "",
    effect_index: "",
    effect_kind: "",
    effect_source_text: "",
    activation_type: "",
    activation_where: "",
    priority_model: "",
    status_configuracao: status,
    target: "",
    timing: "",
    scope: "",
    amount: "",
    raw_effect_json: "",
  };
}

function buildEffectRow(card, effect, index, status, activationType, activationWhere, priorityModel) {
  return {
    card_id: card.id,
    card_name: card.name,
    card_type: card.type,
    tribe: card.tribe || "",
    set: card.set || "",
    rarity: card.rarity || "",
    ability_text: card.ability || "",
    effect_index: index + 1,
    effect_kind: effect.kind || "",
    effect_source_text: effect.sourceText || "",
    activation_type: activationType,
    activation_where: activationWhere,
    priority_model: priorityModel,
    status_configuracao: status,
    target: effect.target ?? "",
    timing: effect.timing ?? "",
    scope: effect.scope ?? "",
    amount: Number.isFinite(Number(effect.amount)) ? Number(effect.amount) : "",
    raw_effect_json: JSON.stringify(effect),
  };
}

function createSummaryRows(stats) {
  const rows = [];
  rows.push({ secao: "Meta", chave: "generated_at", valor: new Date().toISOString() });
  rows.push({ secao: "Meta", chave: "arquivo_saida", valor: stats.outputPath });
  rows.push({ secao: "Totais", chave: "cards_total", valor: stats.cardsTotal });
  rows.push({ secao: "Totais", chave: "linhas_total", valor: stats.rowsTotal });

  Object.entries(stats.byType).forEach(([type, value]) => {
    rows.push({ secao: "Por Tipo", chave: type, valor: value });
  });
  Object.entries(stats.byStatus).forEach(([status, value]) => {
    rows.push({ secao: "Por Status", chave: status, valor: value });
  });
  Object.entries(stats.byActivationType).forEach(([kind, value]) => {
    rows.push({ secao: "Por Ativacao", chave: kind || "(vazio)", valor: value });
  });
  Object.entries(stats.byEffectKind).forEach(([kind, value]) => {
    rows.push({ secao: "Por Effect Kind", chave: kind || "(vazio)", valor: value });
  });
  return rows;
}

function increment(mapObj, key, amount = 1) {
  const safeKey = String(key || "");
  mapObj[safeKey] = Number(mapObj[safeKey] || 0) + amount;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = args.out;
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const library = buildLibrary(ROOT_DIR);
  const { configuredKinds, activatableKinds } = loadConfiguredKinds();
  const workbook = XLSX.utils.book_new();
  const stats = {
    outputPath: outPath,
    cardsTotal: library.cards.length,
    rowsTotal: 0,
    byType: {},
    byStatus: {},
    byActivationType: {},
    byEffectKind: {},
  };

  Object.entries(SHEET_BY_TYPE).forEach(([type, sheetName]) => {
    const rows = [];
    const cards = (library.cardsByType[type] || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    cards.forEach((card) => {
      const ability = String(card.ability || "").trim();
      if (!ability) {
        rows.push(buildPlaceholderRow(card, "sem_habilidade"));
        increment(stats.byStatus, "sem_habilidade");
        increment(stats.byType, type);
        return;
      }
      const effects = Array.isArray(card.parsedEffects) ? card.parsedEffects : [];
      if (!effects.length) {
        rows.push(buildPlaceholderRow(card, "sem_parse"));
        increment(stats.byStatus, "sem_parse");
        increment(stats.byType, type);
        return;
      }

      const activationBodies = extractActivationBodies(card.ability);
      effects.forEach((effect, index) => {
        const status = configuredKinds.has(effect.kind) ? "configurado" : "pendente";
        const activationType = inferActivationType(effect, card, activationBodies, activatableKinds);
        const activationWhere = inferActivationWhere(effect, type, activationType);
        const priorityModel = inferPriorityModel(effect, activationType);
        rows.push(buildEffectRow(card, effect, index, status, activationType, activationWhere, priorityModel));
        increment(stats.byStatus, status);
        increment(stats.byActivationType, activationType);
        increment(stats.byEffectKind, effect.kind || "");
      });
      increment(stats.byType, type);
    });

    stats.rowsTotal += rows.length;
    const sheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  });

  const summaryRows = createSummaryRows(stats);
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumo");

  XLSX.writeFile(workbook, outPath);
  console.log(`XLSX gerado com sucesso: ${outPath}`);
}

main();
