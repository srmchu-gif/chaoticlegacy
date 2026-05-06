/**
 * Módulo de Gerenciamento de Drops de Criaturas
 * Gerencia raridades, localizações e rotações diárias
 */

const XLSX = require("xlsx");
const path = require("path");

// Raridades e suas porcentagens de drop
const RARITY_PERCENTAGES = {
  Common: 0.6,
  Uncommon: 0.25,
  Rare: 0.1,
  "Super Rare": 0.04,
  "Ultra Rare": 0.01,
};

class CreatureDropManager {
  constructor(locaisPath, criaturasPath) {
    this.locaisPath = locaisPath;
    this.criaturasPath = criaturasPath;
    this.locations = [];
    this.creatures = [];
    this.locationMap = {}; // { locationName: locationData }
    this.creatureMap = {}; // { creatureLoki: creatureData }
    this.adjacencies = {}; // { locationName: [adjacent locations] }
  }

  /**
   * Carrega e processa os dados dos Excels
   */
  loadData() {
    console.log("[CreatureDropManager] Carregando dados dos Excels...");

    // Carregar locais
    const wbLocais = XLSX.readFile(this.locaisPath);
    const locaisSheet = XLSX.utils.sheet_to_json(wbLocais.Sheets[wbLocais.SheetNames[0]], {
      defval: "",
    });
    this.locations = locaisSheet.map((row) => ({
      name: row["Column1.name"] || "",
      type: row["Column1.type"] || "",
      set: row["Column1.set"] || "",
      rarity: row["rarity"] || "",
      id: row["Column1.id"] || "",
      raridadeNivel: Number(row["nivel de raridade"]) || 0,
      worldType: row["SOBRE OU EMBAIXO DA TERRA"] || "", // Overworld ou Underworld
      scanChance: Number(row["chance de scan"]) || 0,
      temComoDropar: row["TEM COMO DROPAR"] || "", // S/N
      adjacents: [],
    }));

    // Extrair adjacências
    this.locations.forEach((loc) => {
      const adjacents = [];
      for (let i = 1; i <= 11; i++) {
        const adjKey = `LIGADO A LOCAL ${i}`;
        const adjLocais = locaisSheet.find((row) => row["Column1.name"] === loc.name);
        const adjName = adjLocais[adjKey] || "";
        if (adjName && adjName.trim()) {
          adjacents.push(adjName.trim());
        }
      }
      loc.adjacents = adjacents;
      this.locationMap[loc.name] = loc;
    });

    // Carregar criaturas
    const wbCriaturas = XLSX.readFile(this.criaturasPath);
    const criaturasSheet = XLSX.utils.sheet_to_json(wbCriaturas.Sheets["Sheet1"] || wbCriaturas.Sheets[0], {
      defval: "",
    });

    this.creatures = criaturasSheet
      .filter((row) => row["Column1.type"] === "Creatures")
      .map((row) => {
        const nearbyLocation = row["ENCONTRADO PROXIMO A ESSE LOCAL"] || "";
        const onlyLocation1 = row["ENCONTRADO SOMENTE NESSE LOCAL"] || "";
        const onlyLocation2 = row["ENCONTRADO SOMENTE NESSE LOCAL 2"] || "";

        // Se a criatura tem "Overworld" ou "Underworld" em lugares específicos
        const isOverworld = nearbyLocation.includes("Overworld") || onlyLocation1.includes("Overworld");
        const isUnderworld = nearbyLocation.includes("Underworld") || onlyLocation1.includes("Underworld");

        return {
          name: row["Column1.name"] || "",
          type: row["Column1.type"] || "",
          set: row["Column1.set"] || "",
          rarity: row["Column1.rarity"] || "",
          id: row["Column1.id"] || "",
          tribe: row["Column1.tribe"] || "",
          types: row["Column1.types"] || "",
          loki: Number(row["Column1.loki"]) || 0,
          nearbyLocation: nearbyLocation.trim(),
          onlyLocation1: onlyLocation1.trim(),
          onlyLocation2: onlyLocation2.trim(),
          isOverworld,
          isUnderworld,
        };
      });

    this.creatures.forEach((creature) => {
      this.creatureMap[creature.loki] = creature;
    });

    console.log(
      `[CreatureDropManager] Carregados ${this.locations.length} locais e ${this.creatures.length} criaturas`
    );
  }

  /**
   * Obtém todas as adjacências para um local específico
   * @param {string} locationName - Nome do local
   * @param {number} depth - Profundidade de busca
   * @returns {string[]} Array de locais adjacentes
   */
  getAdjacentLocations(locationName, depth = 1) {
    const location = this.locationMap[locationName];
    if (!location) return [];

    if (depth === 1) {
      return location.adjacents.filter((adj) => this.locationMap[adj]);
    }

    // Busca recursiva para profundidades maiores
    let result = new Set(location.adjacents.filter((adj) => this.locationMap[adj]));
    let currentLevel = new Set(location.adjacents.filter((adj) => this.locationMap[adj]));

    for (let d = 1; d < depth; d++) {
      const nextLevel = new Set();
      currentLevel.forEach((adj) => {
        const adjLoc = this.locationMap[adj];
        if (adjLoc) {
          adjLoc.adjacents.forEach((next) => {
            if (!result.has(next) && this.locationMap[next]) {
              nextLevel.add(next);
              result.add(next);
            }
          });
        }
      });
      currentLevel = nextLevel;
    }

    return Array.from(result);
  }

  /**
   * Determina os possíveis locais de drop para uma criatura
   * @param {object} creature - Dados da criatura
   * @returns {string[]} Array de possíveis locais
   */
  getPossibleLocations(creature) {
    const locations = [];

    // Se tem "ENCONTRADO SOMENTE NESSE LOCAL" - alta prioridade
    if (creature.onlyLocation1) {
      const loc = this.locationMap[creature.onlyLocation1];
      if (loc) {
        locations.push({
          name: creature.onlyLocation1,
          priority: "solo_only",
          weight: 3, // Peso para sorteio (solo tem mais peso)
        });
      }
    }

    // Se tem "ENCONTRADO SOMENTE NESSE LOCAL 2"
    if (creature.onlyLocation2) {
      const loc = this.locationMap[creature.onlyLocation2];
      if (loc) {
        locations.push({
          name: creature.onlyLocation2,
          priority: "solo_only_2",
          weight: 3,
        });
      }
    }

    // "ENCONTRADO PROXIMO A ESSE LOCAL" - pode ser o local ou adjacentes
    if (creature.nearbyLocation) {
      const nearbyLoc = this.locationMap[creature.nearbyLocation];
      if (nearbyLoc) {
        // Inclui o próprio local
        locations.push({
          name: creature.nearbyLocation,
          priority: "nearby",
          weight: 2,
        });

        // Inclui locais adjacentes
        const adjacents = this.getAdjacentLocations(creature.nearbyLocation, 2);
        adjacents.forEach((adjName) => {
          locations.push({
            name: adjName,
            priority: "nearby_adjacent",
            weight: 1,
          });
        });
      }
    }

    // Filtro por Overworld/Underworld se aplicável
    if (creature.isOverworld || creature.isUnderworld) {
      return locations.filter((loc) => {
        const locData = this.locationMap[loc.name];
        if (creature.isOverworld && locData.worldType === "Overworld") return true;
        if (creature.isUnderworld && locData.worldType === "Underworld") return true;
        return false;
      });
    }

    return locations;
  }

  /**
   * Escolhe um local aleatório com ponderação
   * @param {array} locations - Array de locais com weights
   * @returns {string} Nome do local escolhido
   */
  selectLocationWeighted(locations) {
    if (!locations.length) return null;

    // Cria array ponderado
    const weighted = [];
    locations.forEach((loc) => {
      for (let i = 0; i < loc.weight; i++) {
        weighted.push(loc.name);
      }
    });

    if (!weighted.length) return null;
    return weighted[Math.floor(Math.random() * weighted.length)];
  }

  /**
   * Rotaciona a localização de uma criatura para um local adjacente
   * @param {string} currentLocation - Local atual
   * @returns {string} Novo local
   */
  rotateToAdjacentLocation(currentLocation) {
    const adjacents = this.getAdjacentLocations(currentLocation, 1);
    if (!adjacents.length) return currentLocation;
    return adjacents[Math.floor(Math.random() * adjacents.length)];
  }

  /**
   * Exporta configuração de drops para banco de dados
   * @returns {object} Dados formatados para inserção em banco
   */
  exportForDatabase() {
    const locationData = this.locations.map((loc) => ({
      name: loc.name,
      worldType: loc.worldType, // Overworld/Underworld
      set: loc.set,
      rarity: loc.rarity,
      raridadeNivel: loc.raridadeNivel,
      adjacents: JSON.stringify(loc.adjacents),
    }));

    const creatureDropData = this.creatures.map((creature) => {
      const possibleLocs = this.getPossibleLocations(creature);
      const rarityPercent = RARITY_PERCENTAGES[creature.rarity] || 0;

      return {
        loki: creature.loki,
        name: creature.name,
        rarity: creature.rarity,
        rarityPercent,
        tribe: creature.tribe,
        types: creature.types,
        possibleLocations: JSON.stringify(possibleLocs),
        nearbyLocation: creature.nearbyLocation,
        onlyLocation1: creature.onlyLocation1,
        onlyLocation2: creature.onlyLocation2,
      };
    });

    return {
      locations: locationData,
      creatures: creatureDropData,
    };
  }
}

module.exports = CreatureDropManager;
