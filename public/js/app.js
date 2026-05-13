import { getAliveSlots } from "./battle/board-state.js";
import { explodeIntoCode } from "./matrix.js";
import { clearSessionToken, toPage } from "./runtime-config.js";
import {
  PHASE_LABEL,
  advanceBattle,
  chooseAttack,
  chooseMugic,
  chooseActivatedAbility,
  chooseEffectTarget,
  chooseEffectChoice,
  chooseDefenderRedirect,
  declareMove,
  confirmEndPostCombatMove,
  clearBattleListeners,
  createBattleState,
  endActionWithoutCombat,
  getLegalMoves,
  getEffectiveUnitSnapshot,
  isHumanTurn,
  onBattleEvent,
  phaseHelpText,
} from "./battle/engine.js";

const CARD_TYPES = ["creatures", "attacks", "battlegear", "locations", "mugic"];
const TYPE_LABEL = {
  all: "Todas",
  creatures: "Creature",
  attacks: "Attack",
  battlegear: "Battle Gear",
  locations: "Location",
  mugic: "Mugic",
};
const STATUS_PREVIEW_LABELS = {
  strike: "Strike",
  recklessness: "Recklessness",
  swift: "Swift",
  surprise: "Surprise",
  invisibility: "Invisibility",
  defender: "Defender",
  range: "Range",
  untargetable: "Untargetable",
  fluidmorph: "Fluidmorph",
  disarm: "Disarm",
};
const SETTINGS_STORAGE_KEY = "chaotic.settings.v1";
const SETTINGS_SCHEMA_VERSION = 1;
const DEBUG_FLUSH_INTERVAL_MS = 4000;
const PRESENCE_HEARTBEAT_VISIBLE_MS = 25000;
const PRESENCE_HEARTBEAT_HIDDEN_MS = 90000;
const KEYBIND_ACTIONS = [
  "confirmAction",
  "confirmAttack",
  "autoStep",
  "switchBuilder",
  "switchBattle",
  "switchSettings",
  "cancel",
];
const DEFAULT_SETTINGS = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  updatedAt: null,
  screen: {
    fullscreenAuto: true,
    resolution: "high",
  },
  audio: {
    enabled: true,
    master: 85,
    sfx: 80,
    music: 70,
  },
  language: {
    cards: "pt",
    ui: "pt",
  },
  gameplay: {
    animations: true,
    hints: true,
  },
  menuHomePanels: {
    globalChatEnabled: true,
    top50Enabled: true,
  },
  controls: {
    mouseSensitivity: 100,
    keybinds: {
      confirmAction: "Enter",
      confirmAttack: "Space",
      autoStep: "KeyN",
      switchBuilder: "Digit1",
      switchBattle: "Digit2",
      switchSettings: "Digit3",
      cancel: "Escape",
    },
  },
  extras: {
    theme: "dark",
    fpsCounter: false,
    debugMode: false,
  },
  musicPlayer: {
    enabled: true,
    loopTrack: false,
    lastTrackIndex: 0,
    volume: 100,
  },
};
const UI_LANGUAGE_LABELS = {
  pt: {
    tabBuilder: "Deck Builder",
    tabBattle: "Battlefield",
    tabSettings: "Configuracoes",
    mobileViewerToggle: "Visualizacao",
    libraryTitle: "Scans",
    libraryViewLibrary: "Biblioteca",
    libraryViewScans: "Scans",
    scansSummaryPrefix: "Scans disponiveis",
    deckTitle: "Deck",
    clearFilters: "Limpar Filtros",
    cardSearchPlaceholder: "Buscar carta...",
    setFilterTitle: "Sets (multiselecao)",
    starsFilterAll: "Todas as estrelas",
    starsFilterTitle: "Estrelas (criaturas)",
    sortFieldName: "Ordenar: Nome",
    sortFieldSet: "Ordenar: Set",
    sortFieldRarity: "Ordenar: Raridade",
    sortFieldType: "Ordenar: Tipo",
    sortFieldStars: "Ordenar: Estrelas",
    sortDirectionAsc: "Crescente",
    sortDirectionDesc: "Decrescente",
    noCardsInventoryFiltered: "Sem cartas disponiveis no inventario para estes filtros.",
    noCardsFound: "Nenhuma carta encontrada.",
    markFlagsPrompt: "Marque Alpha, Promo, Unused ou Outras para exibir cartas.",
    showingLimited: "Mostrando {limit} de {total} cartas. Refine os filtros.",
    deckLimitAlert: "Limite de {limit} para {type} atingido.",
    scansOutOfStock: "Sem copias disponiveis no inventario de scans.",
    scansReserveFail: "Nao foi possivel reservar esta carta no inventario de scans.",
    reload: "Recarregar Pasta",
    settingsTitle: "Configuracoes",
    settingsSave: "Salvar Configuracoes",
    settingsScreenTitle: "Tela",
    settingsAudioTitle: "Audio",
    settingsLanguageTitle: "Idioma",
    settingsGameplayTitle: "Jogabilidade",
    settingsProgressTitle: "Conta / Progresso",
    settingsControlsTitle: "Controles",
    settingsExtrasTitle: "Extras",
    resetProgress: "Resetar progresso",
  },
  en: {
    tabBuilder: "Deck Builder",
    tabBattle: "Battlefield",
    tabSettings: "Settings",
    mobileViewerToggle: "Viewer",
    libraryTitle: "Scans",
    libraryViewLibrary: "Library",
    libraryViewScans: "Scans",
    scansSummaryPrefix: "Available scans",
    deckTitle: "Deck",
    clearFilters: "Clear Filters",
    cardSearchPlaceholder: "Search card...",
    setFilterTitle: "Sets (multi-select)",
    starsFilterAll: "All stars",
    starsFilterTitle: "Stars (creatures)",
    sortFieldName: "Sort: Name",
    sortFieldSet: "Sort: Set",
    sortFieldRarity: "Sort: Rarity",
    sortFieldType: "Sort: Type",
    sortFieldStars: "Sort: Stars",
    sortDirectionAsc: "Ascending",
    sortDirectionDesc: "Descending",
    noCardsInventoryFiltered: "No inventory cards available for these filters.",
    noCardsFound: "No cards found.",
    markFlagsPrompt: "Enable Alpha, Promo, Unused or Other to display cards.",
    showingLimited: "Showing {limit} of {total} cards. Refine filters.",
    deckLimitAlert: "{type} limit of {limit} reached.",
    scansOutOfStock: "No copies available in scan inventory.",
    scansReserveFail: "Could not reserve this card from scan inventory.",
    reload: "Reload Folder",
    settingsTitle: "Settings",
    settingsSave: "Save Settings",
    settingsScreenTitle: "Display",
    settingsAudioTitle: "Audio",
    settingsLanguageTitle: "Language",
    settingsGameplayTitle: "Gameplay",
    settingsProgressTitle: "Account / Progress",
    settingsControlsTitle: "Controls",
    settingsExtrasTitle: "Extras",
    resetProgress: "Reset Progress",
  },
  es: {
    tabBuilder: "Deck Builder",
    tabBattle: "Battlefield",
    tabSettings: "Configuracion",
    mobileViewerToggle: "Vista",
    libraryTitle: "Scans",
    libraryViewLibrary: "Biblioteca",
    libraryViewScans: "Scans",
    scansSummaryPrefix: "Scans disponibles",
    deckTitle: "Mazo",
    clearFilters: "Limpiar Filtros",
    cardSearchPlaceholder: "Buscar carta...",
    setFilterTitle: "Sets (multiseleccion)",
    starsFilterAll: "Todas las estrellas",
    starsFilterTitle: "Estrellas (criaturas)",
    sortFieldName: "Ordenar: Nombre",
    sortFieldSet: "Ordenar: Set",
    sortFieldRarity: "Ordenar: Rareza",
    sortFieldType: "Ordenar: Tipo",
    sortFieldStars: "Ordenar: Estrellas",
    sortDirectionAsc: "Ascendente",
    sortDirectionDesc: "Descendente",
    noCardsInventoryFiltered: "No hay cartas disponibles en inventario para estos filtros.",
    noCardsFound: "No se encontraron cartas.",
    markFlagsPrompt: "Marca Alpha, Promo, Unused u Otras para mostrar cartas.",
    showingLimited: "Mostrando {limit} de {total} cartas. Ajusta los filtros.",
    deckLimitAlert: "Limite de {limit} para {type} alcanzado.",
    scansOutOfStock: "No hay copias disponibles en el inventario de scans.",
    scansReserveFail: "No fue posible reservar esta carta del inventario de scans.",
    reload: "Recargar Carpeta",
    settingsTitle: "Configuracion",
    settingsSave: "Guardar Configuracion",
    settingsScreenTitle: "Pantalla",
    settingsAudioTitle: "Audio",
    settingsLanguageTitle: "Idioma",
    settingsGameplayTitle: "Jugabilidad",
    settingsProgressTitle: "Cuenta / Progreso",
    settingsControlsTitle: "Controles",
    settingsExtrasTitle: "Extras",
    resetProgress: "Reiniciar Progreso",
  },
};

const DECK_RULESETS = {
  casual: {
    label: "Casual",
    exactCounts: null,
    maxCopies: null,
  },
  competitive: {
    label: "Competitivo",
    exactCounts: {
      creatures: 6,
      battlegear: 6,
      mugic: 6,
      locations: 10,
      attacks: 20,
    },
    maxCopiesByRarity: {
      common: 3,
      uncommon: 3,
      rare: 2,
      "super rare": 2,
      "ultra rare": 1,
    },
    maxCopiesDefault: 2,
  },
  "1v1": {
    label: "1v1",
    exactCounts: {
      creatures: 1,
      battlegear: 1,
      mugic: 1,
      locations: 1,
      attacks: 20,
    },
    maxCopiesByRarity: {
      common: 3,
      uncommon: 3,
      rare: 2,
      "super rare": 2,
      "ultra rare": 1,
    },
    maxCopiesDefault: 2,
  },
};

const DECK_MAX_COUNTS = {
  creatures: 6,
  battlegear: 6,
  mugic: 6,
  attacks: 20,
  locations: 10,
};

const DECK_STAGE_POSITIONS = [
  { x: 18, y: 50, z: 4 }, // 1
  { x: 46, y: 25, z: 4 }, // 2 (topo)
  { x: 46, y: 75, z: 3 }, // 2 (baixo)
  { x: 73, y: 0, z: 4 }, // 3 (topo)
  { x: 73, y: 50, z: 3 }, // 3 (meio)
  { x: 73, y: 100, z: 2 }, // 3 (baixo)
];
const DECK_STAGE_POSITIONS_1V1 = [{ x: 46, y: 50, z: 6 }];
const SLOT_LAYOUT = {
  // Fixed battlefield slots aligned to the reference layout.bmp
  // Slot order: 1, 2-top, 2-bottom, 3-top, 3-middle, 3-bottom
  bottom: [
    { x: 30, y: 51, z: 4 },
    { x: 38, y: 31, z: 5 },
    { x: 38, y: 71, z: 4 },
    { x: 46, y: 15, z: 6 },
    { x: 46, y: 51, z: 5 },
    { x: 46, y: 87, z: 4 },
  ],
  top: [
    { x: 70, y: 51, z: 4 },
    { x: 62, y: 31, z: 5 },
    { x: 62, y: 71, z: 4 },
    { x: 54, y: 15, z: 6 },
    { x: 54, y: 51, z: 5 },
    { x: 54, y: 87, z: 4 },
  ],
};
const BOARD_ADJACENCY = {
  A: ["B", "C"],
  B: ["A", "C", "D", "E"],
  C: ["A", "B", "E", "F"],
  D: ["B", "E", "G", "H"],
  E: ["B", "C", "D", "F", "G", "H", "I"],
  F: ["C", "E", "H", "I"],
  G: ["D", "E", "H", "J"],
  H: ["D", "E", "F", "G", "I", "J", "K"],
  I: ["E", "F", "H", "K"],
  J: ["G", "H", "K", "L"],
  K: ["H", "I", "J", "L"],
  L: ["J", "K"],
};
const PLAYER_SLOT_LETTERS = {
  0: ["A", "B", "C", "D", "E", "F"],
  1: ["L", "J", "K", "G", "H", "I"],
};
const ONE_VS_ONE_VISIBLE_LETTERS = {
  0: ["E"],
  1: ["H"],
};
const LETTER_TO_PLAYER_SLOT = {
  0: Object.fromEntries(PLAYER_SLOT_LETTERS[0].map((letter, slot) => [letter, slot])),
  1: Object.fromEntries(PLAYER_SLOT_LETTERS[1].map((letter, slot) => [letter, slot])),
};
const DECK_SLOT_STACK_HEIGHT = 188;

function cloneDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function normalizeResolution(value) {
  return ["low", "medium", "high"].includes(value) ? value : DEFAULT_SETTINGS.screen.resolution;
}

function normalizeLanguage(value) {
  return ["pt", "en", "es"].includes(value) ? value : "pt";
}

function uiDictionary() {
  return UI_LANGUAGE_LABELS[normalizeLanguage(appState?.settings?.language?.ui)] || UI_LANGUAGE_LABELS.pt;
}

function uiText(key, vars = null) {
  const dictionary = uiDictionary();
  let text = String(dictionary?.[key] ?? UI_LANGUAGE_LABELS.pt?.[key] ?? key);
  if (vars && typeof vars === "object") {
    Object.entries(vars).forEach(([name, value]) => {
      text = text.replaceAll(`{${name}}`, String(value ?? ""));
    });
  }
  return text;
}

function normalizeTheme(value) {
  return ["dark", "light"].includes(value) ? value : DEFAULT_SETTINGS.extras.theme;
}

function normalizeKeyCode(value, fallback) {
  const text = String(value || "").trim();
  if (!text) {
    return fallback;
  }
  return text;
}

function sanitizeSettings(rawSettings) {
  const settings = cloneDefaultSettings();
  const source = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  settings.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : null;

  settings.screen.fullscreenAuto = coerceBoolean(source.screen?.fullscreenAuto, settings.screen.fullscreenAuto);
  settings.screen.resolution = normalizeResolution(source.screen?.resolution);

  settings.audio.enabled = coerceBoolean(source.audio?.enabled, settings.audio.enabled);
  settings.audio.master = clampNumber(source.audio?.master, 0, 100, settings.audio.master);
  settings.audio.sfx = clampNumber(source.audio?.sfx, 0, 100, settings.audio.sfx);
  settings.audio.music = clampNumber(source.audio?.music, 0, 100, settings.audio.music);

  settings.language.cards = normalizeLanguage(source.language?.cards);
  settings.language.ui = normalizeLanguage(source.language?.ui);

  settings.gameplay.animations = coerceBoolean(source.gameplay?.animations, settings.gameplay.animations);
  settings.gameplay.hints = coerceBoolean(source.gameplay?.hints, settings.gameplay.hints);
  settings.menuHomePanels.globalChatEnabled = coerceBoolean(
    source.menuHomePanels?.globalChatEnabled,
    settings.menuHomePanels.globalChatEnabled
  );
  settings.menuHomePanels.top50Enabled = coerceBoolean(
    source.menuHomePanels?.top50Enabled,
    settings.menuHomePanels.top50Enabled
  );

  settings.controls.mouseSensitivity = clampNumber(
    source.controls?.mouseSensitivity,
    1,
    200,
    settings.controls.mouseSensitivity
  );
  KEYBIND_ACTIONS.forEach((action) => {
    settings.controls.keybinds[action] = normalizeKeyCode(
      source.controls?.keybinds?.[action],
      settings.controls.keybinds[action]
    );
  });

  settings.extras.theme = normalizeTheme(source.extras?.theme);
  settings.extras.fpsCounter = coerceBoolean(source.extras?.fpsCounter, settings.extras.fpsCounter);
  settings.extras.debugMode = coerceBoolean(source.extras?.debugMode, settings.extras.debugMode);
  settings.musicPlayer.enabled = coerceBoolean(source.musicPlayer?.enabled, settings.musicPlayer.enabled);
  settings.musicPlayer.loopTrack = coerceBoolean(source.musicPlayer?.loopTrack, settings.musicPlayer.loopTrack);
  settings.musicPlayer.lastTrackIndex = clampNumber(
    source.musicPlayer?.lastTrackIndex,
    0,
    9999,
    settings.musicPlayer.lastTrackIndex
  );
  settings.musicPlayer.volume = clampNumber(source.musicPlayer?.volume, 0, 100, settings.musicPlayer.volume);
  return settings;
}

function keyCodeLabel(code) {
  const map = {
    Space: "Space",
    Escape: "Esc",
    Enter: "Enter",
    Backspace: "Backspace",
    Tab: "Tab",
    Delete: "Delete",
    ArrowUp: "Arrow Up",
    ArrowDown: "Arrow Down",
    ArrowLeft: "Arrow Left",
    ArrowRight: "Arrow Right",
  };
  if (map[code]) {
    return map[code];
  }
  const digitMatch = /^Digit(\d)$/.exec(code);
  if (digitMatch) {
    return digitMatch[1];
  }
  const keyMatch = /^Key([A-Z])$/.exec(code);
  if (keyMatch) {
    return keyMatch[1];
  }
  return code || "-";
}

const appState = {
  library: null,
  cardsById: new Map(),
  filterType: "all",
  filterText: "",
  filterSets: [],
  filterStars: [],
  sortField: "name",
  sortDirection: "asc",
  filterElement: "",
  filterTribe: "",
  filterFlags: {
    alpha: false,
    promo: false,
    unused: false,
    other: true,
  },
  filterStats: {
    courage: 0,
    power: 0,
    wisdom: 0,
    speed: 0,
  },
  libraryView: "scans",
  mobileViewer: {
    active: false,
    index: 0,
    touchStartX: null,
    touchStartY: null,
  },
  scans: {
    cards: {
      creatures: [],
      attacks: [],
      battlegear: [],
      locations: [],
      mugic: [],
    },
    available: {
      creatures: [],
      attacks: [],
      battlegear: [],
      locations: [],
      mugic: [],
    },
    stats: null,
    updatedAt: null,
  },
  scansReservations: {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  },
  savedDecks: [],
  deck: createEmptyDeck(),
  editingDeckAnchor: "",
  battle: null,
  lastBattleConfig: null,
  currentRuleset: "competitive",
  battleCenterView: "board",
  battleLogView: "events",
  slotSnapshotHashByUnit: new Map(),
  creatureAbilityQuickPick: null,
  user: {
    username: "local-player",
    isAdmin: false,
  },
  currentTab: "builder",
  settings: cloneDefaultSettings(),
  keybindCaptureAction: null,
  fpsCounter: {
    rafId: null,
    lastTick: 0,
    frames: 0,
  },
  debug: {
    sessionId: null,
    active: false,
    buffer: [],
    flushTimerId: null,
    lastBattleLogIndex: 0,
  },
  pendingAttackRuntime: {
    seen: new Set(),
    queue: [],
    flushTimerId: null,
    lastBattleLogIndex: 0,
  },
  profileTracking: {
    usageReported: false,
    resultReported: false,
    lastFinishedState: false,
  },
  musicPlayer: {
    tracks: [],
    currentIndex: 0,
    ready: false,
    unlockBound: false,
    autoplayTriggered: false,
    seeking: false,
  },
  multiplayer: {
    enabled: false,
    roomId: null,
    phase: "lobby",
    matchType: "",
    rulesMode: "competitive",
    dromeId: "",
    challengeMeta: null,
    role: "host",
    seatToken: "",
    localPlayerIndex: 0,
    battleSnapshotHydrated: false,
    eventSource: null,
    connection: {
      hostConnected: false,
      guestConnected: false,
      timeoutSeat: null,
      timeoutAt: null,
      timeoutMs: 120000,
    },
    timeoutTickerId: null,
    rematch: {
      pending: false,
      requestedBy: null,
      requestedAt: null,
    },
    players: {
      host: null,
      guest: null,
    },
    deckSelect: {
      host: { ready: false, deckName: "", valid: false, errors: [] },
      guest: { ready: false, deckName: "", valid: false, errors: [] },
    },
  },
  adminMetrics: {
    pollTimerId: null,
    latest: null,
  },
};

const el = {
  libraryMeta: document.querySelector("#library-meta"),
  tabBuilder: document.querySelector("#tab-builder"),
  tabBattle: document.querySelector("#tab-battle"),
  tabSettings: document.querySelector("#tab-settings"),
  deckBuilder: document.querySelector("#deck-builder"),
  battleArena: document.querySelector("#battle-arena"),
  settingsPanel: document.querySelector("#settings-panel"),
  battleSetupView: document.querySelector("#battle-setup-view"),
  battleCombatView: document.querySelector("#battle-combat-view"),
  battleSetupTitle: document.querySelector("#battle-setup-title"),
  battleSetupDescription: document.querySelector("#battle-setup-description"),
  battleSetupMpStatus: document.querySelector("#battle-setup-mp-status"),
  battleSetupPlayerATitle: document.querySelector("#battle-setup-player-a-title"),
  battleSetupPlayerBTitle: document.querySelector("#battle-setup-player-b-title"),
  battleMpReady: document.querySelector("#battle-mp-ready"),
  battleBackSetup: document.querySelector("#battle-back-setup"),
  battleStageTitle: document.querySelector("#battle-stage-title"),
  battleRematch: document.querySelector("#battle-rematch"),
  battleForfeit: document.querySelector("#battle-forfeit"),
  battleMenuBtn: document.querySelector("#battle-menu-btn"),
  mobileScanViewerToggle: document.querySelector("#mobile-scan-viewer-toggle"),
  reloadLibrary: document.querySelector("#reload-library"),
  cardTypeFilter: document.querySelector("#card-type-filter"),
  setFilter: document.querySelector("#set-filter"),
  starsFilter: document.querySelector("#stars-filter"),
  sortFieldFilter: document.querySelector("#sort-field-filter"),
  sortDirectionFilter: document.querySelector("#sort-direction-filter"),
  elementFilter: document.querySelector("#element-filter"),
  tribeFilter: document.querySelector("#tribe-filter"),
  flagAlpha: document.querySelector("#flag-alpha"),
  flagPromo: document.querySelector("#flag-promo"),
  flagUnused: document.querySelector("#flag-unused"),
  flagOther: document.querySelector("#flag-other"),
  clearLibraryFilters: document.querySelector("#clear-library-filters"),
  libraryViewLibrary: document.querySelector("#library-view-library"),
  libraryViewScans: document.querySelector("#library-view-scans"),
  scansStockSummary: document.querySelector("#scans-stock-summary"),
  courageMin: document.querySelector("#courage-min"),
  powerMin: document.querySelector("#power-min"),
  wisdomMin: document.querySelector("#wisdom-min"),
  speedMin: document.querySelector("#speed-min"),
  cardSearch: document.querySelector("#card-search"),
  cardLibrary: document.querySelector("#card-library"),
  mobileScanViewer: document.querySelector("#mobile-scan-viewer"),
  mobileScanViewerImage: document.querySelector("#mobile-scan-viewer-image"),
  mobileScanViewerEmpty: document.querySelector("#mobile-scan-viewer-empty"),
  mobileScanViewerName: document.querySelector("#mobile-scan-viewer-name"),
  mobileScanViewerMeta: document.querySelector("#mobile-scan-viewer-meta"),
  mobileScanViewerStars: document.querySelector("#mobile-scan-viewer-stars"),
  mobileScanViewerIndex: document.querySelector("#mobile-scan-viewer-index"),
  deckMode: document.querySelector("#deck-mode"),
  deckName: document.querySelector("#deck-name"),
  saveDeck: document.querySelector("#save-deck"),
  deckList: document.querySelector("#deck-list"),
  loadDeck: document.querySelector("#load-deck"),
  deleteDeck: document.querySelector("#delete-deck"),
  clearDeck: document.querySelector("#clear-deck"),
  deckSummary: document.querySelector("#deck-summary"),
  deckValidation: document.querySelector("#deck-validation"),
  musicColumn: document.querySelector("#music-column"),
  creatureGrid: document.querySelector("#creature-grid"),
  equipmentGrid: document.querySelector("#equipment-grid"),
  locationStack: document.querySelector("#location-stack"),
  attacksColumn: document.querySelector("#attacks-column"),
  hoverPreview: document.querySelector("#hover-preview"),
  battleDeckA: document.querySelector("#battle-deck-a"),
  battleDeckB: document.querySelector("#battle-deck-b"),
  battleDeckAInfo: document.querySelector("#battle-deck-a-info"),
  battleDeckBInfo: document.querySelector("#battle-deck-b-info"),
  battleMode: document.querySelector("#battle-mode"),
  aiPlayerOne: document.querySelector("#ai-player-one"),
  startBattle: document.querySelector("#start-battle"),
  runAiMatch: document.querySelector("#run-ai-match"),
  hudTurn: document.querySelector("#hud-turn"),
  hudPhase: document.querySelector("#hud-phase"),
  phaseHelp: document.querySelector("#phase-help"),
  confirmEngage: document.querySelector("#confirm-engage"),
  playerAttack: document.querySelector("#player-attack"),
  autoStep: document.querySelector("#auto-step"),
  topSlots: document.querySelector("#top-slots"),
  bottomSlots: document.querySelector("#bottom-slots"),
  engagedPlayerPanel: document.querySelector("#engaged-player-panel"),
  engagedOpponentPanel: document.querySelector("#engaged-opponent-panel"),
  locationMini: document.querySelector("#location-mini"),
  atkDiscardCount: document.querySelector("#atk-discard-count"),
  genDiscardCount: document.querySelector("#gen-discard-count"),
  boardCount: document.querySelector("#board-count"),
  oppGenDiscardCount: document.querySelector("#opp-gen-discard-count"),
  oppAtkDiscardCount: document.querySelector("#opp-atk-discard-count"),
  tabAtkDiscard: document.querySelector("#tab-atk-discard"),
  tabGenDiscard: document.querySelector("#tab-gen-discard"),
  tabBoardView: document.querySelector("#tab-board-view"),
  tabOppGenDiscard: document.querySelector("#tab-opp-gen-discard"),
  tabOppAtkDiscard: document.querySelector("#tab-opp-atk-discard"),
  boardInspector: document.querySelector("#board-inspector"),
  boardInspectorTitle: document.querySelector("#board-inspector-title"),
  boardInspectorContent: document.querySelector("#board-inspector-content"),
  attackHand: document.querySelector("#attack-hand"),
  creatureAbilityPopup: document.querySelector("#creature-ability-popup"),
  rematchRequestPopup: document.querySelector("#rematch-request-popup"),
  rematchRequestText: document.querySelector("#rematch-request-text"),
  rematchAccept: document.querySelector("#rematch-accept"),
  rematchDecline: document.querySelector("#rematch-decline"),
  battleLog: document.querySelector("#battle-log"),
  battleLogTabEvents: document.querySelector("#battle-log-tab-events"),
  battleLogTabEffects: document.querySelector("#battle-log-tab-effects"),
  oppMugicRail: document.querySelector("#opp-mugic-rail"),
  playerMugicRail: document.querySelector("#player-mugic-rail"),
  oppAlive: document.querySelector("#opp-alive"),
  playerAlive: document.querySelector("#player-alive"),
  battlePlayerAName: document.querySelector("#battle-player-a-name"),
  battlePlayerBName: document.querySelector("#battle-player-b-name"),
  battlePlayerAAvatar: document.querySelector("#battle-player-a-avatar"),
  battlePlayerBAvatar: document.querySelector("#battle-player-b-avatar"),
  cardTemplate: document.querySelector("#card-template"),
  fpsCounter: document.querySelector("#fps-counter"),
  saveSettings: document.querySelector("#save-settings"),
  settingsFeedback: document.querySelector("#settings-feedback"),
  adminObservabilitySection: document.querySelector("#admin-observability-section"),
  adminObservabilityGrid: document.querySelector("#admin-observability-grid"),
  adminObservabilityRefresh: document.querySelector("#admin-observability-refresh"),
  adminObservabilityUpdated: document.querySelector("#admin-observability-updated"),
  settingsTitle: document.querySelector("#settings-title"),
  settingsScreenTitle: document.querySelector("#settings-screen-title"),
  settingsAudioTitle: document.querySelector("#settings-audio-title"),
  settingsLanguageTitle: document.querySelector("#settings-language-title"),
  settingsGameplayTitle: document.querySelector("#settings-gameplay-title"),
  settingsProgressTitle: document.querySelector("#settings-progress-title"),
  settingsControlsTitle: document.querySelector("#settings-controls-title"),
  settingsExtrasTitle: document.querySelector("#settings-extras-title"),
  settingFullscreenAuto: document.querySelector("#setting-fullscreen-auto"),
  settingResolution: document.querySelector("#setting-resolution"),
  settingAudioEnabled: document.querySelector("#setting-audio-enabled"),
  settingAudioMaster: document.querySelector("#setting-audio-master"),
  settingAudioSfx: document.querySelector("#setting-audio-sfx"),
  settingAudioMusic: document.querySelector("#setting-audio-music"),
  settingCardLanguage: document.querySelector("#setting-card-language"),
  settingUiLanguage: document.querySelector("#setting-ui-language"),
  settingGameplayAnimations: document.querySelector("#setting-gameplay-animations"),
  settingGameplayHints: document.querySelector("#setting-gameplay-hints"),
  settingMenuGlobalChat: document.querySelector("#setting-menu-global-chat"),
  settingMenuTop50: document.querySelector("#setting-menu-top50"),
  settingMouseSensitivity: document.querySelector("#setting-mouse-sensitivity"),
  settingTheme: document.querySelector("#setting-theme"),
  settingFpsCounter: document.querySelector("#setting-fps-counter"),
  settingDebugMode: document.querySelector("#setting-debug-mode"),
  resetProgress: document.querySelector("#reset-progress"),
  keybindResetDefaults: document.querySelector("#keybind-reset-defaults"),
  keybindConfirmAction: document.querySelector("#keybind-confirmAction"),
  keybindConfirmAttack: document.querySelector("#keybind-confirmAttack"),
  keybindAutoStep: document.querySelector("#keybind-autoStep"),
  keybindSwitchBuilder: document.querySelector("#keybind-switchBuilder"),
  keybindSwitchBattle: document.querySelector("#keybind-switchBattle"),
  keybindSwitchSettings: document.querySelector("#keybind-switchSettings"),
  keybindCancel: document.querySelector("#keybind-cancel"),
  toggleMusicPanel: document.querySelector("#toggle-music-panel"),
  musicPlayer: document.querySelector("#music-player"),
  musicAudio: document.querySelector("#music-audio"),
  musicTrackName: document.querySelector("#music-track-name"),
  musicPrev: document.querySelector("#music-prev"),
  musicToggle: document.querySelector("#music-toggle"),
  musicNext: document.querySelector("#music-next"),
  musicLoop: document.querySelector("#music-loop"),
  musicProgress: document.querySelector("#music-progress"),
  musicCurrentTime: document.querySelector("#music-current-time"),
  musicDuration: document.querySelector("#music-duration"),
  musicPlayerVolume: document.querySelector("#music-player-volume"),
};

function createEmptyDeck() {
  return {
    name: "",
    createdAt: null,
    mode: "competitive",
    cards: {
      creatures: [],
      attacks: [],
      battlegear: [],
      locations: [],
      mugic: [],
    },
  };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function startAppPresenceHeartbeat() {
  let timerId = null;
  let stopped = false;
  let inFlight = false;

  const clearTimer = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const nextDelay = () => (
    document.visibilityState === "hidden"
      ? PRESENCE_HEARTBEAT_HIDDEN_MS
      : PRESENCE_HEARTBEAT_VISIBLE_MS
  );

  const schedule = (delayMs = nextDelay()) => {
    clearTimer();
    if (stopped) {
      return;
    }
    timerId = setTimeout(() => {
      void tick();
    }, Math.max(1000, Number(delayMs || PRESENCE_HEARTBEAT_VISIBLE_MS)));
  };

  const tick = async () => {
    if (stopped || inFlight) {
      return;
    }
    if (document.visibilityState === "hidden") {
      schedule(PRESENCE_HEARTBEAT_HIDDEN_MS);
      return;
    }
    inFlight = true;
    try {
      await apiJson("/api/presence/ping", { method: "POST" });
    } catch (_) {
      // noop: falhas de heartbeat nao devem quebrar UI
    } finally {
      inFlight = false;
      schedule(nextDelay());
    }
  };

  const onVisibility = () => {
    if (stopped) {
      return;
    }
    if (document.visibilityState === "visible") {
      void tick();
      return;
    }
    schedule(PRESENCE_HEARTBEAT_HIDDEN_MS);
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onVisibility);
  void tick();

  return () => {
    stopped = true;
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onVisibility);
  };
}

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "local-player";
}

function currentUsername() {
  return normalizeUsername(appState.user?.username || "local-player");
}

function resetProfileTracking() {
  appState.profileTracking.usageReported = false;
  appState.profileTracking.resultReported = false;
  appState.profileTracking.lastFinishedState = false;
}

function reportCreatureUsageOnce(battle) {
  if (!battle || appState.profileTracking.usageReported) {
    return;
  }
  if (!isLocalHumanControlled(battle)) {
    return;
  }
  if (isMultiplayerActive() && appState.multiplayer.role === "spectator") {
    return;
  }
  const localIndex = localPlayerIndex();
  const player = battle.board?.players?.[localIndex];
  if (!player) {
    return;
  }
  const seen = new Set();
  (player.creatures || []).forEach((unit) => {
    const cardId = String(unit?.card?.id || "").trim();
    if (!cardId || seen.has(cardId)) {
      return;
    }
    seen.add(cardId);
    apiJson("/api/profile/creature-usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: currentUsername(),
        cardId,
        cardName: unit?.card?.name || cardId,
        count: 1,
      }),
    }).catch(() => {});
  });
  appState.profileTracking.usageReported = true;
}

function reportBattleResultIfNeeded(battle) {
  if (!battle || !battle.finished || appState.profileTracking.resultReported) {
    return;
  }
  if (!isLocalHumanControlled(battle)) {
    return;
  }
  if (isMultiplayerActive() && appState.multiplayer.role === "spectator") {
    return;
  }
  const localIndex = localPlayerIndex();
  const localPlayer = battle.board?.players?.[localIndex];
  const opponentPlayer = battle.board?.players?.[localIndex === 0 ? 1 : 0];
  if (!localPlayer) {
    return;
  }
  const localLabel = String(localPlayer.label || "");
  const winnerLabel = String(battle.winner || "");
  const result = winnerLabel && localLabel && winnerLabel === localLabel ? "win" : "loss";
  appState.profileTracking.resultReported = true;
  apiJson("/api/profile/battle-result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: currentUsername(),
      result,
      mode: String(battle.mode || appState.currentRuleset || "competitive"),
      opponent: String(opponentPlayer?.label || "Oponente"),
      timestamp: new Date().toISOString(),
      roomId: String(appState.multiplayer?.roomId || ""),
      matchType: String(appState.multiplayer?.matchType || ""),
      dromeId: String(appState.multiplayer?.dromeId || ""),
      challengeMeta: appState.multiplayer?.challengeMeta || null,
    }),
  }).catch(() => {});
}

function encodeRichValue(value) {
  if (value instanceof Set) {
    return { __chaoticType: "Set", values: [...value].map((entry) => encodeRichValue(entry)) };
  }
  if (value instanceof Map) {
    return {
      __chaoticType: "Map",
      entries: [...value.entries()].map(([key, entryValue]) => [encodeRichValue(key), encodeRichValue(entryValue)]),
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => encodeRichValue(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = encodeRichValue(value[key]);
    });
    return out;
  }
  return value;
}

function decodeRichValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => decodeRichValue(entry));
  }
  if (value.__chaoticType === "Set" && Array.isArray(value.values)) {
    return new Set(value.values.map((entry) => decodeRichValue(entry)));
  }
  if (value.__chaoticType === "Map" && Array.isArray(value.entries)) {
    return new Map(value.entries.map(([key, entryValue]) => [decodeRichValue(key), decodeRichValue(entryValue)]));
  }
  const out = {};
  Object.keys(value).forEach((key) => {
    out[key] = decodeRichValue(value[key]);
  });
  return out;
}

function isMultiplayerActive() {
  return Boolean(appState.multiplayer?.enabled && appState.multiplayer?.roomId);
}

function isMultiplayerDeckSelectPhase() {
  return isMultiplayerActive() && String(appState.multiplayer?.phase || "") === "deck_select";
}

function localSeatName() {
  const seat = String(appState.multiplayer?.role || "");
  return seat === "host" || seat === "guest" ? seat : "spectator";
}

function ensureDeckOption(selectEl, deckName) {
  if (!selectEl || !deckName) {
    return;
  }
  const hasOption = Array.from(selectEl.options || []).some((entry) => String(entry.value || "") === deckName);
  if (!hasOption) {
    const option = document.createElement("option");
    option.value = deckName;
    option.textContent = deckName;
    selectEl.appendChild(option);
  }
}

function localPlayerIndex() {
  return Number.isInteger(appState.multiplayer?.localPlayerIndex)
    ? appState.multiplayer.localPlayerIndex
    : 0;
}

function opponentPlayerIndex() {
  return localPlayerIndex() === 0 ? 1 : 0;
}

function isLocalHumanTurn(battle) {
  return Boolean(battle && battle.board?.activePlayerIndex === localPlayerIndex());
}

function isLocalHumanControlled(battle) {
  if (!battle) {
    return false;
  }
  if (isMultiplayerActive()) {
    return appState.multiplayer.role !== "spectator";
  }
  return !battle.ai?.player0;
}

function closeMultiplayerStream() {
  const stream = appState.multiplayer?.eventSource || null;
  if (stream) {
    try {
      stream.close();
    } catch (_error) {
      // ignore
    }
  }
  appState.multiplayer.eventSource = null;
  appState.multiplayer.battleSnapshotHydrated = false;
  if (appState.multiplayer.timeoutTickerId) {
    window.clearInterval(appState.multiplayer.timeoutTickerId);
    appState.multiplayer.timeoutTickerId = null;
  }
}

function triggerDefeatCodeExplosion(unitId, options = {}) {
  const targetId = String(unitId || "").trim();
  const fallbackRenderDelay = Number.isFinite(Number(options.fallbackRenderDelay))
    ? Number(options.fallbackRenderDelay)
    : 100;
  if (!targetId) {
    if (!options.skipFallbackRender) {
      window.setTimeout(() => renderBattle(), fallbackRenderDelay);
    }
    return false;
  }
  const slotEl = document.querySelector(`[data-unit-id="${targetId}"]`);
  if (!slotEl) {
    if (!options.skipFallbackRender) {
      window.setTimeout(() => renderBattle(), fallbackRenderDelay);
    }
    return false;
  }
  slotEl.style.opacity = "0";
  const rect = slotEl.getBoundingClientRect();
  explodeIntoCode(rect.left, rect.top, rect.width, rect.height, document.body);
  appState.animationBlocks = (appState.animationBlocks || 0) + 1;
  appState.battleAnimationBlock = true;
  window.setTimeout(() => {
    appState.animationBlocks = Math.max(0, (appState.animationBlocks || 0) - 1);
    if (appState.animationBlocks <= 0) {
      appState.battleAnimationBlock = false;
      renderBattle();
    }
  }, 2800);
  return true;
}

function collectDefeatedUnitIdsById(battle) {
  const defeatedById = new Map();
  if (!battle?.board?.players) {
    return defeatedById;
  }
  battle.board.players.forEach((player) => {
    (player?.creatures || []).forEach((unit) => {
      if (!unit?.unitId) {
        return;
      }
      defeatedById.set(String(unit.unitId), Boolean(unit.defeated));
    });
  });
  return defeatedById;
}

function findNewlyDefeatedUnitIds(previousBattle, nextBattle) {
  const previousById = collectDefeatedUnitIdsById(previousBattle);
  const nextById = collectDefeatedUnitIdsById(nextBattle);
  const newlyDefeated = [];
  previousById.forEach((wasDefeated, unitId) => {
    if (wasDefeated) {
      return;
    }
    if (nextById.get(unitId) === true) {
      newlyDefeated.push(unitId);
    }
  });
  return newlyDefeated;
}

function syncMultiplayerTimeoutTicker() {
  if (appState.multiplayer.timeoutTickerId) {
    window.clearInterval(appState.multiplayer.timeoutTickerId);
    appState.multiplayer.timeoutTickerId = null;
  }
  if (!isMultiplayerActive()) {
    return;
  }
  const timeoutAtText = appState.multiplayer.connection?.timeoutAt || null;
  const timeoutAt = timeoutAtText ? Date.parse(timeoutAtText) : NaN;
  if (!Number.isFinite(timeoutAt) || timeoutAt <= Date.now()) {
    return;
  }
  appState.multiplayer.timeoutTickerId = window.setInterval(() => {
    const target = Date.parse(appState.multiplayer.connection?.timeoutAt || "");
    if (!Number.isFinite(target) || target <= Date.now()) {
      if (appState.multiplayer.timeoutTickerId) {
        window.clearInterval(appState.multiplayer.timeoutTickerId);
        appState.multiplayer.timeoutTickerId = null;
      }
      renderBattle();
      return;
    }
    renderBattle();
  }, 1000);
}

function applyMultiplayerSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    return;
  }
  const previousBattle = appState.battle;
  const hadHydratedBattleSnapshot = Boolean(appState.multiplayer.battleSnapshotHydrated);
  const nextBattle = snapshot.battleState ? decodeRichValue(snapshot.battleState) : null;
  const newlyDefeatedUnitIds =
    hadHydratedBattleSnapshot && previousBattle && nextBattle
      ? findNewlyDefeatedUnitIds(previousBattle, nextBattle)
      : [];
  appState.battle = nextBattle;
  appState.multiplayer.battleSnapshotHydrated = true;
  if (newlyDefeatedUnitIds.length) {
    newlyDefeatedUnitIds.forEach((unitId) => {
      triggerDefeatCodeExplosion(unitId, { skipFallbackRender: true });
    });
  }
  if (typeof snapshot.localPlayerIndex === "number") {
    appState.multiplayer.localPlayerIndex = snapshot.localPlayerIndex;
  }
  if (typeof snapshot.seat === "string") {
    appState.multiplayer.role = snapshot.seat;
  }
  appState.multiplayer.phase = String(snapshot.phase || "lobby");
  appState.multiplayer.matchType = String(snapshot.matchType || "");
  appState.multiplayer.rulesMode = String(snapshot.rulesMode || "competitive");
  appState.multiplayer.dromeId = String(snapshot.dromeId || "");
  appState.multiplayer.challengeMeta = snapshot.challengeMeta && typeof snapshot.challengeMeta === "object"
    ? {
        inviteId: String(snapshot.challengeMeta.inviteId || ""),
        codemasterKey: String(snapshot.challengeMeta.codemasterKey || ""),
        challengerKey: String(snapshot.challengeMeta.challengerKey || ""),
        dromeId: String(snapshot.challengeMeta.dromeId || ""),
      }
    : null;
  if (snapshot.connection && typeof snapshot.connection === "object") {
    appState.multiplayer.connection = {
      hostConnected: Boolean(snapshot.connection.hostConnected),
      guestConnected: Boolean(snapshot.connection.guestConnected),
      timeoutSeat: snapshot.connection.timeoutSeat || null,
      timeoutAt: snapshot.connection.timeoutAt || null,
      timeoutMs: Number(snapshot.connection.timeoutMs || 120000),
    };
  }
  if (snapshot.rematch && typeof snapshot.rematch === "object") {
    appState.multiplayer.rematch = {
      pending: Boolean(snapshot.rematch.pending),
      requestedBy: snapshot.rematch.requestedBy || null,
      requestedAt: snapshot.rematch.requestedAt || null,
    };
  } else {
    appState.multiplayer.rematch = {
      pending: false,
      requestedBy: null,
      requestedAt: null,
    };
  }
  if (snapshot.players && typeof snapshot.players === "object") {
    appState.multiplayer.players = {
      host: snapshot.players.host || null,
      guest: snapshot.players.guest || null,
    };
  }
  if (snapshot.deckSelect && typeof snapshot.deckSelect === "object") {
    const host = snapshot.deckSelect.host || {};
    const guest = snapshot.deckSelect.guest || {};
    appState.multiplayer.deckSelect = {
      host: {
        ready: Boolean(host.ready),
        deckName: String(host.deckName || ""),
        valid: Boolean(host.valid),
        errors: Array.isArray(host.errors) ? host.errors : [],
      },
      guest: {
        ready: Boolean(guest.ready),
        deckName: String(guest.deckName || ""),
        valid: Boolean(guest.valid),
        errors: Array.isArray(guest.errors) ? guest.errors : [],
      },
    };
  }
  syncMultiplayerTimeoutTicker();
}

function updateBattlePlayerAvatars(localIndex, opponentIndex) {
  const defaultAvatar = "/fundo%20cartas.png";
  const leftAvatarEl = el.battlePlayerAAvatar;
  const rightAvatarEl = el.battlePlayerBAvatar;
  if (!leftAvatarEl || !rightAvatarEl) {
    return;
  }
  if (!isMultiplayerActive()) {
    leftAvatarEl.src = defaultAvatar;
    rightAvatarEl.src = defaultAvatar;
    return;
  }
  const players = appState.multiplayer.players || {};
  const hostAvatar = String(players.host?.avatar || "").trim() || defaultAvatar;
  const guestAvatar = String(players.guest?.avatar || "").trim() || defaultAvatar;
  const leftAvatar = localIndex === 0 ? hostAvatar : guestAvatar;
  const rightAvatar = opponentIndex === 0 ? hostAvatar : guestAvatar;
  leftAvatarEl.src = leftAvatar;
  rightAvatarEl.src = rightAvatar;
}

function renderRematchRequestPopup() {
  const popup = el.rematchRequestPopup;
  if (!popup) {
    return;
  }
  const isMp = isMultiplayerActive();
  const rematch = appState.multiplayer?.rematch || {};
  const localSeat = localSeatName();
  const shouldShow =
    isMp &&
    Boolean(rematch.pending) &&
    Boolean(appState.battle?.finished) &&
    localSeat !== "spectator" &&
    rematch.requestedBy &&
    rematch.requestedBy !== localSeat;

  popup.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    return;
  }
  if (el.rematchRequestText) {
    const requester = rematch.requestedBy === "host" ? "Host" : "Guest";
    el.rematchRequestText.textContent = `${requester} pediu revanche. Deseja aceitar?`;
  }
}

async function submitMultiplayerAction(action) {
  if (!isMultiplayerActive()) {
    return null;
  }
  const roomId = appState.multiplayer.roomId;
  const payload = await apiJson(`/api/multiplayer/rooms/${encodeURIComponent(roomId)}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      seatToken: appState.multiplayer.seatToken || "",
      action: encodeRichValue(action || {}),
    }),
  });
  if (payload?.snapshot) {
    applyMultiplayerSnapshot(payload.snapshot);
  }
  renderBattle();
  return payload;
}

const NOOP_PENDING_EFFECT_REGEX = /^\[noop_pending_kind\]\s*([^:]+):\s*efeito\s+'([^']+)'/i;

function inferCardTypeFromPendingSource(sourceLabel = "") {
  const label = String(sourceLabel || "").toLowerCase();
  if (label.startsWith("attack ")) return "attacks";
  if (label.startsWith("mugic ")) return "mugic";
  if (label.startsWith("location ")) return "locations";
  if (label.startsWith("battlegear ")) return "battlegear";
  if (label.startsWith("ability ") || label.includes("creature")) return "creatures";
  return "unknown";
}

function inferCardNameFromPendingSource(sourceLabel = "") {
  const text = String(sourceLabel || "").trim();
  return text.replace(/^(Attack|Mugic|Location|Battlegear|Ability)\s+/i, "").trim();
}

async function flushPendingAttackRuntimeQueue() {
  const queueState = appState.pendingAttackRuntime;
  queueState.flushTimerId = null;
  while (queueState.queue.length > 0) {
    const payload = queueState.queue.shift();
    try {
      const endpoint =
        String(payload?.cardType || "").toLowerCase() === "creatures"
          ? "/api/creatures/pending/append"
          : "/api/effects/pending/append";
      await apiJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      queueState.queue.unshift(payload);
      queueState.flushTimerId = window.setTimeout(flushPendingAttackRuntimeQueue, 1200);
      return;
    }
  }
}

function queuePendingAttackRuntimeFromLog(line) {
  const match = String(line || "").match(NOOP_PENDING_EFFECT_REGEX);
  if (!match) {
    return;
  }
  const sourceLabel = String(match[1] || "").trim();
  const effectKind = String(match[2] || "").trim();
  const cardName = inferCardNameFromPendingSource(sourceLabel);
  const cardType = inferCardTypeFromPendingSource(sourceLabel);
  if (!cardName || !effectKind) {
    return;
  }
  const key = `${normalizeFilterToken(cardType)}|${normalizeFilterToken(cardName)}|${normalizeFilterToken(effectKind)}`;
  if (!key || appState.pendingAttackRuntime.seen.has(key)) {
    return;
  }
  appState.pendingAttackRuntime.seen.add(key);
  appState.pendingAttackRuntime.queue.push({
    reason: "kind_pendente",
    cardType,
    cardName,
    effectKind,
    sourceText: line,
  });
  if (!appState.pendingAttackRuntime.flushTimerId) {
    appState.pendingAttackRuntime.flushTimerId = window.setTimeout(flushPendingAttackRuntimeQueue, 300);
  }
}

function imageOf(card) {
  return card?.image || card?.imageVariants?.ic || "";
}

function deckEntryCardId(entry) {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry === "object") {
    if (typeof entry.cardId === "string" && entry.cardId.trim()) {
      return entry.cardId.trim();
    }
    if (typeof entry.id === "string" && entry.id.trim()) {
      return entry.id.trim();
    }
  }
  return "";
}

function formatScanTimestampLabel(value) {
  if (!value) {
    return "Scaneada em: sem registro";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Scaneada em: sem registro";
  }
  return `Scaneada em: ${parsed.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function normalizeVariant(rawVariant) {
  if (!rawVariant || typeof rawVariant !== "object") {
    return null;
  }
  const variant = {
    energyDelta: Number(rawVariant.energyDelta || 0),
    courageDelta: Number(rawVariant.courageDelta || 0),
    powerDelta: Number(rawVariant.powerDelta || 0),
    wisdomDelta: Number(rawVariant.wisdomDelta || 0),
    speedDelta: Number(rawVariant.speedDelta || 0),
    perfect: Boolean(rawVariant.perfect),
  };
  ["energyDelta", "courageDelta", "powerDelta", "wisdomDelta", "speedDelta"].forEach((key) => {
    if (!Number.isFinite(variant[key])) {
      variant[key] = 0;
    }
    variant[key] = Math.round(variant[key] / 5) * 5;
  });
  const starsRaw = Number(rawVariant.stars);
  if (Number.isFinite(starsRaw)) {
    variant.stars = Math.max(0, Math.min(5, Math.round(starsRaw * 2) / 2));
  } else {
    const sumDeltas = Number(variant.energyDelta || 0)
      + Number(variant.courageDelta || 0)
      + Number(variant.powerDelta || 0)
      + Number(variant.wisdomDelta || 0)
      + Number(variant.speedDelta || 0);
    const computed = Math.round((((sumDeltas + 25) / 10) * 2)) / 2;
    variant.stars = Math.max(0, Math.min(5, computed));
  }
  if (typeof rawVariant.starsLabel === "string" && rawVariant.starsLabel.trim()) {
    variant.starsLabel = rawVariant.starsLabel.trim();
  } else {
    variant.starsLabel = `${variant.stars.toFixed(1)}★`;
  }
  return variant;
}

function creatureStarsLabelFromVariant(variant) {
  if (!variant || typeof variant !== "object") {
    return "";
  }
  if (typeof variant.starsLabel === "string" && variant.starsLabel.trim()) {
    return variant.starsLabel.trim();
  }
  const stars = Number(variant.stars);
  if (!Number.isFinite(stars)) {
    return "";
  }
  const normalized = Math.max(0, Math.min(5, Math.round(stars * 2) / 2));
  return `${normalized.toFixed(1)}★`;
}

function applyCreatureVariantToCard(baseCard, variant) {
  if (!baseCard || baseCard.type !== "creatures" || !variant) {
    return baseCard;
  }
  const stats = baseCard.stats || {};
  return {
    ...baseCard,
    stats: {
      ...stats,
      energy: Number(stats.energy || 0) + Number(variant.energyDelta || 0),
      courage: Number(stats.courage || 0) + Number(variant.courageDelta || 0),
      power: Number(stats.power || 0) + Number(variant.powerDelta || 0),
      wisdom: Number(stats.wisdom || 0) + Number(variant.wisdomDelta || 0),
      speed: Number(stats.speed || 0) + Number(variant.speedDelta || 0),
    },
    _scanVariant: variant,
    _baseStats: { ...stats },
  };
}

function getCardById(cardId) {
  if (typeof cardId === "string") {
    return appState.cardsById.get(cardId) || null;
  }
  const normalizedId = deckEntryCardId(cardId);
  if (!normalizedId) {
    return null;
  }
  const baseCard = appState.cardsById.get(normalizedId) || null;
  if (!baseCard) {
    return null;
  }
  const variant = normalizeVariant(cardId?.variant);
  return applyCreatureVariantToCard(baseCard, variant);
}

function statLine(card) {
  const stats = card.stats || {};
  if (card.type === "creatures") {
    return `C/P/W/S ${stats.courage}/${stats.power}/${stats.wisdom}/${stats.speed} | Energy ${stats.energy}`;
  }
  if (card.type === "attacks") {
    return `Base ${stats.base} | F ${stats.fireAttack} A ${stats.airAttack} E ${stats.earthAttack} W ${stats.waterAttack}`;
  }
  if (card.type === "locations") {
    return `Initiative ${stats.initiative || "Random"}`;
  }
  if (card.type === "mugic") {
    return `Cost ${stats.cost} | ${card.tribe || "Any"}`;
  }
  return card.tribe ? `Tribe ${card.tribe}` : "";
}

function attackTotalDamage(card) {
  const stats = card?.stats || {};
  return Number(stats.base || 0)
    + Number(stats.fireAttack || 0)
    + Number(stats.airAttack || 0)
    + Number(stats.earthAttack || 0)
    + Number(stats.waterAttack || 0);
}

function createActionButton(text, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  if (className) {
    button.className = className;
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

function normalizeTribeKey(tribe) {
  return String(tribe || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function tribeNeonColor(tribe) {
  const tribeKey = normalizeTribeKey(tribe);
  const palette = {
    overworld: "#66d1ff",
    underworld: "#ff6a5c",
    danian: "#b06a3b",
    mipedian: "#f2d26b",
    marrillian: "#a28cff",
    generic: "#9fb1c8",
  };
  return palette[tribeKey] || palette.generic;
}

function normalizeFilterToken(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cardFlags(card) {
  const nameKey = normalizeFilterToken(card?.name);
  const setKey = normalizeFilterToken(card?.set);
  const rarityKey = normalizeFilterToken(card?.rarity);
  const merged = normalizeFilterToken(`${card?.name || ""} ${card?.set || ""} ${card?.rarity || ""} ${card?.ability || ""}`);
  const alpha = nameKey.includes("alpha");
  const promo = setKey === "promo" || rarityKey === "promo" || merged.includes("promo");
  const unused = nameKey.includes("unused");

  return {
    alpha,
    promo,
    unused,
    other: !alpha && !promo && !unused,
  };
}

function mugicCounterMarkup(count, wrapperClass, tribe = "") {
  const safeCount = Math.max(0, Number(count || 0));
  if (safeCount <= 0) {
    return "";
  }
  const visibleDots = Math.min(safeCount, 6);
  const dots = Array.from({ length: visibleDots }, () => "<span class=\"mugic-counter-dot\"></span>").join("");
  const tribeKey = normalizeTribeKey(tribe);
  const tribeClass = tribeKey ? ` tribe-${tribeKey}` : "";

  return `
    <div class="${wrapperClass}${tribeClass}">
      <div class="mugic-counter-dots">${dots}</div>
      <span class="mugic-counter-value">${safeCount}</span>
    </div>
  `;
}

function moveHoverPreview(event) {
  if (!el.hoverPreview || !el.hoverPreview.classList.contains("active")) {
    return;
  }
  const sensitivity = clampNumber(appState.settings?.controls?.mouseSensitivity, 1, 200, 100);
  const gap = Math.round(10 + (sensitivity / 200) * 22);
  const maxX = window.innerWidth - el.hoverPreview.offsetWidth - 8;
  const maxY = window.innerHeight - el.hoverPreview.offsetHeight - 8;
  const x = Math.max(8, Math.min(maxX, event.clientX + gap));
  const y = Math.max(8, Math.min(maxY, event.clientY + gap));
  el.hoverPreview.style.left = `${x}px`;
  el.hoverPreview.style.top = `${y}px`;
}

function hideHoverPreview() {
  if (!el.hoverPreview) {
    return;
  }
  el.hoverPreview.classList.remove("active");
  el.hoverPreview.classList.remove("preview-location");
  el.hoverPreview.classList.remove("battle-unit-preview");
  delete el.hoverPreview.dataset.mode;
  delete el.hoverPreview.dataset.cardId;
  el.hoverPreview.innerHTML = "";
}

function renderPreviewContent(card) {
  const rarity = card?.rarity || "Unknown";
  const variant = normalizeVariant(card?._scanVariant);
  const baseStats = card?._baseStats || card?.stats || {};
  let variantBlock = "";
  if (card?.type === "creatures" && variant) {
    const formatDelta = (value) => {
      const n = Number(value || 0);
      if (!n) {
        return "0";
      }
      return n > 0 ? `+${n}` : String(n);
    };
    variantBlock = `
      <small><strong>Base:</strong> C/P/I/V ${Number(baseStats.courage || 0)}/${Number(baseStats.power || 0)}/${Number(baseStats.wisdom || 0)}/${Number(baseStats.speed || 0)} | Energia ${Number(baseStats.energy || 0)}</small>
      <small><strong>Variacao:</strong> C ${formatDelta(variant.courageDelta)} | P ${formatDelta(variant.powerDelta)} | I ${formatDelta(variant.wisdomDelta)} | V ${formatDelta(variant.speedDelta)} | E ${formatDelta(variant.energyDelta)}</small>
      <small><strong>Final:</strong> C/P/I/V ${Number(card?.stats?.courage || 0)}/${Number(card?.stats?.power || 0)}/${Number(card?.stats?.wisdom || 0)}/${Number(card?.stats?.speed || 0)} | Energia ${Number(card?.stats?.energy || 0)}${variant.perfect ? " | ★ Perfeita" : ""}</small>
    `;
  }
  return `
    <img src="${imageOf(card)}" alt="${card.name}">
    <div class="hover-preview-text">
      <strong>${card.name}</strong>
      <small>${TYPE_LABEL[card.type] || card.type} | ${rarity}</small>
      ${variantBlock ? variantBlock : `<small>${statLine(card)}</small>`}
    </div>
  `;
}

function renderMugicCounterPreviewContent(unit) {
  const creature = unit?.card;
  const count = Math.max(0, Number(unit?.mugicCounters || 0));
  const tribe = creature?.tribe || "Unknown";
  return `
    <img src="${imageOf(creature)}" alt="${creature?.name || "Creature"}">
    <div class="hover-preview-text">
      <strong>${creature?.name || "Creature"}</strong>
      <small>Mugic Counters: ${count}</small>
      <small>Tribe: ${tribe}</small>
    </div>
  `;
}

function renderBattleUnitPreviewContent(snapshot, playerIndex) {
  if (!snapshot?.card) {
    return "";
  }
  const c = Math.round(Number(snapshot.stats?.courage || 0));
  const p = Math.round(Number(snapshot.stats?.power || 0));
  const w = Math.round(Number(snapshot.stats?.wisdom || 0));
  const s = Math.round(Number(snapshot.stats?.speed || 0));
  const maxEnergy = Math.max(0, Number(snapshot.energy?.max || 0));
  const currentEnergy = Math.max(0, Number(snapshot.energy?.current || 0));
  const elementRows = [
    ["fire", "Fogo"],
    ["air", "Ar"],
    ["earth", "Terra"],
    ["water", "Agua"],
  ]
    .map(([key, label]) => {
      const value = Number(snapshot.stats?.[key] || 0);
      if (value <= 0) {
        return "";
      }
      const base = Number(snapshot.base?.[key] || 0);
      const bonus = Math.round(value - base);
      const suffix = bonus > 0 ? `+${bonus}` : "";
      return `<li class="preview-element-${key}"><span>${label}</span><strong>${suffix}</strong></li>`;
    })
    .filter(Boolean)
    .join("");
  const statuses = snapshot.unit?.statuses || {};
  const statusRows = Object.entries(STATUS_PREVIEW_LABELS)
    .map(([key, label]) => {
      const value = statuses?.[key];
      if (typeof value === "number" && value > 0) {
        return `<li>${label}${value > 1 ? ` +${Math.round(value)}` : ""}</li>`;
      }
      if (value) {
        return `<li>${label}</li>`;
      }
      return "";
    })
    .filter(Boolean);
  if (Array.isArray(statuses?.intimidate) && statuses.intimidate.length) {
    statusRows.push(`<li>Intimidate (${statuses.intimidate.length})</li>`);
  }
  if (Array.isArray(statuses?.support) && statuses.support.length) {
    statusRows.push(`<li>Support (${statuses.support.length})</li>`);
  }
  const statusMarkup = statusRows.length ? statusRows.join("") : "<li>Sem status ativo</li>";
  const isOpponentFaceDownGear = playerIndex === 1 && snapshot.gearState === "face_down";
  const gearState = snapshot.gearCard
    ? snapshot.gearState === "face_down"
      ? "Virado para baixo"
      : "Ativo"
    : "Sem battlegear";
  const gearName = isOpponentFaceDownGear ? "Face-down Battlegear" : snapshot.gearCard?.name;
  const gearLabel = snapshot.gearCard ? `${gearName} (${gearState})` : gearState;
  const engagedLabel = snapshot.engaged ? "Engajada" : "Nao engajada";
  return `
    <img src="${imageOf(snapshot.card)}" alt="${snapshot.card.name}">
    <div class="hover-preview-text battle-unit-preview-text">
      <strong>${snapshot.card.name}</strong>
      <small>${TYPE_LABEL[snapshot.card.type] || snapshot.card.type} | ${engagedLabel}</small>
      <small>Raridade: ${snapshot.card.rarity || "Unknown"}</small>
      <small>Energia ${currentEnergy}/${maxEnergy}</small>
      <small>Gear: ${gearLabel}</small>
      <div class="battle-preview-columns">
        <div class="battle-preview-group">
          <h5>Atributos</h5>
          <ul>
            <li><span>Coragem</span><strong>${c}</strong></li>
            <li><span>Poder</span><strong>${p}</strong></li>
            <li><span>Inteligencia</span><strong>${w}</strong></li>
            <li><span>Velocidade</span><strong>${s}</strong></li>
          </ul>
        </div>
        <div class="battle-preview-group">
          <h5>Elementos</h5>
          <ul>${elementRows || "<li>Sem elemento ativo</li>"}</ul>
        </div>
      </div>
      <div class="battle-preview-group">
        <h5>Status</h5>
        <ul>${statusMarkup}</ul>
      </div>
    </div>
  `;
}

function liveUnitById(playerIndex, unitId) {
  if (!appState.battle || !Number.isInteger(playerIndex) || !unitId) {
    return null;
  }
  return appState.battle.board.players[playerIndex]?.creatures?.find((unit) => unit?.unitId === unitId && !unit.defeated) || null;
}

function showBattleUnitPreview(playerIndex, unitId, event) {
  if (!el.hoverPreview) {
    return;
  }
  const unit = liveUnitById(playerIndex, unitId);
  if (!unit) {
    hideHoverPreview();
    return;
  }
  const snapshot = effectiveSnapshot(playerIndex, unit);
  if (!snapshot?.card) {
    hideHoverPreview();
    return;
  }
  el.hoverPreview.innerHTML = renderBattleUnitPreviewContent(snapshot, playerIndex);
  el.hoverPreview.classList.remove("preview-location");
  el.hoverPreview.classList.add("battle-unit-preview");
  el.hoverPreview.dataset.mode = "hover";
  el.hoverPreview.dataset.cardId = snapshot.card.id || "";
  el.hoverPreview.classList.add("active");
  moveHoverPreview(event);
}

function showHoverPreview(card, event) {
  if (!el.hoverPreview || !card) {
    return;
  }
  el.hoverPreview.innerHTML = renderPreviewContent(card);
  el.hoverPreview.classList.toggle("preview-location", card.type === "locations");
  el.hoverPreview.classList.remove("battle-unit-preview");
  el.hoverPreview.dataset.mode = "hover";
  el.hoverPreview.dataset.cardId = card.id || "";
  el.hoverPreview.classList.add("active");
  moveHoverPreview(event);
}

function showClickPreview(card, event) {
  if (!el.hoverPreview || !card) {
    return;
  }
  const sameCardOpen =
    el.hoverPreview.classList.contains("active") &&
    el.hoverPreview.dataset.mode === "click" &&
    el.hoverPreview.dataset.cardId === String(card.id || "");
  if (sameCardOpen) {
    hideHoverPreview();
    return;
  }
  el.hoverPreview.innerHTML = renderPreviewContent(card);
  el.hoverPreview.classList.toggle("preview-location", card.type === "locations");
  el.hoverPreview.classList.remove("battle-unit-preview");
  el.hoverPreview.dataset.mode = "click";
  el.hoverPreview.dataset.cardId = card.id || "";
  el.hoverPreview.classList.add("active");
  moveHoverPreview(event);
}

function attachHoverPreview(node, card) {
  node.addEventListener("mouseenter", (event) => {
    event.stopPropagation();
    showHoverPreview(card, event);
  });
  node.addEventListener("mousemove", (event) => {
    event.stopPropagation();
    moveHoverPreview(event);
  });
  node.addEventListener("mouseleave", (event) => {
    event.stopPropagation();
    hideHoverPreview();
  });
}

function attachMugicCounterPreview(node, unit) {
  if (!node || !unit?.card || !el.hoverPreview) {
    return;
  }
  node.addEventListener("mouseenter", (event) => {
    el.hoverPreview.innerHTML = renderMugicCounterPreviewContent(unit);
    el.hoverPreview.classList.remove("preview-location");
    el.hoverPreview.classList.remove("battle-unit-preview");
    el.hoverPreview.dataset.mode = "hover";
    el.hoverPreview.dataset.cardId = unit.card.id || "";
    el.hoverPreview.classList.add("active");
    moveHoverPreview(event);
  });
  node.addEventListener("mousemove", (event) => {
    event.stopPropagation();
    moveHoverPreview(event);
  });
  node.addEventListener("mouseleave", () => {
    hideHoverPreview();
  });
}

function attachBattleUnitPreview(node, playerIndex, unit) {
  if (!node || !Number.isInteger(playerIndex) || !unit?.unitId || !el.hoverPreview) {
    return;
  }
  const unitId = unit.unitId;
  node.addEventListener("mouseenter", (event) => {
    event.stopPropagation();
    showBattleUnitPreview(playerIndex, unitId, event);
  });
  node.addEventListener("mousemove", (event) => {
    event.stopPropagation();
    showBattleUnitPreview(playerIndex, unitId, event);
  });
  node.addEventListener("mouseleave", (event) => {
    event.stopPropagation();
    hideHoverPreview();
  });
}

function cardNode(card, buttons = [], options = {}) {
  const { scanTimestamp = null } = options;
  const node = el.cardTemplate.content.firstElementChild.cloneNode(true);
  const image = node.querySelector("img");
  const src = imageOf(card);
  image.src = src;
  image.alt = card.name;
  if (!src) {
    image.style.display = "none";
  }
  const creatureStars = card?.type === "creatures"
    ? creatureStarsLabelFromVariant(normalizeVariant(card?._scanVariant))
    : "";
  node.querySelector("h4").textContent = creatureStars ? `${card.name} (${creatureStars})` : card.name;
  node.querySelector(".meta").textContent = `${TYPE_LABEL[card.type] || card.type} | ${card.set || "-"} | ${card.rarity || "-"}`;
  if (creatureStars) {
    const metaEl = node.querySelector(".meta");
    if (metaEl) {
      metaEl.insertAdjacentHTML("beforeend", ` <span class="variant-stars-badge">${creatureStars}</span>`);
    }
  }
  node.querySelector(".ability").textContent = card.ability || "Sem habilidade textual";
  node.querySelector(".stats").textContent = statLine(card);
  if (scanTimestamp !== null) {
    const scanMeta = document.createElement("p");
    scanMeta.className = "scan-obtained-meta";
    scanMeta.textContent = formatScanTimestampLabel(scanTimestamp);
    const contentEl = node.querySelector(".card-content");
    const actionsEl = node.querySelector(".card-actions");
    if (contentEl && actionsEl) {
      contentEl.insertBefore(scanMeta, actionsEl);
    }
  }
  buttons.forEach((button) => node.querySelector(".card-actions").appendChild(button));
  attachHoverPreview(node, card);
  return node;
}

function rarityCopyLimit(card, ruleset) {
  if (!ruleset?.maxCopiesByRarity) {
    return null;
  }
  if (card.legendary || card.unique) {
    return 1;
  }
  const rarityKey = String(card.rarity || "").toLowerCase().trim();
  return ruleset.maxCopiesByRarity[rarityKey] || ruleset.maxCopiesDefault || 2;
}

function validateDeck(deck, rulesetKey) {
  const ruleset = DECK_RULESETS[rulesetKey] || DECK_RULESETS.casual;
  const errors = [];
  const warnings = [];
  const counts = CARD_TYPES.reduce((acc, type) => {
    acc[type] = filledDeckCount(deck, type);
    return acc;
  }, {});

  if (ruleset.exactCounts) {
    Object.entries(ruleset.exactCounts).forEach(([type, required]) => {
      if ((counts[type] || 0) !== required) {
        errors.push(`${TYPE_LABEL[type]} deve ter ${required} cartas (atual: ${counts[type] || 0}).`);
      }
    });
  }

  if (ruleset.maxCopiesByRarity) {
    const seen = new Map();
    CARD_TYPES.forEach((type) => {
      (deck.cards[type] || []).forEach((cardId) => {
        const card = getCardById(cardId);
        if (!card) {
          return;
        }
        const key = `${type}:${card.normalizedName || card.name}`;
        if (!seen.has(key)) {
          seen.set(key, { card, count: 0 });
        }
        seen.get(key).count += 1;
      });
    });
    seen.forEach(({ card, count }) => {
      const limit = rarityCopyLimit(card, ruleset);
      if (limit !== null && count > limit) {
        errors.push(`${card.name}: limite ${limit}, atual ${count}.`);
      }
    });
  }

  const totalAttackBP = (deck.cards.attacks || []).reduce((sum, cardId) => {
    const card = getCardById(cardId);
    return sum + Number(card?.stats?.bp || 0);
  }, 0);

  if (totalAttackBP > 20) {
    errors.push(`Pontuacao total de Ataques excede 20 BP (atual: ${totalAttackBP}).`);
  }

  if (!ruleset.exactCounts && (counts.creatures || 0) < 6) {
    warnings.push("Recomendado: usar pelo menos 6 creatures.");
  }

  return {
    rulesetKey,
    counts,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function parseMinValue(input) {
  const value = Number(input?.value || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getSelectedMultiValues(selectEl) {
  if (!selectEl) {
    return [];
  }
  return [...selectEl.options]
    .filter((option) => option.selected)
    .map((option) => String(option.value || "").trim())
    .filter(Boolean);
}

function selectedSetKeys() {
  return new Set((Array.isArray(appState.filterSets) ? appState.filterSets : []).map((value) => String(value || "").trim().toLowerCase()));
}

function selectedStarKeys() {
  return new Set((Array.isArray(appState.filterStars) ? appState.filterStars : []).map((value) => String(value || "").trim()));
}

function raritySortScore(card) {
  const rarity = String(card?.rarity || "").trim().toLowerCase();
  const scoreMap = {
    common: 1,
    uncommon: 2,
    rare: 3,
    "super rare": 4,
    "ultra rare": 5,
    legendary: 6,
  };
  return Number(scoreMap[rarity] || 0);
}

function compareCardsBySortField(a, b) {
  const direction = appState.sortDirection === "desc" ? -1 : 1;
  const field = appState.sortField || "name";
  const nameA = String(a?.name || "").toLowerCase();
  const nameB = String(b?.name || "").toLowerCase();
  if (field === "set") {
    const setA = String(a?.set || "").toLowerCase();
    const setB = String(b?.set || "").toLowerCase();
    if (setA !== setB) {
      return setA.localeCompare(setB) * direction;
    }
    return nameA.localeCompare(nameB) * direction;
  }
  if (field === "rarity") {
    const rarityDelta = raritySortScore(a) - raritySortScore(b);
    if (rarityDelta !== 0) {
      return rarityDelta * direction;
    }
    return nameA.localeCompare(nameB) * direction;
  }
  if (field === "type") {
    const typeA = String(a?.type || "").toLowerCase();
    const typeB = String(b?.type || "").toLowerCase();
    if (typeA !== typeB) {
      return typeA.localeCompare(typeB) * direction;
    }
    return nameA.localeCompare(nameB) * direction;
  }
  if (field === "stars") {
    const aIsCreature = String(a?.type || "") === "creatures";
    const bIsCreature = String(b?.type || "") === "creatures";
    if (aIsCreature !== bIsCreature) {
      return aIsCreature ? -1 : 1;
    }
    const starsA = Number(a?._scanVariant?.stars ?? a?.variant?.stars ?? -1);
    const starsB = Number(b?._scanVariant?.stars ?? b?.variant?.stars ?? -1);
    const safeA = Number.isFinite(starsA) ? starsA : -1;
    const safeB = Number.isFinite(starsB) ? starsB : -1;
    if (safeA !== safeB) {
      return (safeA - safeB) * direction;
    }
    return nameA.localeCompare(nameB) * direction;
  }
  return nameA.localeCompare(nameB) * direction;
}

function populateSetFilterOptions() {
  if (!el.setFilter || !appState.library?.cards) {
    return;
  }
  const selectedValues = new Set((appState.filterSets || []).map((value) => String(value || "").trim().toLowerCase()));
  const discoveredSets = [...new Set(
    appState.library.cards
      .map((card) => String(card?.set || "").trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));
  el.setFilter.innerHTML = "";
  discoveredSets.forEach((setName) => {
    const key = setName.toLowerCase();
    const option = document.createElement("option");
    option.value = key;
    option.textContent = setName;
    option.selected = selectedValues.has(key);
    el.setFilter.appendChild(option);
  });
}

function syncLibraryFilterControlsFromState() {
  if (el.cardTypeFilter) {
    el.cardTypeFilter.value = appState.filterType || "all";
  }
  if (el.setFilter) {
    const selected = selectedSetKeys();
    [...el.setFilter.options].forEach((option) => {
      option.selected = selected.has(String(option.value || "").trim().toLowerCase());
    });
  }
  if (el.starsFilter) {
    const selected = selectedStarKeys();
    [...el.starsFilter.options].forEach((option) => {
      option.selected = selected.has(String(option.value || "").trim());
    });
  }
  if (el.sortFieldFilter) {
    el.sortFieldFilter.value = appState.sortField || "name";
  }
  if (el.sortDirectionFilter) {
    el.sortDirectionFilter.value = appState.sortDirection || "asc";
  }
  if (el.elementFilter) {
    el.elementFilter.value = appState.filterElement || "";
  }
  if (el.tribeFilter) {
    el.tribeFilter.value = appState.filterTribe || "";
  }
  if (el.cardSearch) {
    el.cardSearch.value = appState.filterText || "";
  }
  if (el.courageMin) {
    el.courageMin.value = appState.filterStats.courage > 0 ? String(appState.filterStats.courage) : "";
  }
  if (el.powerMin) {
    el.powerMin.value = appState.filterStats.power > 0 ? String(appState.filterStats.power) : "";
  }
  if (el.wisdomMin) {
    el.wisdomMin.value = appState.filterStats.wisdom > 0 ? String(appState.filterStats.wisdom) : "";
  }
  if (el.speedMin) {
    el.speedMin.value = appState.filterStats.speed > 0 ? String(appState.filterStats.speed) : "";
  }
  if (el.flagAlpha) {
    el.flagAlpha.checked = Boolean(appState.filterFlags.alpha);
  }
  if (el.flagPromo) {
    el.flagPromo.checked = Boolean(appState.filterFlags.promo);
  }
  if (el.flagUnused) {
    el.flagUnused.checked = Boolean(appState.filterFlags.unused);
  }
  if (el.flagOther) {
    el.flagOther.checked = Boolean(appState.filterFlags.other);
  }
}

function clearLibraryFilters() {
  appState.filterType = "all";
  appState.filterSets = [];
  appState.filterStars = [];
  appState.sortField = "name";
  appState.sortDirection = "asc";
  appState.filterElement = "";
  appState.filterTribe = "";
  appState.filterText = "";
  appState.filterStats = {
    courage: 0,
    power: 0,
    wisdom: 0,
    speed: 0,
  };
  appState.filterFlags = {
    alpha: false,
    promo: false,
    unused: false,
    other: true,
  };
  syncLibraryFilterControlsFromState();
  renderLibraryCards();
}

function scansEditingDeckName() {
  return String(appState.editingDeckAnchor || "").trim();
}

function cloneScansReservations() {
  const out = {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
  CARD_TYPES.forEach((type) => {
    const entries = Array.isArray(appState.scansReservations?.[type]) ? appState.scansReservations[type] : [];
    out[type] = entries.map((entry) => cloneDeckEntryRef(entry));
  });
  return out;
}

function clearScansReservations() {
  appState.scansReservations = {
    creatures: [],
    attacks: [],
    battlegear: [],
    locations: [],
    mugic: [],
  };
}

function ensureScansReservationBucket(type) {
  if (!appState.scansReservations || typeof appState.scansReservations !== "object") {
    clearScansReservations();
  }
  if (!Array.isArray(appState.scansReservations[type])) {
    appState.scansReservations[type] = [];
  }
  return appState.scansReservations[type];
}

function reserveScansEntry(type, entryLike) {
  const bucket = ensureScansReservationBucket(type);
  bucket.push(cloneDeckEntryRef(entryLike));
}

function releaseScansReservation(type, entryLike) {
  const bucket = ensureScansReservationBucket(type);
  if (!bucket.length) {
    return;
  }
  const cardId = deckEntryCardId(entryLike);
  let index = -1;
  if (type === "creatures" && entryLike && typeof entryLike === "object" && entryLike.scanEntryId) {
    const scanEntryId = String(entryLike.scanEntryId);
    index = bucket.findIndex((candidate) => (
      candidate
      && typeof candidate === "object"
      && String(candidate.scanEntryId || "") === scanEntryId
    ));
  }
  if (index < 0 && cardId) {
    index = bucket.findIndex((candidate) => deckEntryCardId(candidate) === cardId);
  }
  if (index >= 0) {
    bucket.splice(index, 1);
  }
}

function applyLocalScansReservations() {
  CARD_TYPES.forEach((type) => {
    const bucket = ensureScansReservationBucket(type);
    bucket.forEach((reservedEntry) => {
      removeEntryFromAvailableScans(type, reservedEntry);
    });
  });
}

function scansAvailabilityMap() {
  const map = new Map();
  CARD_TYPES.forEach((type) => {
    const list = Array.isArray(appState.scans?.available?.[type]) ? appState.scans.available[type] : [];
    list.forEach((entry) => {
      const cardId = deckEntryCardId(entry);
      if (!cardId) {
        return;
      }
      const key = `${type}:${cardId}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
  });
  return map;
}

function scansAvailableCopies(type, cardId) {
  if (!type || !cardId) {
    return 0;
  }
  const key = `${type}:${cardId}`;
  const map = scansAvailabilityMap();
  return Number(map.get(key) || 0);
}

function updateScansStockSummaryFromAvailable() {
  if (!el.scansStockSummary) {
    return;
  }
  const language = normalizeLanguage(appState.settings?.language?.ui);
  const dictionary = UI_LANGUAGE_LABELS[language] || UI_LANGUAGE_LABELS.pt;
  const total = CARD_TYPES.reduce((sum, type) => {
    const list = Array.isArray(appState.scans?.available?.[type]) ? appState.scans.available[type] : [];
    return sum + list.length;
  }, 0);
  el.scansStockSummary.textContent = `${dictionary.scansSummaryPrefix}: ${total}`;
}

function cloneDeckEntryRef(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  return JSON.parse(JSON.stringify(entry));
}

function removeEntryFromAvailableScans(type, entryLike) {
  const list = Array.isArray(appState.scans?.available?.[type]) ? appState.scans.available[type] : null;
  if (!list || !list.length) {
    return null;
  }
  const cardId = deckEntryCardId(entryLike);
  if (!cardId) {
    return null;
  }
  let index = -1;
  if (type === "creatures" && entryLike && typeof entryLike === "object" && entryLike.scanEntryId) {
    const scanEntryId = String(entryLike.scanEntryId);
    index = list.findIndex((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return false;
      }
      return String(candidate.scanEntryId || "") === scanEntryId;
    });
  }
  if (index < 0) {
    index = list.findIndex((candidate) => deckEntryCardId(candidate) === cardId);
  }
  if (index < 0) {
    return null;
  }
  const [removed] = list.splice(index, 1);
  updateScansStockSummaryFromAvailable();
  return cloneDeckEntryRef(removed);
}

function addEntryBackToAvailableScans(type, entryLike) {
  const list = Array.isArray(appState.scans?.available?.[type]) ? appState.scans.available[type] : null;
  if (!list) {
    return;
  }
  const cardId = deckEntryCardId(entryLike);
  if (!cardId) {
    return;
  }
  const totalOwned = Array.isArray(appState.scans?.cards?.[type])
    ? appState.scans.cards[type].filter((candidate) => deckEntryCardId(candidate) === cardId).length
    : 0;
  const availableOwned = list.filter((candidate) => deckEntryCardId(candidate) === cardId).length;
  if (totalOwned > 0 && availableOwned >= totalOwned) {
    return;
  }
  if (type === "creatures" && entryLike && typeof entryLike === "object" && entryLike.scanEntryId) {
    const scanEntryId = String(entryLike.scanEntryId);
    const exists = list.some((candidate) => {
      if (!candidate || typeof candidate !== "object") {
        return false;
      }
      return String(candidate.scanEntryId || "") === scanEntryId;
    });
    if (exists) {
      return;
    }
  }
  list.push(cloneDeckEntryRef(entryLike));
  updateScansStockSummaryFromAvailable();
}

function resolveScansEntryForCard(type, card) {
  const direct = cloneDeckEntryRef(card?._deckEntryRef);
  if (direct) {
    return direct;
  }
  const availableList = Array.isArray(appState.scans?.available?.[type]) ? appState.scans.available[type] : [];
  const cardId = card?.id;
  if (!cardId) {
    return null;
  }
  const match = availableList.find((entry) => deckEntryCardId(entry) === cardId);
  return cloneDeckEntryRef(match || null);
}

async function refreshScansData() {
  const editingDeck = scansEditingDeckName();
  const reservationSnapshot = cloneScansReservations();
  const params = new URLSearchParams();
  params.set("username", currentUsername());
  if (editingDeck) {
    params.set("editingDeckAnchor", editingDeck);
  }
  const query = `?${params.toString()}`;
  const payload = await apiJson(`/api/scans${query}`);
  appState.scans = {
    cards: {
      creatures: Array.isArray(payload?.cards?.creatures) ? payload.cards.creatures : [],
      attacks: Array.isArray(payload?.cards?.attacks) ? payload.cards.attacks : [],
      battlegear: Array.isArray(payload?.cards?.battlegear) ? payload.cards.battlegear : [],
      locations: Array.isArray(payload?.cards?.locations) ? payload.cards.locations : [],
      mugic: Array.isArray(payload?.cards?.mugic) ? payload.cards.mugic : [],
    },
    available: {
      creatures: Array.isArray(payload?.available?.creatures) ? payload.available.creatures : [],
      attacks: Array.isArray(payload?.available?.attacks) ? payload.available.attacks : [],
      battlegear: Array.isArray(payload?.available?.battlegear) ? payload.available.battlegear : [],
      locations: Array.isArray(payload?.available?.locations) ? payload.available.locations : [],
      mugic: Array.isArray(payload?.available?.mugic) ? payload.available.mugic : [],
    },
    stats: payload?.stats || null,
    updatedAt: payload?.updatedAt || null,
  };
  appState.scansReservations = reservationSnapshot;
  applyLocalScansReservations();
  updateScansStockSummaryFromAvailable();
}

function setLibraryView(_view = "scans") {
  appState.libraryView = "scans";
  if (el.libraryViewScans) {
    el.libraryViewScans.classList.add("active");
  }
  renderLibraryCards();
}

function maxCountForType(type) {
  const ruleset = DECK_RULESETS[appState.deck.mode] || DECK_RULESETS.competitive;
  if (ruleset.exactCounts && Number.isFinite(Number(ruleset.exactCounts[type]))) {
    return Number(ruleset.exactCounts[type]);
  }
  return DECK_MAX_COUNTS[type] || Number.POSITIVE_INFINITY;
}

function deckTypeList(deck, type) {
  return Array.isArray(deck?.cards?.[type]) ? deck.cards[type] : [];
}

function filledDeckCount(deck, type) {
  return deckTypeList(deck, type).filter((cardId) => Boolean(cardId)).length;
}

function canAddCardToDeck(type) {
  const current = filledDeckCount(appState.deck, type);
  return current < maxCountForType(type);
}

function addCardToDeck(type, cardRef) {
  const list = deckTypeList(appState.deck, type);
  const limit = maxCountForType(type);
  const storedRef = cloneDeckEntryRef(cardRef);
  for (let index = 0; index < limit; index += 1) {
    if (!list[index]) {
      list[index] = storedRef;
      appState.deck.cards[type] = list;
      return true;
    }
  }
  return false;
}

function clearDeckCardAt(type, index) {
  const list = deckTypeList(appState.deck, type);
  if (index < 0 || index >= list.length) {
    return null;
  }
  const removed = list[index] ? cloneDeckEntryRef(list[index]) : null;
  list[index] = null;
  while (list.length && !list[list.length - 1]) {
    list.pop();
  }
  appState.deck.cards[type] = list;
  return removed;
}

function cardsForSlots(type, size) {
  const list = deckTypeList(appState.deck, type);
  return Array.from({ length: size }, (_, index) => getCardById(list[index]));
}

function cardHasElement(card, elementKey) {
  if (!card || !elementKey) {
    return false;
  }
  const stats = card.stats || {};
  if (card.type === "attacks") {
    const attackElementKeyByElement = {
      fire: "fireAttack",
      air: "airAttack",
      earth: "earthAttack",
      water: "waterAttack",
    };
    const attackStatKey = attackElementKeyByElement[elementKey];
    return Number(stats[attackStatKey] || 0) > 0;
  }
  return Number(stats[elementKey] || 0) > 0;
}

function getFilteredLibraryCards() {
  if (!appState.library) {
    return [];
  }

  const attachEntryRef = (card, entry) => {
    if (!card) {
      return null;
    }
    return {
      ...card,
      _deckEntryRef: entry,
    };
  };

  const source = (() => {
    const scanCards = appState.scans?.available || {};
    if (appState.filterType === "all") {
      return CARD_TYPES.flatMap((type) =>
        (Array.isArray(scanCards[type]) ? scanCards[type] : [])
          .map((entry) => attachEntryRef(getCardById(entry), entry))
          .filter(Boolean)
      );
    }
    return (Array.isArray(scanCards[appState.filterType]) ? scanCards[appState.filterType] : [])
      .map((entry) => attachEntryRef(getCardById(entry), entry))
      .filter(Boolean);
  })();
  const query = appState.filterText.trim().toLowerCase();

  const hasStatFilter = Object.values(appState.filterStats).some((value) => value > 0);
  const setFilters = selectedSetKeys();
  const starFilters = selectedStarKeys();
  const elementFilter = appState.filterElement;
  const tribeFilter = appState.filterTribe;
  const tribeFilterKey = normalizeFilterToken(tribeFilter);
  const activeFlags = Object.keys(appState.filterFlags).filter((flag) => appState.filterFlags[flag]);
  if (!activeFlags.length) {
    return [];
  }

  const filtered = source.filter((card) => {
    const text = `${card.name || ""} ${card.tribe || ""} ${card.set || ""} ${card.ability || ""}`.toLowerCase();
    if (query && !text.includes(query)) {
      return false;
    }

    if (setFilters.size) {
      const setKey = String(card?.set || "").trim().toLowerCase();
      if (!setFilters.has(setKey)) {
        return false;
      }
    }

    if (tribeFilterKey) {
      const tribe = normalizeFilterToken(card.tribe);
      if (!tribe.includes(tribeFilterKey)) {
        return false;
      }
    }

    if (activeFlags.length) {
      const flags = cardFlags(card);
      if (!activeFlags.some((flag) => flags[flag])) {
        return false;
      }
    }

    if (elementFilter && !cardHasElement(card, elementFilter)) {
      return false;
    }

    if (hasStatFilter) {
      if (card.type !== "creatures") {
        return false;
      }
      const stats = card.stats || {};
      if (Number(stats.courage || 0) < appState.filterStats.courage) {
        return false;
      }
      if (Number(stats.power || 0) < appState.filterStats.power) {
        return false;
      }
      if (Number(stats.wisdom || 0) < appState.filterStats.wisdom) {
        return false;
      }
      if (Number(stats.speed || 0) < appState.filterStats.speed) {
        return false;
      }
    }

    if (starFilters.size) {
      if (card.type !== "creatures") {
        return false;
      }
      const starsRaw = Number(card?._scanVariant?.stars ?? card?.variant?.stars);
      const starsKey = Number.isFinite(starsRaw) ? starsRaw.toFixed(1) : "";
      if (!starFilters.has(starsKey)) {
        return false;
      }
    }

    return true;
  });

  return filtered
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const delta = compareCardsBySortField(left.card, right.card);
      if (delta !== 0) {
        return delta;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.card);
}

function renderLibraryCards() {
  const cards = getFilteredLibraryCards();
  const limit = 180;
  const hasSelectedSpecialFlag = Object.keys(appState.filterFlags).some((flag) => appState.filterFlags[flag]);
  const availableMap = scansAvailabilityMap();
  el.cardLibrary.innerHTML = "";

  if (!cards.length) {
    el.cardLibrary.innerHTML = hasSelectedSpecialFlag
      ? `<p>${uiText("noCardsInventoryFiltered")}</p>`
      : `<p>${uiText("markFlagsPrompt")}</p>`;
    renderMobileScanViewer();
    return;
  }

  if (cards.length > limit) {
    const info = document.createElement("p");
    info.textContent = uiText("showingLimited", { limit, total: cards.length });
    el.cardLibrary.appendChild(info);
  }

  cards.slice(0, limit).forEach((card) => {
    const stockKey = `${card.type}:${card.id}`;
    const availableCopies = Number(availableMap.get(stockKey) || 0);
    const addButton = createActionButton("+ Deck", () => {
      if (!canAddCardToDeck(card.type)) {
        alert(uiText("deckLimitAlert", { limit: maxCountForType(card.type), type: TYPE_LABEL[card.type] }));
        return;
      }
      const freshAvailable = scansAvailableCopies(card.type, card.id);
      if (freshAvailable <= 0) {
        alert(uiText("scansOutOfStock"));
        return;
      }
      const scansEntry = resolveScansEntryForCard(card.type, card);
      if (!scansEntry) {
        alert(uiText("scansReserveFail"));
        return;
      }
      const storedRef = card.type === "creatures" ? scansEntry : deckEntryCardId(scansEntry);
      if (!addCardToDeck(card.type, storedRef)) {
        alert(uiText("deckLimitAlert", { limit: maxCountForType(card.type), type: TYPE_LABEL[card.type] }));
        return;
      }
      removeEntryFromAvailableScans(card.type, scansEntry);
      reserveScansEntry(card.type, scansEntry);
      renderDeck();
      renderLibraryCards();
    });
    addButton.disabled = availableCopies <= 0;
    addButton.textContent = availableCopies > 0 ? `+ Deck (${availableCopies})` : "Esgotado";
    const scanTimestamp = card?._deckEntryRef && typeof card._deckEntryRef === "object"
      ? card._deckEntryRef.obtainedAt || null
      : null;
    el.cardLibrary.appendChild(cardNode(card, [addButton], { scanTimestamp }));
  });
  renderMobileScanViewer();
}

function createDeckRow(card, text, onRemove = null, options = {}) {
  const { hoverPreviewEnabled = true, previewOnClick = false } = options;
  const row = document.createElement("div");
  row.className = "deck-row";
  const label = document.createElement("span");
  label.textContent = text;
  row.appendChild(label);
  if (card) {
    if (hoverPreviewEnabled) {
      attachHoverPreview(row, card);
    }
    if (previewOnClick) {
      row.classList.add("deck-row-clickable");
      row.addEventListener("click", (event) => {
        event.stopPropagation();
        showClickPreview(card, event);
      });
    }
  } else {
    row.classList.add("deck-row-empty");
  }
  if (onRemove) {
    const remove = createActionButton("x", onRemove);
    remove.classList.add("remove-mini");
    row.appendChild(remove);
  }
  return row;
}

function createStageCard(card, extraClass, removeHandler, options = {}) {
  const { showRemoveButton = true, removeOnRightClick = false } = options;
  const node = document.createElement("div");
  node.className = `stage-card ${extraClass}`;
  const counter = card && card.stats && card.stats.mugicability !== undefined ? mugicCounterMarkup(card.stats.mugicability, "slot-mugic-counter", card.tribe) : "";
  const removeButton = showRemoveButton ? "<button class=\"remove-mini\" type=\"button\">x</button>" : "";
  node.innerHTML = `
    ${counter}
    <img src="${imageOf(card)}" alt="${card.name}">
    ${removeButton}
  `;
  if (card?.type === "creatures") {
    const starsLabel = creatureStarsLabelFromVariant(normalizeVariant(card?._scanVariant));
    if (starsLabel) {
      const badge = document.createElement("span");
      badge.className = "stage-stars-badge";
      badge.textContent = starsLabel;
      node.appendChild(badge);
    }
  }
  attachHoverPreview(node, card);
  if (showRemoveButton) {
    node.querySelector("button").addEventListener("click", (event) => {
      event.stopPropagation();
      removeHandler();
    });
  }
  if (removeOnRightClick) {
    node.title = "Clique com o botao direito para remover";
    node.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeHandler();
    });
  }
  return node;
}

function renderDeckBoard() {
  const creatureLimit = maxCountForType("creatures");
  const gearLimit = maxCountForType("battlegear");
  const mugicLimit = maxCountForType("mugic");
  const locationLimit = maxCountForType("locations");
  const attackLimit = maxCountForType("attacks");
  const creatures = cardsForSlots("creatures", creatureLimit);
  const gears = cardsForSlots("battlegear", gearLimit);
  const mugics = cardsForSlots("mugic", mugicLimit);
  const locations = cardsForSlots("locations", locationLimit);
  const attacks = cardsForSlots("attacks", attackLimit);
  const stagePositions = appState.deck.mode === "1v1" ? DECK_STAGE_POSITIONS_1V1 : DECK_STAGE_POSITIONS;

  el.creatureGrid.innerHTML = "";
  el.equipmentGrid.innerHTML = "";
  stagePositions.forEach((position, index) => {
    const slotNumber = appState.deck.mode === "1v1" ? 1 : (index === 0 ? 1 : index <= 2 ? 2 : 3);
    const slotStack = document.createElement("div");
    slotStack.className = "deck-slot-stack";
    slotStack.style.left = `${position.x}%`;
    slotStack.style.top = `calc((100% - ${DECK_SLOT_STACK_HEIGHT}px) * ${position.y / 100})`;
    slotStack.style.zIndex = String(position.z);

    const placeholder = document.createElement("div");
    placeholder.className = "stage-placeholder";
    placeholder.textContent = String(slotNumber);
    slotStack.appendChild(placeholder);

    const creature = creatures[index];
    if (creature) {
      const card = createStageCard(
        creature,
        "creature",
        () => {
          const removed = clearDeckCardAt("creatures", index);
          if (removed) {
            releaseScansReservation("creatures", removed);
            addEntryBackToAvailableScans("creatures", removed);
          }
          renderDeck();
          renderLibraryCards();
        },
        { showRemoveButton: false, removeOnRightClick: true }
      );
      card.style.zIndex = "3";
      slotStack.appendChild(card);
    }

    const gear = gears[index];
    if (gear) {
      const gearCard = createStageCard(
        gear,
        "gear",
        () => {
          const removed = clearDeckCardAt("battlegear", index);
          if (removed) {
            releaseScansReservation("battlegear", removed);
            addEntryBackToAvailableScans("battlegear", removed);
          }
          renderDeck();
          renderLibraryCards();
        },
        { showRemoveButton: false, removeOnRightClick: true }
      );
      gearCard.style.zIndex = "2";
      slotStack.appendChild(gearCard);
    }

    el.creatureGrid.appendChild(slotStack);
  });

  el.musicColumn.innerHTML = "<h4>Mugic</h4>";
  if (!mugics.some(Boolean)) {
    el.musicColumn.innerHTML += "<p class=\"empty-col\">Sem mugic.</p>";
  } else {
    let visibleIndex = 0;
    mugics.forEach((card, index) => {
      if (!card) {
        return;
      }
      const stageCard = createStageCard(
        card,
        "mugic",
        () => {
          const removed = clearDeckCardAt("mugic", index);
          if (removed) {
            releaseScansReservation("mugic", removed);
            addEntryBackToAvailableScans("mugic", removed);
          }
          renderDeck();
          renderLibraryCards();
        },
        { showRemoveButton: false, removeOnRightClick: true }
      );
      stageCard.style.marginTop = visibleIndex ? "-5.5rem" : "0";
      stageCard.style.marginLeft = `${Math.min(visibleIndex * 2, 10)}px`;
      stageCard.style.position = "relative";
      stageCard.style.left = "0";
      stageCard.style.top = "0";
      stageCard.style.zIndex = String(visibleIndex + 1);
      el.musicColumn.appendChild(stageCard);
      visibleIndex += 1;
    });
  }

  el.locationStack.innerHTML = "<h4>Locations</h4>";
  for (let index = 0; index < locationLimit; index += 1) {
    const card = locations[index];
    if (!card) {
      el.locationStack.appendChild(createDeckRow(null, `${index + 1}. ---`));
      continue;
    }
    const row = createDeckRow(
      card,
      `${index + 1}. ${card.name}`,
      () => {
        const removed = clearDeckCardAt("locations", index);
        if (removed) {
          releaseScansReservation("locations", removed);
          addEntryBackToAvailableScans("locations", removed);
        }
        renderDeck();
        renderLibraryCards();
      },
      { hoverPreviewEnabled: false, previewOnClick: true }
    );
    el.locationStack.appendChild(row);
  }

  el.attacksColumn.innerHTML = "<h4>Attacks</h4>";
  for (let index = 0; index < attackLimit; index += 1) {
    const card = attacks[index];
    if (!card) {
      el.attacksColumn.appendChild(createDeckRow(null, `${index + 1}. ---`));
      continue;
    }
    const totalDamage = attackTotalDamage(card);
    const bp = Number(card.stats?.bp || 0);
    const row = createDeckRow(
      card,
      `${index + 1}. ${card.name} | DMG ${totalDamage} | BP ${bp}`,
      () => {
        const removed = clearDeckCardAt("attacks", index);
        if (removed) {
          releaseScansReservation("attacks", removed);
          addEntryBackToAvailableScans("attacks", removed);
        }
        renderDeck();
        renderLibraryCards();
      },
      { hoverPreviewEnabled: false, previewOnClick: true }
    );
    el.attacksColumn.appendChild(row);
  }
}

function renderDeckValidation() {
  const rulesetKey = el.deckMode?.value || appState.deck.mode || appState.currentRuleset;
  const validation = validateDeck(appState.deck, rulesetKey);
  const lines = [`Modo: ${(DECK_RULESETS[rulesetKey] || DECK_RULESETS.casual).label}`];
  if (validation.ok) {
    lines.push("Deck valido.");
  } else {
    lines.push("Deck invalido.");
    validation.errors.slice(0, 6).forEach((error) => lines.push(`- ${error}`));
  }
  validation.warnings.forEach((warning) => lines.push(`* ${warning}`));
  el.deckValidation.textContent = lines.join("\n");
  el.deckValidation.classList.toggle("invalid", !validation.ok);
  el.deckValidation.classList.toggle("valid", validation.ok);
}

function renderDeck() {
  const counts = CARD_TYPES.reduce((acc, type) => {
    acc[type] = filledDeckCount(appState.deck, type);
    return acc;
  }, {});
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  el.deckSummary.innerHTML = "";
  [
    `Creature ${counts.creatures}`,
    `Attack ${counts.attacks}`,
    `Gear ${counts.battlegear}`,
    `Location ${counts.locations}`,
    `Mugic ${counts.mugic}`,
    `Total ${total}`,
  ].forEach((text) => {
    const chip = document.createElement("span");
    chip.textContent = text;
    el.deckSummary.appendChild(chip);
  });

  renderDeckBoard();
  renderDeckValidation();
}

function refreshScansUi() {
  void refreshScansData()
    .then(() => {
      renderLibraryCards();
    })
    .catch(() => {
      // keep builder usable even if scans endpoint is temporarily unavailable
    });
}

async function loadLibrary() {
  const library = await apiJson("/api/library");
  appState.library = library;
  appState.cardsById = new Map(library.cards.map((card) => [card.id, card]));
  populateSetFilterOptions();
  await refreshScansData();
  el.libraryMeta.textContent =
    `Cartas ${library.stats.totalCards} | Cr ${library.stats.creatures} | Atk ${library.stats.attacks} | ` +
    `Gear ${library.stats.battlegear} | Loc ${library.stats.locations} | Mugic ${library.stats.mugic}`;
  syncLibraryFilterControlsFromState();
  renderLibraryCards();
}

async function refreshDeckList() {
  const response = await apiJson(`/api/decks?username=${encodeURIComponent(currentUsername())}`);
  appState.savedDecks = response.decks || [];
  [el.deckList, el.battleDeckA, el.battleDeckB].filter(Boolean).forEach((select) => {
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecione deck";
    select.appendChild(placeholder);
    appState.savedDecks.forEach((deck) => {
      const option = document.createElement("option");
      option.value = deck.name;
      option.textContent = deck.name;
      select.appendChild(option);
    });
  });
  await updateBattleSetupDeckInfo();
}

function syncModeSelectors(mode) {
  const normalizedMode = DECK_RULESETS[mode] ? mode : "competitive";
  appState.currentRuleset = normalizedMode;
  appState.deck.mode = normalizedMode;
  if (el.deckMode) {
    el.deckMode.value = normalizedMode;
  }
  if (el.battleMode && [...el.battleMode.options].some((option) => option.value === normalizedMode)) {
    el.battleMode.value = normalizedMode;
  }
  void updateBattleSetupDeckInfo();
}

function countDeckCards(deck) {
  return {
    creatures: Array.isArray(deck.cards?.creatures) ? deck.cards.creatures.length : 0,
    battlegear: Array.isArray(deck.cards?.battlegear) ? deck.cards.battlegear.length : 0,
    mugic: Array.isArray(deck.cards?.mugic) ? deck.cards.mugic.length : 0,
    attacks: Array.isArray(deck.cards?.attacks) ? deck.cards.attacks.length : 0,
    locations: Array.isArray(deck.cards?.locations) ? deck.cards.locations.length : 0,
  };
}

async function renderBattleDeckInfo(targetEl, deckName, mode) {
  if (!targetEl) {
    return;
  }
  targetEl.classList.remove("valid", "invalid");
  if (!deckName) {
    targetEl.textContent = "Selecione um deck para ver detalhes.";
    return;
  }
  try {
    const deck = await apiJson(
      `/api/decks/${encodeURIComponent(deckName)}?username=${encodeURIComponent(currentUsername())}`
    );
    const counts = countDeckCards(deck);
    const validation = validateDeck(deck, mode);
    if (validation.ok) {
      targetEl.classList.add("valid");
    } else {
      targetEl.classList.add("invalid");
    }
    const status = validation.ok ? "Deck valido" : "Deck invalido";
    const counters =
      `Cr ${counts.creatures} | Gear ${counts.battlegear} | Mugic ${counts.mugic} | ` +
      `Atk ${counts.attacks} | Loc ${counts.locations}`;
    const err =
      validation.ok || !validation.errors.length
        ? ""
        : `\n${validation.errors.slice(0, 2).join(" | ")}`;
    targetEl.textContent = `${status}\n${counters}${err}`;
  } catch (error) {
    targetEl.classList.add("invalid");
    targetEl.textContent = `Falha ao carregar deck: ${error.message}`;
  }
}

async function updateBattleSetupDeckInfo() {
  const mode = el.battleMode?.value || appState.currentRuleset || "competitive";
  await Promise.all([
    renderBattleDeckInfo(el.battleDeckAInfo, el.battleDeckA?.value || "", mode),
    renderBattleDeckInfo(el.battleDeckBInfo, el.battleDeckB?.value || "", mode),
  ]);
}

async function saveDeck() {
  const name = el.deckName.value.trim();
  if (!name) {
    alert("Defina um nome para o deck.");
    return;
  }
  const mode = el.deckMode?.value || appState.deck.mode || "competitive";
  const editingDeckAnchorBeforeSave = scansEditingDeckName() || name;
  appState.deck.mode = mode;
  const validation = validateDeck(appState.deck, mode);
  if (!validation.ok) {
    alert(`Deck invalido:\n${validation.errors.slice(0, 4).join("\n")}`);
    return;
  }
  await apiJson(`/api/decks/${encodeURIComponent(name)}?username=${encodeURIComponent(currentUsername())}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      owner: currentUsername(),
      editingDeckAnchor: editingDeckAnchorBeforeSave,
      createdAt: appState.deck.createdAt || new Date().toISOString(),
      mode,
      cards: appState.deck.cards,
    }),
  });
  appState.deck.name = name;
  appState.editingDeckAnchor = name;
  clearScansReservations();
  await refreshDeckList();
  await refreshScansData();
  renderLibraryCards();
  alert("Deck salvo.");
}

async function loadDeck(deckName) {
  if (!deckName) {
    return;
  }
  const payload = await apiJson(
    `/api/decks/${encodeURIComponent(deckName)}?username=${encodeURIComponent(currentUsername())}`
  );
  clearScansReservations();
  appState.deck = {
    name: payload.name || deckName,
    createdAt: payload.createdAt || null,
    mode: payload.mode || "competitive",
    cards: {
      creatures: Array.isArray(payload.cards?.creatures) ? payload.cards.creatures : [],
      attacks: Array.isArray(payload.cards?.attacks) ? payload.cards.attacks : [],
      battlegear: Array.isArray(payload.cards?.battlegear) ? payload.cards.battlegear : [],
      locations: Array.isArray(payload.cards?.locations) ? payload.cards.locations : [],
      mugic: Array.isArray(payload.cards?.mugic) ? payload.cards.mugic : [],
    },
  };
  appState.editingDeckAnchor = appState.deck.name || deckName;
  syncModeSelectors(appState.deck.mode);
  el.deckName.value = appState.deck.name;
  renderDeck();
  await refreshScansData();
  renderLibraryCards();
}

async function deleteDeck(deckName) {
  if (!deckName) {
    return;
  }
  const deckNamesBeforeDelete = Array.isArray(appState.savedDecks)
    ? appState.savedDecks.map((deck) => String(deck?.name || "").trim()).filter(Boolean)
    : [];
  const selectedDeckIndexBeforeDelete = Math.max(0, deckNamesBeforeDelete.indexOf(String(deckName || "").trim()));
  const confirmed = window.confirm(`Excluir o deck "${deckName}"?`);
  if (!confirmed) {
    return;
  }
  const deletion = await apiJson(`/api/decks/${encodeURIComponent(deckName)}?username=${encodeURIComponent(currentUsername())}`, {
    method: "DELETE",
  });

  const loadedDeckName = (appState.deck?.name || "").trim();
  const nameInput = (el.deckName?.value || "").trim();
  const shouldResetBuilder = loadedDeckName === deckName || nameInput === deckName;

  if (shouldResetBuilder) {
    appState.deck = createEmptyDeck();
    appState.editingDeckAnchor = "";
    clearScansReservations();
    syncModeSelectors(appState.deck.mode);
    el.deckName.value = "";
    renderDeck();
  }

  await refreshDeckList();
  const deckNamesAfterDelete = Array.isArray(appState.savedDecks)
    ? appState.savedDecks.map((deck) => String(deck?.name || "").trim()).filter(Boolean)
    : [];
  if (deckNamesAfterDelete.length && el.deckList) {
    const nextDeckName = selectedDeckIndexBeforeDelete < deckNamesAfterDelete.length
      ? deckNamesAfterDelete[selectedDeckIndexBeforeDelete]
      : deckNamesAfterDelete[deckNamesAfterDelete.length - 1];
    el.deckList.value = nextDeckName;
  }
  await refreshScansData();
  renderLibraryCards();
  const returnedCount = Math.max(0, Number(deletion?.returnedCount || 0));
  const skippedByCapCount = Math.max(0, Number(deletion?.skippedByCapCount || 0));
  if (skippedByCapCount > 0) {
    alert(`Deck excluido. Cartas devolvidas: ${returnedCount}. Ignoradas por limite de 3 copias: ${skippedByCapCount}.`);
    return;
  }
  alert(`Deck excluido. Cartas devolvidas: ${returnedCount}.`);
}

function toBattleDeck(deck) {
  const byType = {};
  CARD_TYPES.forEach((type) => {
    byType[type] = (deck.cards[type] || []).map((cardId) => getCardById(cardId)).filter(Boolean);
  });
  return byType;
}

function keybindButtonMap() {
  return {
    confirmAction: el.keybindConfirmAction,
    confirmAttack: el.keybindConfirmAttack,
    autoStep: el.keybindAutoStep,
    switchBuilder: el.keybindSwitchBuilder,
    switchBattle: el.keybindSwitchBattle,
    switchSettings: el.keybindSwitchSettings,
    cancel: el.keybindCancel,
  };
}

function updateKeybindButtons() {
  const map = keybindButtonMap();
  KEYBIND_ACTIONS.forEach((action) => {
    const button = map[action];
    if (!button) {
      return;
    }
    button.classList.toggle("capture", appState.keybindCaptureAction === action);
    if (appState.keybindCaptureAction === action) {
      button.textContent = "Pressione...";
    } else {
      button.textContent = keyCodeLabel(appState.settings.controls.keybinds[action]);
    }
  });
}

function syncSettingsControlsFromState() {
  const settings = appState.settings;
  if (el.settingFullscreenAuto) {
    el.settingFullscreenAuto.checked = Boolean(settings.screen.fullscreenAuto);
  }
  if (el.settingResolution) {
    el.settingResolution.value = settings.screen.resolution;
  }
  if (el.settingAudioEnabled) {
    el.settingAudioEnabled.checked = Boolean(settings.audio.enabled);
  }
  if (el.settingAudioMaster) {
    el.settingAudioMaster.value = String(settings.audio.master);
  }
  if (el.settingAudioSfx) {
    el.settingAudioSfx.value = String(settings.audio.sfx);
  }
  if (el.settingAudioMusic) {
    el.settingAudioMusic.value = String(settings.audio.music);
  }
  if (el.settingCardLanguage) {
    el.settingCardLanguage.value = settings.language.cards;
  }
  if (el.settingUiLanguage) {
    el.settingUiLanguage.value = settings.language.ui;
  }
  if (el.settingGameplayAnimations) {
    el.settingGameplayAnimations.checked = Boolean(settings.gameplay.animations);
  }
  if (el.settingGameplayHints) {
    el.settingGameplayHints.checked = Boolean(settings.gameplay.hints);
  }
  if (el.settingMenuGlobalChat) {
    el.settingMenuGlobalChat.checked = Boolean(settings.menuHomePanels?.globalChatEnabled);
  }
  if (el.settingMenuTop50) {
    el.settingMenuTop50.checked = Boolean(settings.menuHomePanels?.top50Enabled);
  }
  if (el.settingMouseSensitivity) {
    el.settingMouseSensitivity.value = String(settings.controls.mouseSensitivity);
  }
  if (el.settingTheme) {
    el.settingTheme.value = settings.extras.theme;
  }
  if (el.settingFpsCounter) {
    el.settingFpsCounter.checked = Boolean(settings.extras.fpsCounter);
  }
  if (el.settingDebugMode) {
    el.settingDebugMode.checked = Boolean(settings.extras.debugMode);
  }
  updateKeybindButtons();
}

function settingsFromControls() {
  const draft = cloneDefaultSettings();
  draft.screen.fullscreenAuto = Boolean(el.settingFullscreenAuto?.checked);
  draft.screen.resolution = normalizeResolution(el.settingResolution?.value);
  draft.audio.enabled = Boolean(el.settingAudioEnabled?.checked);
  draft.audio.master = clampNumber(el.settingAudioMaster?.value, 0, 100, draft.audio.master);
  draft.audio.sfx = clampNumber(el.settingAudioSfx?.value, 0, 100, draft.audio.sfx);
  draft.audio.music = clampNumber(el.settingAudioMusic?.value, 0, 100, draft.audio.music);
  draft.language.cards = normalizeLanguage(el.settingCardLanguage?.value);
  draft.language.ui = normalizeLanguage(el.settingUiLanguage?.value);
  draft.gameplay.animations = Boolean(el.settingGameplayAnimations?.checked);
  draft.gameplay.hints = Boolean(el.settingGameplayHints?.checked);
  draft.menuHomePanels.globalChatEnabled = Boolean(el.settingMenuGlobalChat?.checked);
  draft.menuHomePanels.top50Enabled = Boolean(el.settingMenuTop50?.checked);
  draft.controls.mouseSensitivity = clampNumber(
    el.settingMouseSensitivity?.value,
    1,
    200,
    draft.controls.mouseSensitivity
  );
  KEYBIND_ACTIONS.forEach((action) => {
    draft.controls.keybinds[action] = normalizeKeyCode(
      appState.settings.controls.keybinds[action],
      DEFAULT_SETTINGS.controls.keybinds[action]
    );
  });
  draft.extras.theme = normalizeTheme(el.settingTheme?.value);
  draft.extras.fpsCounter = Boolean(el.settingFpsCounter?.checked);
  draft.extras.debugMode = Boolean(el.settingDebugMode?.checked);
  draft.musicPlayer.enabled = coerceBoolean(appState.settings.musicPlayer?.enabled, draft.musicPlayer.enabled);
  draft.musicPlayer.loopTrack = coerceBoolean(appState.settings.musicPlayer?.loopTrack, draft.musicPlayer.loopTrack);
  draft.musicPlayer.lastTrackIndex = clampNumber(
    appState.settings.musicPlayer?.lastTrackIndex,
    0,
    9999,
    draft.musicPlayer.lastTrackIndex
  );
  draft.musicPlayer.volume = clampNumber(
    appState.settings.musicPlayer?.volume,
    0,
    100,
    draft.musicPlayer.volume
  );
  draft.updatedAt = new Date().toISOString();
  return sanitizeSettings(draft);
}

function setSettingsFeedback(message, tone = "info") {
  if (!el.settingsFeedback) {
    return;
  }
  el.settingsFeedback.textContent = message;
  el.settingsFeedback.style.color = tone === "error"
    ? "#ff9ea7"
    : tone === "success"
      ? "#9be6a8"
      : "#9ac7ff";
}

function stopAdminMetricsAutoRefresh() {
  if (appState.adminMetrics.pollTimerId) {
    clearInterval(appState.adminMetrics.pollTimerId);
    appState.adminMetrics.pollTimerId = null;
  }
}

function renderAdminMetrics(snapshot) {
  if (!el.adminObservabilityGrid) {
    return;
  }
  const perim = snapshot?.perimStateLatencyMs || {};
  const errorsMap = snapshot?.errorsByRoute && typeof snapshot.errorsByRoute === "object"
    ? snapshot.errorsByRoute
    : {};
  const errors = Object.entries(errorsMap)
    .map(([route, total]) => ({ route, total: Number(total || 0) }))
    .sort((a, b) => b.total - a.total);
  const cache = snapshot?.cache || {};
  const firstError = errors[0];
  const lines = [
    { label: "Perim p50", value: `${Number(perim.p50 || 0)} ms` },
    { label: "Perim p95", value: `${Number(perim.p95 || 0)} ms` },
    { label: "Perim p99", value: `${Number(perim.p99 || 0)} ms` },
    { label: "Erros (top)", value: firstError ? `${firstError.route} (${firstError.total})` : "Sem erros recentes" },
    { label: "Jogadores online", value: String(Number(snapshot?.onlinePlayers || 0)) },
    { label: "Salas multiplayer", value: String(Number(snapshot?.activeRooms?.multiplayer || 0)) },
    { label: "Trades ativos", value: String(Number(snapshot?.activeRooms?.trades || 0)) },
    { label: "Trades concluidas", value: String(Number(snapshot?.trades?.completed || 0)) },
    { label: "Cache hit", value: String(Number(cache.hits || 0)) },
    { label: "Cache miss", value: String(Number(cache.misses || 0)) },
    { label: "Cache invalida", value: String(Number(cache.invalidations || 0)) },
    { label: "Perim degraded", value: snapshot?.jobs?.perim?.degraded ? "SIM" : "NAO" },
  ];
  el.adminObservabilityGrid.innerHTML = lines
    .map((line) => `
      <div class="admin-observability-item">
        <strong>${escapeHtml(line.label)}</strong>
        <span>${escapeHtml(line.value)}</span>
      </div>
    `)
    .join("");
  if (el.adminObservabilityUpdated) {
    const dateText = snapshot?.generatedAt ? new Date(snapshot.generatedAt).toLocaleString("pt-BR") : "agora";
    el.adminObservabilityUpdated.textContent = `Atualizado em ${dateText}`;
  }
}

async function refreshAdminMetrics() {
  if (!appState.user.isAdmin || !el.adminObservabilitySection) {
    return;
  }
  try {
    const payload = await apiJson("/api/admin/metrics");
    if (!payload?.ok) {
      throw new Error(payload?.error || "Falha ao carregar metricas.");
    }
    appState.adminMetrics.latest = payload;
    renderAdminMetrics(payload);
  } catch (error) {
    if (el.adminObservabilityUpdated) {
      el.adminObservabilityUpdated.textContent = `Erro: ${error?.message || "nao foi possivel atualizar metricas"}`;
    }
  }
}

function startAdminMetricsAutoRefresh() {
  if (!appState.user.isAdmin || appState.currentTab !== "settings" || !el.adminObservabilitySection) {
    return;
  }
  stopAdminMetricsAutoRefresh();
  void refreshAdminMetrics();
  appState.adminMetrics.pollTimerId = setInterval(() => {
    void refreshAdminMetrics();
  }, 8000);
}

function syncAdminObservabilityVisibility() {
  if (!el.adminObservabilitySection) {
    return;
  }
  const show = Boolean(appState.user.isAdmin);
  el.adminObservabilitySection.classList.toggle("hidden", !show);
  if (!show) {
    stopAdminMetricsAutoRefresh();
  }
}

function applyInterfaceLanguage() {
  const language = normalizeLanguage(appState.settings.language.ui);
  const dictionary = UI_LANGUAGE_LABELS[language] || UI_LANGUAGE_LABELS.pt;
  const setFilterTitleEl = document.querySelector("#set-filter-title");
  const starsFilterTitleEl = document.querySelector("#stars-filter-title");
  const libraryTitleEl = document.querySelector("#library-title");
  const deckTitleEl = document.querySelector("#deck-title");
  if (el.tabBuilder) {
    el.tabBuilder.textContent = dictionary.tabBuilder;
  }
  if (el.tabBattle) {
    el.tabBattle.textContent = dictionary.tabBattle;
  }
  if (el.tabSettings) {
    el.tabSettings.textContent = dictionary.tabSettings;
  }
  if (el.mobileScanViewerToggle) {
    el.mobileScanViewerToggle.textContent = dictionary.mobileViewerToggle;
  }
  if (el.reloadLibrary) {
    el.reloadLibrary.textContent = dictionary.reload;
  }
  if (el.settingsTitle) {
    el.settingsTitle.textContent = dictionary.settingsTitle;
  }
  if (el.saveSettings) {
    el.saveSettings.textContent = dictionary.settingsSave;
  }
  if (el.settingsScreenTitle) {
    el.settingsScreenTitle.textContent = dictionary.settingsScreenTitle;
  }
  if (el.settingsAudioTitle) {
    el.settingsAudioTitle.textContent = dictionary.settingsAudioTitle;
  }
  if (el.settingsLanguageTitle) {
    el.settingsLanguageTitle.textContent = dictionary.settingsLanguageTitle;
  }
  if (el.settingsGameplayTitle) {
    el.settingsGameplayTitle.textContent = dictionary.settingsGameplayTitle;
  }
  if (el.settingsProgressTitle) {
    el.settingsProgressTitle.textContent = dictionary.settingsProgressTitle;
  }
  if (el.settingsControlsTitle) {
    el.settingsControlsTitle.textContent = dictionary.settingsControlsTitle;
  }
  if (el.settingsExtrasTitle) {
    el.settingsExtrasTitle.textContent = dictionary.settingsExtrasTitle;
  }
  if (el.resetProgress) {
    el.resetProgress.textContent = dictionary.resetProgress;
  }
  if (libraryTitleEl) {
    libraryTitleEl.textContent = dictionary.libraryTitle;
  }
  if (deckTitleEl) {
    deckTitleEl.textContent = dictionary.deckTitle;
  }
  if (el.libraryViewLibrary) {
    el.libraryViewLibrary.textContent = dictionary.libraryViewLibrary;
  }
  if (el.libraryViewScans) {
    el.libraryViewScans.textContent = dictionary.libraryViewScans;
  }
  if (el.cardSearch) {
    el.cardSearch.placeholder = dictionary.cardSearchPlaceholder;
  }
  if (el.clearLibraryFilters) {
    el.clearLibraryFilters.textContent = dictionary.clearFilters;
  }
  if (setFilterTitleEl) {
    setFilterTitleEl.textContent = dictionary.setFilterTitle;
  }
  if (starsFilterTitleEl) {
    starsFilterTitleEl.textContent = dictionary.starsFilterTitle;
  }
  if (el.starsFilter) {
    const allOption = el.starsFilter.querySelector('option[value=""]');
    if (allOption) {
      allOption.textContent = dictionary.starsFilterAll;
    }
  }
  if (el.sortFieldFilter) {
    const labels = {
      name: dictionary.sortFieldName,
      set: dictionary.sortFieldSet,
      rarity: dictionary.sortFieldRarity,
      type: dictionary.sortFieldType,
      stars: dictionary.sortFieldStars,
    };
    [...el.sortFieldFilter.options].forEach((option) => {
      const key = String(option.value || "");
      if (labels[key]) {
        option.textContent = labels[key];
      }
    });
  }
  if (el.sortDirectionFilter) {
    const labels = {
      asc: dictionary.sortDirectionAsc,
      desc: dictionary.sortDirectionDesc,
    };
    [...el.sortDirectionFilter.options].forEach((option) => {
      const key = String(option.value || "");
      if (labels[key]) {
        option.textContent = labels[key];
      }
    });
  }
  updateScansStockSummaryFromAvailable();
}

function stopFpsCounter() {
  if (appState.fpsCounter.rafId !== null) {
    cancelAnimationFrame(appState.fpsCounter.rafId);
    appState.fpsCounter.rafId = null;
  }
  appState.fpsCounter.frames = 0;
  appState.fpsCounter.lastTick = 0;
  if (el.fpsCounter) {
    el.fpsCounter.classList.add("hidden");
    el.fpsCounter.textContent = "FPS: --";
  }
}

function startFpsCounter() {
  if (!el.fpsCounter || appState.fpsCounter.rafId !== null) {
    return;
  }
  el.fpsCounter.classList.remove("hidden");
  const tick = (timestamp) => {
    if (!appState.settings.extras.fpsCounter) {
      stopFpsCounter();
      return;
    }
    if (!appState.fpsCounter.lastTick) {
      appState.fpsCounter.lastTick = timestamp;
      appState.fpsCounter.frames = 0;
    }
    appState.fpsCounter.frames += 1;
    const delta = timestamp - appState.fpsCounter.lastTick;
    if (delta >= 500) {
      const fps = Math.round((appState.fpsCounter.frames * 1000) / delta);
      el.fpsCounter.textContent = `FPS: ${fps}`;
      appState.fpsCounter.lastTick = timestamp;
      appState.fpsCounter.frames = 0;
    }
    appState.fpsCounter.rafId = requestAnimationFrame(tick);
  };
  appState.fpsCounter.rafId = requestAnimationFrame(tick);
}

function debugIsEnabled() {
  return Boolean(appState.settings.extras.debugMode);
}

function enqueueDebugLog(entry) {
  if (!debugIsEnabled()) {
    return;
  }
  appState.debug.buffer.push(entry);
}

function debugLog(type, message, payload = null) {
  if (!debugIsEnabled()) {
    return;
  }
  const line = {
    at: new Date().toISOString(),
    type: String(type || "event"),
    message: String(message || ""),
    payload,
  };
  enqueueDebugLog(line);
}

async function flushDebugBuffer(force = false) {
  if (!appState.debug.active || !appState.debug.sessionId || !appState.debug.buffer.length) {
    return;
  }
  if (!force && appState.debug.buffer.length < 4) {
    return;
  }
  const entries = appState.debug.buffer.splice(0, appState.debug.buffer.length);
  try {
    await apiJson("/api/debug/session/append", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: appState.debug.sessionId,
        entries,
      }),
    });
  } catch (_error) {
    // Keep session running even if append fails once.
  }
}

async function startDebugSession() {
  if (!debugIsEnabled() || appState.debug.active) {
    return;
  }
  try {
    const response = await apiJson("/api/debug/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: window.location.href,
        userAgent: navigator.userAgent,
        settings: appState.settings,
      }),
    });
    appState.debug.sessionId = response.sessionId || null;
    appState.debug.active = Boolean(appState.debug.sessionId);
    appState.debug.lastBattleLogIndex = 0;
    if (appState.debug.active && !appState.debug.flushTimerId) {
      appState.debug.flushTimerId = window.setInterval(() => {
        void flushDebugBuffer(false);
      }, DEBUG_FLUSH_INTERVAL_MS);
    }
    debugLog("debug", "Debug mode enabled.");
  } catch (_error) {
    appState.debug.active = false;
    appState.debug.sessionId = null;
  }
}

async function stopDebugSession(reason = "settings_change") {
  if (!appState.debug.active || !appState.debug.sessionId) {
    return;
  }
  const sessionId = appState.debug.sessionId;
  await flushDebugBuffer(true);
  try {
    await apiJson("/api/debug/session/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        reason,
        entries: appState.debug.buffer.splice(0, appState.debug.buffer.length),
      }),
    });
  } catch (_error) {
    // Ignore finalization errors.
  }
  appState.debug.active = false;
  appState.debug.sessionId = null;
  appState.debug.buffer = [];
  appState.debug.lastBattleLogIndex = 0;
  if (appState.debug.flushTimerId) {
    clearInterval(appState.debug.flushTimerId);
    appState.debug.flushTimerId = null;
  }
}

function applySettingsRuntime() {
  const settings = appState.settings;
  document.body.dataset.theme = settings.extras.theme;
  document.body.classList.toggle("resolution-low", settings.screen.resolution === "low");
  document.body.classList.toggle("resolution-medium", settings.screen.resolution === "medium");
  document.body.classList.toggle("resolution-high", settings.screen.resolution === "high");
  document.body.classList.toggle("no-animations", !settings.gameplay.animations);
  if (el.phaseHelp) {
    el.phaseHelp.classList.toggle("hidden", !settings.gameplay.hints);
  }
  if (settings.extras.fpsCounter) {
    startFpsCounter();
  } else {
    stopFpsCounter();
  }
  applyInterfaceLanguage();
  window.__chaoticAudioSettings = {
    enabled: settings.audio.enabled,
    master: settings.audio.master,
    sfx: settings.audio.sfx,
    music: settings.audio.music,
  };
  applyMusicPlayerRuntime();
}

async function persistSettingsState() {
  appState.settings.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(appState.settings));
  } catch (_error) {
    // Ignore storage quota errors and keep server mirror.
  }
  try {
    await apiJson("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: appState.settings,
      }),
    });
  } catch (_error) {
    // Keep local copy as source of truth when server mirror fails.
  }
}

async function loadSettingsState() {
  let localRaw = null;
  try {
    const localText = localStorage.getItem(SETTINGS_STORAGE_KEY);
    localRaw = localText ? JSON.parse(localText) : null;
  } catch (_error) {
    localRaw = null;
  }

  let serverRaw = null;
  try {
    const response = await apiJson("/api/settings");
    if (response?.settings && typeof response.settings === "object") {
      serverRaw = {
        ...response.settings,
        updatedAt: response.updatedAt || null,
        schemaVersion: response.schemaVersion || SETTINGS_SCHEMA_VERSION,
      };
    }
  } catch (_error) {
    serverRaw = null;
  }

  const base = sanitizeSettings(serverRaw || DEFAULT_SETTINGS);
  if (localRaw) {
    const localSettings = sanitizeSettings(localRaw);
    const localAt = Date.parse(localSettings.updatedAt || 0);
    const serverAt = Date.parse(base.updatedAt || 0);
    appState.settings = localAt >= serverAt ? localSettings : base;
  } else {
    appState.settings = base;
  }
  syncSettingsControlsFromState();
  applySettingsRuntime();
  if (debugIsEnabled()) {
    await startDebugSession();
  }
}

async function saveSettingsFromUi() {
  const wasDebug = debugIsEnabled();
  appState.settings = settingsFromControls();
  syncSettingsControlsFromState();
  applySettingsRuntime();
  await persistSettingsState();
  const nowDebug = debugIsEnabled();
  if (!wasDebug && nowDebug) {
    await startDebugSession();
  } else if (wasDebug && !nowDebug) {
    await stopDebugSession("disabled_from_settings");
  }
  setSettingsFeedback("Configuracoes salvas.", "success");
}

function startKeybindCapture(action) {
  appState.keybindCaptureAction = action;
  updateKeybindButtons();
  setSettingsFeedback(`Pressione uma tecla para ${action}.`, "info");
}

function resetKeybindDefaults() {
  KEYBIND_ACTIONS.forEach((action) => {
    appState.settings.controls.keybinds[action] = DEFAULT_SETTINGS.controls.keybinds[action];
  });
  updateKeybindButtons();
  setSettingsFeedback("Teclas padrao restauradas.", "success");
}

function formatAudioTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function musicPlayerVolumeFactor() {
  const settings = appState.settings;
  if (!settings.audio.enabled || !settings.musicPlayer.enabled) {
    return 0;
  }
  const master = clampNumber(settings.audio.master, 0, 100, 100) / 100;
  const music = clampNumber(settings.audio.music, 0, 100, 100) / 100;
  const localVolume = clampNumber(settings.musicPlayer.volume, 0, 100, 100) / 100;
  return Math.max(0, Math.min(1, master * music * localVolume));
}

function updateMusicPlayerHeader() {
  if (!el.musicTrackName) {
    return;
  }
  const track = appState.musicPlayer.tracks[appState.musicPlayer.currentIndex] || null;
  el.musicTrackName.textContent = track ? track.name : "Sem musica";
}

function updateMusicPlayerLoopButton() {
  if (!el.musicLoop) {
    return;
  }
  const active = Boolean(appState.settings.musicPlayer.loopTrack);
  el.musicLoop.classList.toggle("active", active);
  el.musicLoop.textContent = active ? "Loop On" : "Loop";
}

function updateMusicPlayerToggleButton() {
  if (!el.musicToggle || !el.musicAudio) {
    return;
  }
  el.musicToggle.innerHTML = el.musicAudio.paused ? "&#9654;" : "&#9208;";
}

function updateMusicPlayerProgress() {
  if (!el.musicAudio || !el.musicProgress || !el.musicCurrentTime || !el.musicDuration) {
    return;
  }
  const duration = Number.isFinite(el.musicAudio.duration) ? el.musicAudio.duration : 0;
  const current = Math.max(0, Number(el.musicAudio.currentTime || 0));
  const percent = duration > 0 ? (current / duration) * 100 : 0;
  if (!appState.musicPlayer.seeking) {
    el.musicProgress.value = String(percent);
  }
  el.musicCurrentTime.textContent = formatAudioTime(current);
  el.musicDuration.textContent = formatAudioTime(duration);
}

function updateMusicPlayerVolumeUi() {
  if (!el.musicPlayerVolume) {
    return;
  }
  el.musicPlayerVolume.value = String(clampNumber(appState.settings.musicPlayer.volume, 0, 100, 100));
}

function applyMusicPlayerVolume() {
  if (!el.musicAudio) {
    return;
  }
  el.musicAudio.volume = musicPlayerVolumeFactor();
}

function setMusicTrack(index, keepPosition = false) {
  if (!el.musicAudio || !appState.musicPlayer.tracks.length) {
    return;
  }
  const total = appState.musicPlayer.tracks.length;
  const normalized = ((Number(index) || 0) % total + total) % total;
  const track = appState.musicPlayer.tracks[normalized];
  if (!track) {
    return;
  }
  appState.musicPlayer.currentIndex = normalized;
  appState.settings.musicPlayer.lastTrackIndex = normalized;
  el.musicAudio.src = track.url;
  if (!keepPosition) {
    el.musicAudio.currentTime = 0;
  }
  updateMusicPlayerHeader();
  updateMusicPlayerProgress();
  void persistSettingsState();
}

async function playMusicCurrentTrack() {
  if (!el.musicAudio || !appState.musicPlayer.tracks.length) {
    return;
  }
  if (!appState.settings.audio.enabled || !appState.settings.musicPlayer.enabled) {
    return;
  }
  if (!el.musicAudio.src) {
    setMusicTrack(appState.musicPlayer.currentIndex);
  }
  applyMusicPlayerVolume();
  try {
    await el.musicAudio.play();
    appState.musicPlayer.autoplayTriggered = true;
    debugLog("music", "play", {
      track: appState.musicPlayer.tracks[appState.musicPlayer.currentIndex]?.name || "",
    });
  } catch (_error) {
    // Browser may block until a trusted gesture.
  }
  updateMusicPlayerToggleButton();
}

function pauseMusicPlayback() {
  if (!el.musicAudio) {
    return;
  }
  el.musicAudio.pause();
  updateMusicPlayerToggleButton();
}

async function playNextTrack(autoPlay = true) {
  if (!appState.musicPlayer.tracks.length) {
    return;
  }
  setMusicTrack(appState.musicPlayer.currentIndex + 1);
  debugLog("music", "next", {
    index: appState.musicPlayer.currentIndex,
  });
  if (autoPlay) {
    await playMusicCurrentTrack();
  }
}

async function playPreviousTrack(autoPlay = true) {
  if (!appState.musicPlayer.tracks.length) {
    return;
  }
  setMusicTrack(appState.musicPlayer.currentIndex - 1);
  debugLog("music", "previous", {
    index: appState.musicPlayer.currentIndex,
  });
  if (autoPlay) {
    await playMusicCurrentTrack();
  }
}

function maybeAutoplayMusicAfterInteraction() {
  if (!appState.musicPlayer.ready || appState.musicPlayer.unlockBound) {
    return;
  }
  appState.musicPlayer.unlockBound = true;
  
  const attemptPlay = async () => {
    if (appState.settings.audio.enabled && appState.settings.musicPlayer.enabled) {
      try {
        await playMusicCurrentTrack();
      } catch (e) {
        console.warn("Autoplay prevented by browser. Waiting for interaction...");
        window.addEventListener("pointerdown", async () => {
          await playMusicCurrentTrack();
        }, { once: true });
      }
    }
  };
  attemptPlay();
}

function applyMusicPlayerRuntime() {
  if (!el.musicPlayer || !el.musicAudio) {
    return;
  }
  const hasTracks = appState.musicPlayer.tracks.length > 0;
  el.musicPlayer.classList.toggle("hidden", !hasTracks);
  if (!hasTracks) {
    pauseMusicPlayback();
    return;
  }
  updateMusicPlayerVolumeUi();
  applyMusicPlayerVolume();
  updateMusicPlayerLoopButton();
  updateMusicPlayerHeader();
  if (!appState.settings.audio.enabled || !appState.settings.musicPlayer.enabled) {
    pauseMusicPlayback();
  } else if (appState.musicPlayer.autoplayTriggered && el.musicAudio.paused) {
    void playMusicCurrentTrack();
  }
  maybeAutoplayMusicAfterInteraction();
}

async function loadMusicTracks() {
  if (!el.musicPlayer || !el.musicAudio) {
    return;
  }
  try {
    const response = await apiJson("/api/music");
    const tracks = Array.isArray(response?.tracks) ? response.tracks : [];
    appState.musicPlayer.tracks = tracks.map((track, index) => ({
      id: track.id || `track-${index + 1}`,
      name: String(track.name || `Faixa ${index + 1}`),
      url: String(track.url || ""),
    })).filter((track) => track.url);
  } catch (_error) {
    appState.musicPlayer.tracks = [];
  }

  if (!appState.musicPlayer.tracks.length) {
    if (el.musicTrackName) {
      el.musicTrackName.textContent = "Sem musicas na pasta Music";
    }
    el.musicPlayer.classList.add("hidden");
    return;
  }

  const preferredIndex = clampNumber(
    appState.settings.musicPlayer.lastTrackIndex,
    0,
    appState.musicPlayer.tracks.length - 1,
    0
  );
  appState.musicPlayer.ready = true;
  setMusicTrack(preferredIndex);
  applyMusicPlayerRuntime();
}

function actionFromKeyCode(code) {
  const keybinds = appState.settings.controls.keybinds || {};
  return KEYBIND_ACTIONS.find((action) => keybinds[action] === code) || null;
}

function isEditableTarget(target) {
  if (!(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }
  return Boolean(target.closest("[contenteditable='true']"));
}

function handleKeybindCapture(event) {
  if (!appState.keybindCaptureAction) {
    return false;
  }
  event.preventDefault();
  const code = String(event.code || "").trim();
  if (!code || code === "Escape") {
    appState.keybindCaptureAction = null;
    updateKeybindButtons();
    setSettingsFeedback("Captura de tecla cancelada.", "info");
    return true;
  }
  const conflict = KEYBIND_ACTIONS.find((action) => {
    if (action === appState.keybindCaptureAction) {
      return false;
    }
    return appState.settings.controls.keybinds[action] === code;
  });
  if (conflict) {
    setSettingsFeedback("Tecla ja usada por outra acao.", "error");
    return true;
  }
  appState.settings.controls.keybinds[appState.keybindCaptureAction] = code;
  appState.keybindCaptureAction = null;
  updateKeybindButtons();
  setSettingsFeedback("Tecla atualizada.", "success");
  return true;
}

function runKeybindAction(action) {
  if (!action) {
    return;
  }
  if (action === "switchBuilder") {
    switchTab("builder");
    return;
  }
  if (action === "switchBattle") {
    switchTab("battle");
    return;
  }
  if (action === "switchSettings") {
    switchTab("settings");
    return;
  }
  if (action === "confirmAction") {
    if (el.confirmEngage && !el.confirmEngage.disabled) {
      el.confirmEngage.click();
    }
    return;
  }
  if (action === "confirmAttack") {
    if (el.playerAttack && !el.playerAttack.disabled) {
      el.playerAttack.click();
    }
    return;
  }
  if (action === "autoStep") {
    if (isMultiplayerActive()) {
      return;
    }
    if (el.autoStep && !el.autoStep.disabled) {
      el.autoStep.click();
    }
    return;
  }
  if (action === "cancel") {
    hideHoverPreview();
    if (!appState.battle || appState.battle.finished) {
      return;
    }
    if (appState.creatureAbilityQuickPick) {
      appState.creatureAbilityQuickPick = null;
      renderBattle();
      return;
    }
    const pending = appState.battle.pendingAction;
    if (!pending) {
      return;
    }
    if (pending.type === "target_select" && pending.playerIndex === localPlayerIndex()) {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "cancel_target" }).catch((error) => alert(error.message));
      } else {
        chooseEffectTarget(appState.battle, null);
        advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
        renderBattle();
      }
      return;
    }
    if (pending.type === "choice_select" && pending.playerIndex === localPlayerIndex()) {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "cancel_choice" }).catch((error) => alert(error.message));
      } else {
        chooseEffectChoice(appState.battle, null);
        advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
        renderBattle();
      }
      return;
    }
    if (pending.type === "priority" && pending.playerIndex === localPlayerIndex()) {
      appState.battle.log.push("Use o botao 'Passar prioridade' para encerrar a janela.");
      renderBattle();
    }
  }
}

function switchTab(target = "builder") {
  let tab = target;
  if (typeof target === "boolean") {
    tab = target ? "battle" : "builder";
  }
  if (!["builder", "battle", "settings"].includes(tab)) {
    tab = "builder";
  }
  appState.currentTab = tab;
  if (el.tabBuilder) {
    el.tabBuilder.classList.toggle("active", tab === "builder");
  }
  if (el.tabBattle) {
    el.tabBattle.classList.toggle("active", tab === "battle");
  }
  if (el.tabSettings) {
    el.tabSettings.classList.toggle("active", tab === "settings");
  }
  if (el.deckBuilder) {
    el.deckBuilder.classList.toggle("hidden", tab !== "builder");
  }
  if (el.battleArena) {
    el.battleArena.classList.toggle("hidden", tab !== "battle");
  }
  if (el.settingsPanel) {
    el.settingsPanel.classList.toggle("hidden", tab !== "settings");
  }
  if (tab === "settings") {
    startAdminMetricsAutoRefresh();
  } else {
    stopAdminMetricsAutoRefresh();
  }
  if (tab === "battle") {
    updateMultiplayerBattleView();
  }
  if (tab !== "builder") {
    appState.mobileViewer.active = false;
  }
  syncTopbarButtons();
  renderMobileScanViewer();
}

function isMobileViewport() {
  try {
    return window.matchMedia("(max-width: 900px)").matches;
  } catch (_error) {
    return window.innerWidth <= 900;
  }
}

function syncTopbarButtons() {
  const isBuilderTab = appState.currentTab === "builder";
  const canUseMobileViewer = isBuilderTab && isMobileViewport();
  if (el.battleForfeit) {
    el.battleForfeit.classList.toggle("hidden", !appState.currentTab || appState.currentTab !== "battle");
  }
  if (el.mobileScanViewerToggle) {
    el.mobileScanViewerToggle.classList.toggle("hidden", !canUseMobileViewer);
    el.mobileScanViewerToggle.classList.toggle("active", Boolean(appState.mobileViewer.active && canUseMobileViewer));
  }
}

function setMobileScanViewerActive(active) {
  const canActivate = isMobileViewport() && appState.currentTab === "builder";
  appState.mobileViewer.active = Boolean(active && canActivate);
  if (!appState.mobileViewer.active) {
    appState.mobileViewer.touchStartX = null;
    appState.mobileViewer.touchStartY = null;
  }
  syncTopbarButtons();
  renderMobileScanViewer();
}

function mobileViewerCards() {
  return getFilteredLibraryCards();
}

function navigateMobileScanViewer(direction) {
  const cards = mobileViewerCards();
  if (!cards.length) {
    appState.mobileViewer.index = 0;
    renderMobileScanViewer();
    return;
  }
  const step = direction === "prev" ? -1 : 1;
  const nextIndex = (appState.mobileViewer.index + step + cards.length) % cards.length;
  appState.mobileViewer.index = nextIndex;
  renderMobileScanViewer();
}

function renderMobileScanViewer() {
  if (!el.mobileScanViewer || !el.mobileScanViewerImage) {
    return;
  }
  const enabled = Boolean(appState.mobileViewer.active && isMobileViewport() && appState.currentTab === "builder");
  el.mobileScanViewer.classList.toggle("hidden", !enabled);
  el.mobileScanViewer.classList.toggle("is-active", enabled);
  document.body.classList.toggle("mobile-scan-viewer-mode", enabled);
  if (!enabled) {
    return;
  }
  const cards = mobileViewerCards();
  if (!cards.length) {
    appState.mobileViewer.index = 0;
    if (el.mobileScanViewerImage) {
      el.mobileScanViewerImage.classList.add("hidden");
      el.mobileScanViewerImage.removeAttribute("src");
    }
    if (el.mobileScanViewerEmpty) {
      el.mobileScanViewerEmpty.classList.remove("hidden");
    }
    if (el.mobileScanViewerName) el.mobileScanViewerName.textContent = "-";
    if (el.mobileScanViewerMeta) el.mobileScanViewerMeta.textContent = "-";
    if (el.mobileScanViewerStars) el.mobileScanViewerStars.textContent = "Estrelas: -";
    if (el.mobileScanViewerIndex) el.mobileScanViewerIndex.textContent = "0/0";
    return;
  }
  const safeIndex = Math.min(Math.max(0, appState.mobileViewer.index), cards.length - 1);
  appState.mobileViewer.index = safeIndex;
  const card = cards[safeIndex];
  const imageSrc = imageOf(card);
  if (el.mobileScanViewerImage) {
    if (imageSrc) {
      el.mobileScanViewerImage.src = imageSrc;
      el.mobileScanViewerImage.classList.remove("hidden");
    } else {
      el.mobileScanViewerImage.classList.add("hidden");
    }
    el.mobileScanViewerImage.alt = card?.name || "Carta";
  }
  if (el.mobileScanViewerEmpty) {
    el.mobileScanViewerEmpty.classList.add("hidden");
  }
  const starsLabel = card?.type === "creatures"
    ? creatureStarsLabelFromVariant(normalizeVariant(card?._scanVariant))
    : "-";
  if (el.mobileScanViewerName) {
    el.mobileScanViewerName.textContent = card?.name || "-";
  }
  if (el.mobileScanViewerMeta) {
    el.mobileScanViewerMeta.textContent = `${TYPE_LABEL[card?.type] || card?.type || "-"} | ${card?.set || "-"} | ${card?.rarity || "-"}`;
  }
  if (el.mobileScanViewerStars) {
    el.mobileScanViewerStars.textContent = `Estrelas: ${starsLabel || "-"}`;
  }
  if (el.mobileScanViewerIndex) {
    el.mobileScanViewerIndex.textContent = `${safeIndex + 1}/${cards.length}`;
  }
}

function initialViewFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    const view = String(params.get("view") || "").trim().toLowerCase();
    if (["builder", "battle", "settings"].includes(view)) {
      return view;
    }
  } catch (_error) {
    // Ignore malformed query strings and keep default startup behavior.
  }
  return "builder";
}

function switchBattleView(showCombat) {
  const finalShowCombat = Boolean(showCombat);
  if (el.battleSetupView) {
    el.battleSetupView.classList.toggle("hidden", finalShowCombat);
  }
  if (el.battleCombatView) {
    el.battleCombatView.classList.toggle("hidden", !finalShowCombat);
  }
}

function slotVisual(slot, lane) {
  return (SLOT_LAYOUT[lane] || SLOT_LAYOUT.bottom)[slot] || { x: 50, y: 50, z: 3 };
}

function resolvedSlotPlacement(_board, _playerIndex, lane, slot) {
  return slotVisual(slot, lane);
}

function slotLetter(playerIndex, slot) {
  return PLAYER_SLOT_LETTERS[playerIndex]?.[slot] || null;
}

function slotFromLetter(playerIndex, letter) {
  return LETTER_TO_PLAYER_SLOT[playerIndex]?.[letter] ?? null;
}

function normalizeBoardLetter(letter) {
  const value = String(letter || "").trim().toUpperCase();
  return BOARD_ADJACENCY[value] ? value : null;
}

function unitBoardLetter(playerIndex, unit) {
  if (!unit) {
    return null;
  }
  const mapped = normalizeBoardLetter(unit.positionLetter);
  if (mapped) {
    return mapped;
  }
  return slotLetter(playerIndex, unit.slot);
}

function laneLetters(lane) {
  return lane === "top" ? PLAYER_SLOT_LETTERS[1] : PLAYER_SLOT_LETTERS[0];
}

function buildBoardOccupancy(board) {
  const map = new Map();
  board.players.forEach((player, playerIndex) => {
    player.creatures.forEach((unit) => {
      if (!unit || unit.defeated) {
        return;
      }
      const letter = unitBoardLetter(playerIndex, unit);
      if (letter) {
        map.set(letter, { playerIndex, unit });
      }
    });
  });
  return map;
}

function areLettersAdjacent(fromLetter, toLetter) {
  const from = normalizeBoardLetter(fromLetter);
  const to = normalizeBoardLetter(toLetter);
  if (!from || !to) {
    return false;
  }
  return (BOARD_ADJACENCY[from] || []).includes(to);
}

function ownAdjacentSlots(playerIndex, slot) {
  const letter = slotLetter(playerIndex, slot);
  if (!letter) {
    return [];
  }
  return (BOARD_ADJACENCY[letter] || [])
    .map((adjacentLetter) => slotFromLetter(playerIndex, adjacentLetter))
    .filter((adjacentSlot) => Number.isInteger(adjacentSlot));
}

function enemyAdjacentSlots(playerIndex, slot) {
  const letter = slotLetter(playerIndex, slot);
  const enemyIndex = playerIndex === 0 ? 1 : 0;
  if (!letter) {
    return [];
  }
  return (BOARD_ADJACENCY[letter] || [])
    .map((adjacentLetter) => slotFromLetter(enemyIndex, adjacentLetter))
    .filter((adjacentSlot) => Number.isInteger(adjacentSlot));
}

function canSlotsEngageOnBoard(attackerSlot, defenderSlot) {
  const battle = appState.battle;
  if (!battle) {
    return false;
  }
  const localIndex = localPlayerIndex();
  const enemyIndex = opponentPlayerIndex();
  const attacker = battle.board.players[localIndex]?.creatures?.[attackerSlot];
  const defender = battle.board.players[enemyIndex]?.creatures?.[defenderSlot];
  return areLettersAdjacent(unitBoardLetter(localIndex, attacker), unitBoardLetter(enemyIndex, defender));
}

function isAdjacentSlot(fromSlot, toSlot) {
  const battle = appState.battle;
  if (!battle) {
    return false;
  }
  const localIndex = localPlayerIndex();
  const source = battle.board.players[localIndex]?.creatures?.[fromSlot];
  const destinationLetter = normalizeBoardLetter(
    slotLetter(0, toSlot) || slotLetter(1, toSlot)
  );
  return areLettersAdjacent(unitBoardLetter(localIndex, source), destinationLetter);
}

function engagedSlotForPlayer(board, playerIndex) {
  return playerIndex === board.activePlayerIndex ? board.engagement.attackerSlot : board.engagement.defenderSlot;
}

function renderMugicRail(railElement, player, opponentView) {
  if (!railElement || !player) {
    return;
  }
  railElement.innerHTML = "";
  const totalCounters = player.creatures
    .filter((unit) => !unit.defeated)
    .reduce((sum, unit) => sum + Number(unit.mugicCounters || 0), 0);

  const railSlots = Array.isArray(player.mugicSlots)
    ? player.mugicSlots.slice(0, 6)
    : [];
  for (let index = 0; index < 6; index += 1) {
    const bubble = document.createElement("span");
    bubble.className = "mugic-orb";
    const slotEntry = railSlots[index] || null;
    const mugicCard = slotEntry?.card || null;
    const available = Boolean(slotEntry?.available);
    const queued = Boolean(slotEntry?.queued);
    const spent = Boolean(slotEntry?.spent);
    const disabledByEffect = Boolean(slotEntry?.disabledByEffect);

    if (mugicCard && queued) {
      bubble.classList.add("queued", "has-card");
      if (opponentView) {
        bubble.classList.add("face-down");
        bubble.title = "Mugic do Oponente (na pilha)";
      } else {
        const tribeKey = normalizeTribeKey(mugicCard.tribe);
        if (tribeKey) {
          bubble.classList.add(`tribe-${tribeKey}`);
        }
        bubble.title = `${mugicCard.name} (na pilha)`;
        attachHoverPreview(bubble, mugicCard);
      }
    } else if (mugicCard && available) {
      bubble.classList.add("has-card");
      if (opponentView) {
        bubble.classList.add("face-down");
        bubble.title = "Mugic do Oponente";
      } else {
        const tribeKey = normalizeTribeKey(mugicCard.tribe);
        if (tribeKey) {
          bubble.classList.add(`tribe-${tribeKey}`);
        }
        attachHoverPreview(bubble, mugicCard);
        bubble.title = mugicCard.name;
        const battle = appState.battle;
        const canPlayFromRail =
          battle &&
          !battle.finished &&
          battle.pendingAction?.type === "priority" &&
          battle.pendingAction.playerIndex === localPlayerIndex() &&
          Array.isArray(battle.pendingAction.options) &&
          battle.pendingAction.options.some(
            (option) => option.kind === "mugic" && Number(option.mugicIndex) === Number(slotEntry.slotIndex)
          );
        if (canPlayFromRail) {
          bubble.classList.add("priority-playable");
          bubble.addEventListener("click", (event) => {
            event.stopPropagation();
            if (isMultiplayerActive()) {
              submitMultiplayerAction({ type: "choose_mugic", value: Number(slotEntry.slotIndex) }).catch((error) => {
                alert(error.message);
              });
              return;
            }
            chooseMugic(battle, Number(slotEntry.slotIndex), null);
            advanceBattle(battle, Boolean(battle.ai?.player0));
            renderBattle();
          });
        } else if (battle?.pendingAction?.type === "priority" && battle.pendingAction.playerIndex === localPlayerIndex()) {
          bubble.classList.add("disabled");
          if (disabledByEffect || battle.board?.exchange?.disableMugic) {
            bubble.title = `${mugicCard.name} (Mugic bloqueado nesta janela)`;
          } else {
            bubble.title = `${mugicCard.name} (sem custo/tribo/caster valido agora)`;
          }
        }
      }
    } else if (mugicCard && (spent || !available)) {
      bubble.classList.add("used", "spent");
    } else {
      bubble.classList.add("empty");
    }

    if (mugicCard && available && !queued && index < totalCounters) {
      bubble.classList.add(opponentView ? "active" : "active-yellow");
    }
    railElement.appendChild(bubble);
  }
}

function effectiveSnapshot(playerIndex, unit) {
  if (!appState.battle || !unit) {
    return null;
  }
  return getEffectiveUnitSnapshot(appState.battle, playerIndex, unit) || null;
}

function snapshotHash(snapshot) {
  if (!snapshot) {
    return "";
  }
  const fields = [
    snapshot.stats?.courage,
    snapshot.stats?.power,
    snapshot.stats?.wisdom,
    snapshot.stats?.speed,
    snapshot.stats?.fire,
    snapshot.stats?.air,
    snapshot.stats?.earth,
    snapshot.stats?.water,
    snapshot.energy?.current,
    snapshot.energy?.max,
    snapshot.gearState,
  ];
  return fields.map((value) => String(Number.isFinite(value) ? Number(value) : value || 0)).join("|");
}

function slotMetricsMarkup(snapshot, isChanged) {
  if (!snapshot) {
    return "";
  }
  const c = Math.round(Number(snapshot.stats?.courage || 0));
  const p = Math.round(Number(snapshot.stats?.power || 0));
  const w = Math.round(Number(snapshot.stats?.wisdom || 0));
  const s = Math.round(Number(snapshot.stats?.speed || 0));
  const maxEnergy = Math.max(1, Number(snapshot.energy?.max || 1));
  const currentEnergy = Math.max(0, Number(snapshot.energy?.current || 0));
  const energyPct = Math.max(0, Math.min(100, (currentEnergy / maxEnergy) * 100));
  const elementBadges = [
    ["fire", "F"],
    ["air", "A"],
    ["earth", "T"],
    ["water", "W"],
  ]
    .map(([key, label]) => {
      const value = Number(snapshot.stats?.[key] || 0);
      if (value <= 0) {
        return "";
      }
      const base = Number(snapshot.base?.[key] || 0);
      const bonus = Math.round(value - base);
      const suffix = bonus > 0 ? `+${bonus}` : "";
      return `<span class="slot-element slot-element-${key}">${label}${suffix ? ` ${suffix}` : ""}</span>`;
    })
    .filter(Boolean)
    .join("");
  return `
    <div class="slot-live-stats${isChanged ? " is-changed" : ""}">
      <div class="slot-live-disciplines">C ${c} | P ${p} | I ${w} | V ${s}</div>
      ${elementBadges ? `<div class="slot-live-elements">${elementBadges}</div>` : ""}
      <div class="slot-live-energy"><span style="width:${energyPct}%"></span><strong>${currentEnergy}/${maxEnergy}</strong></div>
    </div>
  `;
}

function activatableCreatureOptionsByUnitId(pendingAction) {
  const byUnit = new Map();
  if (!pendingAction || pendingAction.type !== "priority" || pendingAction.playerIndex !== localPlayerIndex()) {
    return byUnit;
  }
  const options = Array.isArray(pendingAction.options) ? pendingAction.options : [];
  options.forEach((option) => {
    if (option?.kind !== "ability") {
      return;
    }
    const sourceKey = option.option?.sourceKey;
    if (sourceKey !== "creature" && sourceKey !== "gear") {
      return;
    }
    const unitId = option.option?.sourceUnitId;
    if (!unitId) {
      return;
    }
    if (!byUnit.has(unitId)) {
      byUnit.set(unitId, []);
    }
    byUnit.get(unitId).push(option);
  });
  return byUnit;
}

function renderSlotLayer(container, playerIndex, lane) {
  container.innerHTML = "";
  const battle = appState.battle;
  if (!battle) {
    return;
  }
  const board = battle.board;
  const localIndex = localPlayerIndex();
  const enemyIndex = opponentPlayerIndex();
  const occupancy = buildBoardOccupancy(board);
  const baseLetters = PLAYER_SLOT_LETTERS[playerIndex] || [];
  const oneVsOneBattlefield = battle.mode === "1v1";
  const letters = oneVsOneBattlefield ? (ONE_VS_ONE_VISIBLE_LETTERS[playerIndex] || []) : baseLetters;
  const movedUnitIds = battle.movementState?.movedUnitIdsThisTurn || new Set();
  const humanSelectionPhase =
    !battle.finished &&
    isLocalHumanControlled(battle) &&
    isLocalHumanTurn(battle) &&
    battle.phase === "move_action";
  const humanPostCombatPhase =
    !battle.finished &&
    isLocalHumanControlled(battle) &&
    isLocalHumanTurn(battle) &&
    battle.phase === "additional_movement";
  const targetSelectionStep =
    battle.pendingAction?.type === "target_select" && battle.pendingAction.playerIndex === localIndex
      ? battle.pendingAction.targetSteps?.[battle.pendingAction.currentStep] || null
      : null;
  const casterSelectionPending =
    battle.pendingAction?.type === "mugic_caster_select" && battle.pendingAction.playerIndex === localIndex
      ? battle.pendingAction
      : null;
  const casterCandidateUnitIds = new Set(
    (Array.isArray(casterSelectionPending?.options) ? casterSelectionPending.options : [])
      .map((entry) => String(entry?.casterUnitId || ""))
      .filter(Boolean)
  );
  const legalHumanMoves = humanSelectionPhase ? getLegalMoves(battle, localIndex) : [];
  const activatableByUnitId = activatableCreatureOptionsByUnitId(battle.pendingAction);

  letters.forEach((letter, visualSlot) => {
    const mappedSlot = slotFromLetter(playerIndex, letter);
    const renderSlot = Number.isInteger(mappedSlot) ? mappedSlot : visualSlot;
    const placement = resolvedSlotPlacement(board, playerIndex, lane, renderSlot);
    const slot = document.createElement("article");
    slot.className = "free-slot";
    slot.style.left = `${placement.x}%`;
    slot.style.top = `${placement.y}%`;
    slot.style.zIndex = String(placement.z || 3);
    slot.dataset.letter = letter;

    const occupied = occupancy.get(letter) || null;
    const occupiedUnit = occupied?.unit || null;
    const occupiedOwner = occupied?.playerIndex ?? null;

    if (occupiedUnit && occupiedUnit.unitId) {
      slot.dataset.unitId = occupiedUnit.unitId;
    }

    const selectedAttacker = board.engagement.attackerLetter === letter;
    const selectedDefender = board.engagement.defenderLetter === letter;
    const combatLocked = Boolean(board.engagement.attackerLetter && board.engagement.defenderLetter);
    const isCombatEngagedSlot = combatLocked && (selectedAttacker || selectedDefender);
    if (selectedAttacker || selectedDefender) {
      slot.classList.add("active-engage");
    }

    const selectedMoverSlot = board.action.selectedMoverSlot;
    const selectedSourceUnit = Number.isInteger(selectedMoverSlot)
      ? board.players[localIndex].creatures[selectedMoverSlot]
      : null;
    const selectedSourceLetter = unitBoardLetter(localIndex, selectedSourceUnit);
    const selectedMoveOptions = Number.isInteger(selectedMoverSlot)
      ? legalHumanMoves.filter((move) => move.from === selectedMoverSlot)
      : [];

    if (humanSelectionPhase) {
      if (occupiedUnit && occupiedOwner === localIndex && !occupiedUnit.defeated) {
        const isSelected = selectedMoverSlot === occupiedUnit.slot || selectedAttacker;
        if (isSelected) {
          slot.classList.add("selected-source");
        } else if (!occupiedUnit.movedThisAction && !movedUnitIds.has(occupiedUnit.unitId)) {
          slot.classList.add("post-combat-movable");
        }
      } else if (selectedMoveOptions.some((move) => move.toLetter === letter && move.type === "move_empty")) {
        slot.classList.add("move-target");
      }
    }

    const isPostCombatSource =
      humanPostCombatPhase &&
      occupiedUnit &&
      occupiedOwner === localIndex &&
      !occupiedUnit.defeated &&
      !occupiedUnit.movedThisAction &&
      !movedUnitIds.has(occupiedUnit.unitId) &&
      selectedMoverSlot === occupiedUnit.slot;
    if (isPostCombatSource) {
      slot.classList.add("selected-source");
    }

    const isPostCombatMovable =
      humanPostCombatPhase &&
      occupiedUnit &&
      occupiedOwner === localIndex &&
      !occupiedUnit.defeated &&
      !occupiedUnit.movedThisAction &&
      !movedUnitIds.has(occupiedUnit.unitId);
    if (isPostCombatMovable && !isPostCombatSource) {
      slot.classList.add("post-combat-movable");
    }

    const isPostCombatTarget =
      humanPostCombatPhase &&
      !occupiedUnit &&
      selectedSourceUnit &&
      !selectedSourceUnit.movedThisAction &&
      !movedUnitIds.has(selectedSourceUnit.unitId) &&
      areLettersAdjacent(selectedSourceLetter, letter);
    if (isPostCombatTarget) {
      slot.classList.add("move-target");
    }

    const canEngageTarget =
      humanSelectionPhase &&
      occupiedUnit &&
      occupiedOwner === enemyIndex &&
      selectedMoveOptions.some((move) => move.toLetter === letter && move.type === "move_engage");
    if (canEngageTarget) {
      slot.classList.add("engage-target");
    }

    const selectableCreatureTarget =
      targetSelectionStep && occupiedUnit
        ? (targetSelectionStep.candidates || []).find(
          (candidate) => candidate.type === "creature" && candidate.unitId === occupiedUnit.unitId
        ) || null
        : null;
    const selectableGearTarget =
      targetSelectionStep && occupiedUnit
        ? (targetSelectionStep.candidates || []).find(
          (candidate) => candidate.type === "battlegear" && candidate.unitId === occupiedUnit.unitId
        ) || null
        : null;

    if (targetSelectionStep?.spec?.type === "creature" && selectableCreatureTarget) {
      slot.classList.add("target-select-candidate");
    }
    if (targetSelectionStep?.spec?.type === "battlegear" && selectableGearTarget) {
      slot.classList.add("target-select-gear-candidate");
    }
    if (
      casterSelectionPending
      && occupiedUnit
      && occupiedOwner === localIndex
      && casterCandidateUnitIds.has(String(occupiedUnit.unitId || ""))
    ) {
      slot.classList.add("cost-select-candidate");
    }

    if (!occupiedUnit) {
      slot.classList.add("empty-slot");
      slot.innerHTML = `<div class="slot-empty-placeholder"></div>`;
    } else {
      const activatableCreatureOptions =
        occupiedOwner === localIndex && occupiedUnit.unitId
          ? activatableByUnitId.get(occupiedUnit.unitId) || []
          : [];
      const hasActivatableCreatureAbility = activatableCreatureOptions.length > 0;
      if ((battle.flash || []).some((hit) => hit.playerIndex === occupiedOwner && hit.slot === occupiedUnit.slot && Date.now() <= hit.until)) {
        slot.classList.add("attack-hit");
      }
      const isOpponentFaceDownGear = occupiedOwner === enemyIndex && occupiedUnit.gearState === "face_down";
      const gearHtml = occupiedUnit.gearCard
        ? `<div class="slot-gear${occupiedUnit.gearState === "face_down" ? " face-down" : ""}"><img src="${isOpponentFaceDownGear ? '/images/card-back.png' : imageOf(occupiedUnit.gearCard)}" alt="Battlegear"></div>`
        : "";
      const mugicCounterHtml = mugicCounterMarkup(occupiedUnit.mugicCounters, "slot-mugic-counter", occupiedUnit.card?.tribe);
      const snapshot = effectiveSnapshot(occupiedOwner, occupiedUnit);
      const hash = snapshotHash(snapshot);
      const previousHash = appState.slotSnapshotHashByUnit.get(occupiedUnit.unitId);
      const changed = Boolean(previousHash && previousHash !== hash);
      if (occupiedUnit.unitId) {
        appState.slotSnapshotHashByUnit.set(occupiedUnit.unitId, hash);
      }
      const liveMetricsHtml = "";
      const cardClasses = [
        "slot-main-card",
        occupiedOwner === localIndex ? "border-player" : "border-opponent",
      ];
      if (hasActivatableCreatureAbility) {
        cardClasses.push("ability-neon-ready");
      }
      const neonStyle = hasActivatableCreatureAbility
        ? ` style="--ability-neon-color:${tribeNeonColor(occupiedUnit.card?.tribe)}"`
        : "";
      slot.innerHTML = `
        ${mugicCounterHtml}
        <div class="slot-card-shell">
          <img class="${cardClasses.join(" ")}" src="${imageOf(occupiedUnit.card)}" alt="${occupiedUnit.card.name}"${neonStyle}>
          ${gearHtml}
        </div>
        ${liveMetricsHtml}
        <div class="slot-caption">${occupiedUnit.card.name}</div>
      `;
      if (occupiedUnit.unitId) {
        attachBattleUnitPreview(slot, occupiedOwner, occupiedUnit);
      } else {
        attachHoverPreview(slot, occupiedUnit.card);
      }
      const gearNode = slot.querySelector(".slot-gear");
      if (gearNode && selectableGearTarget) {
        gearNode.classList.add("target-select-gear");
      }
      if (gearNode && occupiedUnit.gearCard && !(occupiedOwner === enemyIndex && occupiedUnit.gearState === "face_down")) {
        attachHoverPreview(gearNode, occupiedUnit.gearCard);
      }
      const mugicCounterNode = slot.querySelector(".slot-mugic-counter");
      attachMugicCounterPreview(mugicCounterNode, occupiedUnit);
    }

    slot.addEventListener("click", () => {
      if (!appState.battle || appState.battle.finished || !isLocalHumanControlled(appState.battle)) {
        return;
      }
      const activePending = appState.battle.pendingAction;

      if (targetSelectionStep) {
        const targetType = targetSelectionStep.spec?.type;
        if (targetType === "creature" || targetType === "battlegear") {
          const selectable = targetType === "creature" ? selectableCreatureTarget : selectableGearTarget;
          if (!selectable) {
            return;
          }
          if (isMultiplayerActive()) {
            submitMultiplayerAction({ type: "choose_target", value: selectable.id }).catch((error) => alert(error.message));
          } else {
            chooseEffectTarget(appState.battle, selectable.id);
            advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
            renderBattle();
          }
          return;
        }
        return;
      }

      if (activePending?.type === "mugic_caster_select" && activePending.playerIndex === localIndex) {
        if (!occupiedUnit || occupiedOwner !== localIndex) {
          return;
        }
        const options = Array.isArray(activePending.options) ? activePending.options : [];
        const optionIndex = options.findIndex(
          (entry) => String(entry?.casterUnitId || "") === String(occupiedUnit.unitId || "")
        );
        if (optionIndex < 0) {
          return;
        }
        if (isMultiplayerActive()) {
          submitMultiplayerAction({ type: "choose_mugic_caster", value: optionIndex }).catch((error) => alert(error.message));
        } else {
          chooseMugic(appState.battle, optionIndex);
          advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
          renderBattle();
        }
        return;
      }

      if (activePending?.type === "priority" && activePending.playerIndex === localIndex) {
        if (!occupiedUnit || occupiedOwner !== localIndex) {
          return;
        }
        const activatableOptions = (Array.isArray(activePending.options) ? activePending.options : [])
          .map((option, optionIndex) => ({ option, optionIndex }))
          .filter(({ option }) => (
            option?.kind === "ability"
            && (option.option?.sourceKey === "creature" || option.option?.sourceKey === "gear")
            && option.option?.sourceUnitId === occupiedUnit.unitId
          ));

        if (!activatableOptions.length) {
          appState.creatureAbilityQuickPick = null;
          return;
        }

        if (activatableOptions.length === 1) {
          appState.creatureAbilityQuickPick = null;
          if (isMultiplayerActive()) {
            submitMultiplayerAction({ type: "choose_ability", value: activatableOptions[0].optionIndex }).catch((error) => {
              alert(error.message);
            });
          } else {
            chooseActivatedAbility(appState.battle, activatableOptions[0].optionIndex);
            advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
            renderBattle();
          }
          return;
        }

        appState.creatureAbilityQuickPick = {
          sourceUnitId: occupiedUnit.unitId,
          sourceLabel: occupiedUnit.card?.name || "Creature",
          sourceKeys: ["creature", "gear"],
          options: activatableOptions.map(({ optionIndex, option }) => ({
            optionIndex,
            sourceKey: option?.option?.sourceKey || "creature",
            sourceLabel: option?.option?.sourceLabel || occupiedUnit.card?.name || "Habilidade",
            costLabel: option?.option?.cost?.label || "Ability",
          })),
        };
        renderBattle();
        return;
      }

      if (appState.battle.phase === "additional_movement" && isLocalHumanTurn(appState.battle)) {
        if (occupiedUnit && occupiedOwner === localIndex && !occupiedUnit.defeated && !occupiedUnit.movedThisAction && !movedUnitIds.has(occupiedUnit.unitId)) {
          board.action.selectedMoverSlot = occupiedUnit.slot;
          renderBattle();
          return;
        }
        if (!occupiedUnit && Number.isInteger(board.action.selectedMoverSlot)) {
          if (isMultiplayerActive()) {
            submitMultiplayerAction({
              type: "declare_move",
              fromSlot: board.action.selectedMoverSlot,
              toLetter: letter,
            }).catch((error) => alert(error.message));
          } else {
            const moved = declareMove(appState.battle, board.action.selectedMoverSlot, letter);
            if (moved) {
              board.action.selectedMoverSlot = null;
            }
            renderBattle();
          }
        }
        return;
      }

      if (!isLocalHumanTurn(appState.battle) || appState.battle.phase !== "move_action") {
        return;
      }

      if (occupiedUnit && occupiedOwner === localIndex && !occupiedUnit.defeated) {
        board.action.selectedMoverSlot = occupiedUnit.slot;
        renderBattle();
        return;
      }

      const sourceSlot = board.action.selectedMoverSlot;
      if (!Number.isInteger(sourceSlot)) {
        return;
      }
      const legalMove = legalHumanMoves.find((move) => move.from === sourceSlot && move.toLetter === letter);
      if (!legalMove) {
        return;
      }
      if (isMultiplayerActive()) {
        submitMultiplayerAction({
          type: "declare_move",
          fromSlot: sourceSlot,
          toLetter: letter,
        }).catch((error) => alert(error.message));
        return;
      }
      const moved = declareMove(appState.battle, sourceSlot, letter);
      if (moved) {
        if (legalMove.type === "move_engage") {
          board.action.selectedMoverSlot = null;
          // Engage starts combat immediately; no extra confirm step needed.
          advanceBattle(appState.battle, Boolean(appState.battle.ai?.player0));
        } else {
          board.action.selectedMoverSlot = sourceSlot;
        }
      }
      renderBattle();
    });

    slot.addEventListener("contextmenu", (event) => {
      if (!appState.battle || appState.battle.finished || !isLocalHumanControlled(appState.battle)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });

    container.appendChild(slot);
  });
}

function renderLocationCard() {
  if (!el.locationMini) {
    return;
  }
  el.locationMini.innerHTML = "";
  const location = appState.battle?.board?.locationCard;
  if (!location) {
    el.locationMini.innerHTML = "<p>Sem location ativa.</p>";
    return;
  }
  const wrapper = document.createElement("button");
  wrapper.type = "button";
  wrapper.className = "location-image-wrap";
  wrapper.innerHTML = `
    <img src="${imageOf(location)}" alt="${location.name}">
    <span class="location-name">${location.name}</span>
  `;
  wrapper.addEventListener("click", (event) => {
    event.stopPropagation();
    showClickPreview(location, event);
  });
  attachHoverPreview(wrapper, location);
  el.locationMini.appendChild(wrapper);
}

function engagedUnitForPlayer(battle, playerIndex) {
  const board = battle?.board;
  if (!board) {
    return null;
  }
  const combatActive = Boolean(
    battle?.combatState?.active &&
    battle.phase === "combat_sequence" &&
    board.engagement.attackerLetter &&
    board.engagement.defenderLetter
  );
  if (!combatActive) {
    return null;
  }
  const letter =
    playerIndex === board.activePlayerIndex
      ? normalizeBoardLetter(board.engagement.attackerLetter)
      : normalizeBoardLetter(board.engagement.defenderLetter);
  if (!letter) {
    return null;
  }
  const occupancy = buildBoardOccupancy(board).get(letter);
  if (!occupancy || occupancy.playerIndex !== playerIndex) {
    return null;
  }
  return occupancy.unit || null;
}

function unitDisplayStatFromSnapshot(snapshot, statKey) {
  return Number(snapshot?.stats?.[statKey] || 0);
}

function metricPercent(metricKey, value, maxEnergy = 100) {
  const statCaps = {
    courage: 150,
    power: 150,
    wisdom: 150,
    speed: 150,
    fire: 100,
    air: 100,
    earth: 100,
    water: 100,
    energy: Math.max(1, Number(maxEnergy || 100)),
  };
  const cap = Number(statCaps[metricKey] || 100);
  return Math.max(0, Math.min(100, (Number(value || 0) / cap) * 100));
}

function appendEngagedMetric(container, metric, maxEnergy) {
  const block = document.createElement("div");
  block.className = `engaged-metric metric-${metric.key}`;
  const barPercent = metricPercent(metric.key, metric.value, maxEnergy);
  const valueText = metric.displayValue === undefined
    ? String(Math.round(Number(metric.value || 0)))
    : String(metric.displayValue || "");
  block.innerHTML = `
    <div class="engaged-metric-head">
      <span class="metric-name">${metric.label}</span>
      <strong class="metric-value ${valueText ? "" : "is-empty"}">${valueText || "-"}</strong>
    </div>
    <div class="engaged-metric-bar"><span style="width:${barPercent}%"></span></div>
  `;
  container.appendChild(block);
}

function appendEngagedEnergy(container, currentEnergy, maxEnergy) {
  const rawMax = Number(maxEnergy || 0);
  const isPlaceholder = rawMax <= 0;
  const current = Math.max(0, Number(currentEnergy || 0));
  const max = isPlaceholder ? 1 : rawMax;
  const percent = isPlaceholder ? 0 : metricPercent("energy", current, max);
  const valueLabel = isPlaceholder ? "-/-" : `${current}/${max}`;
  const block = document.createElement("div");
  block.className = "engaged-energy-vertical";
  block.innerHTML = `
    <div class="engaged-energy-rail"><span style="height:${percent}%"></span></div>
    <div class="engaged-energy-text">
      <span class="metric-name">Energia</span>
      <strong class="metric-value">${valueLabel}</strong>
    </div>
  `;
  container.appendChild(block);
}

function buildEngagedMetricList(snapshot) {
  const maxEnergy = Math.max(0, Number(snapshot?.energy?.max || 0));
  const disciplineMetrics = [
    { key: "courage", label: "Coragem", value: unitDisplayStatFromSnapshot(snapshot, "courage") },
    { key: "power", label: "Poder", value: unitDisplayStatFromSnapshot(snapshot, "power") },
    { key: "wisdom", label: "Inteligencia", value: unitDisplayStatFromSnapshot(snapshot, "wisdom") },
    { key: "speed", label: "Velocidade", value: unitDisplayStatFromSnapshot(snapshot, "speed") },
  ];
  const elementMetrics = [
    { key: "fire", label: "Fogo" },
    { key: "air", label: "Ar" },
    { key: "earth", label: "Terra" },
    { key: "water", label: "Agua" },
  ]
    .map(({ key, label }) => {
      const baseValue = Number(snapshot?.base?.[key] || 0);
      const currentValue = Number(unitDisplayStatFromSnapshot(snapshot, key) || 0);
      if (currentValue <= 0) {
        return null;
      }
      const bonus = Math.round(currentValue - baseValue);
      return {
        key,
        label,
        value: currentValue,
        displayValue: bonus > 0 ? `+${bonus}` : "",
      };
    })
    .filter(Boolean);
  return {
    maxEnergy,
    currentEnergy: Math.max(0, Number(snapshot?.energy?.current || 0)),
    disciplineMetrics,
    elementMetrics,
  };
}

function renderEngagedCreaturePanel(panelNode, unit, snapshot, title) {
  if (!panelNode) {
    return;
  }
  panelNode.innerHTML = "";
  panelNode.classList.toggle("is-empty", !unit);

  const heading = document.createElement("div");
  heading.className = "engaged-title";
  heading.innerHTML = `<span>${title}</span>`;
  panelNode.appendChild(heading);

  if (!unit || !snapshot?.card) {
    const emptyTitle = document.createElement("strong");
    emptyTitle.textContent = "Sem criatura engajada";
    heading.appendChild(emptyTitle);

    const content = document.createElement("div");
    content.className = "engaged-body engaged-body-empty";

    const cardColumn = document.createElement("div");
    cardColumn.className = "engaged-card-column";
    const cardPlaceholder = document.createElement("div");
    cardPlaceholder.className = "engaged-card-thumb engaged-card-thumb-placeholder";
    cardPlaceholder.innerHTML = "<span>Sem combate</span>";
    cardColumn.appendChild(cardPlaceholder);
    const gearPlaceholder = document.createElement("div");
    gearPlaceholder.className = "engaged-gear-thumb empty";
    gearPlaceholder.innerHTML = "<span>Sem Gear</span>";
    cardColumn.appendChild(gearPlaceholder);
    content.appendChild(cardColumn);

    const statList = document.createElement("div");
    statList.className = "engaged-stats engaged-stats-empty";
    ["Coragem", "Poder", "Inteligencia", "Velocidade"].forEach((name) => {
      const block = document.createElement("div");
      block.className = "engaged-metric engaged-metric-empty";
      block.innerHTML = `
        <div class="engaged-metric-head">
          <span class="metric-name">${name}</span>
          <strong class="metric-value">-</strong>
        </div>
        <div class="engaged-metric-bar"><span style="width:0%"></span></div>
      `;
      statList.appendChild(block);
    });
    appendEngagedEnergy(statList, 0, 0);
    content.appendChild(statList);
    panelNode.appendChild(content);

    const placeholder = document.createElement("p");
    placeholder.className = "engaged-placeholder";
    placeholder.textContent = "Entre em combate para acompanhar os atributos.";
    panelNode.appendChild(placeholder);
    return;
  }

  const nameLine = document.createElement("strong");
  nameLine.textContent = snapshot.card.name;
  heading.appendChild(nameLine);

  const thumbButton = document.createElement("button");
  thumbButton.type = "button";
  thumbButton.className = "engaged-card-thumb";
  thumbButton.innerHTML = `<img src="${imageOf(snapshot.card)}" alt="${snapshot.card.name}">`;
  thumbButton.addEventListener("click", (event) => {
    event.stopPropagation();
    showClickPreview(snapshot.card, event);
  });
  attachHoverPreview(thumbButton, snapshot.card);

  const content = document.createElement("div");
  content.className = "engaged-body";

  const cardColumn = document.createElement("div");
  cardColumn.className = "engaged-card-column";
  cardColumn.appendChild(thumbButton);

  if (snapshot.gearCard) {
    const gearButton = document.createElement("button");
    gearButton.type = "button";
    gearButton.className = `engaged-gear-thumb${snapshot.gearState === "face_down" ? " face-down" : ""}`;
    gearButton.innerHTML = `<img src="${imageOf(snapshot.gearCard)}" alt="${snapshot.gearCard.name}">`;
    if (snapshot.gearState !== "face_down") {
      gearButton.addEventListener("click", (event) => {
        event.stopPropagation();
        showClickPreview(snapshot.gearCard, event);
      });
      attachHoverPreview(gearButton, snapshot.gearCard);
    }
    cardColumn.appendChild(gearButton);
  } else {
    const gearEmpty = document.createElement("div");
    gearEmpty.className = "engaged-gear-thumb empty";
    gearEmpty.innerHTML = "<span>Sem Gear</span>";
    cardColumn.appendChild(gearEmpty);
  }
  content.appendChild(cardColumn);

  const statList = document.createElement("div");
  statList.className = "engaged-stats";
  const {
    maxEnergy,
    currentEnergy,
    disciplineMetrics,
    elementMetrics,
  } = buildEngagedMetricList(snapshot);
  disciplineMetrics.forEach((metric) => appendEngagedMetric(statList, metric, maxEnergy));
  elementMetrics.forEach((metric) => appendEngagedMetric(statList, metric, maxEnergy));
  appendEngagedEnergy(statList, currentEnergy, maxEnergy);
  content.appendChild(statList);
  panelNode.appendChild(content);
}

function renderEngagedCreaturePanels() {
  if (!el.engagedPlayerPanel || !el.engagedOpponentPanel) {
    return;
  }
  const battle = appState.battle;
  if (!battle?.board) {
    renderEngagedCreaturePanel(el.engagedPlayerPanel, null, null, "Sua criatura");
    renderEngagedCreaturePanel(el.engagedOpponentPanel, null, null, "Criatura oponente");
    return;
  }
  const localIndex = localPlayerIndex();
  const enemyIndex = opponentPlayerIndex();
  const unitPlayer = engagedUnitForPlayer(battle, localIndex);
  const unitOpponent = engagedUnitForPlayer(battle, enemyIndex);
  renderEngagedCreaturePanel(
    el.engagedPlayerPanel,
    unitPlayer,
    effectiveSnapshot(localIndex, unitPlayer),
    "Sua criatura"
  );
  renderEngagedCreaturePanel(
    el.engagedOpponentPanel,
    unitOpponent,
    effectiveSnapshot(enemyIndex, unitOpponent),
    "Criatura oponente"
  );
}

function appendPassPriorityCard(onClick, text = "Passar prioridade") {
  const passButton = document.createElement("button");
  passButton.type = "button";
  passButton.className = "attack-hand-card action-pass-card";
  passButton.innerHTML = `<span>${text}</span>`;
  passButton.addEventListener("click", onClick);
  el.attackHand.appendChild(passButton);
}

function renderCreatureAbilityPopup() {
  if (!el.creatureAbilityPopup) {
    return;
  }
  el.creatureAbilityPopup.innerHTML = "";
  const battle = appState.battle;
  const quickPick = appState.creatureAbilityQuickPick;
  if (!battle || !quickPick || battle.finished) {
    el.creatureAbilityPopup.classList.add("hidden");
    return;
  }
  const pending = battle.pendingAction;
  if (!(pending?.type === "priority" && pending.playerIndex === localPlayerIndex())) {
    appState.creatureAbilityQuickPick = null;
    el.creatureAbilityPopup.classList.add("hidden");
    return;
  }

  const mappedOptions = (Array.isArray(quickPick.options) ? quickPick.options : [])
    .map((entry) => {
      const optionIndex = Number(entry.optionIndex);
      const option = Array.isArray(pending.options) ? pending.options[optionIndex] : null;
      const allowedSourceKeys = Array.isArray(quickPick.sourceKeys) && quickPick.sourceKeys.length
        ? quickPick.sourceKeys
        : ["creature"];
      if (
        !option
        || option.kind !== "ability"
        || !allowedSourceKeys.includes(String(option.option?.sourceKey || ""))
        || option.option?.sourceUnitId !== quickPick.sourceUnitId
      ) {
        return null;
      }
      return { optionIndex, option };
    })
    .filter(Boolean);

  if (!mappedOptions.length) {
    appState.creatureAbilityQuickPick = null;
    el.creatureAbilityPopup.classList.add("hidden");
    return;
  }

  const title = document.createElement("h4");
  title.textContent = `Escolha a habilidade de ${quickPick.sourceLabel || "sua unidade"}`;
  el.creatureAbilityPopup.appendChild(title);

  const list = document.createElement("div");
  list.className = "creature-ability-popup-list";
  mappedOptions.forEach(({ optionIndex, option }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "creature-ability-option";
    button.innerHTML = `
      <strong>${option.option?.sourceLabel || "Habilidade"}</strong>
      <small>${option.option?.cost?.label || "Ability"}</small>
    `;
    button.addEventListener("click", () => {
      appState.creatureAbilityQuickPick = null;
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "choose_ability", value: optionIndex }).catch((error) => alert(error.message));
      } else {
        chooseActivatedAbility(battle, optionIndex);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    });
    list.appendChild(button);
  });
  el.creatureAbilityPopup.appendChild(list);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "creature-ability-popup-cancel";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => {
    appState.creatureAbilityQuickPick = null;
    renderBattle();
  });
  el.creatureAbilityPopup.appendChild(cancel);

  el.creatureAbilityPopup.classList.remove("hidden");
}

function renderAttackHand() {
  el.attackHand.innerHTML = "";
  const battle = appState.battle;
  if (!battle) {
    return;
  }
  const pending = battle.pendingAction;
  const localIndex = localPlayerIndex();
  if (!(pending?.type === "priority" && pending.playerIndex === localIndex)) {
    appState.creatureAbilityQuickPick = null;
  }

  if (pending?.type === "target_select" && pending.playerIndex === localIndex) {
    const step = pending.targetSteps?.[pending.currentStep] || null;
    const candidates = step?.candidates || [];
    if (!step || !candidates.length) {
      el.attackHand.innerHTML = "<p>Nenhum alvo valido disponivel para este efeito.</p>";
    } else if (step.spec?.type === "attack") {
      el.attackHand.innerHTML = "<p>Selecione o Attack alvo no painel de log da batalha.</p>";
    } else if (step.spec?.type === "creature") {
      el.attackHand.innerHTML = "<p>Selecione a criatura alvo no tabuleiro com clique.</p>";
    } else if (step.spec?.type === "battlegear") {
      el.attackHand.innerHTML = "<p>Selecione o Battlegear alvo no tabuleiro com clique.</p>";
    } else {
      el.attackHand.innerHTML = "<p>Selecione o alvo diretamente no tabuleiro/log.</p>";
    }
    const canCancelTarget =
      pending.sourceKind === "passive_auto"
      || (pending.sourceKind !== "mugic" && pending.sourceKind !== "ability");
    if (canCancelTarget) {
      appendPassPriorityCard(() => {
        if (isMultiplayerActive()) {
          submitMultiplayerAction({ type: "cancel_target" }).catch((error) => alert(error.message));
        } else {
          chooseEffectTarget(battle, null);
          advanceBattle(battle, Boolean(battle.ai?.player0));
          renderBattle();
        }
      }, "Cancelar alvo");
    } else {
      const helper = document.createElement("p");
      helper.className = "attack-hand-helper";
      helper.textContent = "Ativacao em andamento: selecione um alvo para continuar.";
      el.attackHand.appendChild(helper);
    }
    return;
  }

  if (pending?.type === "choice_select" && pending.playerIndex === localIndex) {
    const step = pending.choiceSteps?.[pending.currentChoiceStep] || null;
    const options = Array.isArray(step?.options) ? step.options : [];
    if (!step || !options.length) {
      el.attackHand.innerHTML = "<p>Nenhuma opcao valida disponivel para este efeito.</p>";
      return;
    }
    const helper = document.createElement("p");
    helper.className = "attack-hand-helper";
    helper.textContent = step.label || "Escolha uma opcao para continuar.";
    el.attackHand.appendChild(helper);
    options.forEach((option, optionIndex) => {
      const node = document.createElement("button");
      node.type = "button";
      node.className = "attack-hand-card ability-window-card target-window-card";
      const optionId = option.id ?? option.value ?? String(optionIndex);
      const optionLabel = option.label || option.value || option.id || "Opcao";
      node.innerHTML = `
        <div class="target-no-image">Escolha</div>
        <span class="attack-chip attack-bp">${step.spec?.type || "choice"}</span>
        <span class="attack-chip attack-damage">${optionLabel}</span>
      `;
      node.addEventListener("click", () => {
        if (isMultiplayerActive()) {
          submitMultiplayerAction({ type: "choose_choice", value: optionId }).catch((error) => alert(error.message));
        } else {
          chooseEffectChoice(battle, optionId);
          advanceBattle(battle, Boolean(battle.ai?.player0));
          renderBattle();
        }
      });
      el.attackHand.appendChild(node);
    });
    if (pending.sourceKind === "passive_auto") {
      appendPassPriorityCard(() => {
        if (isMultiplayerActive()) {
          submitMultiplayerAction({ type: "cancel_choice" }).catch((error) => alert(error.message));
        } else {
          chooseEffectChoice(battle, null);
          advanceBattle(battle, Boolean(battle.ai?.player0));
          renderBattle();
        }
      }, "Cancelar escolha");
    }
    return;
  }

  if (pending?.type === "defender_redirect" && pending.playerIndex === localIndex) {
    const options = Array.isArray(pending.options) ? pending.options : [];
    if (!options.length) {
      el.attackHand.innerHTML = "<p>Sem criatura com Defender para redirecionar.</p>";
    } else {
      options.forEach((slotIndex) => {
        const unit = battle.board.players[localIndex]?.creatures?.[slotIndex] || null;
        if (!unit || unit.defeated) {
          return;
        }
        const node = document.createElement("button");
        node.type = "button";
        node.className = "attack-hand-card ability-window-card";
        node.innerHTML = `
          <img src="${imageOf(unit.card)}" alt="${unit.card.name}">
          <span class="attack-chip attack-bp">Slot ${slotIndex + 1}</span>
          <span class="attack-chip attack-damage">Defender</span>
        `;
        node.addEventListener("click", () => {
          if (isMultiplayerActive()) {
            submitMultiplayerAction({ type: "choose_defender", value: slotIndex }).catch((error) => alert(error.message));
          } else {
            chooseDefenderRedirect(battle, slotIndex);
            advanceBattle(battle, Boolean(battle.ai?.player0));
            renderBattle();
          }
        });
        attachHoverPreview(node, unit.card);
        el.attackHand.appendChild(node);
      });
    }
    appendPassPriorityCard(() => {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "choose_defender", value: null }).catch((error) => alert(error.message));
      } else {
        chooseDefenderRedirect(battle, null);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    }, "Manter alvo atual");
    return;
  }

  if (pending?.type === "priority" && pending.playerIndex === localIndex) {
    const options = Array.isArray(pending.options) ? pending.options : [];
    const abilityOptions = options.filter((option) => option.kind === "ability");
    const mugicOptions = options.filter((option) => option.kind === "mugic");
    if (!abilityOptions.length && !mugicOptions.length) {
      el.attackHand.innerHTML = "<p>Sem efeito jogavel nesta janela.</p>";
    } else {
      const helper = document.createElement("p");
      helper.className = "attack-hand-helper";
      helper.textContent = "Ative Mugics pelos orbes laterais e habilidades clicando na criatura/equipamento.";
      el.attackHand.appendChild(helper);
    }
    appendPassPriorityCard(() => {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "pass_priority" }).catch((error) => alert(error.message));
      } else {
        chooseMugic(battle, null);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    });
    return;
  }

  if (pending?.type === "mugic" && pending.playerIndex === localIndex) {
    el.attackHand.innerHTML = "<p>Use os hexagonos laterais para ativar Mugic.</p>";
    appendPassPriorityCard(() => {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "cancel_mugic" }).catch((error) => alert(error.message));
      } else {
        chooseMugic(battle, null);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    });
    return;
  }

  if (pending?.type === "mugic_caster_select" && pending.playerIndex === localIndex) {
    const casterOptions = Array.isArray(pending.options) ? pending.options : [];
    el.attackHand.innerHTML = casterOptions.length
      ? "<p>Escolha no tabuleiro a criatura que vai pagar o custo do Mugic (clique).</p>"
      : "<p>Nenhuma criatura elegivel para lancar este Mugic.</p>";
    appendPassPriorityCard(() => {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "cancel_mugic" }).catch((error) => alert(error.message));
      } else {
        chooseMugic(battle, null);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    }, "Cancelar Mugic");
    return;
  }

  if (pending?.type === "ability" && pending.playerIndex === localIndex) {
    const options = Array.isArray(pending.options) ? pending.options : [];
    if (!options.length) {
      el.attackHand.innerHTML = "<p>Nenhuma habilidade ativada disponivel.</p>";
    } else {
      const helper = document.createElement("p");
      helper.className = "attack-hand-helper";
      helper.textContent = "Clique na criatura/equipamento para ativar a habilidade.";
      el.attackHand.appendChild(helper);
    }
    appendPassPriorityCard(() => {
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "cancel_ability" }).catch((error) => alert(error.message));
      } else {
        chooseActivatedAbility(battle, null);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
      }
    });
    return;
  }

  const player = battle.board.players[localIndex];
  if (!player.attackHand.length) {
    el.attackHand.innerHTML = "<p>Sem attacks na mao.</p>";
    return;
  }
  const canSelectAttack =
    !battle.finished &&
    isLocalHumanControlled(battle) &&
    battle.pendingAction?.type === "strike_attack" &&
    battle.pendingAction.playerIndex === localIndex;
  player.attackHand.forEach((card, index) => {
    const selected = canSelectAttack && Number(battle.pendingAction?.choice) === index;
    const node = document.createElement("button");
    node.type = "button";
    node.className = `attack-hand-card${selected ? " selected" : ""}`;
    node.disabled = !canSelectAttack;
    node.innerHTML = `
      <img src="${imageOf(card)}" alt="${card.name}">
      <span class="attack-chip attack-bp">${Number(card.stats?.bp || 0)} BP</span>
      <span class="attack-chip attack-damage">${Number(card.stats?.base || 0)} DMG</span>
    `;
    node.addEventListener("click", () => {
      if (!canSelectAttack) {
        return;
      }
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "choose_attack", index }).catch((error) => alert(error.message));
      } else {
        chooseAttack(battle, localIndex, index);
        renderBattle();
      }
    });
    attachHoverPreview(node, card);
    el.attackHand.appendChild(node);
  });
}

function syncBattleLogTabs() {
  const view = appState.battleLogView === "effects" ? "effects" : "events";
  if (el.battleLogTabEvents) {
    const isActive = view === "events";
    el.battleLogTabEvents.classList.toggle("is-active", isActive);
    el.battleLogTabEvents.setAttribute("aria-selected", String(isActive));
  }
  if (el.battleLogTabEffects) {
    const isActive = view === "effects";
    el.battleLogTabEffects.classList.toggle("is-active", isActive);
    el.battleLogTabEffects.setAttribute("aria-selected", String(isActive));
  }
}

function renderAttackTargetPickerInLog(battle) {
  const pending = battle.pendingAction;
  if (!(pending?.type === "target_select" && pending.playerIndex === localPlayerIndex())) {
    return false;
  }
  const step = pending.targetSteps?.[pending.currentStep] || null;
  if (step?.spec?.type !== "attack") {
    return false;
  }
  const targetBox = document.createElement("div");
  targetBox.className = "log-target-picker";
  const title = document.createElement("strong");
  title.className = "log-target-picker-title";
  title.textContent = "Selecione o Attack alvo da pilha";
  targetBox.appendChild(title);
  const subtitle = document.createElement("small");
  subtitle.className = "log-target-picker-subtitle";
  subtitle.textContent = step.label || "Escolha um attack.";
  targetBox.appendChild(subtitle);
  const list = document.createElement("div");
  list.className = "log-target-picker-list";
  const candidates = Array.isArray(step.candidates) ? step.candidates : [];
  if (!candidates.length) {
    const empty = document.createElement("span");
    empty.className = "log-target-picker-empty";
    empty.textContent = "Sem attacks validos na pilha.";
    list.appendChild(empty);
  } else {
    candidates.forEach((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "log-target-candidate";
      button.innerHTML = `
        <span class="log-target-name">${candidate.label || "Attack"}</span>
        <span class="log-target-meta">${Number(candidate.card?.stats?.base || 0)} DMG</span>
      `;
      button.addEventListener("click", () => {
        if (isMultiplayerActive()) {
          submitMultiplayerAction({ type: "choose_target", value: candidate.id }).catch((error) => alert(error.message));
        } else {
          chooseEffectTarget(battle, candidate.id);
          advanceBattle(battle, Boolean(battle.ai?.player0));
          renderBattle();
        }
      });
      if (candidate.card) {
        attachHoverPreview(button, candidate.card);
      }
      list.appendChild(button);
    });
  }
  targetBox.appendChild(list);
  el.battleLog.appendChild(targetBox);
  return true;
}

function renderEffectTimelineLog(battle) {
  const entries = Array.isArray(battle.effectLog) ? battle.effectLog.slice(-120) : [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "Nenhum efeito/habilidade registrado ainda.";
    el.battleLog.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const box = document.createElement("div");
    box.className = "log-entry log-effect-entry";
    const turn = Number(entry.turn || 0);
    const phase = entry.phase ? String(entry.phase).replaceAll("_", " ") : "-";
    const header = document.createElement("div");
    header.className = "log-effect-head";
    header.innerHTML = `
      <span class="log-effect-kind">${entry.type || "effect"} · ${entry.source || "fonte"}</span>
      <span class="log-effect-time">T${turn} · ${phase}</span>
    `;
    box.appendChild(header);

    const desc = document.createElement("div");
    desc.className = "log-effect-desc";
    desc.textContent = entry.description || "Efeito aplicado.";
    box.appendChild(desc);

    const meta = document.createElement("div");
    meta.className = "log-effect-meta";
    const targets = Array.isArray(entry.targetsResolved) && entry.targetsResolved.length
      ? entry.targetsResolved
      : (Array.isArray(entry.targets) ? entry.targets : []);
    const effects = Array.isArray(entry.effects) && entry.effects.length ? entry.effects : [];
    const choices = Array.isArray(entry.choices) && entry.choices.length ? entry.choices : [];
    const kindLabel = entry.effectKind ? String(entry.effectKind) : "-";
    const activationType = entry.activationType ? String(entry.activationType) : "-";
    const timing = entry.timing ? String(entry.timing) : "-";
    const result = entry.result ? String(entry.result) : "-";
    meta.innerHTML = `
      <small><strong>Efeito:</strong> ${kindLabel}</small>
      <small><strong>Ativacao:</strong> ${activationType}</small>
      <small><strong>Timing:</strong> ${timing}</small>
      <small><strong>Alvos:</strong> ${targets.length ? targets.join(", ") : "sem alvo"}</small>
      <small><strong>Resultado:</strong> ${result}</small>
      <small><strong>Kinds aplicados:</strong> ${effects.length ? effects.join(", ") : "-"}</small>
      <small><strong>Escolhas:</strong> ${choices.length ? choices.join(", ") : "-"}</small>
    `;
    box.appendChild(meta);
    el.battleLog.appendChild(box);
  });
}

function renderBattleLog() {
  el.battleLog.innerHTML = "";
  syncBattleLogTabs();
  const battle = appState.battle;
  if (!battle) {
    appState.debug.lastBattleLogIndex = 0;
    appState.pendingAttackRuntime.lastBattleLogIndex = 0;
    return;
  }

  const hasTargetPicker = renderAttackTargetPickerInLog(battle);
  const view = appState.battleLogView === "effects" ? "effects" : "events";
  if (view === "effects") {
    renderEffectTimelineLog(battle);
  } else {
    battle.log.slice(-90).forEach((line) => {
      const item = document.createElement("div");
      item.className = "log-entry";
      item.textContent = line;
      if (/vitoria/i.test(line)) {
        item.classList.add("log-win");
      }
      if (/derrotad|dano/i.test(line)) {
        item.classList.add("log-danger");
      }
      el.battleLog.appendChild(item);
    });
  }
  if (!hasTargetPicker && !el.battleLog.children.length) {
    const empty = document.createElement("div");
    empty.className = "log-empty";
    empty.textContent = "Sem eventos de combate registrados.";
    el.battleLog.appendChild(empty);
  }
  el.battleLog.scrollTop = el.battleLog.scrollHeight;

  if (Number(appState.pendingAttackRuntime.lastBattleLogIndex || 0) > battle.log.length) {
    appState.pendingAttackRuntime.lastBattleLogIndex = 0;
  }
  const pendingFrom = Math.max(0, Number(appState.pendingAttackRuntime.lastBattleLogIndex || 0));
  const pendingUpdates = battle.log.slice(pendingFrom);
  pendingUpdates.forEach((line) => {
    queuePendingAttackRuntimeFromLog(line);
  });
  appState.pendingAttackRuntime.lastBattleLogIndex = battle.log.length;

  if (appState.debug.active) {
    if (Number(appState.debug.lastBattleLogIndex || 0) > battle.log.length) {
      appState.debug.lastBattleLogIndex = 0;
    }
    const fromIndex = Math.max(0, Number(appState.debug.lastBattleLogIndex || 0));
    const updates = battle.log.slice(fromIndex);
    updates.forEach((line) => {
      debugLog("battle_log", line);
    });
    appState.debug.lastBattleLogIndex = battle.log.length;
  }
}
function getGeneralDiscard(player) {
  const creatures = Array.isArray(player?.creatureDiscard)
    ? player.creatureDiscard
    : (player?.creatures || []).filter((unit) => unit?.defeated).map((unit) => unit.card).filter(Boolean);
  const battlegear = Array.isArray(player?.battlegearDiscard)
    ? player.battlegearDiscard
    : [];
  return { creatures, battlegear };
}

function createInspectorRow(card, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "inspector-row";
  row.innerHTML = `
    <span class="inspector-row-index">${index + 1}.</span>
    <img src="${imageOf(card)}" alt="${card.name}">
    <span class="inspector-row-name">${card.name}</span>
  `;
  row.addEventListener("click", (event) => {
    event.stopPropagation();
    showClickPreview(card, event);
  });
  attachHoverPreview(row, card);
  return row;
}

function appendInspectorSection(container, title, cards, emptyText) {
  const section = document.createElement("section");
  section.className = "inspector-section";
  section.innerHTML = `<h4>${title} (${cards.length})</h4>`;
  if (!cards.length) {
    const empty = document.createElement("p");
    empty.className = "inspector-empty";
    empty.textContent = emptyText;
    section.appendChild(empty);
    container.appendChild(section);
    return;
  }
  const list = document.createElement("div");
  list.className = "inspector-list";
  cards.forEach((card, index) => {
    list.appendChild(createInspectorRow(card, index));
  });
  section.appendChild(list);
  container.appendChild(section);
}

function renderBoardInspector() {
  if (
    !el.boardInspector ||
    !el.boardInspectorTitle ||
    !el.boardInspectorContent ||
    !el.tabAtkDiscard ||
    !el.tabGenDiscard ||
    !el.tabBoardView ||
    !el.tabOppGenDiscard ||
    !el.tabOppAtkDiscard
  ) {
    return;
  }

  const view = appState.battleCenterView || "board";
  const tabs = [
    [el.tabAtkDiscard, "atk-discard"],
    [el.tabGenDiscard, "gen-discard"],
    [el.tabBoardView, "board"],
    [el.tabOppGenDiscard, "opp-gen-discard"],
    [el.tabOppAtkDiscard, "opp-atk-discard"],
  ];
  tabs.forEach(([node, key]) => {
    node.classList.toggle("is-active", key === view);
  });

  if (view === "board" || !appState.battle) {
    el.boardInspector.classList.add("hidden");
    el.boardInspectorContent.innerHTML = "";
    return;
  }

  const board = appState.battle.board;
  const player = board.players[localPlayerIndex()];
  const opponent = board.players[opponentPlayerIndex()];
  const ownGeneral = getGeneralDiscard(player);
  const oppGeneral = getGeneralDiscard(opponent);

  el.boardInspector.classList.remove("hidden");
  el.boardInspectorContent.innerHTML = "";

  if (view === "atk-discard") {
    el.boardInspectorTitle.textContent = "Seus Ataques e Mugics usados";
    appendInspectorSection(el.boardInspectorContent, "Attacks", player.attackDiscard || [], "Nenhum attack usado ainda.");
    appendInspectorSection(el.boardInspectorContent, "Mugics", player.mugicDiscard || [], "Nenhum mugic usado ainda.");
    return;
  }

  if (view === "gen-discard") {
    el.boardInspectorTitle.textContent = "Suas Creatures e Battlegears descartados";
    appendInspectorSection(el.boardInspectorContent, "Creatures", ownGeneral.creatures, "Nenhuma creature descartada.");
    appendInspectorSection(el.boardInspectorContent, "Battlegear", ownGeneral.battlegear, "Nenhum battlegear descartado.");
    return;
  }

  if (view === "opp-gen-discard") {
    el.boardInspectorTitle.textContent = "Creatures e Battlegears descartados do oponente";
    appendInspectorSection(el.boardInspectorContent, "Creatures", oppGeneral.creatures, "Oponente sem creatures descartadas.");
    appendInspectorSection(el.boardInspectorContent, "Battlegear", oppGeneral.battlegear, "Oponente sem battlegear descartado.");
    return;
  }

  if (view === "opp-atk-discard") {
    el.boardInspectorTitle.textContent = "Ataques e Mugics usados do oponente";
    appendInspectorSection(el.boardInspectorContent, "Attacks", opponent.attackDiscard || [], "Oponente sem attacks usados.");
    appendInspectorSection(el.boardInspectorContent, "Mugics", opponent.mugicDiscard || [], "Oponente sem mugics usados.");
  }
}

function renderBattle() {
  if (appState.battleAnimationBlock) return;
  if (
    !el.topSlots ||
    !el.bottomSlots ||
    !el.locationMini ||
    !el.attackHand ||
    !el.battleLog ||
    !el.hudTurn ||
    !el.hudPhase ||
    !el.phaseHelp ||
    !el.confirmEngage ||
    !el.playerAttack
  ) {
    return;
  }
  const battle = appState.battle;
  if (!battle) {
    resetProfileTracking();
  } else {
    const wasFinished = Boolean(appState.profileTracking.lastFinishedState);
    const isFinished = Boolean(battle.finished);
    if (wasFinished && !isFinished) {
      appState.profileTracking.usageReported = false;
      appState.profileTracking.resultReported = false;
    }
    appState.profileTracking.lastFinishedState = isFinished;
  }
  if (!battle) {
    appState.slotSnapshotHashByUnit.clear();
  } else {
    const aliveIds = new Set();
    battle.board.players.forEach((player) => {
      player.creatures.forEach((unit) => {
        if (unit && !unit.defeated && unit.unitId) {
          aliveIds.add(unit.unitId);
        }
      });
    });
    [...appState.slotSnapshotHashByUnit.keys()].forEach((unitId) => {
      if (!aliveIds.has(unitId)) {
        appState.slotSnapshotHashByUnit.delete(unitId);
      }
    });
  }
  const visualLocalIndex = localPlayerIndex();
  const visualEnemyIndex = opponentPlayerIndex();
  renderSlotLayer(el.topSlots, visualEnemyIndex, "top");
  renderSlotLayer(el.bottomSlots, visualLocalIndex, "bottom");
  renderCreatureAbilityPopup();
  renderLocationCard();
  renderAttackHand();
  renderBattleLog();
  renderBoardInspector();
  renderEngagedCreaturePanels();
  renderRematchRequestPopup();

  if (!battle) {
    el.hudTurn.textContent = "-";
    el.hudPhase.textContent = "-";
    el.phaseHelp.textContent = "Inicie a batalha para comecar.";
    if (el.battleStageTitle) {
      el.battleStageTitle.textContent = "Turno -";
    }
    if (el.battleRematch) {
      el.battleRematch.classList.add("hidden");
      el.battleRematch.disabled = true;
    }
    if (el.battleForfeit) {
      el.battleForfeit.disabled = true;
    }
    if (el.battlePlayerAName) {
      el.battlePlayerAName.textContent = el.battleDeckA?.value || "Jogador 1";
    }
    if (el.battlePlayerBName) {
      el.battlePlayerBName.textContent = el.battleDeckB?.value || "Jogador 2";
    }
    updateBattlePlayerAvatars(0, 1);
    const playerTagA = el.battlePlayerAName?.closest(".battle-player-tag");
    const playerTagB = el.battlePlayerBName?.closest(".battle-player-tag");
    if (playerTagA) {
      playerTagA.classList.remove("is-active-turn");
    }
    if (playerTagB) {
      playerTagB.classList.remove("is-active-turn");
    }
    el.confirmEngage.textContent = "Encerrar Acao";
    el.playerAttack.textContent = "Confirmar Attack";
    el.confirmEngage.disabled = true;
    el.playerAttack.disabled = true;
    return;
  }

  const board = battle.board;
  const localIndex = localPlayerIndex();
  const opponentIndex = opponentPlayerIndex();
  const active = board.players[board.activePlayerIndex];
  const humanControlled = isLocalHumanControlled(battle);
  const engagedReady = Boolean(board.engagement.attackerLetter && board.engagement.defenderLetter);
  const waitingHumanEngage =
    !battle.finished && battle.phase === "move_action" && isLocalHumanTurn(battle) && humanControlled;
  const waitingHumanAttack =
    !battle.finished &&
    humanControlled &&
    battle.pendingAction?.type === "strike_attack" &&
    battle.pendingAction.playerIndex === localIndex;
  const waitingHumanPostMove =
    !battle.finished && battle.phase === "additional_movement" && isLocalHumanTurn(battle) && humanControlled;
  const canFinishActionWithoutCombat = waitingHumanEngage && !engagedReady;

  if (el.battleStageTitle) {
    el.battleStageTitle.textContent = battle.finished
      ? `Vencedor: ${battle.winner || "Jogador"}`
      : `Turno ${board.turn}`;
  }
  if (el.battleRematch) {
    el.battleRematch.classList.toggle("hidden", !battle.finished);
    if (isMultiplayerActive()) {
      const rematch = appState.multiplayer?.rematch || {};
      const localSeat = localSeatName();
      const waitingApproval = Boolean(rematch.pending);
      const requestedBySelf = waitingApproval && rematch.requestedBy === localSeat;
      el.battleRematch.textContent = waitingApproval
        ? (requestedBySelf ? "Aguardando..." : "Responder Revanche")
        : "Revanche";
      el.battleRematch.disabled = !battle.finished || localSeat === "spectator" || waitingApproval;
    } else {
      el.battleRematch.textContent = "Revanche";
      el.battleRematch.disabled = !battle.finished;
    }
  }
  if (el.battleForfeit) {
    const isSpectator = isMultiplayerActive() && appState.multiplayer.role === "spectator";
    el.battleForfeit.disabled = !battle || battle.finished || isSpectator;
  }

  el.hudTurn.textContent = String(board.turn);
  el.hudPhase.textContent = PHASE_LABEL[battle.phase] || battle.phase;
  let phaseHelpMessage = phaseHelpText(battle);
  if (isMultiplayerActive()) {
    const connection = appState.multiplayer.connection || {};
    const hostStatus = connection.hostConnected ? "Host online" : "Host offline";
    const guestStatus = connection.guestConnected ? "Guest online" : "Guest offline";
    phaseHelpMessage += ` | ${hostStatus} | ${guestStatus}`;
    if (connection.timeoutSeat && connection.timeoutAt) {
      const timeoutAt = Date.parse(connection.timeoutAt);
      if (Number.isFinite(timeoutAt) && timeoutAt > Date.now()) {
        const remainingSeconds = Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000));
        const seatLabel = connection.timeoutSeat === "host" ? "Host" : "Guest";
        phaseHelpMessage += ` | ${seatLabel} desconectado: forfeit em ${remainingSeconds}s.`;
      }
    }
  }
  el.phaseHelp.textContent = phaseHelpMessage;

  const player = board.players[localIndex];
  const opponent = board.players[opponentIndex];
  reportCreatureUsageOnce(battle);
  reportBattleResultIfNeeded(battle);
  const playerGeneralDiscard = getGeneralDiscard(player);
  const opponentGeneralDiscard = getGeneralDiscard(opponent);
  el.atkDiscardCount.textContent = String(player.attackDiscard.length + player.mugicDiscard.length);
  el.genDiscardCount.textContent = String(playerGeneralDiscard.creatures.length + playerGeneralDiscard.battlegear.length);
  el.boardCount.textContent = String(getAliveSlots(player).length + getAliveSlots(opponent).length);
  el.oppGenDiscardCount.textContent = String(opponentGeneralDiscard.creatures.length + opponentGeneralDiscard.battlegear.length);
  el.oppAtkDiscardCount.textContent = String(opponent.attackDiscard.length + opponent.mugicDiscard.length);

  if (el.playerAlive) {
    el.playerAlive.textContent = `${getAliveSlots(player).length} alive`;
  }
  if (el.oppAlive) {
    el.oppAlive.textContent = `${getAliveSlots(opponent).length} alive`;
  }
  if (el.battlePlayerAName) {
    el.battlePlayerAName.textContent = board.players[localIndex]?.label || "Voce";
  }
  if (el.battlePlayerBName) {
    el.battlePlayerBName.textContent = board.players[opponentIndex]?.label || "Oponente";
  }
  updateBattlePlayerAvatars(localIndex, opponentIndex);
  const playerTagA = el.battlePlayerAName?.closest(".battle-player-tag");
  const playerTagB = el.battlePlayerBName?.closest(".battle-player-tag");
  if (playerTagA && playerTagB) {
    playerTagA.classList.toggle("is-active-turn", !battle.finished && board.activePlayerIndex === localIndex);
    playerTagB.classList.toggle("is-active-turn", !battle.finished && board.activePlayerIndex === opponentIndex);
  }

  renderMugicRail(el.playerMugicRail, player, false);
  renderMugicRail(el.oppMugicRail, opponent, true);

  if (waitingHumanPostMove) {
    el.confirmEngage.textContent = "Encerrar Turno";
    el.confirmEngage.disabled = false;
  } else if (waitingHumanEngage && engagedReady) {
    el.confirmEngage.textContent = "Continuar";
    el.confirmEngage.disabled = false;
  } else if (canFinishActionWithoutCombat) {
    el.confirmEngage.textContent = "Encerrar Acao";
    el.confirmEngage.disabled = false;
  } else {
    el.confirmEngage.textContent = "Encerrar Acao";
    el.confirmEngage.disabled = !(waitingHumanEngage && (engagedReady || canFinishActionWithoutCombat));
  }
  el.playerAttack.textContent = "Confirmar Attack";
  el.playerAttack.disabled = !(
    waitingHumanAttack &&
    battle.pendingAction?.choice !== null &&
    battle.pendingAction?.choice !== undefined
  );
  if (el.autoStep) {
    const mp = isMultiplayerActive();
    el.autoStep.disabled = mp;
    el.autoStep.title = mp
      ? "Desativado no multiplayer (controle manual do jogador)."
      : "Avanca automaticamente o fluxo local.";
  }
}

function buildBattleConfigFromUi(options = {}) {
  const forceAiVsAi = Boolean(options.forceAiVsAi);
  return {
    deckAName: el.battleDeckA?.value || "",
    deckBName: el.battleDeckB?.value || "",
    mode: el.battleMode?.value || appState.currentRuleset || "competitive",
    aiPlayer0: forceAiVsAi || Boolean(el.aiPlayerOne?.checked),
    aiVsAi: forceAiVsAi,
  };
}

async function startBattleFromConfig(config) {
  if (isMultiplayerActive()) {
    closeMultiplayerStream();
    appState.multiplayer.enabled = false;
    appState.multiplayer.roomId = null;
    appState.multiplayer.phase = "lobby";
    appState.multiplayer.matchType = "";
    appState.multiplayer.rulesMode = "competitive";
    appState.multiplayer.dromeId = "";
    appState.multiplayer.challengeMeta = null;
    appState.multiplayer.seatToken = "";
    appState.multiplayer.role = "host";
    appState.multiplayer.localPlayerIndex = 0;
    appState.multiplayer.battleSnapshotHydrated = false;
    appState.multiplayer.connection = {
      hostConnected: false,
      guestConnected: false,
      timeoutSeat: null,
      timeoutAt: null,
      timeoutMs: 120000,
    };
    appState.multiplayer.rematch = {
      pending: false,
      requestedBy: null,
      requestedAt: null,
    };
    appState.multiplayer.deckSelect = {
      host: { ready: false, deckName: "", valid: false, errors: [] },
      guest: { ready: false, deckName: "", valid: false, errors: [] },
    };
  }
  if (!config.deckAName || !config.deckBName) {
    alert("Selecione os dois decks da batalha.");
    return;
  }
  const [deckA, deckB] = await Promise.all([
    apiJson(`/api/decks/${encodeURIComponent(config.deckAName)}?username=${encodeURIComponent(currentUsername())}`),
    apiJson(`/api/decks/${encodeURIComponent(config.deckBName)}?username=${encodeURIComponent(currentUsername())}`),
  ]);
  const validationA = validateDeck(deckA, config.mode);
  const validationB = validateDeck(deckB, config.mode);
  if (!validationA.ok || !validationB.ok) {
    const details = [
      ...(!validationA.ok ? [`Deck Jogador 1 invalido: ${validationA.errors.slice(0, 3).join(" | ")}`] : []),
      ...(!validationB.ok ? [`Deck Jogador 2 invalido: ${validationB.errors.slice(0, 3).join(" | ")}`] : []),
    ];
    alert(details.join("\n"));
    return;
  }

  try {
    clearBattleListeners();
    appState.battle = createBattleState(toBattleDeck(deckA), toBattleDeck(deckB), config.mode);
    resetProfileTracking();
    appState.lastBattleConfig = { ...config };
    if (el.battleDeckA) {
      el.battleDeckA.value = config.deckAName;
    }
    if (el.battleDeckB) {
      el.battleDeckB.value = config.deckBName;
    }
    if (el.battleMode) {
      el.battleMode.value = config.mode;
    }
    if (el.aiPlayerOne) {
      el.aiPlayerOne.checked = Boolean(config.aiPlayer0);
    }
    appState.battleCenterView = "board";
    appState.battleLogView = "events";
    appState.battle.ai = {
      player0: Boolean(config.aiPlayer0),
      player1: true,
    };
    onBattleEvent("damage", () => {
      debugLog("battle_event", "damage");
      setTimeout(() => renderBattle(), 50);
    });
    onBattleEvent("defeat", (data) => {
      debugLog("battle_event", "defeat", data);
      const { unitId } = data || {};
      triggerDefeatCodeExplosion(unitId);
    });
    onBattleEvent("reveal", () => {
      debugLog("battle_event", "reveal");
      renderBattle();
    });
    onBattleEvent("finished", () => {
      debugLog("battle_event", "finished");
      renderBattle();
    });
  } catch (error) {
    alert(error.message);
    return;
  }

  switchTab("battle");
  switchBattleView(true);
  const autoHuman = Boolean(appState.battle?.ai?.player0);
  advanceBattle(appState.battle, autoHuman);
  if (config.aiVsAi && appState.battle && !appState.battle.finished) {
    advanceBattle(appState.battle, true);
  }
  renderBattle();
}

async function startBattleFromUI(options = {}) {
  const config = buildBattleConfigFromUi(options);
  await startBattleFromConfig(config);
}

async function startRematchFromCurrentBattle() {
  if (!appState.lastBattleConfig) {
    alert("Nao ha batalha anterior para revanche.");
    return;
  }
  if (isMultiplayerActive()) {
    await submitMultiplayerAction({ type: "request_rematch" });
    return;
  }
  await startBattleFromConfig({ ...appState.lastBattleConfig });
}

function updateMultiplayerBattleView() {
  if (isMultiplayerDeckSelectPhase()) {
    switchBattleView(false);
    renderMultiplayerDeckSelectState();
    return;
  }
  if (el.battleSetupMpStatus) {
    el.battleSetupMpStatus.classList.add("hidden");
  }
  if (el.battleMode) {
    el.battleMode.disabled = false;
    const modeLabel = el.battleMode.closest("label");
    if (modeLabel) {
      modeLabel.classList.remove("hidden");
    }
  }
  if (el.aiPlayerOne) {
    el.aiPlayerOne.disabled = false;
    const toggleLabel = el.aiPlayerOne.closest("label");
    if (toggleLabel) {
      toggleLabel.classList.remove("hidden");
    }
  }
  if (el.startBattle) {
    el.startBattle.classList.remove("hidden");
    el.startBattle.textContent = "Iniciar Batalha";
  }
  if (el.runAiMatch) {
    el.runAiMatch.classList.remove("hidden");
    el.runAiMatch.textContent = "IA vs IA";
  }
  if (el.battleMpReady) {
    el.battleMpReady.classList.add("hidden");
  }
  switchBattleView(true);
}

function readableRulesMode(modeRaw) {
  const mode = String(modeRaw || "").toLowerCase();
  if (mode === "casual") return "Casual";
  if (mode === "1v1") return "1v1";
  return "Competitivo";
}

async function submitMultiplayerDeckSelection(useBuilderSnapshot = false) {
  if (!isMultiplayerDeckSelectPhase()) {
    return;
  }
  const localSeat = localSeatName();
  if (localSeat !== "host" && localSeat !== "guest") {
    alert("Somente os jogadores da sala podem selecionar deck.");
    return;
  }
  const localSelect = localSeat === "host" ? el.battleDeckA : el.battleDeckB;
  const deckName = String(localSelect?.value || "").trim();
  const payloadBody = {
    seatToken: String(appState.multiplayer.seatToken || ""),
    deckName,
  };
  if (useBuilderSnapshot) {
    payloadBody.deckName = String(appState.deck?.name || deckName || `${currentUsername()} Snapshot`).trim();
    payloadBody.deckSnapshot = {
      name: payloadBody.deckName,
      owner: currentUsername(),
      mode: String(appState.currentRuleset || "competitive"),
      createdAt: appState.deck?.createdAt || new Date().toISOString(),
      cards: {
        creatures: Array.isArray(appState.deck?.cards?.creatures) ? [...appState.deck.cards.creatures] : [],
        attacks: Array.isArray(appState.deck?.cards?.attacks) ? [...appState.deck.cards.attacks] : [],
        battlegear: Array.isArray(appState.deck?.cards?.battlegear) ? [...appState.deck.cards.battlegear] : [],
        locations: Array.isArray(appState.deck?.cards?.locations) ? [...appState.deck.cards.locations] : [],
        mugic: Array.isArray(appState.deck?.cards?.mugic) ? [...appState.deck.cards.mugic] : [],
      },
    };
  } else if (!payloadBody.deckName) {
    alert("Selecione um deck salvo primeiro.");
    return;
  }
  try {
    const payload = await apiJson(`/api/multiplayer/rooms/${encodeURIComponent(appState.multiplayer.roomId || "")}/deck/select`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadBody),
    });
    if (payload?.snapshot) {
      applyMultiplayerSnapshot(payload.snapshot);
    }
    renderMultiplayerDeckSelectState();
  } catch (error) {
    alert(error?.message || "Nao foi possivel selecionar deck para a sala.");
  }
}

async function setMultiplayerReadyState(nextReady) {
  if (!isMultiplayerDeckSelectPhase()) {
    return;
  }
  try {
    const payload = await apiJson(`/api/multiplayer/rooms/${encodeURIComponent(appState.multiplayer.roomId || "")}/ready`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seatToken: String(appState.multiplayer.seatToken || ""),
        ready: Boolean(nextReady),
      }),
    });
    if (payload?.snapshot) {
      applyMultiplayerSnapshot(payload.snapshot);
    }
    updateMultiplayerBattleView();
    renderBattle();
  } catch (error) {
    alert(error?.message || "Nao foi possivel atualizar estado de pronto.");
  }
}

function renderMultiplayerDeckSelectState() {
  if (!isMultiplayerDeckSelectPhase()) {
    return;
  }
  const roomPlayers = appState.multiplayer.players || {};
  const localSeat = localSeatName();
  const localIsHost = localSeat === "host";
  const hostName = String(roomPlayers.host?.name || "Host");
  const guestName = String(roomPlayers.guest?.name || "Guest");
  const rulesLabel = readableRulesMode(appState.multiplayer.rulesMode);
  const deckSelectState = appState.multiplayer.deckSelect || {};
  const hostState = deckSelectState.host || {};
  const guestState = deckSelectState.guest || {};

  if (el.battleSetupTitle) {
    el.battleSetupTitle.textContent = "Pre-combate Multiplayer";
  }
  if (el.battleSetupDescription) {
    el.battleSetupDescription.textContent = `Defina seu deck de batalha (${rulesLabel}) e marque pronto. A luta so comeca quando os dois jogadores estiverem prontos.`;
  }
  if (el.battleSetupMpStatus) {
    el.battleSetupMpStatus.classList.remove("hidden");
    el.battleSetupMpStatus.textContent = `Host: ${hostState.ready ? "Pronto" : "Ajustando deck"} | Guest: ${guestState.ready ? "Pronto" : "Ajustando deck"}`;
  }
  if (el.battleSetupPlayerATitle) {
    el.battleSetupPlayerATitle.textContent = hostName;
  }
  if (el.battleSetupPlayerBTitle) {
    el.battleSetupPlayerBTitle.textContent = guestName;
  }

  if (el.aiPlayerOne) {
    el.aiPlayerOne.checked = false;
    el.aiPlayerOne.disabled = true;
    const toggleLabel = el.aiPlayerOne.closest("label");
    if (toggleLabel) {
      toggleLabel.classList.add("hidden");
    }
  }
  if (el.battleMode) {
    el.battleMode.value = String(appState.multiplayer.rulesMode || "competitive");
    el.battleMode.disabled = true;
    const modeLabel = el.battleMode.closest("label");
    if (modeLabel) {
      modeLabel.classList.add("hidden");
    }
  }

  if (el.startBattle) {
    el.startBattle.textContent = "Selecionar deck salvo";
    el.startBattle.classList.toggle("hidden", localSeat === "spectator");
  }
  if (el.runAiMatch) {
    el.runAiMatch.textContent = "Usar deck atual do Builder";
    el.runAiMatch.classList.toggle("hidden", localSeat === "spectator");
  }

  if (el.battleDeckA) {
    el.battleDeckA.disabled = !localIsHost;
    ensureDeckOption(el.battleDeckA, String(roomPlayers.host?.deckName || hostState.deckName || ""));
    if (roomPlayers.host?.deckName) {
      el.battleDeckA.value = String(roomPlayers.host.deckName);
    }
  }
  if (el.battleDeckB) {
    el.battleDeckB.disabled = localIsHost || localSeat === "spectator";
    ensureDeckOption(el.battleDeckB, String(roomPlayers.guest?.deckName || guestState.deckName || ""));
    if (roomPlayers.guest?.deckName) {
      el.battleDeckB.value = String(roomPlayers.guest.deckName);
    }
  }

  if (el.battleDeckAInfo) {
    const errors = Array.isArray(hostState.errors) && hostState.errors.length ? ` | ${hostState.errors.join(" | ")}` : "";
    el.battleDeckAInfo.textContent = hostState.deckName
      ? `${hostState.ready ? "Pronto" : "Deck selecionado"}: ${hostState.deckName}${errors}`
      : "Host ainda nao selecionou deck.";
  }
  if (el.battleDeckBInfo) {
    const errors = Array.isArray(guestState.errors) && guestState.errors.length ? ` | ${guestState.errors.join(" | ")}` : "";
    el.battleDeckBInfo.textContent = guestState.deckName
      ? `${guestState.ready ? "Pronto" : "Deck selecionado"}: ${guestState.deckName}${errors}`
      : "Guest ainda nao selecionou deck.";
  }

  if (el.battleMpReady) {
    const localState = localIsHost ? hostState : guestState;
    const localReady = Boolean(localState.ready);
    const canInteract = localSeat === "host" || localSeat === "guest";
    el.battleMpReady.classList.toggle("hidden", !canInteract);
    el.battleMpReady.disabled = !canInteract;
    el.battleMpReady.textContent = localReady ? "Cancelar pronto" : "Marcar pronto";
  }
}

async function handleBattleMenuExit() {
  const isRankedMultiplayer = isMultiplayerActive() && String(appState.multiplayer.matchType || "") === "ranked_drome";
  if (isRankedMultiplayer) {
    try {
      await apiJson("/api/dromos/ranked/session/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: String(appState.multiplayer.roomId || ""),
          seatToken: String(appState.multiplayer.seatToken || ""),
        }),
      });
    } catch (_error) {
      // Keep menu navigation even if ranked cleanup fails.
    }
  }
  window.location.href = toPage("menu.html");
}

async function startMultiplayerBattle(roomId, seatTokenFromQuery = "", roleFromQuery = "") {
  try {
    closeMultiplayerStream();
    resetProfileTracking();
    clearBattleListeners();
    appState.multiplayer.enabled = true;
    appState.multiplayer.roomId = String(roomId || "");
    appState.multiplayer.matchType = "";
    appState.multiplayer.dromeId = "";
    appState.multiplayer.challengeMeta = null;
    appState.multiplayer.seatToken = String(seatTokenFromQuery || "");
    appState.multiplayer.role = roleFromQuery || "spectator";
    appState.multiplayer.battleSnapshotHydrated = false;

    const stateUrl = `/api/multiplayer/rooms/${encodeURIComponent(roomId)}/state?seatToken=${encodeURIComponent(appState.multiplayer.seatToken || "")}`;
    const roomState = await apiJson(stateUrl);
    applyMultiplayerSnapshot(roomState);
    await refreshDeckList().catch(() => {});
    if (typeof roomState.localPlayerIndex === "number") {
      appState.multiplayer.localPlayerIndex = roomState.localPlayerIndex;
    } else if (appState.multiplayer.role === "guest") {
      appState.multiplayer.localPlayerIndex = 1;
    } else if (appState.multiplayer.role === "host") {
      appState.multiplayer.localPlayerIndex = 0;
    } else {
      appState.multiplayer.localPlayerIndex = 0;
    }

    const streamUrl = `/api/multiplayer/events/${encodeURIComponent(roomId)}?seatToken=${encodeURIComponent(appState.multiplayer.seatToken || "")}`;
    const evtSource = new EventSource(streamUrl);
    evtSource.onmessage = (event) => {
      const payload = safeJsonParse(event.data, null);
      if (!payload || typeof payload !== "object") {
        return;
      }
      if (payload.type === "room_snapshot" && payload.snapshot) {
        applyMultiplayerSnapshot(payload.snapshot);
        updateMultiplayerBattleView();
        if (isMultiplayerDeckSelectPhase()) {
          renderMultiplayerDeckSelectState();
        }
        renderBattle();
        return;
      }
      if (payload.type === "room_event") {
        if (payload.event === "disconnect_forfeit") {
          const winner = payload.winner || "Oponente";
          alert(`Partida encerrada por desconexao. Vencedor: ${winner}.`);
        } else if (payload.event === "rematch_declined") {
          alert("Pedido de revanche recusado.");
        } else if (payload.event === "rematch_started") {
          alert("Revanche iniciada.");
        } else if (payload.event === "match_forfeit") {
          const winner = payload.winner || "Oponente";
          alert(`Partida encerrada por desistência. Vencedor: ${winner}.`);
        }
        return;
      }
      if (payload.type === "error_event") {
        alert(payload.message || "Erro de sincronizacao multiplayer.");
      }
    };
    evtSource.onerror = () => {
      // Keep UI running with the last known snapshot.
    };
    appState.multiplayer.eventSource = evtSource;

    switchTab("battle");
    updateMultiplayerBattleView();
    if (isMultiplayerDeckSelectPhase()) {
      renderMultiplayerDeckSelectState();
    }
    renderBattle();
  } catch (err) {
    alert("Erro na partida online: " + err.message);
  }
}

function bindEvents() {
  window.addEventListener("keydown", (event) => {
    if (handleKeybindCapture(event)) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    const action = actionFromKeyCode(event.code);
    if (!action) {
      return;
    }
    event.preventDefault();
    runKeybindAction(action);
  });

  window.addEventListener("beforeunload", () => {
    if (!appState.debug.active || !appState.debug.sessionId) {
      return;
    }
    const payload = {
      sessionId: appState.debug.sessionId,
      reason: "beforeunload",
      entries: appState.debug.buffer.splice(0, appState.debug.buffer.length),
    };
    try {
      const body = new Blob([JSON.stringify(payload)], { type: "application/json" });
      navigator.sendBeacon("/api/debug/session/end", body);
    } catch (_error) {
      // Ignore finalization errors while closing.
    }
  });

  window.addEventListener("error", (event) => {
    debugLog("error", event.message || "window.error", {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    debugLog("promise_rejection", "Unhandled promise rejection", {
      reason: String(event.reason || "unknown"),
    });
  });

  document.addEventListener("click", (event) => {
    if (!el.hoverPreview?.classList.contains("active")) {
      return;
    }
    if (el.hoverPreview.dataset.mode !== "click") {
      return;
    }
    const target = event.target;
    if (target instanceof Element && (target.closest(".deck-row-clickable") || target.closest("#hover-preview"))) {
      return;
    }
    hideHoverPreview();
  });

  if (el.tabBuilder) {
    el.tabBuilder.addEventListener("click", () => switchTab("builder"));
  }
  if (el.tabBattle) {
    el.tabBattle.addEventListener("click", () => switchTab("battle"));
  }
  if (el.tabSettings) {
    el.tabSettings.addEventListener("click", () => switchTab("settings"));
  }
  if (el.adminObservabilityRefresh) {
    el.adminObservabilityRefresh.addEventListener("click", () => {
      void refreshAdminMetrics();
    });
  }
  if (el.battleBackSetup) {
    el.battleBackSetup.addEventListener("click", () => {
      switchTab("builder");
    });
  }
  if (el.battleMenuBtn) {
    el.battleMenuBtn.addEventListener("click", () => {
      void handleBattleMenuExit();
    });
  }
  if (el.mobileScanViewerToggle) {
    el.mobileScanViewerToggle.addEventListener("click", () => {
      setMobileScanViewerActive(!appState.mobileViewer.active);
    });
  }
  if (el.mobileScanViewer) {
    el.mobileScanViewer.addEventListener("touchstart", (event) => {
      const touch = event.changedTouches?.[0];
      if (!touch) {
        return;
      }
      appState.mobileViewer.touchStartX = touch.clientX;
      appState.mobileViewer.touchStartY = touch.clientY;
    }, { passive: true });
    el.mobileScanViewer.addEventListener("touchend", (event) => {
      const touch = event.changedTouches?.[0];
      const startX = appState.mobileViewer.touchStartX;
      const startY = appState.mobileViewer.touchStartY;
      appState.mobileViewer.touchStartX = null;
      appState.mobileViewer.touchStartY = null;
      if (!touch || !Number.isFinite(startX) || !Number.isFinite(startY)) {
        return;
      }
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      if (Math.abs(deltaX) < 45 || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }
      navigateMobileScanViewer(deltaX > 0 ? "prev" : "next");
    }, { passive: true });
    el.mobileScanViewer.addEventListener("click", (event) => {
      if (!appState.mobileViewer.active) {
        return;
      }
      const rect = el.mobileScanViewer.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      if (clickX < rect.width * 0.35) {
        navigateMobileScanViewer("prev");
        return;
      }
      if (clickX > rect.width * 0.65) {
        navigateMobileScanViewer("next");
      }
    });
  }
  if (el.deckName) {
    el.deckName.addEventListener("input", () => {
      // Nome do deck nao altera disponibilidade de scans em tempo real.
      // A disponibilidade so muda ao carregar/salvar/excluir deck.
    });
  }

  el.cardTypeFilter.addEventListener("change", () => {
    appState.filterType = el.cardTypeFilter.value || "all";
    renderLibraryCards();
  });
  if (el.setFilter) {
    el.setFilter.addEventListener("change", () => {
      appState.filterSets = getSelectedMultiValues(el.setFilter).map((value) => value.toLowerCase());
      renderLibraryCards();
    });
  }
  if (el.starsFilter) {
    el.starsFilter.addEventListener("change", () => {
      appState.filterStars = getSelectedMultiValues(el.starsFilter);
      renderLibraryCards();
    });
  }
  if (el.sortFieldFilter) {
    el.sortFieldFilter.addEventListener("change", () => {
      appState.sortField = String(el.sortFieldFilter.value || "name");
      renderLibraryCards();
    });
  }
  if (el.sortDirectionFilter) {
    el.sortDirectionFilter.addEventListener("change", () => {
      appState.sortDirection = String(el.sortDirectionFilter.value || "asc");
      renderLibraryCards();
    });
  }
  el.elementFilter.addEventListener("change", () => {
    appState.filterElement = el.elementFilter.value || "";
    renderLibraryCards();
  });
  el.tribeFilter.addEventListener("change", () => {
    appState.filterTribe = el.tribeFilter.value || "";
    renderLibraryCards();
  });

  const flagFilters = [
    [el.flagAlpha, "alpha"],
    [el.flagPromo, "promo"],
    [el.flagUnused, "unused"],
    [el.flagOther, "other"],
  ];
  flagFilters.forEach(([input, key]) => {
    if (!input) {
      return;
    }
    input.addEventListener("change", () => {
      appState.filterFlags[key] = Boolean(input.checked);
      renderLibraryCards();
    });
  });

  if (el.clearLibraryFilters) {
    el.clearLibraryFilters.addEventListener("click", () => {
      clearLibraryFilters();
    });
  }

  const keybindMap = keybindButtonMap();
  KEYBIND_ACTIONS.forEach((action) => {
    const button = keybindMap[action];
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      startKeybindCapture(action);
    });
  });

  if (el.keybindResetDefaults) {
    el.keybindResetDefaults.addEventListener("click", () => {
      appState.keybindCaptureAction = null;
      resetKeybindDefaults();
      syncSettingsControlsFromState();
    });
  }

  const settingsInputs = [
    el.settingFullscreenAuto,
    el.settingResolution,
    el.settingAudioEnabled,
    el.settingAudioMaster,
    el.settingAudioSfx,
    el.settingAudioMusic,
    el.settingCardLanguage,
    el.settingUiLanguage,
    el.settingGameplayAnimations,
    el.settingGameplayHints,
    el.settingMenuGlobalChat,
    el.settingMenuTop50,
    el.settingMouseSensitivity,
    el.settingTheme,
    el.settingFpsCounter,
    el.settingDebugMode,
  ].filter(Boolean);

  settingsInputs.forEach((input) => {
    input.addEventListener("change", () => {
      appState.settings = settingsFromControls();
      applySettingsRuntime();
      syncSettingsControlsFromState();
      setSettingsFeedback("Alteracoes pendentes. Clique em Salvar Configuracoes.", "info");
    });
    if (input instanceof HTMLInputElement && input.type === "range") {
      input.addEventListener("input", () => {
        appState.settings = settingsFromControls();
        applySettingsRuntime();
      });
    }
  });

  if (el.saveSettings) {
    el.saveSettings.addEventListener("click", () => {
      void saveSettingsFromUi();
    });
  }
  if (el.resetProgress) {
    el.resetProgress.addEventListener("click", () => {
      alert("Reset de progresso completo sera implementado em breve.");
    });
  }

  if (el.toggleMusicPanel) {
    el.toggleMusicPanel.addEventListener("click", () => {
      if (el.musicPlayer) {
        el.musicPlayer.classList.toggle("show-panel");
      }
    });
  }

  if (el.musicToggle) {
    el.musicToggle.addEventListener("click", async () => {
      if (!el.musicAudio) {
        return;
      }
      if (el.musicAudio.paused) {
        await playMusicCurrentTrack();
      } else {
        pauseMusicPlayback();
        debugLog("music", "pause_manual");
      }
    });
  }
  if (el.musicPrev) {
    el.musicPrev.addEventListener("click", () => {
      void playPreviousTrack(true);
    });
  }
  if (el.musicNext) {
    el.musicNext.addEventListener("click", () => {
      void playNextTrack(true);
    });
  }
  if (el.musicLoop) {
    el.musicLoop.addEventListener("click", () => {
      appState.settings.musicPlayer.loopTrack = !appState.settings.musicPlayer.loopTrack;
      updateMusicPlayerLoopButton();
      debugLog("music", "loop_toggle", { enabled: appState.settings.musicPlayer.loopTrack });
      void persistSettingsState();
    });
  }
  if (el.musicPlayerVolume) {
    el.musicPlayerVolume.addEventListener("input", () => {
      appState.settings.musicPlayer.volume = clampNumber(el.musicPlayerVolume.value, 0, 100, 100);
      applyMusicPlayerVolume();
    });
    el.musicPlayerVolume.addEventListener("change", () => {
      appState.settings.musicPlayer.volume = clampNumber(el.musicPlayerVolume.value, 0, 100, 100);
      debugLog("music", "volume_change", { volume: appState.settings.musicPlayer.volume });
      void persistSettingsState();
    });
  }
  if (el.musicProgress) {
    el.musicProgress.addEventListener("input", () => {
      appState.musicPlayer.seeking = true;
      if (!el.musicAudio) {
        return;
      }
      const duration = Number.isFinite(el.musicAudio.duration) ? el.musicAudio.duration : 0;
      const percent = clampNumber(el.musicProgress.value, 0, 100, 0) / 100;
      const previewTime = duration * percent;
      if (el.musicCurrentTime) {
        el.musicCurrentTime.textContent = formatAudioTime(previewTime);
      }
    });
    el.musicProgress.addEventListener("change", () => {
      if (!el.musicAudio) {
        return;
      }
      const duration = Number.isFinite(el.musicAudio.duration) ? el.musicAudio.duration : 0;
      const percent = clampNumber(el.musicProgress.value, 0, 100, 0) / 100;
      el.musicAudio.currentTime = duration * percent;
      appState.musicPlayer.seeking = false;
      updateMusicPlayerProgress();
    });
  }
  if (el.musicAudio) {
    el.musicAudio.addEventListener("timeupdate", () => {
      updateMusicPlayerProgress();
    });
    el.musicAudio.addEventListener("loadedmetadata", () => {
      updateMusicPlayerProgress();
      updateMusicPlayerHeader();
    });
    el.musicAudio.addEventListener("play", () => {
      updateMusicPlayerToggleButton();
    });
    el.musicAudio.addEventListener("pause", () => {
      updateMusicPlayerToggleButton();
    });
    el.musicAudio.addEventListener("ended", () => {
      if (appState.settings.musicPlayer.loopTrack) {
        el.musicAudio.currentTime = 0;
        void playMusicCurrentTrack();
        return;
      }
      void playNextTrack(true);
    });
    el.musicAudio.addEventListener("error", () => {
      debugLog("music_error", "Falha ao tocar faixa atual.", {
        track: appState.musicPlayer.tracks[appState.musicPlayer.currentIndex]?.name || "",
      });
      void playNextTrack(true);
    });
  }

  el.cardSearch.addEventListener("input", () => {
    appState.filterText = el.cardSearch.value || "";
    renderLibraryCards();
  });

  const statInputs = [
    [el.courageMin, "courage"],
    [el.powerMin, "power"],
    [el.wisdomMin, "wisdom"],
    [el.speedMin, "speed"],
  ];
  statInputs.forEach(([input, key]) => {
    input.addEventListener("input", () => {
      appState.filterStats[key] = parseMinValue(input);
      renderLibraryCards();
    });
  });

  if (el.deckMode) {
    el.deckMode.addEventListener("change", () => {
      syncModeSelectors(el.deckMode.value);
      renderDeck();
    });
  }

  if (el.battleMode) {
    el.battleMode.addEventListener("change", () => {
      if (isMultiplayerDeckSelectPhase()) {
        return;
      }
      syncModeSelectors(el.battleMode.value);
      renderDeckValidation();
      void updateBattleSetupDeckInfo();
    });
  }

  if (el.battleDeckA) {
    el.battleDeckA.addEventListener("change", () => {
      if (isMultiplayerDeckSelectPhase()) {
        renderMultiplayerDeckSelectState();
        return;
      }
      void updateBattleSetupDeckInfo();
    });
  }
  if (el.battleDeckB) {
    el.battleDeckB.addEventListener("change", () => {
      if (isMultiplayerDeckSelectPhase()) {
        renderMultiplayerDeckSelectState();
        return;
      }
      void updateBattleSetupDeckInfo();
    });
  }

  const discardTabs = [
    el.tabAtkDiscard,
    el.tabGenDiscard,
    el.tabBoardView,
    el.tabOppGenDiscard,
    el.tabOppAtkDiscard,
  ].filter(Boolean);
  discardTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      appState.battleCenterView = tab.dataset.view || "board";
      renderBattle();
    });
  });

  const logTabs = [el.battleLogTabEvents, el.battleLogTabEffects].filter(Boolean);
  logTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      appState.battleLogView = tab.dataset.view === "effects" ? "effects" : "events";
      renderBattleLog();
    });
  });

  el.saveDeck.addEventListener("click", saveDeck);
  el.loadDeck.addEventListener("click", async () => {
    if (!el.deckList.value) {
      alert("Selecione um deck para carregar.");
      return;
    }
    await loadDeck(el.deckList.value);
  });
  if (el.deleteDeck) {
    el.deleteDeck.addEventListener("click", async () => {
      if (!el.deckList.value) {
        alert("Selecione um deck para excluir.");
        return;
      }
      try {
        await deleteDeck(el.deckList.value);
      } catch (error) {
        alert(error?.message || "Nao foi possivel excluir o deck.");
      }
    });
  }
  el.clearDeck.addEventListener("click", () => {
    appState.deck = createEmptyDeck();
    appState.editingDeckAnchor = "";
    clearScansReservations();
    syncModeSelectors(appState.deck.mode);
    el.deckName.value = "";
    renderDeck();
    refreshScansUi();
  });

  if (el.reloadLibrary) el.reloadLibrary.addEventListener("click", async () => {
    await apiJson("/api/reload", { method: "POST" });
    await loadLibrary();
    alert("Dados locais recarregados.");
  });

  if (el.startBattle) {
    el.startBattle.addEventListener("click", () => {
      if (isMultiplayerDeckSelectPhase()) {
        void submitMultiplayerDeckSelection(false);
        return;
      }
      void startBattleFromUI();
    });
  }
  if (el.runAiMatch) {
    el.runAiMatch.addEventListener("click", () => {
      if (isMultiplayerDeckSelectPhase()) {
        void submitMultiplayerDeckSelection(true);
        return;
      }
      void startBattleFromUI({ forceAiVsAi: true });
    });
  }
  if (el.battleMpReady) {
    el.battleMpReady.addEventListener("click", () => {
      const seat = localSeatName();
      if (seat !== "host" && seat !== "guest") {
        return;
      }
      const localState = appState.multiplayer.deckSelect?.[seat] || {};
      void setMultiplayerReadyState(!Boolean(localState.ready));
    });
  }
  if (el.battleRematch) {
    el.battleRematch.addEventListener("click", async () => {
      await startRematchFromCurrentBattle();
    });
  }
  if (el.rematchAccept) {
    el.rematchAccept.addEventListener("click", () => {
      submitMultiplayerAction({ type: "respond_rematch", accept: true }).catch((error) => alert(error.message));
    });
  }
  if (el.rematchDecline) {
    el.rematchDecline.addEventListener("click", () => {
      submitMultiplayerAction({ type: "respond_rematch", accept: false }).catch((error) => alert(error.message));
    });
  }
  if (el.battleForfeit) {
    el.battleForfeit.addEventListener("click", async () => {
      const battle = appState.battle;
      if (!battle || battle.finished) {
        return;
      }
      if (!window.confirm("Deseja desistir da partida?")) {
        return;
      }
      if (isMultiplayerActive()) {
        await submitMultiplayerAction({ type: "forfeit" }).catch((error) => alert(error.message));
        return;
      }
      const localIndex = localPlayerIndex();
      const winnerIndex = localIndex === 0 ? 1 : 0;
      battle.finished = true;
      battle.pendingAction = null;
      battle.winner = battle.board?.players?.[winnerIndex]?.label || "Oponente";
      if (Array.isArray(battle.log)) {
        battle.log.push(`Desistencia: ${battle.board?.players?.[localIndex]?.label || "Jogador"} concedeu a partida.`);
      }
      renderBattle();
    });
  }
  if (el.confirmEngage) {
    el.confirmEngage.addEventListener("click", () => {
      const battle = appState.battle;
      if (!battle || battle.finished) {
        return;
      }
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "confirm_action_button" }).catch((error) => alert(error.message));
        return;
      }
      // Handle post-combat movement confirmation
      if (battle.phase === "additional_movement") {
        confirmEndPostCombatMove(battle);
        advanceBattle(battle, Boolean(battle.ai?.player0));
        renderBattle();
        return;
      }
      if (battle.phase !== "move_action") {
        return;
      }
      const attacker = battle.board.engagement.attackerSlot;
      const defender = battle.board.engagement.defenderSlot;
      if (attacker !== null && defender !== null) {
        // Combat was declared by movement into an occupied enemy space.
        battle.resolveDeclareNow = true;
      } else {
        // End turn without combat
        endActionWithoutCombat(battle);
      }
      advanceBattle(battle, Boolean(battle.ai?.player0));
      renderBattle();
    });
  }

  if (el.playerAttack) {
    el.playerAttack.addEventListener("click", () => {
      const battle = appState.battle;
      if (!battle || battle.finished || battle.pendingAction?.type !== "strike_attack") {
        return;
      }
      if (
        battle.pendingAction.playerIndex !== localPlayerIndex()
        || battle.pendingAction.choice === null
        || battle.pendingAction.choice === undefined
      ) {
        alert("Selecione um attack na mao.");
        return;
      }
      if (isMultiplayerActive()) {
        submitMultiplayerAction({ type: "confirm_attack" }).catch((error) => alert(error.message));
        return;
      }
      advanceBattle(battle, Boolean(battle.ai?.player0));
      renderBattle();
    });
  }

  if (el.autoStep) {
    el.autoStep.addEventListener("click", () => {
      if (!appState.battle) {
        return;
      }
      if (isMultiplayerActive()) {
        return;
      }
      debugLog("battle_action", "Auto step");
      advanceBattle(appState.battle, true);
      renderBattle();
    });
  }
}

async function init() {
  const localSession = safeJsonParse(localStorage.getItem("chaotic_session"), null);
  if (localSession?.sessionToken) {
    clearSessionToken();
  }
  let sessionPayload = null;
  try {
    sessionPayload = await apiJson("/api/auth/session");
  } catch (_) {
    sessionPayload = null;
  }
  if (!sessionPayload?.ok || !sessionPayload?.username) {
    localStorage.removeItem("chaotic_session");
    clearSessionToken();
    window.location.href = toPage("auth.html");
    return;
  }
  clearSessionToken();
  appState.user.username = normalizeUsername(sessionPayload.username || "local-player");
  appState.user.isAdmin = appState.user.username === "admin";
  localStorage.setItem("chaotic_session", JSON.stringify({
    username: appState.user.username,
    token: Date.now(),
  }));
  const stopPresenceHeartbeat = startAppPresenceHeartbeat();
  window.addEventListener("beforeunload", () => {
    try {
      stopPresenceHeartbeat();
    } catch (_) {}
  });

  window.addEventListener("resize", () => {
    if (!isMobileViewport() && appState.mobileViewer.active) {
      appState.mobileViewer.active = false;
    }
    syncTopbarButtons();
    renderMobileScanViewer();
  });

  bindEvents();
  syncAdminObservabilityVisibility();
  await loadSettingsState();
  syncLibraryFilterControlsFromState();
  syncModeSelectors(appState.deck.mode);
  switchTab(initialViewFromQuery());
  await loadLibrary();
  setLibraryView(appState.libraryView);
  await loadMusicTracks();
  await refreshDeckList();
  renderDeck();
  renderBattle();

  const params = new URLSearchParams(window.location.search || "");
  if (params.get("multiplayer") === "true") {
    const roomId = params.get("roomId");
    const seatToken = params.get("seatToken") || "";
    const role = params.get("role") || "spectator";
    if (roomId) {
      await startMultiplayerBattle(roomId, seatToken, role);
    }
  } else {
    appState.multiplayer.enabled = false;
    appState.multiplayer.roomId = null;
    appState.multiplayer.phase = "lobby";
    appState.multiplayer.matchType = "";
    appState.multiplayer.rulesMode = "competitive";
    appState.multiplayer.dromeId = "";
    appState.multiplayer.challengeMeta = null;
    appState.multiplayer.seatToken = "";
    appState.multiplayer.role = "host";
    appState.multiplayer.localPlayerIndex = 0;
    appState.multiplayer.battleSnapshotHydrated = false;
    appState.multiplayer.rematch = {
      pending: false,
      requestedBy: null,
      requestedAt: null,
    };
    appState.multiplayer.deckSelect = {
      host: { ready: false, deckName: "", valid: false, errors: [] },
      guest: { ready: false, deckName: "", valid: false, errors: [] },
    };
    closeMultiplayerStream();
  }
}

init().catch((error) => {
  el.libraryMeta.textContent = `Falha ao iniciar: ${error.message}`;
});
