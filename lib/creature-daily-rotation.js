/**
 * Serviço de Rotação Diária de Criaturas
 * Muda localização das criaturas à meia-noite
 */

const CreatureDropManager = require("./creature-drop-manager");
const {
  setCreatureDailyLocation,
  getCreatureDailyLocation,
  getCreatureDropSettings,
  setCreatureDropSettings,
  setLocationAdjacencies,
  getLocationAdjacencies,
} = require("./creature-drops-db");

class CreatureDailyRotationService {
  constructor(sqliteDb, locaisPath, criaturasPath) {
    this.sqliteDb = sqliteDb;
    this.manager = new CreatureDropManager(locaisPath, criaturasPath);
    this.initialized = false;
    this.lastRotationDate = null;
  }

  /**
   * Inicializa o serviço, carrega dados e setup
   */
  async initialize() {
    if (this.initialized) return;

    try {
      console.log("[CreatureDailyRotation] Inicializando serviço...");

      // Carregar dados dos Excels
      this.manager.loadData();

      // Carrega para banco de dados se ainda não foi
      await this.syncToDatabase();

      this.initialized = true;
      console.log("[CreatureDailyRotation] Serviço inicializado com sucesso");

      // Verifica e executa rotação se necessário
      this.checkAndRotate();

      // Agenda próxima rotação à meia-noite
      this.scheduleNextRotation();
    } catch (error) {
      console.error("[CreatureDailyRotation] Erro na inicialização:", error);
    }
  }

  /**
   * Sincroniza dados dos Excels para banco de dados
   */
  async syncToDatabase() {
    if (!this.sqliteDb) return;

    try {
      console.log("[CreatureDailyRotation] Sincronizando dados para banco...");

      // Sincronizar locais e adjacências
      this.manager.locations.forEach((loc) => {
        setLocationAdjacencies(this.sqliteDb, loc.name, loc.adjacents, loc.worldType, loc.raridadeNivel);
      });

      // Sincronizar configurações de raridade das criaturas
      this.manager.creatures.forEach((creature) => {
        const possibleLocs = this.manager.getPossibleLocations(creature);
        setCreatureDropSettings(this.sqliteDb, {
          loki: creature.loki,
          name: creature.name,
          rarity: creature.rarity,
          rarityPercent: possibleLocs.length > 0 ? this.getRarityPercent(creature.rarity) : 0,
          tribe: creature.tribe,
          types: creature.types,
          possibleLocations: possibleLocs,
          nearbyLocation: creature.nearbyLocation,
          onlyLocation1: creature.onlyLocation1,
          onlyLocation2: creature.onlyLocation2,
        });
      });

      console.log("[CreatureDailyRotation] Sincronização concluída");
    } catch (error) {
      console.error("[CreatureDailyRotation] Erro na sincronização:", error);
    }
  }

  /**
   * Obtém porcentagem de raridade
   */
  getRarityPercent(rarity) {
    const percentages = {
      Common: 0.6,
      Uncommon: 0.25,
      Rare: 0.1,
      "Super Rare": 0.04,
      "Ultra Rare": 0.01,
    };
    return percentages[rarity] || 0;
  }

  /**
   * Obtém data no formato YYYY-MM-DD
   */
  getTodayDate() {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }

  /**
   * Verifica se precisa rotacionar e faz isso
   */
  async checkAndRotate() {
    const today = this.getTodayDate();

    if (this.lastRotationDate === today) {
      return; // Já rotacionou hoje
    }

    console.log(`[CreatureDailyRotation] Executando rotação para ${today}`);
    await this.rotateAllCreatures(today);
    this.lastRotationDate = today;
  }

  /**
   * Rotaciona localização de todas as criaturas
   */
  async rotateAllCreatures(dateStr) {
    if (!this.sqliteDb) return;

    try {
      const date = new Date(dateStr);
      // Se é a primeira vez, distribui uniformemente
      const yesterday = new Date(date);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];

      for (const creature of this.manager.creatures) {
        const possibleLocs = this.manager.getPossibleLocations(creature);

        if (possibleLocs.length === 0) {
          continue; // Criatura sem local possível
        }

        let newLocation;

        // Se criatura tem "ENCONTRADO SOMENTE NESSE LOCAL", tem mais chance de estar lá
        if (creature.onlyLocation1 || creature.onlyLocation2) {
          // 70% chance de estar em um dos locais "solo"
          if (Math.random() < 0.7) {
            const soloLocs = possibleLocs.filter((loc) => loc.priority === "solo_only" || loc.priority === "solo_only_2");
            if (soloLocs.length > 0) {
              newLocation = this.manager.selectLocationWeighted(soloLocs);
            }
          }
        }

        // Se ainda não foi atribuído, seleciona normalmente
        if (!newLocation) {
          const previousLoc = getCreatureDailyLocation(this.sqliteDb, yesterdayStr, creature.loki);

          if (previousLoc) {
            // Se tinha localização anterior, rotaciona para adjacente
            const adjacents = this.manager.getAdjacentLocations(previousLoc, 1);
            if (adjacents.length > 0) {
              newLocation = adjacents[Math.floor(Math.random() * adjacents.length)];
            } else {
              newLocation = this.manager.selectLocationWeighted(possibleLocs);
            }
          } else {
            // Primeira vez, seleciona com ponderação
            newLocation = this.manager.selectLocationWeighted(possibleLocs);
          }
        }

        if (newLocation) {
          setCreatureDailyLocation(this.sqliteDb, dateStr, creature.loki, newLocation);
        }
      }

      console.log(`[CreatureDailyRotation] Rotação de ${this.manager.creatures.length} criaturas concluída`);
    } catch (error) {
      console.error("[CreatureDailyRotation] Erro na rotação:", error);
    }
  }

  /**
   * Agenda próxima rotação à meia-noite
   */
  scheduleNextRotation() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0); // Meia-noite

    const msUntilMidnight = tomorrow - now;

    console.log(`[CreatureDailyRotation] Próxima rotação em ${msUntilMidnight / 1000 / 60}min`);

    setTimeout(() => {
      this.checkAndRotate();
      this.scheduleNextRotation(); // Re-agenda para próximo dia
    }, msUntilMidnight);
  }

  /**
   * Obtém criaturas disponíveis em um local para hoje
   */
  getCreaturesAtLocation(locationName) {
    if (!this.sqliteDb) return [];

    try {
      const today = this.getTodayDate();
      const creatures = [];

      const rows = this.sqliteDb
        .prepare(
          `
        SELECT d.creature_loki, d.current_location, c.creature_name, c.types, c.rarity
        FROM creature_daily_locations d
        JOIN creature_rarity_settings c ON d.creature_loki = c.creature_loki
        WHERE d.location_date = ? AND d.current_location = ?
      `
        )
        .all(String(today), String(locationName));

      return rows || [];
    } catch (error) {
      console.error("[CreatureDailyRotation] Erro ao obter criaturas:", error);
      return [];
    }
  }

  /**
   * Obtém todas as criaturas disponíveis hoje para um tipo de mundo
   */
  getCreaturesForWorldType(worldType) {
    if (!this.sqliteDb) return [];

    try {
      const today = this.getTodayDate();
      const rows = this.sqliteDb
        .prepare(
          `
        SELECT DISTINCT d.creature_loki, c.creature_name, c.types, c.rarity
        FROM creature_daily_locations d
        JOIN creature_rarity_settings c ON d.creature_loki = c.creature_loki
        JOIN location_adjacencies l ON d.current_location = l.location_name
        WHERE d.location_date = ? AND l.world_type = ?
      `
        )
        .all(String(today), String(worldType));

      return rows || [];
    } catch (error) {
      console.error("[CreatureDailyRotation] Erro ao obter criaturas por tipo:", error);
      return [];
    }
  }
}

module.exports = CreatureDailyRotationService;
