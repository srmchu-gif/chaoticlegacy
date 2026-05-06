const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseAbilityEffects, sanitizeAbilityText, ELEMENT_KEYS } = require("./effect-parser");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "downloads",
  "public",
  "decks",
  "tests",
  "exports",
  "debug-logs",
  "scripts",
  "music",
  "lixo",
]);
const TYPE_MAP = {
  creatures: "creatures",
  creature: "creatures",
  attacks: "attacks",
  attack: "attacks",
  battlegear: "battlegear",
  "battle gear": "battlegear",
  locations: "locations",
  location: "locations",
  mugic: "mugic",
};
const CREATURE_TYPE_SEPARATOR_REGEX = /\s*(?:,|;|\/|\||&|\band\b|\bor\b)\s*/i;
const CARD_CATALOG_STORAGE = "sql_catalog_v1";
const CARD_JSON_FILENAMES = Object.freeze([
  "chaotic_attacks.json",
  "chaotic_battlegear.json",
  "chaotic_creatures.json",
  "chaotic_locations.json",
  "chaotic_mugic.json",
]);

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeName(value).replace(/\s+/g, "-");
}

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeType(value) {
  const key = normalizeName(value);
  return TYPE_MAP[key] || null;
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

function creatureNameStem(value) {
  const text = String(value || "")
    .replace(/\([^)]*\)/g, " ")
    .split(",")[0];
  return normalizeName(text);
}

function splitCreatureTypeSource(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
  }
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(CREATURE_TYPE_SEPARATOR_REGEX)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function dedupeCreatureTypes(list) {
  const seen = new Set();
  const output = [];
  list.forEach((entry) => {
    const clean = String(entry || "").trim();
    const key = normalizeCreatureTypeKey(clean);
    if (!clean || !key || seen.has(key)) {
      return;
    }
    seen.add(key);
    output.push(clean);
  });
  return output;
}

function appendInferenceTypes(map, key, types) {
  if (!key || !types.length) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  const bucket = map.get(key);
  types.forEach((typeName) => bucket.add(typeName));
}

function buildCreatureTypeInference(rows) {
  const byName = new Map();
  const byStem = new Map();

  (rows || []).forEach((row) => {
    if (!row || typeof row !== "object") {
      return;
    }
    const explicitTypes = dedupeCreatureTypes(splitCreatureTypeSource(row.types));
    if (!explicitTypes.length) {
      return;
    }
    appendInferenceTypes(byName, normalizeName(row.name || ""), explicitTypes);
    appendInferenceTypes(byStem, creatureNameStem(row.name || ""), explicitTypes);
  });

  return { byName, byStem };
}

function selectInferredCreatureTypes(card, creatureTypeInference) {
  if (!creatureTypeInference) {
    return [];
  }
  const nameKey = normalizeName(card?.name || "");
  const stemKey = creatureNameStem(card?.name || "");
  const fromName = creatureTypeInference.byName.get(nameKey);
  if (fromName && fromName.size) {
    return [...fromName];
  }
  const fromStem = creatureTypeInference.byStem.get(stemKey);
  if (fromStem && fromStem.size) {
    return [...fromStem];
  }
  return [];
}

function buildCreatureTypeMetadata(card, creatureTypeInference, inferenceLogs) {
  const explicitTypes = dedupeCreatureTypes(splitCreatureTypeSource(card?.types));
  let source = "explicit";
  let creatureTypes = explicitTypes;
  if (!creatureTypes.length) {
    const inferredFromName = selectInferredCreatureTypes(card, creatureTypeInference);
    if (inferredFromName.length) {
      creatureTypes = inferredFromName;
      source = "name_inference";
    }
  }
  if (!creatureTypes.length) {
    const tribeFallback = String(card?.tribe || "Generic").trim() || "Generic";
    creatureTypes = [tribeFallback];
    source = "tribe_fallback";
  }

  const keywords = new Set();
  creatureTypes.forEach((typeName) => {
    const key = normalizeCreatureTypeKey(typeName);
    if (!key) {
      return;
    }
    keywords.add(key);
    key.split(/\s+/).filter(Boolean).forEach((part) => keywords.add(part));
  });

  if (source !== "explicit" && Array.isArray(inferenceLogs)) {
    inferenceLogs.push({
      cardName: String(card?.name || "").trim(),
      source,
      creatureTypes: [...creatureTypes],
    });
  }

  return {
    creatureTypesRaw: creatureTypes.join(" | "),
    creatureTypes,
    creatureTypeKeywords: [...keywords],
    creatureTypesInferred: source !== "explicit",
    creatureTypesSource: source,
  };
}

function inferTypeFromFilename(filePath) {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (base.includes("creature")) {
    return "creatures";
  }
  if (base.includes("attack")) {
    return "attacks";
  }
  if (base.includes("battle")) {
    return "battlegear";
  }
  if (base.includes("location")) {
    return "locations";
  }
  if (base.includes("mugic")) {
    return "mugic";
  }
  return null;
}

function walkJsonFiles(rootDir) {
  const results = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
          stack.push(fullPath);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!entry.name.toLowerCase().endsWith(".json")) {
        continue;
      }
      if (entry.name.toLowerCase() === "package-lock.json" || entry.name.toLowerCase() === "package.json") {
        continue;
      }
      results.push(fullPath);
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function walkFiles(dirPath) {
  const output = [];
  if (!fs.existsSync(dirPath)) {
    return output;
  }
  const stack = [dirPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        output.push(fullPath);
      }
    }
  }
  return output;
}

function toDownloadUrl(rootDir, absoluteFilePath) {
  const relative = path.relative(rootDir, absoluteFilePath);
  const safe = relative.split(path.sep).map((segment) => encodeURIComponent(segment)).join("/");
  return `/${safe}`;
}

function buildImageIndex(rootDir) {
  const downloadsDir = path.join(rootDir, "downloads");
  const filePaths = walkFiles(downloadsDir);
  const imageIndex = new Map();

  for (const fullPath of filePaths) {
    const extension = path.extname(fullPath).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
      continue;
    }

    const fileName = path.basename(fullPath, extension).trim();
    const variantMatch = fileName.match(/^(.*?)(?:\s*-\s*(ic|if|ia))?$/i);
    if (!variantMatch) {
      continue;
    }

    const baseName = String(variantMatch[1] || "").trim();
    const variant = String(variantMatch[2] || "ic").toLowerCase();
    const key = normalizeName(baseName);
    if (!key) {
      continue;
    }

    if (!imageIndex.has(key)) {
      imageIndex.set(key, { ic: null, if: null, ia: null, fallback: [] });
    }
    const entry = imageIndex.get(key);
    const webPath = toDownloadUrl(rootDir, fullPath);
    if (variant === "ic" || variant === "if" || variant === "ia") {
      if (!entry[variant]) {
        entry[variant] = webPath;
      }
    }
    entry.fallback.push(webPath);
  }

  return imageIndex;
}

function getLocalImageVariants(cardName, imageIndex) {
  const key = normalizeName(cardName);
  const found = imageIndex.get(key);
  if (!found) {
    return { ic: null, if: null, ia: null, primary: null };
  }
  return {
    ic: found.ic || null,
    if: found.if || null,
    ia: found.ia || null,
    primary: found.ic || found.if || found.ia || found.fallback[0] || null,
  };
}

function extractElements(card) {
  const raw = String(card.elements || "").toLowerCase();
  const detected = ELEMENT_KEYS.filter((element) => raw.includes(element));
  const flags = {};
  for (const element of ELEMENT_KEYS) {
    flags[element] = detected.includes(element) ? 1 : 0;
  }
  return flags;
}

function createCardRecord(card, type, imageVariants, filePath, indexInFile, options = {}) {
  const name = String(card.name || "").trim();
  const set = String(card.set || "Unknown").trim();
  const rarity = String(card.rarity || "Unknown").trim();
  const ability = sanitizeAbilityText(card.ability || "");
  const idSeed = card.loki || card.id || `${set}-${name}-${indexInFile}`;
  const cardId = `${type}:${slugify(set)}:${slugify(name)}:${slugify(String(idSeed))}`;
  const baseStats = {
    courage: toNumber(card.courage, 0),
    power: toNumber(card.power, 0),
    wisdom: toNumber(card.wisdom, 0),
    speed: toNumber(card.speed, 0),
    energy: toNumber(card.energy, 0),
    mugicability: toNumber(card.mugicability, 0),
    bp: toNumber(card.bp, 0),
    base: toNumber(card.base, 0),
    cost: toNumber(card.cost, 0),
    initiative: String(card.initiative || "").trim(),
    ...extractElements(card),
    fireAttack: toNumber(card.fire, 0),
    airAttack: toNumber(card.air, 0),
    earthAttack: toNumber(card.earth, 0),
    waterAttack: toNumber(card.water, 0),
  };

  const creatureTypeMeta =
    type === "creatures"
      ? buildCreatureTypeMetadata(card, options.creatureTypeInference, options.typeInferenceLogs)
      : {
          creatureTypesRaw: "",
          creatureTypes: [],
          creatureTypeKeywords: [],
          creatureTypesInferred: false,
          creatureTypesSource: "not_applicable",
        };

  return {
    id: cardId,
    name,
    normalizedName: normalizeName(name),
    type,
    set,
    rarity,
    tribe: String(card.tribe || "Generic").trim(),
    idInSet: String(card.id || "").trim(),
    unique: Boolean(card.unique),
    loyal: Boolean(card.loyal),
    legendary: Boolean(card.legendary),
    ability,
    flavorText: String(card.flavortext || "").trim(),
    stats: baseStats,
    parsedEffects: parseAbilityEffects(ability),
    image: imageVariants.primary || card.ic || null,
    imageVariants: {
      ic: imageVariants.ic || null,
      if: imageVariants.if || null,
      ia: imageVariants.ia || null,
    },
    sourceFile: path.basename(filePath),
    creatureTypesRaw: creatureTypeMeta.creatureTypesRaw,
    creatureTypes: creatureTypeMeta.creatureTypes,
    creatureTypeKeywords: creatureTypeMeta.creatureTypeKeywords,
    creatureTypesInferred: creatureTypeMeta.creatureTypesInferred,
    creatureTypesSource: creatureTypeMeta.creatureTypesSource,
    raw: card,
  };
}

function buildCardDedupKey(card, type) {
  const setKey = normalizeName(card?.set || "");
  const nameKey = normalizeName(card?.name || "");
  const idKey = normalizeName(card?.id || card?.loki || "");
  const fallbackStats = card?.stats && typeof card.stats === "object" ? JSON.stringify(card.stats) : "";
  const abilityKey = normalizeName(card?.ability || "");
  if (idKey) {
    return `${type}|${setKey}|${nameKey}|${idKey}`;
  }
  return `${type}|${setKey}|${nameKey}|${abilityKey}|${fallbackStats}`;
}

function parseJsonFile(filePath) {
  const rawText = fs.readFileSync(filePath, "utf8");
  return JSON.parse(rawText);
}

function readAbilityGlossary(rootDir, warnings = []) {
  const candidates = [
    path.join(rootDir, "habilidades.json"),
    path.join(rootDir, "LIXO", "habilidades.json"),
  ];
  let selected = "";
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      selected = candidate;
      break;
    }
  }
  if (!selected) {
    return [];
  }
  try {
    const parsed = parseJsonFile(selected);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const output = [];
    parsed.forEach((row) => {
      if (!row || typeof row !== "object") {
        return;
      }
      output.push({
        number: toNumber(row.number, 0),
        ability: sanitizeAbilityText(row.ability || ""),
        parsedEffects: parseAbilityEffects(row.ability || ""),
      });
    });
    output.sort((a, b) => a.number - b.number);
    return output;
  } catch (error) {
    warnings.push(`Arquivo JSON invalido: habilidades.json (${error.message})`);
    return [];
  }
}

function resolveCardSourceFile(rootDir, fileName) {
  const direct = path.join(rootDir, fileName);
  if (fs.existsSync(direct)) {
    return direct;
  }
  const lixo = path.join(rootDir, "LIXO", fileName);
  if (fs.existsSync(lixo)) {
    return lixo;
  }
  return "";
}

function buildCardsFromCanonicalJson(rootDir, warnings = []) {
  const imageIndex = buildImageIndex(rootDir);
  const cardsByType = {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
  const typeInferenceLogs = [];
  const dedupeSeen = new Set();

  CARD_JSON_FILENAMES.forEach((fileName) => {
    const filePath = resolveCardSourceFile(rootDir, fileName);
    if (!filePath) {
      warnings.push(`Arquivo ausente: ${fileName}`);
      return;
    }
    let parsed;
    try {
      parsed = parseJsonFile(filePath);
    } catch (error) {
      warnings.push(`Arquivo JSON invalido: ${fileName} (${error.message})`);
      return;
    }
    if (!Array.isArray(parsed)) {
      return;
    }
    const fileType = inferTypeFromFilename(filePath);
    const creatureTypeInference = fileType === "creatures" ? buildCreatureTypeInference(parsed) : null;
    parsed.forEach((row, indexInFile) => {
      if (!row || typeof row !== "object") {
        return;
      }
      const type = normalizeType(row.type) || fileType;
      if (!type || !cardsByType[type]) {
        return;
      }
      const dedupeKey = buildCardDedupKey(row, type);
      if (dedupeSeen.has(dedupeKey)) {
        return;
      }
      dedupeSeen.add(dedupeKey);
      const imageVariants = getLocalImageVariants(row.name, imageIndex);
      const card = createCardRecord(row, type, imageVariants, filePath, indexInFile, {
        creatureTypeInference: type === "creatures" ? creatureTypeInference : null,
        typeInferenceLogs,
      });
      cardsByType[type].push(card);
    });
  });

  for (const type of Object.keys(cardsByType)) {
    cardsByType[type].sort((a, b) => a.name.localeCompare(b.name));
  }
  const cards = Object.values(cardsByType).flat();
  return { cardsByType, cards, typeInferenceLogs };
}

function buildCatalogSourceFingerprint(rootDir) {
  const hash = crypto.createHash("sha256");
  const sourceFiles = [];
  CARD_JSON_FILENAMES.forEach((fileName) => {
    const resolved = resolveCardSourceFile(rootDir, fileName);
    if (!resolved) {
      return;
    }
    const buffer = fs.readFileSync(resolved);
    const stat = fs.statSync(resolved);
    hash.update(fileName);
    hash.update(String(stat.size));
    hash.update(String(stat.mtimeMs));
    hash.update(buffer);
    sourceFiles.push({
      fileName,
      path: resolved,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
  });
  return {
    hash: hash.digest("hex"),
    sourceFiles,
  };
}

function createCatalogTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_catalog (
      id TEXT NOT NULL PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      set_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      tribe TEXT NOT NULL,
      ability TEXT NOT NULL,
      flavor_text TEXT NOT NULL,
      id_in_set TEXT NOT NULL,
      unique_flag INTEGER NOT NULL DEFAULT 0,
      loyal_flag INTEGER NOT NULL DEFAULT 0,
      legendary_flag INTEGER NOT NULL DEFAULT 0,
      image TEXT,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_payloads (
      id TEXT NOT NULL PRIMARY KEY,
      stats_json TEXT NOT NULL,
      parsed_effects_json TEXT NOT NULL,
      creature_types_raw TEXT NOT NULL DEFAULT '',
      creature_types_json TEXT NOT NULL,
      creature_type_keywords_json TEXT NOT NULL,
      creature_types_inferred INTEGER NOT NULL DEFAULT 0,
      creature_types_source TEXT NOT NULL DEFAULT 'not_applicable',
      image_variants_json TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_import_meta (
      id INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
      source_hash TEXT NOT NULL,
      source_files_json TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      total_cards INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT ''
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_card_catalog_type_set_rarity ON card_catalog(type, set_name, rarity);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_card_catalog_normalized_name ON card_catalog(normalized_name);");
}

function hasCatalogRows(db) {
  const row = db.prepare("SELECT COUNT(*) AS total FROM card_catalog").get();
  return Number(row?.total || 0) > 0;
}

function importCatalogToSql(db, rootDir, options = {}) {
  createCatalogTables(db);
  const warnings = [];
  const fingerprint = buildCatalogSourceFingerprint(rootDir);
  const metaRow = db.prepare("SELECT source_hash AS sourceHash FROM card_import_meta WHERE id = 1").get();
  const hasRows = hasCatalogRows(db);
  const forceImport = Boolean(options.forceImport);
  if (!forceImport && hasRows && metaRow && String(metaRow.sourceHash || "") === fingerprint.hash) {
    return {
      imported: false,
      sourceHash: fingerprint.hash,
      sourceFiles: fingerprint.sourceFiles,
      warnings,
    };
  }

  const { cards } = buildCardsFromCanonicalJson(rootDir, warnings);
  if (!cards.length) {
    throw new Error("Nao foi possivel importar o catalogo de cartas: nenhuma carta encontrada nas 5 fontes JSON.");
  }
  const importedAt = new Date().toISOString();

  const insertCard = db.prepare(`
    INSERT INTO card_catalog (
      id, type, name, normalized_name, set_name, rarity, tribe, ability, flavor_text, id_in_set,
      unique_flag, loyal_flag, legendary_flag, image, source_file, raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPayload = db.prepare(`
    INSERT INTO card_payloads (
      id, stats_json, parsed_effects_json, creature_types_raw, creature_types_json,
      creature_type_keywords_json, creature_types_inferred, creature_types_source, image_variants_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const upsertMeta = db.prepare(`
    INSERT INTO card_import_meta (id, source_hash, source_files_json, imported_at, total_cards, notes)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_hash = excluded.source_hash,
      source_files_json = excluded.source_files_json,
      imported_at = excluded.imported_at,
      total_cards = excluded.total_cards,
      notes = excluded.notes
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM card_payloads;");
    db.exec("DELETE FROM card_catalog;");
    cards.forEach((card) => {
      insertCard.run(
        card.id,
        card.type,
        card.name,
        card.normalizedName,
        card.set,
        card.rarity,
        card.tribe,
        card.ability,
        card.flavorText,
        card.idInSet,
        card.unique ? 1 : 0,
        card.loyal ? 1 : 0,
        card.legendary ? 1 : 0,
        card.image || null,
        card.sourceFile,
        JSON.stringify(card.raw || {})
      );
      insertPayload.run(
        card.id,
        JSON.stringify(card.stats || {}),
        JSON.stringify(card.parsedEffects || []),
        String(card.creatureTypesRaw || ""),
        JSON.stringify(card.creatureTypes || []),
        JSON.stringify(card.creatureTypeKeywords || []),
        card.creatureTypesInferred ? 1 : 0,
        String(card.creatureTypesSource || "not_applicable"),
        JSON.stringify(card.imageVariants || { ic: null, if: null, ia: null })
      );
    });
    upsertMeta.run(
      fingerprint.hash,
      JSON.stringify(fingerprint.sourceFiles || []),
      importedAt,
      cards.length,
      "sql_catalog_v1"
    );
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw error;
  }

  return {
    imported: true,
    sourceHash: fingerprint.hash,
    sourceFiles: fingerprint.sourceFiles,
    warnings,
  };
}

function parseJsonText(text, fallback) {
  try {
    return JSON.parse(String(text || ""));
  } catch {
    return fallback;
  }
}

function buildLibraryFromSql(db, rootDir) {
  createCatalogTables(db);
  const warnings = [];
  const abilityGlossary = readAbilityGlossary(rootDir, warnings);
  const cardsByType = {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
  const rows = db.prepare(`
    SELECT
      c.id, c.type, c.name, c.normalized_name, c.set_name, c.rarity, c.tribe, c.ability,
      c.flavor_text, c.id_in_set, c.unique_flag, c.loyal_flag, c.legendary_flag, c.image,
      c.source_file, c.raw_json,
      p.stats_json, p.parsed_effects_json, p.creature_types_raw, p.creature_types_json,
      p.creature_type_keywords_json, p.creature_types_inferred, p.creature_types_source, p.image_variants_json
    FROM card_catalog c
    JOIN card_payloads p ON p.id = c.id
    ORDER BY c.type ASC, c.name ASC
  `).all();

  rows.forEach((row) => {
    const type = String(row?.type || "");
    if (!cardsByType[type]) {
      return;
    }
    const card = {
      id: String(row.id || ""),
      name: String(row.name || ""),
      normalizedName: String(row.normalized_name || ""),
      type,
      set: String(row.set_name || "Unknown"),
      rarity: String(row.rarity || "Unknown"),
      tribe: String(row.tribe || "Generic"),
      idInSet: String(row.id_in_set || ""),
      unique: Number(row.unique_flag || 0) === 1,
      loyal: Number(row.loyal_flag || 0) === 1,
      legendary: Number(row.legendary_flag || 0) === 1,
      ability: String(row.ability || ""),
      flavorText: String(row.flavor_text || ""),
      stats: parseJsonText(row.stats_json, {}),
      parsedEffects: parseJsonText(row.parsed_effects_json, []),
      image: row.image ? String(row.image) : null,
      imageVariants: parseJsonText(row.image_variants_json, { ic: null, if: null, ia: null }),
      sourceFile: String(row.source_file || ""),
      creatureTypesRaw: String(row.creature_types_raw || ""),
      creatureTypes: parseJsonText(row.creature_types_json, []),
      creatureTypeKeywords: parseJsonText(row.creature_type_keywords_json, []),
      creatureTypesInferred: Number(row.creature_types_inferred || 0) === 1,
      creatureTypesSource: String(row.creature_types_source || "not_applicable"),
      raw: parseJsonText(row.raw_json, {}),
    };
    cardsByType[type].push(card);
  });

  const cards = Object.values(cardsByType).flat();
  const inferredCreatureTypes = cards.filter((card) => Boolean(card.creatureTypesInferred)).length;
  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    cardsByType,
    cards,
    abilityGlossary,
    stats: {
      creatures: cardsByType.creatures.length,
      attacks: cardsByType.attacks.length,
      battlegear: cardsByType.battlegear.length,
      locations: cardsByType.locations.length,
      mugic: cardsByType.mugic.length,
      totalCards: cards.length,
      glossaryEntries: abilityGlossary.length,
      inferredCreatureTypes,
    },
    warnings,
    typeInferenceLogs: [],
    storage: CARD_CATALOG_STORAGE,
  };
}

function buildLibraryFromJson(rootDir) {
  const warnings = [];
  const abilityGlossary = readAbilityGlossary(rootDir, warnings);
  const { cardsByType, cards, typeInferenceLogs } = buildCardsFromCanonicalJson(rootDir, warnings);
  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    cardsByType,
    cards,
    abilityGlossary,
    stats: {
      creatures: cardsByType.creatures.length,
      attacks: cardsByType.attacks.length,
      battlegear: cardsByType.battlegear.length,
      locations: cardsByType.locations.length,
      mugic: cardsByType.mugic.length,
      totalCards: cards.length,
      glossaryEntries: abilityGlossary.length,
      inferredCreatureTypes: typeInferenceLogs.length,
    },
    warnings,
    typeInferenceLogs,
    storage: "json_files",
  };
}

function ensureCardCatalog(db, rootDir, options = {}) {
  if (!db) {
    return {
      ok: false,
      storage: "json_files",
      imported: false,
      warnings: [],
    };
  }
  const result = importCatalogToSql(db, rootDir, options);
  return {
    ok: true,
    storage: CARD_CATALOG_STORAGE,
    imported: Boolean(result.imported),
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    sourceHash: result.sourceHash,
  };
}

function buildLibrary(rootDir, options = {}) {
  const db = options.db || null;
  const preferSql = options.preferSql !== false;
  if (db && preferSql) {
    try {
      ensureCardCatalog(db, rootDir, { forceImport: Boolean(options.forceImport) });
      return buildLibraryFromSql(db, rootDir);
    } catch (error) {
      const fallback = buildLibraryFromJson(rootDir);
      fallback.warnings.push(`SQL catalog indisponivel, fallback JSON: ${error.message}`);
      return fallback;
    }
  }
  return buildLibraryFromJson(rootDir);
}

module.exports = {
  normalizeName,
  buildLibrary,
  ensureCardCatalog,
  CARD_CATALOG_STORAGE,
  CARD_JSON_FILENAMES,
};
