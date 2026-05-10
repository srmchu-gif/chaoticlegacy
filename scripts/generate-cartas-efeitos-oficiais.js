#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseAbilityEffects, sanitizeAbilityText } = require("../lib/effect-parser");

const ROOT = path.resolve(__dirname, "..");
const INPUT_FILE = path.join(ROOT, "exports", "todas_cartas_por_set_ordem.txt");
const OUTPUT_FILE = path.join(ROOT, "exports", "cartas_efeitos_oficiais_tecnico.txt");
const REPORT_JSON = path.join(ROOT, "exports", "cartas_efeitos_oficiais_tecnico_relatorio.json");
const REPORT_TXT = path.join(ROOT, "exports", "cartas_efeitos_oficiais_tecnico_relatorio.txt");
const LEGACY_COMPARE_FILE = path.join(ROOT, "exports", "cartas_sets_liberados_dop_zoth_ss_v2.txt");

const CARD_FILES = [
  "chaotic_attacks.json",
  "chaotic_battlegear.json",
  "chaotic_creatures.json",
  "chaotic_locations.json",
  "chaotic_mugic.json",
];

const VARIANT_HINT_REGEX =
  /\(([^)]*(?:alpha|promo|misprint|tin|hobby\s*packs|retail\s*packs|comic\s*con|game\s*stop|best\s*buy|target|walmart|convention|op|melee\s*artists\s*collaborative\s*attack)[^)]*)\)$/i;

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSetCode(value) {
  return String(value || "").trim().toUpperCase();
}

function safeReadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sanitizeOneLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function tryDemojibake(text) {
  const input = String(text || "");
  if (!/[ÃÂ][\w\W]?/.test(input)) return input;
  try {
    const decoded = Buffer.from(input, "latin1").toString("utf8");
    return decoded || input;
  } catch {
    return input;
  }
}

function mapType(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("creature")) return "Creature";
  if (raw.includes("attack")) return "Attack";
  if (raw.includes("battle")) return "Battlegear";
  if (raw.includes("location")) return "Location";
  if (raw.includes("mugic")) return "Mugic";
  return "Unknown";
}

function toNumber(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function loadCanonicalCards() {
  const cards = [];
  for (const fileName of CARD_FILES) {
    const primary = path.join(ROOT, fileName);
    const fallback = path.join(ROOT, "LIXO", fileName);
    const resolved = fs.existsSync(primary) ? primary : fallback;
    if (!fs.existsSync(resolved)) {
      throw new Error(`Arquivo canônico ausente: ${fileName}`);
    }
    const rows = safeReadJson(resolved);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const name = String(row.name || "").trim();
      const set = normalizeSetCode(row.set || "");
      const ability = sanitizeAbilityText(row.ability || "");
      const type = mapType(row.type || "");
      cards.push({ name, nameNorm: normalizeName(name), set, type, ability, raw: row });
    }
  }
  return cards;
}

function parseInputList(inputText) {
  const lines = String(inputText || "").split(/\r?\n/);
  const entries = [];
  let currentSetCode = "";
  let currentSetLabel = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Cartas por Set/i.test(trimmed)) continue;
    const headerMatch = trimmed.match(/^===\s*(.+?)\s*\((\d+)\)\s*===$/);
    if (headerMatch) {
      const label = headerMatch[1];
      currentSetLabel = label;
      const codeMatch = label.match(/^([^\s-]+)/);
      currentSetCode = normalizeSetCode(codeMatch ? codeMatch[1] : label);
      continue;
    }
    entries.push({ originalName: trimmed, setCode: currentSetCode, setLabel: currentSetLabel });
  }
  return entries;
}

function buildIndexes(cards) {
  const byExactSetName = new Map();
  const byNormSetName = new Map();
  const byNormName = new Map();

  const push = (map, key, card) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(card);
  };

  for (const card of cards) {
    push(byExactSetName, `${card.set}|${card.name}`, card);
    push(byNormSetName, `${card.set}|${card.nameNorm}`, card);
    push(byNormName, card.nameNorm, card);
  }
  return { byExactSetName, byNormSetName, byNormName };
}

function buildNameCandidates(originalName) {
  const raw = String(originalName || "").trim();
  const list = [];
  const seen = new Set();
  const add = (name, mode) => {
    const clean = String(name || "").trim();
    if (!clean) return;
    const key = `${mode}|${clean}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ name: clean, mode });
  };

  add(raw, "raw");
  add(tryDemojibake(raw), "raw_demojibake");

  if (/^\(Unused\)\s*/i.test(raw)) {
    const stripped = raw.replace(/^\(Unused\)\s*/i, "").trim();
    add(stripped, "unused_stripped");
    add(tryDemojibake(stripped), "unused_stripped_demojibake");
    add(stripped.replace(/,\s*$/, ""), "unused_strip_trailing_comma");
  }

  if (/,\s*$/.test(raw)) add(raw.replace(/,\s*$/, ""), "strip_trailing_comma");

  if (VARIANT_HINT_REGEX.test(raw)) {
    const noSuffix = raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
    add(noSuffix, "variant_alias");
    add(noSuffix.replace(/,\s*$/, ""), "variant_alias_strip_comma");
    add(tryDemojibake(noSuffix), "variant_alias_demojibake");
  }

  return list;
}

function dedupeCards(cards) {
  const out = [];
  const seen = new Set();
  for (const card of cards) {
    const key = `${card.set}|${card.name}|${card.type}|${card.ability}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
}

function resolveCard(entry, indexes) {
  const setCode = normalizeSetCode(entry.setCode);
  const candidates = buildNameCandidates(entry.originalName);

  for (const c of candidates) {
    if (c.mode !== "raw" && c.mode !== "raw_demojibake") continue;
    const hits = dedupeCards(indexes.byExactSetName.get(`${setCode}|${c.name}`) || []);
    if (hits.length === 1) return { card: hits[0], matchKind: "exact_set_raw", trace: [c.mode] };
    if (hits.length > 1) {
      const exactNamed = hits.find((x) => x.name === c.name);
      if (exactNamed) return { card: exactNamed, matchKind: "exact_set_raw_disambiguated", trace: [c.mode] };
      return { card: hits[0], matchKind: "exact_set_raw_ambiguous", trace: [c.mode], ambiguous: hits };
    }
  }

  for (const c of candidates) {
    const hits = dedupeCards(indexes.byNormSetName.get(`${setCode}|${normalizeName(c.name)}`) || []);
    if (hits.length === 1) return { card: hits[0], matchKind: "normalized_set", trace: [c.mode] };
    if (hits.length > 1) {
      const exactNamed = hits.find((x) => normalizeName(x.name) === normalizeName(entry.originalName));
      if (exactNamed) return { card: exactNamed, matchKind: "normalized_set_disambiguated", trace: [c.mode] };
      const sameAbility = new Set(hits.map((x) => x.ability || ""));
      if (sameAbility.size === 1) return { card: hits[0], matchKind: "normalized_set_same_ability", trace: [c.mode], ambiguous: hits };
      return { card: hits[0], matchKind: "normalized_set_ambiguous", trace: [c.mode], ambiguous: hits };
    }
  }

  for (const c of candidates) {
    if (!["variant_alias", "variant_alias_strip_comma", "variant_alias_demojibake", "unused_stripped", "unused_strip_trailing_comma", "strip_trailing_comma"].includes(c.mode)) continue;
    const setHits = dedupeCards(indexes.byNormSetName.get(`${setCode}|${normalizeName(c.name)}`) || []);
    const hits = setHits.length ? setHits : dedupeCards(indexes.byNormName.get(normalizeName(c.name)) || []);
    if (hits.length === 1) return { card: hits[0], matchKind: "alias", trace: [c.mode] };
    if (hits.length > 1) {
      const exactNamed = hits.find((x) => x.name === c.name);
      if (exactNamed) return { card: exactNamed, matchKind: "alias_disambiguated", trace: [c.mode], ambiguous: hits };
      const sameAbility = new Set(hits.map((x) => x.ability || ""));
      if (sameAbility.size === 1) {
        const preferred = hits.find((x) => x.set === setCode) || hits[0];
        return { card: preferred, matchKind: "alias_same_ability", trace: [c.mode], ambiguous: hits };
      }
      const preferred = hits.find((x) => x.set === setCode) || hits[0];
      return { card: preferred, matchKind: "alias_ambiguous", trace: [c.mode], ambiguous: hits };
    }
  }

  for (const c of candidates) {
    const hits = dedupeCards(indexes.byNormName.get(normalizeName(c.name)) || []);
    if (hits.length === 1) return { card: hits[0], matchKind: "global_name", trace: [c.mode] };
    if (hits.length > 1) {
      const exactNamed = hits.find((x) => x.name === c.name);
      if (exactNamed) return { card: exactNamed, matchKind: "global_name_disambiguated", trace: [c.mode], ambiguous: hits };
      const sameAbility = new Set(hits.map((x) => x.ability || ""));
      if (sameAbility.size === 1) return { card: hits[0], matchKind: "global_same_ability", trace: [c.mode], ambiguous: hits };
      return { card: hits[0], matchKind: "global_ambiguous", trace: [c.mode], ambiguous: hits };
    }
  }

  return { card: null, matchKind: "unmatched", trace: [] };
}

function summarizeCosts(abilityText) {
  const text = String(abilityText || "");
  const costBlocks = [...text.matchAll(/([^\n.:]{0,120}(?:\{\{MC\}\}|\bMC\b|\bSacrifice\b|\bDiscard\b|\bExpend\b)[^\n.:]{0,120}):/gi)].map((m) => sanitizeOneLine(m[1]));
  const mcSymbols = (text.match(/\{\{MC\}\}/g) || []).length;
  const mcNumeric = [...text.matchAll(/\b(\d+)\s*MC\b/gi)].reduce((acc, m) => acc + Number(m[1] || 0), 0);
  const hasSac = /\bSacrifice\b/i.test(text);
  const hasDiscard = /\bdiscard\b/i.test(text);
  const hasExpend = /\bexpend\b/i.test(text);
  const hasAnyActivation = costBlocks.length > 0;
  const mcCost = mcSymbols > 0 ? `${mcSymbols} simbolo(s)` : mcNumeric > 0 ? `${mcNumeric}` : "0";
  return {
    mc: mcCost,
    ativacao: hasAnyActivation ? costBlocks.join("; ") : "N/A",
    sacrificio: hasSac ? "sim" : "nao",
    descarte: hasDiscard ? "sim" : "nao",
    passivo: !hasAnyActivation ? "sim" : "nao",
    sem_custo: !hasAnyActivation && !hasSac && !hasDiscard && !hasExpend ? "sim" : "nao",
  };
}

function inferTrigger(abilityText, type) {
  const text = String(abilityText || "").toLowerCase();
  if (!text) return type === "Attack" ? "durante_resolucao_do_ataque" : "sem_trigger_textual";
  if (/at the beginning of combat/.test(text)) return "beginning_of_combat";
  if (/at the beginning of your turn/.test(text)) return "beginning_of_your_turn";
  if (/at the beginning of turn/.test(text)) return "beginning_of_turn";
  if (/when this becomes the active location|when this becomes active|when .* becomes the active location/.test(text)) return "when_location_becomes_active";
  if (/when engaged|becomes engaged/.test(text)) return "when_engaged";
  if (/when .* attacked|when .* is attacked/.test(text)) return "when_attacked";
  if (/when .* takes damage|when .* is dealt damage|when damaged/.test(text)) return "when_damaged";
  if (/when hive is activated|hive is activated/.test(text)) return "when_hive_activated";
  if (/\bwhen\b/.test(text)) return "triggered_when_condition_occurs";
  if (/\bif\b/.test(text) && type === "Attack") return "durante_resolucao_do_ataque_condicional";
  if (/\{\{mc\}\}|\bmc\b|\bsacrifice\b|\bdiscard\b|\bexpend\b/.test(text)) return "activated_ability";
  if (type === "Attack") return "durante_resolucao_do_ataque";
  return "passivo_continuo_ou_condicional";
}

function inferClassification(abilityText, type, trigger) {
  const text = String(abilityText || "").toLowerCase();
  const tags = new Set();
  if (!text) tags.add(type === "Attack" ? "instantaneo" : "passivo");
  if (type === "Attack") {
    tags.add("instantaneo");
    tags.add("durante_combate");
  }
  if (/\{\{mc\}\}|\bmc\b|\bsacrifice\b|\bdiscard\b|\bexpend\b[^.\n:]{0,80}:/i.test(text)) tags.add("ativo");
  if (trigger.includes("beginning_of_combat") || trigger.includes("when_location_becomes_active")) tags.add("triggered");
  if (trigger.includes("when_engaged") || trigger.includes("when_attacked") || trigger.includes("when_damaged") || trigger.includes("when_hive_activated")) tags.add("triggered");
  if (/\bwhile\b|has an additional|have an additional|cannot|is reduced|lose all abilities|gains?/i.test(text)) tags.add("continuo");
  if (!tags.size) tags.add("passivo");
  return [...tags].join(",");
}

function gatherTargets(effects, abilityText, type) {
  const targetSet = new Set();
  for (const effect of effects) {
    const t = effect && effect.targetSpec ? effect.targetSpec : null;
    if (!t) continue;
    targetSet.add(`${String(t.type || "")}:${t.scope ? String(t.scope) : "default"}`);
  }
  const text = String(abilityText || "").toLowerCase();
  if (/target creature/.test(text)) targetSet.add("creature:all");
  if (/opposing engaged creature/.test(text)) targetSet.add("creature:opposing_engaged");
  if (/engaged creature/.test(text)) targetSet.add("creature:engaged");
  if (/target player/.test(text) || /target player's/.test(text)) targetSet.add("player:target");
  if (/target mugic/.test(text)) targetSet.add("mugic:target");
  if (/target attack/.test(text)) targetSet.add("attack:target");
  if (/target battlegear/.test(text) || /battlegear equipped/.test(text)) targetSet.add("battlegear:target");
  if (/active location/.test(text) || /target location/.test(text)) targetSet.add("location:active_or_target");
  if (/each player|both players/.test(text)) targetSet.add("jogadores:ambos");
  if (!targetSet.size) targetSet.add(type === "Attack" ? "criaturas_engajadas" : "N/A");
  return [...targetSet].join(", ");
}

function detectManipulation(abilityText, effects) {
  const text = String(abilityText || "").toLowerCase();
  const items = [];
  if (/look at the top|look at target player's|look at your/.test(text) || effects.some((e) => e.kind === "scryDeck")) items.push("olhar_topo");
  if (/reveal/.test(text) || effects.some((e) => e.kind === "revealNewLocation")) items.push("revelar");
  if (/shuffle/.test(text) || effects.some((e) => e.kind === "shuffleAttackDeckWithDiscard")) items.push("embaralhar");
  if (/draw/.test(text) || effects.some((e) => e.kind === "drawDiscardAttack")) items.push("comprar");
  if (/discard/.test(text) || effects.some((e) => /discard/i.test(e.kind || ""))) items.push("descartar");
  if (/choose/.test(text) || /target/.test(text)) items.push("escolha_de_alvo");
  if (/each player/.test(text) || /both players/.test(text)) items.push("aplicacao_automatica_simetrica");
  return items.length ? items.join(",") : "N/A";
}

function detectDuration(abilityText, type, classification) {
  const text = String(abilityText || "").toLowerCase();
  if (!text) return type === "Attack" ? "instantaneo" : "N/A";
  if (/until end of combat|this combat|each combat/.test(text)) return "ate_fim_do_combate_ou_por_combate";
  if (/this turn|until end of turn|end of turn/.test(text)) return "ate_fim_do_turno";
  if (/while equipped/.test(text)) return "enquanto_equipado";
  if (/while .*active location|while .*location is active|active location/.test(text) && /while/.test(text)) return "enquanto_location_ativa";
  if (/as long as|while/.test(text)) return "enquanto_condicao_for_verdadeira";
  if (/when this becomes the active location/.test(text)) return "efeito_pontual_ao_entrar_location";
  if (classification.includes("instantaneo")) return "instantaneo";
  if (classification.includes("continuo")) return "continuo_enquanto_fonte_valida";
  return "conforme_texto_da_carta";
}

function summarizeConditions(abilityText, effects) {
  const text = String(abilityText || "");
  const statChecks = [...text.matchAll(/Stat Check\s+([A-Za-z ]+?)\s+(\d+)/gi)].map((m) => `${sanitizeOneLine(m[1])} ${m[2]}`);
  const challenges = [...text.matchAll(/Challenge\s+([A-Za-z ]+?)\s+(\d+)/gi)].map((m) => `${sanitizeOneLine(m[1])} ${m[2]}`);
  const elements = [...new Set((text.match(/\b(Fire|Air|Earth|Water)\b/gi) || []).map((x) => x.toLowerCase()))];
  const disciplines = [...new Set((text.match(/\b(Courage|Power|Wisdom|Speed|Energy|Mugic(?:ability| Ability)?)\b/gi) || []).map((x) => x.toLowerCase()))];
  const combatWindows = [];
  if (/at the beginning of combat/i.test(text)) combatWindows.push("inicio_do_combate");
  if (/when engaged|becomes engaged/i.test(text)) combatWindows.push("quando_engajada");
  if (/first attack|next attack|attack/i.test(text)) combatWindows.push("interacao_com_ataque");
  if (/when this becomes the active location/i.test(text)) combatWindows.push("ao_ativar_location");
  return {
    stat_check: statChecks.length ? statChecks.join("; ") : "N/A",
    challenge: challenges.length ? challenges.join("; ") : "N/A",
    elemento: elements.length ? elements.join(",") : "N/A",
    disciplina: disciplines.length ? disciplines.join(",") : "N/A",
    combate: combatWindows.length ? combatWindows.join(",") : "N/A",
    alvo: gatherTargets(effects, text, "Unknown"),
  };
}

function summarizeDamage(card, effects, trigger) {
  const raw = card.raw || {};
  const base = card.type === "Attack" ? toNumber(raw.base, 0) : 0;
  const fire = card.type === "Attack" ? toNumber(raw.fire, 0) : 0;
  const water = card.type === "Attack" ? toNumber(raw.water, 0) : 0;
  const air = card.type === "Attack" ? toNumber(raw.air, 0) : 0;
  const earth = card.type === "Attack" ? toNumber(raw.earth, 0) : 0;
  let mugic = 0;
  const additionalNotes = [];
  for (const effect of effects) {
    const kind = String(effect.kind || "");
    const amount = Number(effect.amount || 0);
    if (kind === "dealDamage" && card.type === "Mugic") {
      mugic += amount;
      additionalNotes.push(`mugic_deal:${amount}`);
    } else if (kind === "dealDamage") {
      additionalNotes.push(`deal:${amount}`);
    } else if (/attackDamage|conditionalDamage|strike|intimidate|mugicDamageModifier|incomingDamageReduction|incomingFirstAttackDamageReduction|nextAttackThisCombatSetDamage|attackDamageSet/i.test(kind)) {
      additionalNotes.push(Number.isFinite(amount) && amount !== 0 ? `${kind}:${amount}` : kind);
    }
  }
  if (card.type === "Attack" && effects.some((e) => /conditionalDamage/.test(String(e.kind || "")))) {
    additionalNotes.push("dano_condicional_por_texto_do_ataque");
  }
  const janela = trigger.includes("beginning_of_combat")
    ? "inicio_do_combate"
    : card.type === "Attack"
      ? "resolucao_do_ataque"
      : trigger === "activated_ability"
        ? "quando_habilidade_e_ativada"
        : "conforme_trigger";
  return { base, fire, water, air, earth, mugic, adicional: additionalNotes.length ? additionalNotes.join(",") : "N/A", janela };
}

function summarizeModifications(abilityText, effects) {
  const text = String(abilityText || "").toLowerCase();
  const mods = {
    elementos: "N/A",
    disciplinas: "N/A",
    energy: "N/A",
    keywords: "N/A",
    battlegear: "N/A",
    mugic: "N/A",
    habilidades: "N/A",
    targeting: "N/A",
    iniciativa: "N/A",
    ataques: "N/A",
    dano: "N/A",
    imunidades: "N/A",
    restricoes: "N/A",
  };
  const kinds = effects.map((e) => String(e.kind || ""));
  if (kinds.some((k) => /gainElement|removeElement|elementModifier|targetCreatureGainChosenElement/i.test(k))) mods.elementos = "concede/remove/modifica_elementos";
  if (kinds.some((k) => /statModifier|conditionalStatModifier|intimidate|support/i.test(k)) || /courage|power|wisdom|speed/.test(text)) mods.disciplinas = "altera_disciplinas";
  if (kinds.some((k) => /healDamage|gainEnergy|loseEnergy|onTakeDamageSourceLosesEnergy|energy/i.test(k)) || /energy/.test(text)) mods.energy = "altera_energy";
  if (/strike|swift|invisibility|intimidate|hive|support|defender|range|surprise|recklessness/i.test(text) || kinds.some((k) => /keyword|invisibilityStrike|hiveGranted|activateHive/i.test(k))) mods.keywords = "concede/remove_keywords";
  if (kinds.some((k) => /battlegear|destroyBattlegear|flipBattlegear|suppressOpposingBattlegear/i.test(k)) || /battlegear/.test(text)) mods.battlegear = "afeta_battlegear";
  if (kinds.some((k) => /mugic|negateMugic|mugicCounter|disableMugic|canPlayAnyTribeMugic|canPlaySpecificTribeMugic/i.test(k)) || /mugic/.test(text)) mods.mugic = "afeta_mugic";
  if (kinds.some((k) => /disable.*Activated|battlegearNoAbilities|lose all abilities|activateHive/i.test(k)) || /lose all abilities|activated ability/.test(text)) mods.habilidades = "altera_habilidades";
  if (/cannot be targeted|target/.test(text) || kinds.some((k) => /untarget|target/i.test(k))) mods.targeting = "altera_regras_de_alvo";
  if (/initiative/.test(text)) mods.iniciativa = "altera_iniciativa";
  if (kinds.some((k) => /attack|drawDiscardAttack|shuffleAttackDeckWithDiscard|targetAttackDamageSet/i.test(k)) || /attack/.test(text)) mods.ataques = "altera_ataques";
  if (kinds.some((k) => /damage|heal|reduce/i.test(k)) || /damage/.test(text)) mods.dano = "altera_dano";
  if (/immune|cannot gain|cannot be targeted/.test(text)) mods.imunidades = "gera_imunidade_ou_protecao";
  if (/cannot|may not|must pay an additional/.test(text) || kinds.some((k) => /disable|costIncrease|cannot/i.test(k))) mods.restricoes = "impõe_restricoes";
  return mods;
}

function buildFuncionamento(card, effects, trigger) {
  const ability = sanitizeOneLine(card.ability || "");
  if (!ability) {
    if (card.type === "Attack") return "Ataque sem texto adicional: aplica apenas os danos impressos (base/elementais) na resolução do ataque.";
    return "Carta sem texto de habilidade: sem efeito adicional além das características impressas.";
  }
  if (!effects.length) {
    return `Efeito textual oficial sem parsing completo: \"${ability}\". Aplicar exatamente conforme o texto oficial e a janela indicada.`;
  }
  const kinds = [...new Set(effects.map((e) => String(e.kind || "")).filter(Boolean))];
  const triggerPt = {
    beginning_of_combat: "no início do combate",
    when_location_becomes_active: "quando a Location se torna ativa",
    when_engaged: "quando a criatura fica engajada",
    when_attacked: "quando é atacada",
    when_damaged: "quando sofre dano",
    activated_ability: "quando o custo é pago e a habilidade resolve",
    durante_resolucao_do_ataque: "na resolução do ataque",
    durante_resolucao_do_ataque_condicional: "na resolução do ataque, sob condição",
  }[trigger] || "na janela definida pelo texto";
  return `Efeito oficial: \"${ability}\". Em regras, resolve ${triggerPt}, gerando: ${kinds.join(", ")}.`;
}

function formatObjectInline(obj, orderedKeys) {
  return orderedKeys.map((k) => `${k}:${obj[k] !== undefined ? obj[k] : "N/A"}`).join(",");
}

function buildLine(entry, resolved) {
  const card = resolved.card;
  if (!card) {
    const damageFallback = { base: 0, fire: 0, water: 0, air: 0, earth: 0, mugic: 0, adicional: "N/A", janela: "N/A" };
    const condFallback = { stat_check: "N/A", challenge: "N/A", elemento: "N/A", disciplina: "N/A", combate: "N/A", alvo: "N/A" };
    const costFallback = { mc: "0", ativacao: "N/A", sacrificio: "nao", descarte: "nao", passivo: "N/A", sem_custo: "N/A" };
    const modsFallback = { elementos: "N/A", disciplinas: "N/A", energy: "N/A", keywords: "N/A", battlegear: "N/A", mugic: "N/A", habilidades: "N/A", targeting: "N/A", iniciativa: "N/A", ataques: "N/A", dano: "N/A", imunidades: "N/A", restricoes: "N/A" };
    return {
      line: `Carta=${entry.originalName} | Tipo=Unknown | Set=${entry.setCode || "Unknown"} | EfeitoOficial=N/A (carta nao encontrada no catalogo canônico local) | Funcionamento=N/A | Dano={${formatObjectInline(damageFallback, ["base", "fire", "water", "air", "earth", "mugic", "adicional", "janela"])}} | Condicoes={${formatObjectInline(condFallback, ["stat_check", "challenge", "elemento", "disciplina", "combate", "alvo"])}} | Custos={${formatObjectInline(costFallback, ["mc", "ativacao", "sacrificio", "descarte", "passivo", "sem_custo"])}} | Classificacao=indeterminado | TriggerExato=N/A | Alvos=N/A | Modificacoes={${formatObjectInline(modsFallback, ["elementos", "disciplinas", "energy", "keywords", "battlegear", "mugic", "habilidades", "targeting", "iniciativa", "ataques", "dano", "imunidades", "restricoes"])}} | ManipulacaoDeckMao=N/A | Duracao=N/A`,
      debug: { cardFound: false },
    };
  }

  const effects = parseAbilityEffects(card.ability || "");
  const trigger = inferTrigger(card.ability || "", card.type);
  const classification = inferClassification(card.ability || "", card.type, trigger);
  const damage = summarizeDamage(card, effects, trigger);
  const conditions = summarizeConditions(card.ability || "", effects);
  const costs = summarizeCosts(card.ability || "");
  const targets = gatherTargets(effects, card.ability || "", card.type);
  const mods = summarizeModifications(card.ability || "", effects);
  const duration = detectDuration(card.ability || "", card.type, classification);
  const manipulation = detectManipulation(card.ability || "", effects);
  const efeitoOficial = sanitizeOneLine(card.ability || "") || "Sem texto de habilidade impresso.";
  const funcionamento = buildFuncionamento(card, effects, trigger);

  const line = `Carta=${entry.originalName} | Tipo=${card.type} | Set=${card.set || entry.setCode || "Unknown"} | EfeitoOficial=${efeitoOficial} | Funcionamento=${funcionamento} | Dano={${formatObjectInline(damage, ["base", "fire", "water", "air", "earth", "mugic", "adicional", "janela"])}} | Condicoes={${formatObjectInline(conditions, ["stat_check", "challenge", "elemento", "disciplina", "combate", "alvo"])}} | Custos={${formatObjectInline(costs, ["mc", "ativacao", "sacrificio", "descarte", "passivo", "sem_custo"])}} | Classificacao=${classification} | TriggerExato=${trigger} | Alvos=${targets} | Modificacoes={${formatObjectInline(mods, ["elementos", "disciplinas", "energy", "keywords", "battlegear", "mugic", "habilidades", "targeting", "iniciativa", "ataques", "dano", "imunidades", "restricoes"])}} | ManipulacaoDeckMao=${manipulation} | Duracao=${duration}`;

  return {
    line,
    debug: {
      cardFound: true,
      type: card.type,
      set: card.set,
      ability: card.ability,
      effectsCount: effects.length,
      trigger,
      classification,
      resolvedName: card.name,
    },
  };
}

function parseLegacyMap() {
  if (!fs.existsSync(LEGACY_COMPARE_FILE)) return new Map();
  const map = new Map();
  const lines = fs.readFileSync(LEGACY_COMPARE_FILE, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^\[/.test(trimmed)) continue;
    const sep = trimmed.indexOf("|");
    if (sep === -1) continue;
    const name = trimmed.slice(0, sep).trim();
    const body = trimmed.slice(sep + 1).trim();
    if (!name) continue;
    map.set(name, body);
  }
  return map;
}

function buildRegressionReport(linesOutput, legacyMap) {
  const changed = [];
  for (const row of linesOutput) {
    const name = row.entry.originalName;
    if (!legacyMap.has(name)) continue;
    const previous = legacyMap.get(name);
    const current = row.line;
    if (!current.includes(previous)) {
      changed.push({ name, previous: previous.slice(0, 320), current: current.slice(0, 420) });
    }
  }
  return changed;
}

function runSemanticSample(linesOutput) {
  const byType = new Map();
  for (const row of linesOutput) {
    const type = row.debug.type || "Unknown";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(row);
  }

  const sampleSummary = {};
  for (const type of ["Creature", "Attack", "Battlegear", "Location", "Mugic"]) {
    const sample = (byType.get(type) || []).slice(0, 5);
    sampleSummary[type] = sample.map((s) => ({
      carta: s.entry.originalName,
      okTrigger: /TriggerExato=([^|]+)/.test(s.line),
      okTargets: /Alvos=([^|]+)/.test(s.line),
      okCosts: /Custos=\{/.test(s.line),
      okDamage: /Dano=\{/.test(s.line),
      okDuration: /Duracao=/.test(s.line),
    }));
  }
  return sampleSummary;
}

function main() {
  const entries = parseInputList(fs.readFileSync(INPUT_FILE, "utf8"));
  const cards = loadCanonicalCards();
  const indexes = buildIndexes(cards);
  const legacyMap = parseLegacyMap();

  const outputs = [];
  const matchStats = {};
  const unresolved = [];
  const ambiguous = [];

  for (const entry of entries) {
    const resolved = resolveCard(entry, indexes);
    matchStats[resolved.matchKind] = (matchStats[resolved.matchKind] || 0) + 1;
    if (!resolved.card) unresolved.push(entry);
    if (resolved.ambiguous && resolved.ambiguous.length > 1) {
      ambiguous.push({
        input: entry.originalName,
        set: entry.setCode,
        selected: resolved.card ? `${resolved.card.set} ${resolved.card.name}` : "N/A",
        candidates: resolved.ambiguous.map((c) => `${c.set} ${c.name}`),
        matchKind: resolved.matchKind,
      });
    }

    const built = buildLine(entry, resolved);
    outputs.push({ entry, line: built.line, debug: built.debug, matchKind: resolved.matchKind, trace: resolved.trace });
  }

  fs.writeFileSync(OUTPUT_FILE, outputs.map((o) => o.line).join("\n") + "\n", "utf8");

  const regressionChanged = buildRegressionReport(outputs, legacyMap);
  const semanticSample = runSemanticSample(outputs);
  const report = {
    generatedAt: new Date().toISOString(),
    inputFile: INPUT_FILE,
    outputFile: OUTPUT_FILE,
    totals: {
      inputCards: entries.length,
      outputLines: outputs.length,
      unresolved: unresolved.length,
      ambiguousCases: ambiguous.length,
    },
    matchStats,
    unresolved,
    ambiguous,
    semanticSample,
    regression: {
      comparedAgainst: fs.existsSync(LEGACY_COMPARE_FILE) ? LEGACY_COMPARE_FILE : null,
      changedCount: regressionChanged.length,
      sample: regressionChanged.slice(0, 80),
    },
  };

  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  const reportTxt = [];
  reportTxt.push("Relatorio - Cartas Efeitos Oficiais Tecnico");
  reportTxt.push(`Gerado em: ${report.generatedAt}`);
  reportTxt.push(`Entrada: ${INPUT_FILE}`);
  reportTxt.push(`Saida: ${OUTPUT_FILE}`);
  reportTxt.push("");
  reportTxt.push(`Total entrada: ${report.totals.inputCards}`);
  reportTxt.push(`Total linhas saida: ${report.totals.outputLines}`);
  reportTxt.push(`Nao resolvidas: ${report.totals.unresolved}`);
  reportTxt.push(`Casos ambiguos: ${report.totals.ambiguousCases}`);
  reportTxt.push("");
  reportTxt.push("Match stats:");
  for (const [k, v] of Object.entries(matchStats).sort((a, b) => b[1] - a[1])) {
    reportTxt.push(`- ${k}: ${v}`);
  }
  reportTxt.push("");
  if (ambiguous.length) {
    reportTxt.push("Ambiguidades (resolvidas por prioridade):");
    for (const a of ambiguous.slice(0, 40)) {
      reportTxt.push(`- ${a.input} [${a.set}] -> ${a.selected} | candidatos: ${a.candidates.join(" ; ")}`);
    }
    reportTxt.push("");
  }
  if (unresolved.length) {
    reportTxt.push("Nao resolvidas:");
    for (const u of unresolved.slice(0, 60)) reportTxt.push(`- ${u.originalName} [${u.setCode}]`);
    reportTxt.push("");
  }
  reportTxt.push(`Regressao vs legado (DOP/ZOTH/SS): ${report.regression.changedCount} linhas divergentes (amostra no JSON).`);

  fs.writeFileSync(REPORT_TXT, reportTxt.join("\n") + "\n", "utf8");
  console.log(`OK: ${OUTPUT_FILE}`);
  console.log(`OK: ${REPORT_JSON}`);
  console.log(`OK: ${REPORT_TXT}`);
  console.log(`cards=${entries.length} unresolved=${unresolved.length} ambiguous=${ambiguous.length}`);
}

main();
