const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { buildLibrary, normalizeName } = require("../lib/library");

const ROOT_DIR = path.resolve(__dirname, "..");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");
const OUT_JSON = path.join(EXPORT_DIR, "effects_reconcile_xlsx_dop_zoth_ss.json");
const OUT_TXT = path.join(EXPORT_DIR, "effects_reconcile_xlsx_dop_zoth_ss.txt");
const TARGET_SETS = new Set(["DOP", "ZOTH", "SS"]);
const DEFAULT_XLSX = "C:/Users/samue/Downloads/cartas.xlsx";

function readWorkbookRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const ws = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
}

function parsePrefixedValue(raw, prefix) {
  const text = String(raw || "").trim();
  const match = text.match(new RegExp(`^${prefix}\\s*=\\s*(.*)$`, "i"));
  return (match ? match[1] : text).trim();
}

function normalizeType(raw) {
  const text = String(raw || "").toLowerCase();
  if (text.includes("creature")) return "creatures";
  if (text.includes("attack")) return "attacks";
  if (text.includes("battle")) return "battlegear";
  if (text.includes("location")) return "locations";
  if (text.includes("mugic")) return "mugic";
  return "unknown";
}

function parseExpectedKinds(funcionamento) {
  const text = String(funcionamento || "");
  const match = text.match(/gerando:\s*([^.]*)/i);
  if (!match) {
    return [];
  }
  return String(match[1] || "")
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function hasTimingCoverage(card) {
  const text = String(card?.ability || "").toLowerCase();
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const hasSourcePrefix = (prefix) =>
    effects.some((effect) => String(effect?.sourceText || "").toLowerCase().includes(prefix));
  const hasTiming = (value) => effects.some((effect) => String(effect?.timing || "").toLowerCase() === value);
  if (text.includes("at the beginning of combat")) {
    return hasTiming("begin_combat") || hasSourcePrefix("at the beginning of combat");
  }
  if (text.includes("at the beginning of your turn") || text.includes("at the beginning of each turn")) {
    if (text.includes("if you do, each player removes a total of") && text.includes("mugic counters")) {
      return true;
    }
    return hasTiming("begin_turn") || hasSourcePrefix("at the beginning of your turn") || hasSourcePrefix("at the beginning of each turn");
  }
  if (text.includes("when this becomes the active location") || text.includes("whenever this becomes the active location")) {
    return hasTiming("location_step") || hasSourcePrefix("becomes the active location");
  }
  return true;
}

function hasTargetCoverage(card) {
  const text = String(card?.ability || "").toLowerCase();
  if (!/\btarget\b/.test(text)) {
    return true;
  }
  const effects = Array.isArray(card?.parsedEffects) ? card.parsedEffects : [];
  const hasTargetSpec = effects.some((effect) => {
    const spec = effect?.targetSpec || null;
    return spec && spec.type;
  });
  const hasTargetField = effects.some((effect) => {
    const target = String(effect?.target || "").toLowerCase();
    return Boolean(target && target !== "none");
  });
  const hasTargetSourceText = effects.some((effect) =>
    /\btarget\b/.test(String(effect?.sourceText || "").toLowerCase())
  );
  return hasTargetSpec || hasTargetField || hasTargetSourceText;
}

function main() {
  const xlsxPath = process.env.CARDS_XLSX_PATH || DEFAULT_XLSX;
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Arquivo XLSX não encontrado: ${xlsxPath}`);
  }

  const rows = readWorkbookRows(xlsxPath);
  const header = rows[0] || [];
  const idxCarta = header.findIndex((col) => String(col).toLowerCase().includes("carta="));
  const idxTipo = header.findIndex((col) => String(col).toLowerCase().includes("tipo="));
  const idxSet = header.findIndex((col) => String(col).toLowerCase().includes("set="));
  const idxEfeito = header.findIndex((col) => String(col).toLowerCase().includes("efeitooficial="));
  const idxFuncionamento = header.findIndex((col) => String(col).toLowerCase().includes("funcionamento="));
  const idxTrigger = header.findIndex((col) => String(col).toLowerCase().includes("triggerexato="));
  const idxAlvos = header.findIndex((col) => String(col).toLowerCase().includes("alvos="));

  const xlsxCards = [];
  rows.slice(1).forEach((row) => {
    const set = parsePrefixedValue(row[idxSet], "set").toUpperCase();
    if (!TARGET_SETS.has(set)) {
      return;
    }
    const name = parsePrefixedValue(row[idxCarta], "carta");
    const type = normalizeType(parsePrefixedValue(row[idxTipo], "tipo"));
    xlsxCards.push({
      set,
      type,
      name,
      nameNorm: normalizeName(name),
      efeitoOficial: parsePrefixedValue(row[idxEfeito], "efeitooficial"),
      funcionamento: parsePrefixedValue(row[idxFuncionamento], "funcionamento"),
      triggerExato: parsePrefixedValue(row[idxTrigger], "triggerexato"),
      alvos: parsePrefixedValue(row[idxAlvos], "alvos"),
      expectedKinds: parseExpectedKinds(parsePrefixedValue(row[idxFuncionamento], "funcionamento")),
    });
  });

  const library = buildLibrary(ROOT_DIR);
  const runtimeCards = (library.cards || []).filter((card) => TARGET_SETS.has(String(card?.set || "").toUpperCase()));

  const runtimeByKey = new Map();
  runtimeCards.forEach((card) => {
    const key = `${String(card.set || "").toUpperCase()}|${card.type}|${normalizeName(card.name || "")}`;
    if (!runtimeByKey.has(key)) runtimeByKey.set(key, []);
    runtimeByKey.get(key).push(card);
  });

  const matchedRuntimeKeys = new Set();
  const reconciliation = [];
  const unmatchedXlsx = [];

  xlsxCards.forEach((row) => {
    const key = `${row.set}|${row.type}|${row.nameNorm}`;
    const candidates = runtimeByKey.get(key) || [];
    if (!candidates.length) {
      unmatchedXlsx.push(row);
      return;
    }
    matchedRuntimeKeys.add(key);
    const runtime = candidates[0];
    const ability = String(runtime?.ability || "").trim();
    const noTextFromXlsx = /sem texto de habilidade/i.test(String(row.efeitoOficial || ""));
    const noTextBase = noTextFromXlsx || !ability;
    const runtimeKinds = [...new Set((runtime.parsedEffects || []).map((effect) => String(effect?.kind || "").trim()).filter(Boolean))];
    const missingExpectedKinds = row.expectedKinds.filter((kind) => !runtimeKinds.includes(kind));

    let status = "ok";
    if (noTextBase) {
      status = "no_text_base";
    } else if (!runtimeKinds.length || missingExpectedKinds.length > 0) {
      status = "resolver_gap";
    } else if (!hasTimingCoverage(runtime)) {
      status = "timing_gap";
    } else if (!hasTargetCoverage(runtime)) {
      status = "target_gap";
    }

    reconciliation.push({
      set: row.set,
      type: row.type,
      name: row.name,
      status,
      triggerExato: row.triggerExato,
      alvos: row.alvos,
      expectedKinds: row.expectedKinds,
      runtimeKinds,
      missingExpectedKinds,
      runtimeAbility: ability,
      ambiguousCandidates: candidates.length,
    });
  });

  const unmatchedRuntime = runtimeCards
    .filter((card) => {
      const key = `${String(card.set || "").toUpperCase()}|${card.type}|${normalizeName(card.name || "")}`;
      return !matchedRuntimeKeys.has(key);
    })
    .map((card) => ({
      set: String(card.set || "").toUpperCase(),
      type: card.type,
      name: card.name,
    }));

  const byStatus = reconciliation.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  const bySet = [...TARGET_SETS].reduce((acc, setCode) => {
    const rowsForSet = reconciliation.filter((row) => row.set === setCode);
    acc[setCode] = rowsForSet.reduce((bucket, row) => {
      bucket[row.status] = (bucket[row.status] || 0) + 1;
      return bucket;
    }, {});
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    source: {
      xlsxPath,
      sheet: "Planilha1",
      scope: ["DOP", "ZOTH", "SS"],
    },
    totals: {
      xlsxRowsInScope: xlsxCards.length,
      runtimeCardsInScope: runtimeCards.length,
      matched: reconciliation.length,
      unmatchedXlsx: unmatchedXlsx.length,
      unmatchedRuntime: unmatchedRuntime.length,
    },
    byStatus,
    bySet,
    unmatchedXlsx,
    unmatchedRuntime,
    reconciliation,
  };

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    "Reconciliacao XLSX x Runtime (DOP/ZOTH/SS)",
    `Gerado em: ${report.generatedAt}`,
    `XLSX: ${xlsxPath}`,
    "",
    `Linhas XLSX (escopo): ${report.totals.xlsxRowsInScope}`,
    `Cartas runtime (escopo): ${report.totals.runtimeCardsInScope}`,
    `Match: ${report.totals.matched}`,
    `Sem match no runtime: ${report.totals.unmatchedXlsx}`,
    `Sem match no XLSX: ${report.totals.unmatchedRuntime}`,
    "",
    "Status:",
    ...Object.entries(byStatus).map(([status, total]) => `- ${status}: ${total}`),
    "",
    "Gaps:",
    ...reconciliation
      .filter((row) => row.status !== "ok" && row.status !== "no_text_base")
      .map((row) => `- [${row.set}] ${row.type} ${row.name}: ${row.status} | faltantes=${row.missingExpectedKinds.join(", ") || "nenhum"}`),
  ];
  fs.writeFileSync(OUT_TXT, `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    json: OUT_JSON,
    txt: OUT_TXT,
    totals: report.totals,
    byStatus: report.byStatus,
  }, null, 2));
}

main();

