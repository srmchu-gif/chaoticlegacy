/**
 * Inicialização de tabelas SQLite para sistema de drops de criaturas
 */

function initializeCreatureDropTables(sqliteDb) {
  if (!sqliteDb) {
    console.warn("[CreatureDrops] SQLite não disponível, sistema de drops desabilitado");
    return;
  }

  try {
    // Tabela com adjacências dos locais
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS location_adjacencies (
        location_name TEXT NOT NULL PRIMARY KEY,
        adjacent_names TEXT NOT NULL,
        world_type TEXT NOT NULL,
        rarity_level INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Tabela com configurações de raridade das criaturas
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS creature_rarity_settings (
        creature_loki INTEGER NOT NULL PRIMARY KEY,
        creature_name TEXT NOT NULL,
        rarity TEXT NOT NULL,
        rarity_percent REAL NOT NULL,
        tribe TEXT,
        types TEXT,
        possible_locations TEXT NOT NULL,
        nearby_location TEXT,
        only_location_1 TEXT,
        only_location_2 TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    // Tabela com localização atual da criatura no dia
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS creature_daily_locations (
        location_date TEXT NOT NULL,
        creature_loki INTEGER NOT NULL,
        current_location TEXT NOT NULL,
        rotated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (location_date, creature_loki)
      );
    `);

    // Tabela para cache de criaturas disponíveis em um local (para performance)
    sqliteDb.exec(`
      CREATE TABLE IF NOT EXISTS location_available_creatures_cache (
        location_name TEXT NOT NULL,
        cache_date TEXT NOT NULL,
        creature_lokis TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (location_name, cache_date)
      );
    `);

    console.log("[CreatureDrops] Tabelas inicializadas com sucesso");
  } catch (error) {
    console.error("[CreatureDrops] Erro ao inicializar tabelas:", error);
  }
}

/**
 * Define localização de uma criatura para um dia específico
 */
function setCreatureDailyLocation(sqliteDb, locationDate, creatureLoki, location) {
  if (!sqliteDb) return false;

  try {
    sqliteDb
      .prepare(`
        INSERT INTO creature_daily_locations (location_date, creature_loki, current_location, rotated_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(location_date, creature_loki)
        DO UPDATE SET current_location = excluded.current_location, rotated_at = excluded.rotated_at
      `)
      .run(
        String(locationDate),
        Number(creatureLoki),
        String(location),
        new Date().toISOString(),
        new Date().toISOString()
      );
    return true;
  } catch (error) {
    console.error("[CreatureDrops] Erro ao salvar localização:", error);
    return false;
  }
}

/**
 * Obtém localização atual de uma criatura
 */
function getCreatureDailyLocation(sqliteDb, locationDate, creatureLoki) {
  if (!sqliteDb) return null;

  try {
    const row = sqliteDb
      .prepare(`
        SELECT current_location FROM creature_daily_locations 
        WHERE location_date = ? AND creature_loki = ?
      `)
      .get(String(locationDate), Number(creatureLoki));
    return row?.current_location || null;
  } catch (error) {
    console.error("[CreatureDrops] Erro ao obter localização:", error);
    return null;
  }
}

/**
 * Obtém todas as criaturas em um local para uma data
 */
function getCreaturesAtLocation(sqliteDb, locationDate, locationName) {
  if (!sqliteDb) return [];

  try {
    const rows = sqliteDb
      .prepare(`
        SELECT creature_loki, current_location FROM creature_daily_locations 
        WHERE location_date = ? AND current_location = ?
      `)
      .all(String(locationDate), String(locationName));
    return rows || [];
  } catch (error) {
    console.error("[CreatureDrops] Erro ao obter criaturas:", error);
    return [];
  }
}

/**
 * Obtém dados de raridade de uma criatura
 */
function getCreatureDropSettings(sqliteDb, creatureLoki) {
  if (!sqliteDb) return null;

  try {
    const row = sqliteDb
      .prepare(`
        SELECT * FROM creature_rarity_settings 
        WHERE creature_loki = ?
      `)
      .get(Number(creatureLoki));
    if (row && row.possible_locations) {
      row.possible_locations = JSON.parse(row.possible_locations);
    }
    return row || null;
  } catch (error) {
    console.error("[CreatureDrops] Erro ao obter configurações:", error);
    return null;
  }
}

/**
 * Insere/atualiza configurações de drop para uma criatura
 */
function setCreatureDropSettings(sqliteDb, creatureData) {
  if (!sqliteDb) return false;

  try {
    sqliteDb
      .prepare(`
        INSERT INTO creature_rarity_settings (
          creature_loki, creature_name, rarity, rarity_percent, tribe, types,
          possible_locations, nearby_location, only_location_1, only_location_2, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(creature_loki)
        DO UPDATE SET
          rarity = excluded.rarity,
          rarity_percent = excluded.rarity_percent,
          possible_locations = excluded.possible_locations,
          updated_at = excluded.updated_at
      `)
      .run(
        Number(creatureData.loki),
        String(creatureData.name || ""),
        String(creatureData.rarity || ""),
        Number(creatureData.rarityPercent || 0),
        String(creatureData.tribe || ""),
        String(creatureData.types || ""),
        JSON.stringify(creatureData.possibleLocations || []),
        String(creatureData.nearbyLocation || ""),
        String(creatureData.onlyLocation1 || ""),
        String(creatureData.onlyLocation2 || ""),
        new Date().toISOString(),
        new Date().toISOString()
      );
    return true;
  } catch (error) {
    console.error("[CreatureDrops] Erro ao salvar configurações:", error);
    return false;
  }
}

/**
 * Define adjacências de um local
 */
function setLocationAdjacencies(sqliteDb, locationName, adjacents, worldType, rarityLevel) {
  if (!sqliteDb) return false;

  try {
    sqliteDb
      .prepare(`
        INSERT INTO location_adjacencies (location_name, adjacent_names, world_type, rarity_level, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(location_name)
        DO UPDATE SET adjacent_names = excluded.adjacent_names, updated_at = excluded.updated_at
      `)
      .run(
        String(locationName),
        JSON.stringify(adjacents || []),
        String(worldType || ""),
        Number(rarityLevel || 0),
        new Date().toISOString(),
        new Date().toISOString()
      );
    return true;
  } catch (error) {
    console.error("[CreatureDrops] Erro ao salvar adjacências:", error);
    return false;
  }
}

/**
 * Obtém adjacências de um local
 */
function getLocationAdjacencies(sqliteDb, locationName) {
  if (!sqliteDb) return [];

  try {
    const row = sqliteDb
      .prepare(`
        SELECT adjacent_names FROM location_adjacencies 
        WHERE location_name = ?
      `)
      .get(String(locationName));
    if (row && row.adjacent_names) {
      return JSON.parse(row.adjacent_names);
    }
    return [];
  } catch (error) {
    console.error("[CreatureDrops] Erro ao obter adjacências:", error);
    return [];
  }
}

module.exports = {
  initializeCreatureDropTables,
  setCreatureDailyLocation,
  getCreatureDailyLocation,
  getCreaturesAtLocation,
  getCreatureDropSettings,
  setCreatureDropSettings,
  setLocationAdjacencies,
  getLocationAdjacencies,
};
