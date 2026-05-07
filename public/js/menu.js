import { initMatrixEffect } from "./matrix.js";
import { apiUrl, clearSessionToken, getSessionToken, setSessionToken, toPage } from "./runtime-config.js";

const DB_SESSION = "chaotic_session";
const SETTINGS_KEY = "chaotic.settings.v1";
const LEGACY_SETTINGS_KEY = "chaotic_settings";
let libraryCachePromise = null;
const NETWORK_TIMEOUT_MS = {
  session: 10000,
  profile: 12000,
  scans: 12000,
  perimState: 25000,
  default: 12000,
};

initMatrixEffect();

function qs(id) {
  return document.getElementById(id);
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "local-player";
}

function normalizeTradeCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = NETWORK_TIMEOUT_MS.default) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `HTTP ${response.status}`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Tempo limite de conexao excedido.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeFilterToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatDurationLabel(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function loadLibraryCardsMap() {
  if (!libraryCachePromise) {
    libraryCachePromise = fetch("/api/library")
      .then((res) => res.json())
      .then((payload) => {
        const map = new Map();
        const cards = Array.isArray(payload?.cards) ? payload.cards : [];
        cards.forEach((card) => {
          if (card?.id) {
            map.set(card.id, card);
          }
        });
        return map;
      })
      .catch(() => new Map());
  }
  return libraryCachePromise;
}

function buildMultiplayerBattleUrl({ roomId, seat, seatToken }) {
  const params = new URLSearchParams({
    view: "battle",
    multiplayer: "true",
    roomId: String(roomId || ""),
    role: String(seat || "spectator"),
  });
  if (seatToken) {
    params.set("seatToken", String(seatToken));
  }
  return toPage(`index.html?${params.toString()}`);
}

async function fetchDeckByName(deckName, username) {
  const query = `?username=${encodeURIComponent(normalizeUsername(username))}`;
  const res = await fetch(`/api/decks/${encodeURIComponent(deckName)}${query}`);
  if (!res.ok) {
    throw new Error("Falha ao carregar deck selecionado.");
  }
  return res.json();
}

async function populateDecks(selectEl, username) {
  if (!selectEl) {
    return;
  }
  try {
    const query = `?username=${encodeURIComponent(normalizeUsername(username))}`;
    const res = await fetch(`/api/decks${query}`);
    const data = await res.json();
    selectEl.innerHTML = "";
    if (Array.isArray(data.decks) && data.decks.length) {
      data.decks.forEach((deck) => {
        const opt = document.createElement("option");
        opt.value = deck.name;
        opt.textContent = deck.name;
        selectEl.appendChild(opt);
      });
      return;
    }
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Nenhum deck encontrado";
    selectEl.appendChild(opt);
  } catch (err) {
    selectEl.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Erro ao carregar decks";
    selectEl.appendChild(opt);
  }
}

async function bindProfile(username, sessionData) {
  const currentUser = sessionData || null;
  const usernameKey = normalizeUsername(username);

  const nameEl = qs("player-name");
  const scoreEl = qs("player-score");
  const winrateEl = qs("player-winrate");
  const avatarImg = qs("player-avatar-img");
  const avatarContainer = qs("avatar-container");
  const avatarUpload = qs("avatar-upload");

  const profileModal = qs("profile-modal");
  const profileModalBackdrop = qs("profile-modal-backdrop");
  const profileModalClose = qs("profile-modal-close");
  const profileModalName = qs("profile-modal-name");
  const profileModalUpdated = qs("profile-modal-updated");
  const profileModalAvatar = qs("profile-modal-avatar");
  const profileModalScore = qs("profile-modal-score");
  const profileModalWL = qs("profile-modal-wl");
  const profileModalWinrate = qs("profile-modal-winrate");
  const profileModalScansTotal = qs("profile-modal-scans-total");
  const profileModalScansTypes = qs("profile-modal-scans-types");
  const profileModalScanners = qs("profile-modal-scanners");
  const profileModalMostPlayed = qs("profile-modal-most-played");
  const profileModalHistory = qs("profile-modal-history");
  const profileAvatarChangeBtn = qs("profile-avatar-change-btn");
  const profileCardModal = qs("profile-card-modal");
  const profileCardBackdrop = qs("profile-card-backdrop");
  const profileCardClose = qs("profile-card-close");
  const profileCardImage = qs("profile-card-image");
  const profileCardName = qs("profile-card-name");
  const profileCardType = qs("profile-card-type");
  const profileCardSet = qs("profile-card-set");
  const profileCardRarity = qs("profile-card-rarity");
  const profileCardStats = qs("profile-card-stats");
  const profileCardAbility = qs("profile-card-ability");

  const applyWinrateColor = (element, value) => {
    if (!element) {
      return;
    }
    const winrate = Number(value || 0);
    if (winrate >= 60) element.style.color = "#00ff88";
    else if (winrate >= 50) element.style.color = "#88ff88";
    else if (winrate >= 40) element.style.color = "#ffcc00";
    else if (winrate >= 30) element.style.color = "#ff8888";
    else element.style.color = "#ff4444";
  };

  const closeProfileModal = () => {
    if (!profileModal) {
      return;
    }
    profileModal.classList.add("hidden");
    profileModal.setAttribute("aria-hidden", "true");
  };

  const closeProfileCardModal = () => {
    if (!profileCardModal) {
      return;
    }
    profileCardModal.classList.add("hidden");
    profileCardModal.setAttribute("aria-hidden", "true");
  };

  const openProfileCardModal = (card) => {
    if (!profileCardModal || !card) {
      return;
    }
    if (profileCardImage) {
      profileCardImage.src = card.image || "/fundo%20cartas.png";
      profileCardImage.alt = card.name || "Carta";
    }
    if (profileCardName) profileCardName.textContent = card.name || "Carta";
    if (profileCardType) profileCardType.textContent = `Tipo: ${card.type || "Unknown"} | Tribo: ${card.tribe || "-"}`;
    if (profileCardSet) profileCardSet.textContent = `Set: ${card.set || "Unknown"}`;
    if (profileCardRarity) profileCardRarity.textContent = `Raridade: ${card.rarity || "Unknown"}`;
    const stats = card.stats || {};
    if (profileCardStats) {
      profileCardStats.textContent = `Stats: Energia ${Number(stats.energy || 0)} | C ${Number(stats.courage || 0)} | P ${Number(stats.power || 0)} | I ${Number(stats.wisdom || 0)} | V ${Number(stats.speed || 0)}`;
    }
    if (profileCardAbility) profileCardAbility.textContent = `Habilidade: ${card.ability || "Sem habilidade textual"}`;
    profileCardModal.classList.remove("hidden");
    profileCardModal.setAttribute("aria-hidden", "false");
  };

  const openProfileModal = () => {
    if (!profileModal) {
      return;
    }
    profileModal.classList.remove("hidden");
    profileModal.setAttribute("aria-hidden", "false");
  };

  const renderProfile = (profile) => {
    if (!profile) {
      return;
    }
    const displayName = currentUser?.username || username;
    const avatar = profile.avatar || currentUser?.avatar || "/fundo%20cartas.png";
    const wins = Number(profile.wins || 0);
    const losses = Number(profile.losses || 0);
    const winrate = Number(profile.winRate || 0);
    const score = Number(profile.score || 0);

    // Apply tribe theme to profile modal card and avatar
    const tribe = String(profile.favoriteTribe || currentUser?.tribe || "").toLowerCase();
    const modalCardEl = profileModal?.querySelector(".profile-modal-card");
    if (modalCardEl) {
      modalCardEl.classList.remove("tribe-outromundo", "tribe-submundo", "tribe-danians", "tribe-mipedians");
      if (tribe) modalCardEl.classList.add(`tribe-${tribe}`);
    }
    if (avatarContainer) {
      avatarContainer.classList.remove("tribe-outromundo", "tribe-submundo", "tribe-danians", "tribe-mipedians");
      if (tribe) avatarContainer.classList.add(`tribe-${tribe}`);
    }

    if (nameEl) nameEl.textContent = displayName;
    if (scoreEl) scoreEl.textContent = String(score);
    if (winrateEl) {
      winrateEl.textContent = `${winrate.toFixed(2).replace(/\.00$/, "")}%`;
      applyWinrateColor(winrateEl, winrate);
    }
    if (avatarImg) {
      avatarImg.src = avatar;
    }

    if (profileModalName) profileModalName.textContent = displayName;
    if (profileModalUpdated) {
      const updatedText = profile.updatedAt ? new Date(profile.updatedAt).toLocaleString("pt-BR") : "Agora";
      profileModalUpdated.textContent = `Atualizado em ${updatedText}`;
    }
    if (profileModalAvatar) profileModalAvatar.src = avatar;
    if (profileModalScore) profileModalScore.textContent = String(score);
    if (profileModalWL) profileModalWL.textContent = `${wins} / ${losses}`;
    if (profileModalWinrate) profileModalWinrate.textContent = `${winrate.toFixed(2).replace(/\.00$/, "")}%`;
    if (profileModalScansTotal) profileModalScansTotal.textContent = String(profile?.scans?.total || 0);
    if (profileModalScansTypes) {
      const byType = profile?.scans?.byType || {};
      const chips = [
        `Creatures: ${Number(byType.creatures || 0)}`,
        `Attacks: ${Number(byType.attacks || 0)}`,
        `Battlegear: ${Number(byType.battlegear || 0)}`,
        `Locations: ${Number(byType.locations || 0)}`,
        `Mugic: ${Number(byType.mugic || 0)}`,
      ];
      profileModalScansTypes.innerHTML = chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("");
    }
    if (profileModalScanners) {
      const scannerLabels = {
        danian: "Danian",
        overworld: "OverWorld",
        underworld: "UnderWorld",
        mipedian: "Mipedian",
        marrillian: "M'arrillian",
      };
      const scanners = profile?.scanners && typeof profile.scanners === "object" ? profile.scanners : {};
      const orderedKeys = ["danian", "overworld", "underworld", "mipedian", "marrillian"];
      profileModalScanners.innerHTML = orderedKeys
        .map((key) => {
          const scanner = scanners[key] || {};
          const level = Math.max(1, Math.min(4, Number(scanner.level || 1)));
          const xp = Math.max(0, Number(scanner.xp || 0));
          const currentThreshold = Math.max(0, Number(scanner.currentLevelXpThreshold || 0));
          const nextThreshold = Math.max(currentThreshold, Number(scanner.nextLevelXpThreshold || currentThreshold));
          const xpIntoLevel = Math.max(0, xp - currentThreshold);
          const xpNeeded = Math.max(1, nextThreshold - currentThreshold);
          const percent = level >= 4 ? 100 : Math.max(0, Math.min(100, (xpIntoLevel / xpNeeded) * 100));
          return `
            <div class="profile-scanner-item">
              <div class="profile-scanner-top">
                <strong>${escapeHtml(scannerLabels[key] || key)}</strong>
                <span>Nivel ${level} ${level >= 4 ? "(Max)" : `| XP ${xpIntoLevel}/${xpNeeded}`}</span>
              </div>
              <div class="profile-scanner-bar"><div class="profile-scanner-fill" style="width:${percent}%;"></div></div>
            </div>
          `;
        })
        .join("");
    }
    if (profileModalMostPlayed) {
      if (profile?.mostPlayedCreature?.name && profile?.mostPlayedCreature?.cardId) {
        const cardName = escapeHtml(profile.mostPlayedCreature.name);
        const count = Number(profile.mostPlayedCreature.count || 0);
        const cardId = escapeHtml(profile.mostPlayedCreature.cardId);
        profileModalMostPlayed.innerHTML = `<span class="profile-card-link" data-card-id="${cardId}">${cardName}</span> (${count} usos)`;
      } else {
        profileModalMostPlayed.textContent = "Nenhuma criatura registrada ainda.";
      }
    }
    if (profileModalHistory) {
      const history = Array.isArray(profile.battleHistory) ? profile.battleHistory : [];
      if (!history.length) {
        profileModalHistory.innerHTML = '<div style="font-size:0.72rem;color:#8ea8bf;">Sem partidas registradas ainda.</div>';
      } else {
        profileModalHistory.innerHTML = history
          .map((entry) => {
            const result = String(entry?.result || "").toLowerCase();
            const resultLabel = result === "win" ? "VitÃ³ria" : result === "loss" ? "Derrota" : "Resultado";
            const resultClass = result === "win" ? "result-win" : result === "loss" ? "result-loss" : "";
            const modeLabel = String(entry?.mode || "unknown");
            const opponent = String(entry?.opponent || "Oponente");
            const when = entry?.timestamp ? new Date(entry.timestamp).toLocaleString("pt-BR") : "-";
            return `
              <div class="profile-history-item">
                <strong class="${resultClass}">${escapeHtml(resultLabel)}</strong>
                <span>${escapeHtml(modeLabel)}</span>
                <span>vs ${escapeHtml(opponent)}</span>
                <span>${escapeHtml(when)}</span>
              </div>
            `;
          })
          .join("");
      }
    }
  };

  async function refreshProfile() {
    const response = await fetch(`/api/profile?username=${encodeURIComponent(usernameKey)}`);
    const payload = await response.json();
    if (!response.ok || !payload?.profile) {
      throw new Error(payload?.error || "Falha ao carregar perfil.");
    }
    renderProfile(payload.profile);
  }

  if (avatarContainer && currentUser?.tribe) {
    avatarContainer.classList.add(`tribe-${currentUser.tribe}`);
  }

  if (avatarContainer) {
    avatarContainer.addEventListener("click", async () => {
      try {
        await refreshProfile();
        openProfileModal();
      } catch (error) {
        alert(error?.message || "Falha ao carregar perfil.");
      }
    });
  }
  if (profileModalClose) {
    profileModalClose.addEventListener("click", closeProfileModal);
  }
  if (profileModalBackdrop) {
    profileModalBackdrop.addEventListener("click", closeProfileModal);
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && profileModal && !profileModal.classList.contains("hidden")) {
      closeProfileModal();
    }
    if (event.key === "Escape" && profileCardModal && !profileCardModal.classList.contains("hidden")) {
      closeProfileCardModal();
    }
  });

  if (profileCardClose) {
    profileCardClose.addEventListener("click", closeProfileCardModal);
  }
  if (profileCardBackdrop) {
    profileCardBackdrop.addEventListener("click", closeProfileCardModal);
  }
  if (profileModalMostPlayed) {
    profileModalMostPlayed.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest(".profile-card-link");
      if (!button) {
        return;
      }
      const cardId = String(button.getAttribute("data-card-id") || "").trim();
      if (!cardId) {
        return;
      }
      const cardsMap = await loadLibraryCardsMap();
      const card = cardsMap.get(cardId) || null;
      if (!card) {
        alert("Nao foi possivel carregar os dados dessa carta.");
        return;
      }
      openProfileCardModal(card);
    });
  }

  if (profileAvatarChangeBtn && avatarUpload) {
    profileAvatarChangeBtn.addEventListener("click", () => avatarUpload.click());
    avatarUpload.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Image = event.target?.result;
        if (!base64Image) {
          return;
        }
        try {
          const response = await fetch("/api/profile/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: usernameKey,
              avatar: base64Image,
            }),
          });
          const payload = await response.json();
          if (!response.ok || !payload?.profile) {
            throw new Error(payload?.error || "Falha ao atualizar avatar.");
          }
          renderProfile(payload.profile);
          // Avatar is now stored server-side via /api/profile/avatar
          avatarUpload.value = "";
        } catch (error) {
          alert(error?.message || "Falha ao salvar avatar.");
        }
      };
      reader.readAsDataURL(file);
    });
  }

  try {
    await refreshProfile();
  } catch {
    if (nameEl) nameEl.textContent = username;
    if (scoreEl) scoreEl.textContent = "1200";
    if (winrateEl) winrateEl.textContent = "0%";
  }
}

function bindNavigation() {
  const btnDromos = qs("btn-dromos");
  const btnBuilder = qs("btn-builder");
  const btnSettings = qs("btn-settings");

  if (btnDromos) {
    btnDromos.addEventListener("click", () => {
      window.location.href = toPage("index.html?view=battle");
    });
  }
  if (btnBuilder) {
    btnBuilder.addEventListener("click", () => {
      window.location.href = toPage("index.html?view=builder");
    });
  }
  if (btnSettings) {
    btnSettings.addEventListener("click", () => {
      window.location.href = toPage("index.html?view=settings");
    });
  }
}

function bindFooterActions() {
  const btnLogout = qs("btn-logout");
  const btnExit = qs("btn-exit");

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        await fetchJsonWithTimeout("/api/auth/logout", { method: "POST" }, NETWORK_TIMEOUT_MS.session);
      } catch (_) {
        // best effort logout
      }
      localStorage.removeItem(DB_SESSION);
      clearSessionToken();
      window.location.href = toPage("auth.html");
    });
  }

  if (btnExit) {
    btnExit.addEventListener("click", () => {
      if (!confirm("Deseja realmente sair do jogo?")) {
        return;
      }
      fetch("/api/shutdown", { method: "POST" }).catch(() => {});
      window.close();
      document.body.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; text-align:center;">
          <h1 style="color:#00d2ff; font-family:'Orbitron',sans-serif; text-transform:uppercase;">O jogo foi encerrado.</h1>
          <p style="color:#889bb4; margin-top:1rem;">Pode fechar esta janela com seguranca.</p>
        </div>
      `;
    });
  }
}

function bindMultiplayer(username) {
  const menuNav = qs("menu-nav");
  const mpPanel = qs("multiplayer-panel");
  const mpCreateView = qs("mp-create-view");
  const mpJoinView = qs("mp-join-view");
  const mpJoinDeckSection = qs("mp-join-deck-section");
  const mpRoomsList = qs("mp-rooms-list");
  const mpWaitingMessage = qs("mp-waiting-message");
  const selMpDeckCreate = qs("mp-deck-select-create");
  const selMpDeckJoin = qs("mp-deck-select-join");
  const selMpRulesMode = qs("mp-rules-mode");

  const btnMultiplayer = qs("btn-multiplayer");
  const btnMpBack = qs("btn-mp-back");
  const btnMpCreate = qs("btn-mp-create");
  const btnMpJoin = qs("btn-mp-join");
  const btnMpConfirmCreate = qs("btn-mp-confirm-create");
  const btnMpConfirmJoin = qs("btn-mp-confirm-join");

  let selectedRoomIdToJoin = null;

  async function renderRoomList() {
    if (!mpRoomsList) {
      return;
    }
    mpRoomsList.innerHTML = '<div style="text-align:center; color:#889bb4;">Buscando salas...</div>';
    try {
      const res = await fetch("/api/multiplayer/rooms");
      const data = await res.json();
      mpRoomsList.innerHTML = "";
      if (!Array.isArray(data.rooms) || !data.rooms.length) {
        mpRoomsList.innerHTML = '<div style="text-align:center; color:#889bb4;">Nenhuma sala encontrada.</div>';
        return;
      }
      data.rooms.forEach((room) => {
        const roomDiv = document.createElement("div");
        roomDiv.style.padding = "0.5rem";
        roomDiv.style.borderBottom = "1px solid rgba(255,255,255,0.1)";
        roomDiv.style.display = "flex";
        roomDiv.style.justifyContent = "space-between";
        roomDiv.style.alignItems = "center";

        const textDiv = document.createElement("div");
        const modeLabel = room.rulesMode === "casual"
          ? "Casual"
          : room.rulesMode === "1v1"
            ? "1v1"
            : "Competitivo";
        const statusLabel = room.status || `${room.occupancy || "1/2"} jogadores`;
        const phaseLabel = room.phase === "in_game" ? "Em jogo" : room.phase === "finished" ? "Finalizada" : "Aguardando";
        textDiv.innerHTML = `<strong>ID: ${room.id}</strong><br><small>Host: ${room.hostName} | Regra: ${modeLabel} | ${statusLabel} | ${phaseLabel}</small>`;
        roomDiv.appendChild(textDiv);

        const actionBtn = document.createElement("button");
        actionBtn.style.padding = "0.3rem 0.6rem";
        if ((room.phase || "lobby") === "lobby" && (room.occupancy || "1/2") !== "2/2") {
          actionBtn.className = "menu-btn primary-btn";
          actionBtn.textContent = "Entrar";
          actionBtn.addEventListener("click", () => {
            selectedRoomIdToJoin = room.id;
            if (mpJoinDeckSection) {
              mpJoinDeckSection.style.display = "block";
            }
          });
        } else {
          actionBtn.className = "menu-btn ghost-btn";
          actionBtn.textContent = "Assistir";
          actionBtn.addEventListener("click", () => {
            window.location.href = buildMultiplayerBattleUrl({ roomId: room.id, seat: "spectator" });
          });
        }
        roomDiv.appendChild(actionBtn);
        mpRoomsList.appendChild(roomDiv);
      });
    } catch (_) {
      mpRoomsList.innerHTML = '<div style="text-align:center; color:#ff6a5c;">Erro ao buscar salas.</div>';
    }
  }

  if (btnMultiplayer) {
    btnMultiplayer.addEventListener("click", async () => {
      if (menuNav) menuNav.style.display = "none";
      if (mpPanel) mpPanel.style.display = "block";
      if (mpCreateView) mpCreateView.style.display = "none";
      if (mpJoinView) mpJoinView.style.display = "none";
      if (mpJoinDeckSection) mpJoinDeckSection.style.display = "none";
      await populateDecks(selMpDeckCreate, username);
      await populateDecks(selMpDeckJoin, username);
    });
  }

  if (btnMpBack) {
    btnMpBack.addEventListener("click", () => {
      if (mpPanel) mpPanel.style.display = "none";
      if (menuNav) menuNav.style.display = "flex";
    });
  }

  if (btnMpCreate) {
    btnMpCreate.addEventListener("click", () => {
      if (mpCreateView) mpCreateView.style.display = "block";
      if (mpJoinView) mpJoinView.style.display = "none";
      if (mpWaitingMessage) mpWaitingMessage.style.display = "none";
      if (btnMpConfirmCreate) btnMpConfirmCreate.style.display = "block";
    });
  }

  if (btnMpJoin) {
    btnMpJoin.addEventListener("click", async () => {
      if (mpJoinView) mpJoinView.style.display = "block";
      if (mpCreateView) mpCreateView.style.display = "none";
      if (mpJoinDeckSection) mpJoinDeckSection.style.display = "none";
      selectedRoomIdToJoin = null;
      await renderRoomList();
    });
  }

  if (btnMpConfirmCreate) {
    btnMpConfirmCreate.addEventListener("click", async () => {
      const deckName = selMpDeckCreate?.value;
      if (!deckName) {
        alert("Selecione um deck!");
        return;
      }
      try {
        const deckData = await fetchDeckByName(deckName, username);
        btnMpConfirmCreate.style.display = "none";
        if (mpWaitingMessage) mpWaitingMessage.style.display = "block";
        const selectedRulesMode = ["casual", "competitive", "1v1"].includes(selMpRulesMode?.value)
          ? selMpRulesMode.value
          : "competitive";
        const res = await fetch("/api/multiplayer/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: normalizeUsername(username),
            playerName: username,
            deckName,
            deck: deckData,
            rulesMode: selectedRulesMode,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.roomId) {
          throw new Error(data?.error || "Falha ao criar sala.");
        }
        const evtSource = new EventSource(
          apiUrl(`/api/multiplayer/events/${data.roomId}?seatToken=${encodeURIComponent(String(data.seatToken || ""))}`)
        );
        evtSource.onmessage = (event) => {
          const msg = safeJsonParse(event.data, null);
          if (msg?.type === "room_snapshot" && msg.snapshot?.phase === "in_game") {
            evtSource.close();
            window.location.href = buildMultiplayerBattleUrl({
              roomId: data.roomId,
              seat: data.seat || "host",
              seatToken: data.seatToken || "",
            });
          }
        };
      } catch (err) {
        alert(err?.message || "Erro ao criar sala");
        btnMpConfirmCreate.style.display = "block";
        if (mpWaitingMessage) mpWaitingMessage.style.display = "none";
      }
    });
  }

  if (btnMpConfirmJoin) {
    btnMpConfirmJoin.addEventListener("click", async () => {
      if (!selectedRoomIdToJoin) {
        alert("Selecione uma sala para entrar.");
        return;
      }
      const deckName = selMpDeckJoin?.value;
      if (!deckName) {
        alert("Selecione um deck!");
        return;
      }
      try {
        const deckData = await fetchDeckByName(deckName, username);
        const res = await fetch(`/api/multiplayer/rooms/${selectedRoomIdToJoin}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spectator: false,
            username: normalizeUsername(username),
            playerName: username,
            deckName,
            deck: deckData,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Falha ao entrar na sala.");
        }
        window.location.href = buildMultiplayerBattleUrl({
          roomId: selectedRoomIdToJoin,
          seat: data.seat || "guest",
          seatToken: data.seatToken || "",
        });
      } catch (err) {
        alert(err?.message || "Erro ao entrar na sala");
      }
    });
  }
}

function bindPerim(username) {
  const menuWrapper = document.querySelector(".menu-wrapper");
  const menuNav = qs("menu-nav");
  const perimPanel = qs("perim-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const tradesPanel = qs("trades-panel");
  const btnPerim = qs("btn-perim");
  const btnPerimBack = qs("btn-perim-back");
  const statusEl = qs("perim-status");
  const locationsGrid = qs("perim-locations-grid");
  const locationDetail = qs("perim-location-detail");
  const actionsList = qs("perim-actions-list");
  const startBtn = qs("perim-start-action");
  const activeRunEl = qs("perim-active-run");
  const newsTicker = qs("perim-news-ticker");
  const newsTickerText = newsTicker ? newsTicker.querySelector(".perim-ticker-text") : null;
  const pendingRewardsEl = qs("perim-pending-rewards");
  const searchFilter = qs("perim-filter-search");
  const previewModal = qs("perim-location-preview-modal");
  const previewBackdrop = qs("perim-location-preview-backdrop");
  const previewClose = qs("perim-location-preview-close");
  const previewImage = qs("perim-location-preview-image");
  const previewName = qs("perim-location-preview-name");
  const previewSet = qs("perim-location-preview-set");
  const previewRarity = qs("perim-location-preview-rarity");
  const rewardModal = qs("perim-reward-modal");
  const rewardBackdrop = qs("perim-reward-backdrop");
  const rewardClose = qs("perim-reward-close");
  const rewardList = qs("perim-reward-list");
  const eventsBtn = qs("perim-events-btn");
  const eventsModal = qs("perim-events-modal");
  const eventsBackdrop = qs("perim-events-backdrop");
  const eventsClose = qs("perim-events-close");
  const eventsList = qs("perim-events-list");

  if (!btnPerim || !perimPanel) {
    return;
  }

  const state = {
    payload: null,
    selectedLocationCardId: "",
    selectedActionId: "explore",
    filterSearch: "",
    countdownTicker: null,
    finishRefreshSent: false,
  };

  const PRESENCE_PHRASES = {
    none: [
      "Silencio absoluto. Nenhum rastro visivel na area hoje.",
      "Terreno limpo por enquanto. Nada indica criaturas por aqui hoje.",
      "Sem pegadas recentes. A area parece vazia neste momento.",
      "Nenhuma movimentacao detectada hoje neste local.",
      "Area calma demais: sem sinais confiaveis de criaturas hoje.",
    ],
    low: [
      "Ha rastros leves. Poucas criaturas podem estar circulando por aqui.",
      "Sinais discretos no terreno: atividade baixa de criaturas hoje.",
      "Pegadas esparsas encontradas. Presenca pequena na area.",
      "Movimento reduzido detectado. Talvez 1 ou 2 criaturas por perto.",
      "Rastros recentes, mas poucos. A area parece pouco ativa.",
    ],
    medium: [
      "Ha rastros consistentes. A area esta moderadamente ativa hoje.",
      "Sinais claros de passagem. Algumas criaturas estao por perto.",
      "Pegadas e marcas frequentes: atividade media detectada.",
      "Presenca equilibrada no local. A exploracao tem bom potencial.",
      "Ha movimento constante no terreno. Faixa media de atividade.",
    ],
    high: [
      "Rastros fortes por toda parte. A area esta bem movimentada hoje.",
      "Muitas marcas recentes. Alta atividade de criaturas neste local.",
      "Sinais intensos no terreno: varias criaturas circulando.",
      "Movimentacao elevada detectada. Excelente area para buscar encontros.",
      "Pegadas abundantes. O local esta muito ativo neste momento.",
    ],
    intense: [
      "Area extremamente ativa. Rastros densos em todos os setores.",
      "Concentracao maxima de sinais hoje. O local esta fervendo.",
      "Atividade intensa confirmada: muitas criaturas rondando a area.",
      "Rastros sobrepostos por todo o terreno. Presenca muito alta.",
      "Pico de movimentacao no local. Exploracao com alta chance de encontro.",
    ],
  };

  function hashToken(text) {
    const raw = String(text || "");
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) {
      hash ^= raw.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

function presenceBucketByCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount <= 0) return "none";
  if (safeCount <= 2) return "low";
  if (safeCount <= 5) return "medium";
  if (safeCount <= 8) return "high";
  return "intense";
}

function pickPresencePhrase(locationEntry, count) {
  const safeCount = Math.max(0, Number(count) || 0);
  if (safeCount === 1) {
    return "alguma ser passou por aqui";
  }
  if (safeCount === 2) {
    return "há pegadas que andam juntas aqui";
  }
  const bucket = presenceBucketByCount(count);
  const pool = PRESENCE_PHRASES[bucket] || PRESENCE_PHRASES.none;
    if (!pool.length) {
      return "Sem dados de presenca no momento.";
    }
    const dayToken = state.payload?.now ? String(state.payload.now).slice(0, 10) : "";
    const actionToken = String(state.selectedActionId || "explore");
    const sourceKey = `${locationEntry?.cardId || locationEntry?.name || "unknown"}:${count}:${actionToken}:${dayToken}:${bucket}`;
    const index = hashToken(sourceKey) % pool.length;
    return pool[index];
  }

  function stopCountdownTicker() {
    if (state.countdownTicker) {
      clearInterval(state.countdownTicker);
      state.countdownTicker = null;
    }
  }

  function setStatus(text, isError = false) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text || "";
    statusEl.style.color = isError ? "#ff8d8d" : "#9ec4db";
  }

  function getLocations() {
    return Array.isArray(state.payload?.locations) ? state.payload.locations : [];
  }

  function getActions() {
    return Array.isArray(state.payload?.actions) ? state.payload.actions : [];
  }

  function getFilteredLocations() {
    const query = normalizeFilterToken(state.filterSearch);
    return getLocations().filter((entry) => {
      if (!query) {
        return true;
      }
      const name = normalizeFilterToken(entry?.name || "");
      return name.includes(query);
    });
  }

  function resolveSelectedLocation() {
    const locations = getLocations();
    if (!locations.length) {
      state.selectedLocationCardId = "";
      return null;
    }
    const selected = locations.find((entry) => entry.cardId === state.selectedLocationCardId) || null;
    if (selected) {
      return selected;
    }
    state.selectedLocationCardId = locations[0].cardId;
    return locations[0];
  }

  function renderFilterOptions() {
    if (searchFilter) {
      searchFilter.value = state.filterSearch || "";
    }
  }

  function closePreview() {
    if (!previewModal) {
      return;
    }
    previewModal.classList.add("hidden");
  }

  function closeRewardModal() {
    if (!rewardModal) {
      return;
    }
    rewardModal.classList.add("hidden");
    rewardModal.setAttribute("aria-hidden", "true");
  }

  function closeEventsModal() {
    if (!eventsModal) {
      return;
    }
    eventsModal.classList.add("hidden");
    eventsModal.setAttribute("aria-hidden", "true");
  }

  async function openEventsModal() {
    if (!eventsModal || !eventsList) {
      return;
    }
    eventsList.innerHTML = '<div style="font-size:0.72rem;color:#8ea8bf;">Carregando eventos...</div>';
    try {
      const res = await fetch("/api/perim/events");
      const payload = await res.json();
      const events = Array.isArray(payload?.events) ? payload.events : [];
      if (!events.length) {
        eventsList.innerHTML = '<div style="font-size:0.72rem;color:#8ea8bf;">Nenhum evento ativo no momento.</div>';
      } else {
        eventsList.innerHTML = events
          .map((entry) => `
            <article class="perim-reward-item">
              <div style="grid-column:1 / -1;">
                <strong>${escapeHtml(entry?.name || "Evento")}</strong>
                <span>${escapeHtml(entry?.description || "-")}</span>
                <span>Inicio: ${escapeHtml(entry?.startAt || "-")} | Fim: ${escapeHtml(entry?.endAt || "-")}</span>
              </div>
            </article>
          `)
          .join("");
      }
    } catch (error) {
      eventsList.innerHTML = `<div style="font-size:0.72rem;color:#ff8d8d;">${escapeHtml(error?.message || "Falha ao carregar eventos.")}</div>`;
    }
    eventsModal.classList.remove("hidden");
    eventsModal.setAttribute("aria-hidden", "false");
  }

  function openRewardModal(rewards) {
    if (!rewardModal || !rewardList) {
      return;
    }
    const items = Array.isArray(rewards) ? rewards : [];
    if (!items.length) {
      rewardList.innerHTML = '<div style="font-size:0.72rem;color:#8ea8bf;">Nenhuma carta recebida nesta coleta.</div>';
    } else {
      rewardList.innerHTML = items
        .map((reward) => {
          const name = reward?.cardDisplayName || reward?.cardName || reward?.cardId || "Carta";
          const type = reward?.type || "card";
          const rarity = reward?.rarity || "Unknown";
          const image = reward?.image || "/fundo%20cartas.png";
          return `
            <article class="perim-reward-item${reward?.isNew ? " is-new" : ""}">
              <img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" loading="lazy" />
              <div>
                <strong>${escapeHtml(name)}</strong>
                <span>${escapeHtml(type)} | ${escapeHtml(rarity)}</span>
                ${reward?.isNew ? '<span class="reward-new-badge">Novo Scan</span>' : ""}
              </div>
            </article>
          `;
        })
        .join("");
    }
    rewardModal.classList.remove("hidden");
    rewardModal.setAttribute("aria-hidden", "false");
  }

  function openPreview(entry) {
    if (!previewModal || !entry) {
      return;
    }
    if (previewImage) {
      previewImage.src = entry.image || "/fundo%20cartas.png";
      previewImage.alt = entry.name || "Local";
    }
    if (previewName) {
      previewName.textContent = entry.name || "Local";
    }
    if (previewSet) {
      previewSet.textContent = `Set: ${entry.set || "Unknown"}`;
    }
    if (previewRarity) {
      previewRarity.textContent = `Raridade: ${entry.rarity || "Unknown"}`;
    }
    previewModal.classList.remove("hidden");
  }

  function renderLocations() {
    if (!locationsGrid) {
      return;
    }
    const filtered = getFilteredLocations();
    const selectedInFiltered = filtered.some((entry) => entry.cardId === state.selectedLocationCardId);
    if (!selectedInFiltered && filtered.length) {
      state.selectedLocationCardId = filtered[0].cardId;
    }
    locationsGrid.innerHTML = "";
    if (!filtered.length) {
      locationsGrid.innerHTML = '<div style="font-size:0.75rem;color:#8ea8bf;">Nenhum local encontrado para esse nome.</div>';
      return;
    }

    filtered.forEach((entry) => {
      const item = document.createElement("article");
      item.className = `perim-location-item${entry.cardId === state.selectedLocationCardId ? " selected" : ""}`;
      item.innerHTML = `
        <img src="${escapeHtml(entry.image || "/fundo%20cartas.png")}" alt="${escapeHtml(entry.name)}" loading="lazy" />
        <div class="perim-location-meta">
          <strong>${escapeHtml(entry.name)}</strong>
          <span>${escapeHtml(entry.set || "Unknown")} | ${escapeHtml(entry.rarity || "Unknown")}</span>
        </div>
        <div style="display:grid; gap:0.25rem;">
          <button class="perim-select-btn" type="button">Selecionar</button>
          <button class="perim-select-btn perim-preview-btn" type="button">Ver carta</button>
        </div>
      `;
      const selectButton = item.querySelector(".perim-select-btn");
      if (selectButton) {
        selectButton.addEventListener("click", () => {
          state.selectedLocationCardId = entry.cardId;
          renderAll();
        });
      }
      const previewButton = item.querySelector(".perim-preview-btn");
      if (previewButton) {
        previewButton.addEventListener("click", () => openPreview(entry));
      }
      locationsGrid.appendChild(item);
    });
  }

  function renderLocationDetail() {
    if (!locationDetail) {
      return;
    }
    const selected = resolveSelectedLocation();
    if (!selected) {
      locationDetail.innerHTML = '<p style="color:#9fb4c6;">Voce ainda nao possui locais no Scans.</p>';
      return;
    }
    const activeRun = state.payload?.activeRun || null;
    const context = activeRun?.locationId === selected.cardId
      ? activeRun.contextSnapshot
      : (selected.contextPreview || null);
    const pendingCount = Number(state.payload?.pendingRewards?.filter((entry) => !entry?.claimedAt).length || 0);
    const actionKey = state.selectedActionId || "explore";
    const creaturesTodayCount = Number(
      context?.creaturesTodayCount
      ?? selected?.creaturesTodayCount
      ?? 0
    );
    const clues = Array.isArray(context?.clues) ? context.clues.filter((entry) => String(entry || "").trim()) : [];
    const cluesHtml = clues.length
      ? `<hr style="border-color:rgba(255,255,255,0.1); margin:0.45rem 0;" /><p><strong>Pistas:</strong></p>${clues
        .map((entry) => `<p style="font-size:0.72rem;color:#b7cadb;">- ${escapeHtml(String(entry))}</p>`)
        .join("")}`
      : "";
    const presencePhrase = pickPresencePhrase(selected, creaturesTodayCount);
    const turnLabel = context?.turnLabel || "--";
    const climate = context?.climate || "Aguardando selecao de acao";
    locationDetail.innerHTML = `
      <p><strong>${escapeHtml(selected.name)}</strong></p>
      <p>Raridade: ${escapeHtml(selected.rarity || "Unknown")}</p>
      <p>Set: ${escapeHtml(selected.set || "Unknown")}</p>
      <hr style="border-color:rgba(255,255,255,0.1); margin:0.45rem 0;" />
      <p>Turno do dia: ${escapeHtml(turnLabel)}</p>
      <p>Clima: ${escapeHtml(climate)}</p>
      <p>Sinal de presenca (${escapeHtml(actionKey)}): ${escapeHtml(presencePhrase)}</p>
      <p>Criaturas detectadas hoje na area: <strong>${Number.isFinite(creaturesTodayCount) ? creaturesTodayCount : 0}</strong></p>
      <p>Chance de evento: 0%</p>
      <hr style="border-color:rgba(255,255,255,0.1); margin:0.45rem 0;" />
      <p>Recompensas pendentes: ${pendingCount}</p>
      ${cluesHtml}
    `;
  }

  function renderActions() {
    if (!actionsList) {
      return;
    }
    const actions = getActions();
    const activeRun = state.payload?.activeRun || null;
    if (!actions.some((action) => action.id === state.selectedActionId) && actions.length) {
      state.selectedActionId = actions[0].id;
    }
    actionsList.innerHTML = "";
    actions.forEach((action) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `perim-action-item${state.selectedActionId === action.id ? " selected" : ""}`;
      item.disabled = Boolean(activeRun);
      item.innerHTML = `
        <strong>${escapeHtml(action.name)}</strong>
        <small>${escapeHtml(action.description)}</small>
      `;
      item.addEventListener("click", () => {
        state.selectedActionId = action.id;
        renderActions();
      });
      actionsList.appendChild(item);
    });
    if (startBtn) {
      const canStart = !activeRun && Boolean(resolveSelectedLocation()) && Boolean(state.selectedActionId);
      startBtn.disabled = !canStart;
      startBtn.style.opacity = canStart ? "1" : "0.5";
      startBtn.style.cursor = canStart ? "pointer" : "not-allowed";
    }
  }

  function renderActiveRun() {
    if (!activeRunEl) {
      return;
    }
    const activeRun = state.payload?.activeRun || null;
    if (!activeRun) {
      activeRunEl.innerHTML = '<div class="perim-run-title">Nenhuma acao em andamento</div><div style="font-size:0.74rem;color:#8ea8bf;">Selecione local e acao para iniciar exploracao.</div>';
      stopCountdownTicker();
      return;
    }
    const remainingMs = Math.max(0, Date.parse(activeRun.endAt) - Date.now());
    const remainingLabel = formatDurationLabel(remainingMs);
    const locationImgHtml = activeRun.locationImage
      ? `<img class="perim-run-image" id="perim-hover-img" src="${escapeHtml(activeRun.locationImage)}" alt="${escapeHtml(activeRun.locationName || "Local")}" style="cursor: pointer;" />`
      : "";
    const activeClues = Array.isArray(activeRun?.contextSnapshot?.clues)
      ? activeRun.contextSnapshot.clues.filter((entry) => String(entry || "").trim())
      : [];
    const activeCluesHtml = activeClues.length
      ? `<div style="margin-top:0.32rem;display:grid;gap:0.16rem;">${activeClues
        .map((entry) => `<div style="font-size:0.68rem;color:#b7cadb;">- ${escapeHtml(String(entry))}</div>`)
        .join("")}</div>`
      : "";
    activeRunEl.innerHTML = `
      <div class="perim-run-title">Acao em andamento</div>
      <div class="perim-active-run-layout">
        <div>
          <div style="font-size:0.74rem;">Local: <strong>${escapeHtml(activeRun.locationName || "Desconhecido")}</strong></div>
          <div style="font-size:0.74rem;">Acao: <strong>${escapeHtml(activeRun.actionLabel || activeRun.actionId || "N/A")}</strong></div>
          <div style="font-size:0.74rem;">Tempo restante: <strong>${escapeHtml(remainingLabel)}</strong></div>
          <div style="font-size:0.7rem;color:#8ea8bf;">Exploracao em progresso. Aguarde a conclusao para coletar as recompensas.</div>
          ${activeCluesHtml}
        </div>
        ${locationImgHtml}
      </div>
    `;

    const imgEl = activeRunEl.querySelector("#perim-hover-img");
    if (imgEl && activeRun.locationCard) {
      imgEl.addEventListener("mouseenter", () => {
        openProfileCardModal(activeRun.locationCard);
      });
      imgEl.addEventListener("mouseleave", () => {
        const profileCardModal = qs("profile-card-modal");
        if (profileCardModal) {
          profileCardModal.classList.add("hidden");
          profileCardModal.setAttribute("aria-hidden", "true");
        }
      });
    }

    // Atualizar ticker de notÃ­cias
    renderNewsTicker();
  }

  function renderPendingRewards() {
    if (!pendingRewardsEl) {
      return;
    }
    const pending = Array.isArray(state.payload?.pendingRewards)
      ? state.payload.pendingRewards.filter((entry) => !entry?.claimedAt)
      : [];
    if (!pending.length) {
      pendingRewardsEl.innerHTML = '<div class="perim-run-title">Recompensas</div><div style="font-size:0.72rem;color:#8ea8bf;">Sem recompensas aguardando coleta.</div>';
      return;
    }
    const entry = pending[0];
    const chips = (entry.rewards || [])
      .map((reward) => `<span class="perim-reward-chip">${escapeHtml(reward.type)}: ${escapeHtml(reward.cardDisplayName || reward.cardName || reward.cardId || "Carta")}</span>`)
      .join("");
    pendingRewardsEl.innerHTML = `
      <div class="perim-run-title">Recompensas prontas</div>
      <div style="font-size:0.74rem;">Run: ${escapeHtml(entry.runId || "")}</div>
      <div style="font-size:0.74rem;">Local: <strong>${escapeHtml(entry.locationName || "Desconhecido")}</strong></div>
      <div style="font-size:0.74rem;">Acao: <strong>${escapeHtml(entry.actionName || entry.actionId || "N/A")}</strong></div>
      <div style="margin-top:0.3rem;">${chips || '<span style="font-size:0.72rem;color:#8ea8bf;">Sem cartas sorteadas.</span>'}</div>
      <button id="perim-claim-btn" class="menu-btn primary-btn" style="padding:0.5rem; margin-top:0.55rem;">Coletar recompensas</button>
    `;
    const claimBtn = qs("perim-claim-btn");
    if (claimBtn) {
      claimBtn.addEventListener("click", async () => {
        claimBtn.disabled = true;
        try {
          const res = await fetch("/api/perim/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: normalizeUsername(username),
              runId: entry.runId,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data?.ok) {
            throw new Error(data?.error || "Falha ao coletar.");
          }
          const skipped = Array.isArray(data.skippedByCap) ? data.skippedByCap.length : 0;
          if (skipped > 0) {
            setStatus(`Recompensas coletadas (${(data.rewards || []).length} carta(s)); ${skipped} bloqueada(s) por inventario cheio.`);
          } else {
            setStatus(`Recompensas coletadas (${(data.rewards || []).length} carta(s)).`);
          }
          openRewardModal(data.rewards || []);
          await refreshPerimState();
        } catch (error) {
          setStatus(error?.message || "Erro ao coletar recompensas.", true);
          claimBtn.disabled = false;
        }
      });
    }
  }

  async function renderNewsTicker() {
    if (!newsTicker || !newsTickerText) {
      return;
    }

    // Se nao ha acao ativa, esconde o ticker
    const activeRun = state.payload?.activeRun;
    if (!activeRun) {
      newsTicker.classList.add("hidden");
      return;
    }

    try {
      let newsItems = Array.isArray(state.payload?.activeRunNewsItems) ? state.payload.activeRunNewsItems : [];
      if (!newsItems.length) {
        // Fallback de compatibilidade para estado legado.
        const locationName = activeRun.locationName;
        const response = await fetch(`/api/creature-drops/news-ticker/${encodeURIComponent(locationName)}`);
        if (!response.ok) {
          newsTicker.classList.add("hidden");
          return;
        }
        const data = await response.json();
        newsItems = data.newsItems || [];
      }

      if (!newsItems.length) {
        newsTickerText.textContent = "Sem sinais claros no radar global de criaturas agora.";
        newsTicker.classList.remove("hidden");
        return;
      }

      const tickerMessages = newsItems
        .map((item) => `I am ${item.types || "Creature"} | ${item.flavortext || "Uma criatura misteriosa..."}`)
        .join(" • ");

      newsTickerText.textContent = tickerMessages || "Sem sinais claros no radar global de criaturas agora.";
      newsTicker.classList.remove("hidden");
    } catch (error) {
      console.error("[NewsTicker] Erro ao buscar criaturas:", error);
      newsTicker.classList.add("hidden");
    }
  }
  function runCountdownTicker() {
    stopCountdownTicker();
    state.finishRefreshSent = false;
    state.countdownTicker = setInterval(async () => {
      if (!state.payload?.activeRun) {
        stopCountdownTicker();
        return;
      }
      const remainingMs = Date.parse(state.payload.activeRun.endAt) - Date.now();
      renderActiveRun();
      if (remainingMs <= 0 && !state.finishRefreshSent) {
        state.finishRefreshSent = true;
        await refreshPerimState();
      }
    }, 1000);
  }

  function renderAll() {
    renderFilterOptions();
    renderLocations();
    renderLocationDetail();
    renderActions();
    renderActiveRun();
    renderPendingRewards();
    if (state.payload?.activeRun) {
      runCountdownTicker();
    } else {
      stopCountdownTicker();
    }
  }

  async function refreshPerimState() {
    try {
      const response = await fetch(`/api/perim/state?username=${encodeURIComponent(normalizeUsername(username))}`);
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Falha ao carregar PERIM.");
      }
      state.payload = payload;
      const locations = getLocations();
      if (!locations.some((entry) => entry.cardId === state.selectedLocationCardId)) {
        state.selectedLocationCardId = locations[0]?.cardId || "";
      }
      setStatus(locations.length ? `Locais disponiveis: ${locations.length}` : "Sem locais disponiveis para este jogador.");
      renderAll();
    } catch (error) {
      setStatus(error?.message || "Erro ao carregar dados da aba PERIM.", true);
    }
  }

  if (searchFilter) {
    searchFilter.addEventListener("input", () => {
      state.filterSearch = searchFilter.value || "";
      renderAll();
    });
  }
  if (previewBackdrop) {
    previewBackdrop.addEventListener("click", closePreview);
  }
  if (previewClose) {
    previewClose.addEventListener("click", closePreview);
  }
  if (rewardBackdrop) {
    rewardBackdrop.addEventListener("click", closeRewardModal);
  }
  if (rewardClose) {
    rewardClose.addEventListener("click", closeRewardModal);
  }
  if (eventsBackdrop) {
    eventsBackdrop.addEventListener("click", closeEventsModal);
  }
  if (eventsClose) {
    eventsClose.addEventListener("click", closeEventsModal);
  }
  if (eventsBtn) {
    eventsBtn.addEventListener("click", () => {
      void openEventsModal();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePreview();
      closeRewardModal();
      closeEventsModal();
    }
  });
  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      const selectedLocation = resolveSelectedLocation();
      if (!selectedLocation || !state.selectedActionId) {
        setStatus("Selecione um local e uma acao.", true);
        return;
      }
      startBtn.disabled = true;
      try {
        const response = await fetch("/api/perim/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: normalizeUsername(username),
            locationCardId: selectedLocation.cardId,
            // Compatibilidade temporaria com backend legado.
            locationEntryId: selectedLocation.entryId,
            actionId: state.selectedActionId,
          }),
        });
        const payload = await response.json();
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Nao foi possivel iniciar a acao.");
        }
        setStatus("Acao iniciada com sucesso.");
        await refreshPerimState();
      } catch (error) {
        setStatus(error?.message || "Erro ao iniciar acao.", true);
      } finally {
        startBtn.disabled = false;
      }
    });
  }

  btnPerim.addEventListener("click", async () => {
    closePreview();
    closeEventsModal();
    if (menuWrapper) {
      menuWrapper.classList.add("perim-mode");
    }
    if (menuNav) {
      menuNav.style.display = "none";
    }
    if (multiplayerPanel) {
      multiplayerPanel.style.display = "none";
    }
    if (tradesPanel) {
      tradesPanel.style.display = "none";
    }
    perimPanel.style.display = "block";
    await refreshPerimState();
  });

    if (btnPerimBack) {
    btnPerimBack.addEventListener("click", () => {
      stopCountdownTicker();
      closePreview();
      closeEventsModal();
      if (menuWrapper) {
        menuWrapper.classList.remove("perim-mode");
      }
      perimPanel.style.display = "none";
      if (menuNav) {
        menuNav.style.display = "flex";
      }
    });
  }
}

function bindTrades(username) {
  const menuNav = qs("menu-nav");
  const menuWrapper = document.querySelector(".menu-wrapper");
  const btnTrades = qs("btn-trades");
  const btnTradesBack = qs("btn-trades-back");
  const tradesPanel = qs("trades-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const perimPanel = qs("perim-panel");
  const tradesStatus = qs("trades-status");
  const hubView = qs("trades-hub-view");
  const roomView = qs("trades-room-view");
  const roomCodeInput = qs("trades-room-code-input");
  const btnCreateRoom = qs("btn-trades-create-room");
  const btnJoinRoom = qs("btn-trades-join-room");
  const roomCodeLabel = qs("trades-room-code-label");
  const seatLabel = qs("trades-seat-label");
  const roomPresence = qs("trades-room-presence");
  const myOfferEl = qs("trades-my-offer");
  const oppOfferEl = qs("trades-opponent-offer");
  const inventoryType = qs("trades-inventory-type");
  const inventoryList = qs("trades-inventory-list");
  const btnAcceptToggle = qs("btn-trades-accept-toggle");
  const btnFinalize = qs("btn-trades-finalize");
  const btnCancelRoom = qs("btn-trades-cancel-room");
  const btnRefreshOnline = qs("btn-trades-refresh-online");
  const onlineListEl = qs("trades-online-list");
  const wishlistInput = qs("trades-wishlist-input");
  const btnSaveWishlist = qs("btn-trades-save-wishlist");
  const normalizedTradeUser = normalizeUsername(username);
  const TRADE_SESSION_KEY = `chaotic_trade_session_v2:${normalizedTradeUser}`;
  localStorage.removeItem("chaotic_trade_session_v1");
  if (!btnTrades || !tradesPanel) {
    return;
  }

  const state = {
    roomCode: "",
    seatToken: "",
    seat: "",
    snapshot: null,
    eventSource: null,
  };

  function persistTradeSession() {
    if (!state.roomCode || !state.seatToken) {
      localStorage.removeItem(TRADE_SESSION_KEY);
      return;
    }
    localStorage.setItem(TRADE_SESSION_KEY, JSON.stringify({
      username: normalizedTradeUser,
      roomCode: state.roomCode,
      seatToken: state.seatToken,
    }));
  }

  function restoreTradeSession() {
    const session = safeJsonParse(localStorage.getItem(TRADE_SESSION_KEY), null);
    if (!session || typeof session !== "object") {
      return false;
    }
    const sessionUser = normalizeUsername(session.username || "");
    if (sessionUser && sessionUser !== normalizedTradeUser) {
      localStorage.removeItem(TRADE_SESSION_KEY);
      return false;
    }
    const roomCode = normalizeTradeCode(session.roomCode || "");
    const seatToken = String(session.seatToken || "").trim();
    if (!roomCode || !seatToken) {
      return false;
    }
    state.roomCode = roomCode;
    state.seatToken = seatToken;
    return true;
  }

  function clearEventSource() {
    if (state.eventSource) {
      try {
        state.eventSource.close();
      } catch (_) {}
      state.eventSource = null;
    }
  }

  function setTradesStatus(message, isError = false) {
    if (!tradesStatus) {
      return;
    }
    tradesStatus.textContent = String(message || "");
    tradesStatus.style.color = isError ? "#ff8d8d" : "#88b5d5";
  }

  function parseWishlistText(rawText) {
    const lines = String(rawText || "")
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    const entries = [];
    lines.forEach((line) => {
      const [typePart, ...idParts] = line.split(":");
      const cardType = String(typePart || "").trim().toLowerCase();
      const cardId = String(idParts.join(":") || "").trim();
      if (!cardType || !cardId) {
        return;
      }
      entries.push({
        cardType,
        cardId,
        priority: 3,
      });
    });
    return entries;
  }

  function formatWishlistText(entries) {
    if (!Array.isArray(entries) || !entries.length) {
      return "";
    }
    return entries
      .map((entry) => `${String(entry?.cardType || "").toLowerCase()}:${String(entry?.cardId || "").trim()}`)
      .filter(Boolean)
      .join("\n");
  }

  function renderTradesOnlinePlayers(playersRaw) {
    if (!onlineListEl) {
      return;
    }
    const players = Array.isArray(playersRaw) ? playersRaw : [];
    if (!players.length) {
      onlineListEl.innerHTML = '<div class="trades-empty">Nenhum jogador online agora.</div>';
      return;
    }
    onlineListEl.innerHTML = players
      .map((player) => {
        const safeUser = escapeHtml(player?.username || "");
        const safeTribe = escapeHtml(player?.tribe || "sem tribo");
        const safeScore = Number(player?.score || 0);
        return `
          <div class="trades-online-row">
            <div>
              <strong>${safeUser}</strong><br/>
              <small>${safeTribe} • score ${safeScore}</small>
            </div>
            <button class="menu-btn ghost-btn" data-trade-copy-user="${escapeAttr(player?.username || "")}">Copiar</button>
          </div>
        `;
      })
      .join("");
    onlineListEl.querySelectorAll("[data-trade-copy-user]").forEach((button) => {
      button.addEventListener("click", async () => {
        const playerName = String(button.getAttribute("data-trade-copy-user") || "").trim();
        if (!playerName) {
          return;
        }
        try {
          await navigator.clipboard.writeText(playerName);
          setTradesStatus(`Usuario ${playerName} copiado. Compartilhe o codigo da sala com ele.`);
        } catch (_) {
          setTradesStatus("Nao foi possivel copiar automaticamente. Copie manualmente.", true);
        }
      });
    });
  }

  async function refreshTradesOnlinePlayers() {
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/online", { method: "GET" });
      renderTradesOnlinePlayers(payload.players);
    } catch (error) {
      renderTradesOnlinePlayers([]);
      setTradesStatus(error?.message || "Nao foi possivel carregar jogadores online.", true);
    }
  }

  async function loadTradeWishlist() {
    if (!wishlistInput) {
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/wishlist", { method: "GET" });
      wishlistInput.value = formatWishlistText(payload.entries);
    } catch {
      wishlistInput.value = "";
    }
  }

  async function saveTradeWishlist() {
    if (!wishlistInput) {
      return;
    }
    const entries = parseWishlistText(wishlistInput.value);
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/wishlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      wishlistInput.value = formatWishlistText(payload.entries);
      setTradesStatus(`Wishlist salva (${payload.entries?.length || 0} itens).`);
    } catch (error) {
      setTradesStatus(error?.message || "Falha ao salvar wishlist.", true);
    }
  }

  function formatCardType(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized === "creatures") return "Creature";
    if (normalized === "attacks") return "Attack";
    if (normalized === "battlegear") return "Gear";
    if (normalized === "locations") return "Location";
    if (normalized === "mugic") return "Mugic";
    return normalized || "Carta";
  }

  function escapeAttr(value) {
    return String(value || "").replace(/"/g, "&quot;");
  }

  function renderCardRow(entry, actionHtml = "", offered = false) {
    if (!entry || !entry.scanEntryId) {
      return "";
    }
    const variantTag = entry?.variant?.perfect ? " ★" : "";
    const offeredTag = offered ? " (ofertada)" : "";
    const lockedTag = entry?.lockedByOtherRoom ? " (travada em outra troca)" : "";
    return `
      <div class="trades-card-row">
        <div class="trades-card-meta">
          <strong>${escapeHtml(entry.cardName || entry.cardId || "Carta")}${variantTag}${offeredTag}${lockedTag}</strong>
          <span>${escapeHtml(formatCardType(entry.cardType))} • ${escapeHtml(entry.rarity || "Unknown")} • ${escapeHtml(entry.set || "Unknown")}</span>
        </div>
        ${actionHtml}
      </div>
    `;
  }

  async function sendTradeAction(action) {
    if (!state.roomCode || !state.seatToken) {
      setTradesStatus("Entre em uma sala antes de enviar acoes.", true);
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout(`/api/trades/rooms/${encodeURIComponent(state.roomCode)}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seatToken: state.seatToken,
          action,
        }),
      });
      state.snapshot = payload.snapshot || state.snapshot;
      renderTradeSnapshot();
    } catch (error) {
      setTradesStatus(error?.message || "Erro na acao de troca.", true);
    }
  }

  function renderOfferList(targetEl, offerList, canRemove) {
    if (!targetEl) {
      return;
    }
    if (!Array.isArray(offerList) || !offerList.length) {
      targetEl.innerHTML = '<div class="trades-empty">Sem cartas ofertadas.</div>';
      return;
    }
    targetEl.innerHTML = offerList
      .map((entry) => {
        const button = canRemove
          ? `<button class="menu-btn ghost-btn" data-trade-remove="${escapeAttr(entry.scanEntryId)}">Remover</button>`
          : "";
        return renderCardRow(entry, button, false);
      })
      .join("");

    if (canRemove) {
      targetEl.querySelectorAll("[data-trade-remove]").forEach((button) => {
        button.addEventListener("click", () => {
          const scanEntryId = String(button.getAttribute("data-trade-remove") || "").trim();
          if (!scanEntryId) {
            return;
          }
          void sendTradeAction({
            type: "offer_remove",
            scanEntryId,
          });
        });
      });
    }
  }

  function renderInventoryList() {
    if (!inventoryList) {
      return;
    }
    const myInventory = Array.isArray(state.snapshot?.myInventory) ? state.snapshot.myInventory : [];
    const filter = String(inventoryType?.value || "all").toLowerCase();
    const filtered = myInventory.filter((entry) => {
      if (filter === "all") {
        return true;
      }
      return String(entry?.cardType || "").toLowerCase() === filter;
    });
    if (!filtered.length) {
      inventoryList.innerHTML = '<div class="trades-empty">Nenhuma carta disponivel neste filtro.</div>';
      return;
    }
    inventoryList.innerHTML = filtered
      .map((entry) => {
        const disabledAttr = entry.offered || entry.lockedByOtherRoom ? "disabled" : "";
        const buttonLabel = entry.lockedByOtherRoom ? "Travada" : "Adicionar";
        const actionHtml = `<button class="menu-btn primary-btn" data-trade-add="${escapeAttr(entry.scanEntryId)}" ${disabledAttr}>${buttonLabel}</button>`;
        return renderCardRow(entry, actionHtml, Boolean(entry.offered));
      })
      .join("");

    inventoryList.querySelectorAll("[data-trade-add]").forEach((button) => {
      button.addEventListener("click", () => {
        const scanEntryId = String(button.getAttribute("data-trade-add") || "").trim();
        if (!scanEntryId) {
          return;
        }
        void sendTradeAction({
          type: "offer_add",
          scanEntryId,
        });
      });
    });
  }

  function renderTradeSnapshot() {
    const snapshot = state.snapshot;
    if (!snapshot) {
      if (roomView) {
        roomView.style.display = "none";
      }
      if (hubView) {
        hubView.style.display = "grid";
      }
      return;
    }

    if (hubView) {
      hubView.style.display = "none";
    }
    if (roomView) {
      roomView.style.display = "grid";
    }

    const seat = String(snapshot.seat || state.seat || "spectator");
    state.seat = seat;
    const mySeat = seat === "host" ? "Host" : seat === "guest" ? "Guest" : "Spectator";
    if (roomCodeLabel) {
      roomCodeLabel.textContent = String(snapshot.roomCode || state.roomCode || "------");
    }
    if (seatLabel) {
      seatLabel.textContent = mySeat;
    }

    const guestPresent = Boolean(snapshot?.players?.guest);
    if (roomPresence) {
      if (snapshot.status === "completed") {
        roomPresence.textContent = "Troca concluida com sucesso.";
        localStorage.removeItem(TRADE_SESSION_KEY);
      } else if (snapshot.status === "cancelled") {
        roomPresence.textContent = "Sala cancelada.";
        localStorage.removeItem(TRADE_SESSION_KEY);
      } else if (!guestPresent) {
        roomPresence.textContent = "Aguardando segundo jogador entrar...";
      } else {
        const acceptedHost = Boolean(snapshot?.accepted?.host);
        const acceptedGuest = Boolean(snapshot?.accepted?.guest);
        const confirmHost = Boolean(snapshot?.confirmFinalize?.host);
        const confirmGuest = Boolean(snapshot?.confirmFinalize?.guest);
        roomPresence.textContent = `Aceite H/G: ${acceptedHost ? "OK" : "--"}/${acceptedGuest ? "OK" : "--"} | Confirmacao H/G: ${confirmHost ? "OK" : "--"}/${confirmGuest ? "OK" : "--"}`;
      }
    }

    const myOffer = seat === "guest" ? snapshot?.offers?.guest : snapshot?.offers?.host;
    const oppOffer = seat === "guest" ? snapshot?.offers?.host : snapshot?.offers?.guest;
    renderOfferList(myOfferEl, myOffer, seat === "host" || seat === "guest");
    renderOfferList(oppOfferEl, oppOffer, false);
    renderInventoryList();

    const myAccepted = seat === "guest"
      ? Boolean(snapshot?.accepted?.guest)
      : Boolean(snapshot?.accepted?.host);
    const myConfirmed = seat === "guest"
      ? Boolean(snapshot?.confirmFinalize?.guest)
      : Boolean(snapshot?.confirmFinalize?.host);
    const canAct = seat === "host" || seat === "guest";
    if (btnAcceptToggle) {
      btnAcceptToggle.disabled = !canAct || !guestPresent || snapshot.status === "completed" || snapshot.status === "cancelled";
      btnAcceptToggle.textContent = myAccepted ? "Retirar aceite" : "Aceitar troca";
    }
    if (btnFinalize) {
      btnFinalize.disabled = !canAct || snapshot.status !== "ready" || !guestPresent || !myAccepted;
      btnFinalize.textContent = snapshot.canFinalize
        ? "Concluir troca agora"
        : myConfirmed
          ? "Retirar confirmacao"
          : "Confirmar finalizacao";
    }
    if (btnCancelRoom) {
      btnCancelRoom.disabled = !canAct || snapshot.status === "completed" || snapshot.status === "cancelled";
    }
  }

  async function fetchTradeState() {
    if (!state.roomCode || !state.seatToken) {
      return;
    }
    const payload = await fetchJsonWithTimeout(
      `/api/trades/rooms/${encodeURIComponent(state.roomCode)}/state?seatToken=${encodeURIComponent(state.seatToken)}`,
      { method: "GET" },
      NETWORK_TIMEOUT_MS.default
    );
    state.snapshot = payload.snapshot || null;
    renderTradeSnapshot();
  }

  function connectTradeEvents() {
    clearEventSource();
    if (!state.roomCode || !state.seatToken) {
      return;
    }
    const source = new EventSource(
      apiUrl(`/api/trades/events/${encodeURIComponent(state.roomCode)}?seatToken=${encodeURIComponent(state.seatToken)}`)
    );
    state.eventSource = source;
    source.onmessage = (event) => {
      const message = safeJsonParse(event.data, null);
      if (message?.type === "trade_room_snapshot" && message.snapshot) {
        state.snapshot = message.snapshot;
        renderTradeSnapshot();
      }
      if (message?.type === "trade_room_event" && message?.event === "trade_completed") {
        setTradesStatus("Troca concluida e inventarios atualizados.");
      }
    };
    source.onerror = () => {
      setTradesStatus("Conexao em tempo real instavel. Tentando reconectar...", true);
    };
  }

  function resetTradeState(keepStatus = false) {
    clearEventSource();
    state.roomCode = "";
    state.seatToken = "";
    state.seat = "";
    state.snapshot = null;
    localStorage.removeItem(TRADE_SESSION_KEY);
    if (!keepStatus) {
      setTradesStatus("Monte uma sala e troque cartas em tempo real.");
    }
    if (hubView) {
      hubView.style.display = "grid";
    }
    if (roomView) {
      roomView.style.display = "none";
    }
    if (roomCodeInput) {
      roomCodeInput.value = "";
    }
  }

  async function createTradeRoom() {
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: username,
        }),
      });
      state.roomCode = String(payload.roomCode || "");
      state.seatToken = String(payload.seatToken || "");
      state.seat = String(payload.seat || "host");
      persistTradeSession();
      setTradesStatus(`Sala criada: ${state.roomCode}. Compartilhe o codigo com outro jogador.`);
      await fetchTradeState();
      connectTradeEvents();
    } catch (error) {
      setTradesStatus(error?.message || "Erro ao criar sala de troca.", true);
    }
  }

  async function joinTradeRoom() {
    const roomCode = normalizeTradeCode(roomCodeInput?.value || "");
    if (!roomCode) {
      setTradesStatus("Informe um codigo de sala valido.", true);
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode,
          playerName: username,
        }),
      });
      state.roomCode = String(payload.roomCode || roomCode);
      state.seatToken = String(payload.seatToken || "");
      state.seat = String(payload.seat || "guest");
      persistTradeSession();
      setTradesStatus(`Conectado na sala ${state.roomCode}.`);
      await fetchTradeState();
      connectTradeEvents();
    } catch (error) {
      setTradesStatus(error?.message || "Erro ao entrar na sala de troca.", true);
    }
  }

  btnTrades.addEventListener("click", () => {
    if (menuWrapper) {
      menuWrapper.classList.remove("perim-mode");
    }
    if (menuNav) {
      menuNav.style.display = "none";
    }
    if (multiplayerPanel) {
      multiplayerPanel.style.display = "none";
    }
    if (perimPanel) {
      perimPanel.style.display = "none";
    }
    tradesPanel.style.display = "block";
    void refreshTradesOnlinePlayers();
    void loadTradeWishlist();
    clearEventSource();
    if (!restoreTradeSession()) {
      if (hubView) {
        hubView.style.display = "grid";
      }
      if (roomView) {
        roomView.style.display = "none";
      }
      setTradesStatus("Monte uma sala e troque cartas em tempo real.");
      return;
    }
    setTradesStatus("Reconectando sala de troca...");
    void fetchTradeState()
      .then(() => {
        connectTradeEvents();
        setTradesStatus("Sala de troca reconectada.");
      })
      .catch((error) => {
        resetTradeState(true);
        setTradesStatus(error?.message || "Nao foi possivel reconectar a sala anterior.", true);
      });
  });

  if (btnCreateRoom) {
    btnCreateRoom.addEventListener("click", () => {
      void createTradeRoom();
    });
  }

  if (btnJoinRoom) {
    btnJoinRoom.addEventListener("click", () => {
      void joinTradeRoom();
    });
  }

  if (roomCodeInput) {
    roomCodeInput.addEventListener("input", () => {
      roomCodeInput.value = normalizeTradeCode(roomCodeInput.value || "");
    });
    roomCodeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void joinTradeRoom();
      }
    });
  }

  if (inventoryType) {
    inventoryType.addEventListener("change", () => {
      renderInventoryList();
    });
  }

  if (btnAcceptToggle) {
    btnAcceptToggle.addEventListener("click", () => {
      const seat = String(state.seat || "");
      const currentAccepted = seat === "guest"
        ? Boolean(state.snapshot?.accepted?.guest)
        : Boolean(state.snapshot?.accepted?.host);
      void sendTradeAction({
        type: "accept_set",
        accepted: !currentAccepted,
      });
    });
  }

  if (btnFinalize) {
    btnFinalize.addEventListener("click", () => {
      const seat = String(state.seat || "");
      const currentConfirm = seat === "guest"
        ? Boolean(state.snapshot?.confirmFinalize?.guest)
        : Boolean(state.snapshot?.confirmFinalize?.host);
      if (!currentConfirm) {
        void sendTradeAction({ type: "confirm_set", confirmed: true });
        return;
      }
      if (state.snapshot?.canFinalize) {
        void sendTradeAction({ type: "finalize" });
        return;
      }
      void sendTradeAction({ type: "confirm_set", confirmed: false });
    });
  }

  if (btnCancelRoom) {
    btnCancelRoom.addEventListener("click", () => {
      void sendTradeAction({ type: "cancel" });
    });
  }

  if (btnRefreshOnline) {
    btnRefreshOnline.addEventListener("click", () => {
      void refreshTradesOnlinePlayers();
    });
  }

  if (btnSaveWishlist) {
    btnSaveWishlist.addEventListener("click", () => {
      void saveTradeWishlist();
    });
  }

  if (btnTradesBack) {
    btnTradesBack.addEventListener("click", () => {
      clearEventSource();
      tradesPanel.style.display = "none";
      if (menuNav) {
        menuNav.style.display = "flex";
      }
    });
  }
}

async function initMenuMusic() {
  const toggleBtn = qs("toggle-music-panel");
  const playerSection = qs("music-player");
  const audioEl = qs("music-audio");
  const trackNameEl = qs("music-track-name");
  const btnPrev = qs("music-prev");
  const btnToggle = qs("music-toggle");
  const btnNext = qs("music-next");
  const btnLoop = qs("music-loop");
  const volumeSlider = qs("music-player-volume");
  if (!toggleBtn || !playerSection || !audioEl || !btnToggle || !volumeSlider) {
    return;
  }

  let tracks = [];
  let currentIndex = 0;
  let isLooping = false;
  let isPlaying = false;
  const setTrackStatus = (message, isError = false) => {
    if (!trackNameEl) {
      return;
    }
    trackNameEl.textContent = message;
    trackNameEl.style.color = isError ? "#ff8d8d" : "";
  };

  try {
    const res = await fetch("/api/music");
    const payload = await res.json();
    tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    if (tracks.length > 0) {
      currentIndex = Math.floor(Math.random() * tracks.length);
    }
  } catch (_) {
    tracks = [];
  }
  if (!tracks.length) {
    setTrackStatus("Nenhuma trilha encontrada no servidor compartilhado.", true);
  }

  // Load audio settings from server API (fallback to localStorage)
  let serverSettings = {};
  try {
    const settingsRes = await fetch("/api/settings");
    const settingsPayload = await settingsRes.json();
    serverSettings = settingsPayload?.settings && typeof settingsPayload.settings === "object"
      ? settingsPayload.settings
      : {};
  } catch (_) {
    serverSettings = {};
  }
  const localSettings =
    safeJsonParse(localStorage.getItem(SETTINGS_KEY), null)
    || safeJsonParse(localStorage.getItem(LEGACY_SETTINGS_KEY), {})
    || {};
  const audioConfig = serverSettings?.audio || localSettings?.audio || {};
  let audioEnabled = audioConfig.enabled !== false;
  let masterVol = Number(audioConfig.master ?? 50);
  let musicVol = Number(audioConfig.music ?? 50);

  // Persist merged settings to localStorage
  if (!localSettings.audio) localSettings.audio = {};
  localSettings.audio.enabled = audioEnabled;
  localSettings.audio.master = masterVol;
  localSettings.audio.music = musicVol;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(localSettings));
  localStorage.removeItem(LEGACY_SETTINGS_KEY);

  const applyVolume = () => {
    const effectiveVolume = audioEnabled ? (masterVol / 100) * (musicVol / 100) : 0;
    audioEl.volume = effectiveVolume;
    volumeSlider.value = String(Math.max(0, Math.min(100, musicVol)));
  };
  const updateToggleBtn = () => {
    btnToggle.innerHTML = isPlaying ? "&#9208;" : "&#9654;";
  };

  const persistAudioSettings = async () => {
    const current =
      safeJsonParse(localStorage.getItem(SETTINGS_KEY), null)
      || safeJsonParse(localStorage.getItem(LEGACY_SETTINGS_KEY), {})
      || {};
    if (!current.audio) current.audio = {};
    current.audio.enabled = audioEnabled;
    current.audio.master = masterVol;
    current.audio.music = musicVol;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
      });
    } catch (_) {
      // best-effort sync
    }
  };

  const playTrack = async () => {
    if (!tracks.length || !audioEnabled) {
      if (!tracks.length) {
        setTrackStatus("Sem trilhas disponiveis agora.", true);
      }
      return;
    }
    const track = tracks[currentIndex];
    if (!track) {
      return;
    }
    if (audioEl.src !== window.location.origin + track.url) {
      audioEl.src = track.url;
      setTrackStatus(track.name || "Tocando trilha");
    }
    applyVolume();
    try {
      await audioEl.play();
      isPlaying = true;
    } catch (error) {
      isPlaying = false;
      setTrackStatus("Clique para liberar o audio do navegador.", true);
      console.error("[MENU MUSIC] Falha ao reproduzir trilha:", {
        message: error?.message || "unknown",
        trackUrl: track?.url || "",
      });
      window.addEventListener(
        "pointerdown",
        async () => {
          if (!isPlaying) {
            await playTrack();
          }
        },
        { once: true }
      );
    }
    updateToggleBtn();
  };

  toggleBtn.addEventListener("click", () => {
    playerSection.classList.toggle("show-panel");
    if (!isPlaying && playerSection.classList.contains("show-panel")) {
      playTrack();
    }
  });

  btnToggle.addEventListener("click", () => {
    if (isPlaying) {
      audioEl.pause();
      isPlaying = false;
    } else {
      playTrack();
    }
    updateToggleBtn();
  });

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (!tracks.length) return;
      currentIndex = (currentIndex - 1 + tracks.length) % tracks.length;
      playTrack();
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      if (!tracks.length) return;
      currentIndex = (currentIndex + 1) % tracks.length;
      playTrack();
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener("input", () => {
      musicVol = Number(volumeSlider.value);
      applyVolume();
      persistAudioSettings();
    });
  }

  if (btnLoop) {
    btnLoop.addEventListener("click", () => {
      isLooping = !isLooping;
      audioEl.loop = isLooping;
      btnLoop.classList.toggle("active", isLooping);
      btnLoop.style.color = isLooping ? "#00ff88" : "";
    });
  }

  audioEl.addEventListener("ended", () => {
    if (!isLooping && btnNext) {
      btnNext.click();
    }
  });
  audioEl.addEventListener("error", () => {
    const currentSrc = audioEl.currentSrc || audioEl.src || "(sem src)";
    setTrackStatus("Falha ao carregar trilha. Tente proxima musica.", true);
    console.error("[MENU MUSIC] Erro no elemento de audio:", currentSrc);
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== SETTINGS_KEY && event.key !== LEGACY_SETTINGS_KEY) {
      return;
    }
    const data = safeJsonParse(localStorage.getItem(SETTINGS_KEY), null)
      || safeJsonParse(localStorage.getItem(LEGACY_SETTINGS_KEY), null);
    const audio = data?.audio || {};
    audioEnabled = audio.enabled !== false;
    masterVol = Number(audio.master ?? masterVol);
    musicVol = Number(audio.music ?? musicVol);
    applyVolume();
  });

  applyVolume();
  updateToggleBtn();
  if (audioEnabled) {
    playTrack();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const localSession = safeJsonParse(localStorage.getItem(DB_SESSION), null);
  if (localSession?.sessionToken) {
    setSessionToken(String(localSession.sessionToken));
  }
  let sessionData = null;
  try {
    sessionData = await fetchJsonWithTimeout("/api/auth/session", { method: "GET" }, NETWORK_TIMEOUT_MS.session);
  } catch (_) {
    sessionData = null;
  }
  if (!sessionData?.ok || !sessionData?.username) {
    localStorage.removeItem(DB_SESSION);
    clearSessionToken();
    window.location.href = toPage("auth.html");
    return;
  }

  if (sessionData.sessionToken) {
    setSessionToken(String(sessionData.sessionToken));
  }
  localStorage.setItem(
    DB_SESSION,
    JSON.stringify({
      username: String(sessionData.username),
      sessionToken: getSessionToken(),
      token: Date.now(),
    })
  );
  const username = sessionData.username || "Jogador";

  await bindProfile(username, sessionData);
  bindNavigation();
  bindMultiplayer(username);
  bindPerim(username);
  bindTrades(username);
  bindFooterActions();
  await initMenuMusic();
});



