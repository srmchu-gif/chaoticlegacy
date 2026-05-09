import { initMatrixEffect } from "./matrix.js";
import { apiUrl, clearSessionToken, getSessionToken, setSessionToken, toPage } from "./runtime-config.js";

const DB_SESSION = "chaotic_session";
const SETTINGS_KEY = "chaotic.settings.v1";
const LEGACY_SETTINGS_KEY = "chaotic_settings";
const GLOBAL_CHAT_UI_KEY = "chaotic.global_chat_ui";
const TOP50_UI_KEY = "chaotic.top50_ui";
const GLOBAL_CHAT_POS_KEY = "chaotic.global_chat_pos";
const TOP50_POS_KEY = "chaotic.top50_pos";
const GLOBAL_CHAT_OPEN_KEY = "chaotic.global_chat_open";
const TOP50_OPEN_KEY = "chaotic.top50_open";
const GLOBAL_CHAT_PIN_KEY = "chaotic.global_chat_pin";
const TOP50_PIN_KEY = "chaotic.top50_pin";
let libraryCachePromise = null;
const MENU_HOME_PANEL_DEFAULTS = Object.freeze({
  globalChatEnabled: true,
  top50Enabled: true,
});
let menuHomePanelSettings = { ...MENU_HOME_PANEL_DEFAULTS };
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

function normalizeMenuHomePanelSettings(source) {
  const raw = source && typeof source === "object" ? source : {};
  return {
    globalChatEnabled: raw.globalChatEnabled !== false,
    top50Enabled: raw.top50Enabled !== false,
  };
}

function parseStoredSettings() {
  return safeJsonParse(localStorage.getItem(SETTINGS_KEY), null)
    || safeJsonParse(localStorage.getItem(LEGACY_SETTINGS_KEY), null)
    || {};
}

async function loadMenuHomePanelSettings() {
  let serverSettings = {};
  try {
    const payload = await fetchJsonWithTimeout("/api/settings", { method: "GET" });
    serverSettings = payload?.settings && typeof payload.settings === "object" ? payload.settings : {};
  } catch (_) {
    serverSettings = {};
  }
  const localSettings = parseStoredSettings();
  const merged = normalizeMenuHomePanelSettings(
    serverSettings?.menuHomePanels && typeof serverSettings.menuHomePanels === "object"
      ? serverSettings.menuHomePanels
      : localSettings?.menuHomePanels
  );
  const patchedLocal = localSettings && typeof localSettings === "object" ? localSettings : {};
  patchedLocal.menuHomePanels = merged;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(patchedLocal));
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
  menuHomePanelSettings = merged;
  return merged;
}

function refreshMenuHomePanelSettingsFromStorage() {
  const settings = parseStoredSettings();
  menuHomePanelSettings = normalizeMenuHomePanelSettings(settings?.menuHomePanels);
  return menuHomePanelSettings;
}

function updateMainMenuSidebarVisibility() {
  const globalSidebar = qs("global-chat-sidebar");
  const top50Sidebar = qs("top50-sidebar");
  const profileGlobalChatBubble = qs("profile-global-chat-bubble");
  const profileTop50Bubble = qs("profile-top50-bubble");
  if (!globalSidebar && !top50Sidebar && !profileGlobalChatBubble && !profileTop50Bubble) {
    return;
  }
  const globalEnabled = menuHomePanelSettings.globalChatEnabled !== false;
  const top50Enabled = menuHomePanelSettings.top50Enabled !== false;
  document.body.classList.toggle("menu-global-chat-disabled", !globalEnabled);
  document.body.classList.toggle("menu-top50-disabled", !top50Enabled);
  if (profileGlobalChatBubble) {
    profileGlobalChatBubble.hidden = !globalEnabled;
  }
  if (profileTop50Bubble) {
    profileTop50Bubble.hidden = !top50Enabled;
  }
  const menuNav = qs("menu-nav");
  const dromosPanel = qs("dromos-panel");
  const perimPanel = qs("perim-panel");
  const tradesPanel = qs("trades-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const navVisible = menuNav ? getComputedStyle(menuNav).display !== "none" : false;
  const anyPanelVisible = [dromosPanel, perimPanel, tradesPanel, multiplayerPanel]
    .filter(Boolean)
    .some((panel) => getComputedStyle(panel).display !== "none");
  const showSidebars = navVisible && !anyPanelVisible && (globalEnabled || top50Enabled);
  document.body.classList.toggle("menu-sidebars-hidden", !showSidebars);
  if (globalSidebar) {
    globalSidebar.hidden = !globalEnabled;
  }
  if (top50Sidebar) {
    top50Sidebar.hidden = !top50Enabled;
  }
  window.dispatchEvent(new CustomEvent("menu:sidebar-visibility-updated", {
    detail: {
      globalEnabled,
      top50Enabled,
      navVisible,
      anyPanelVisible,
      showSidebars,
    },
  }));
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function normalizeFilterToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function normalizeTribeThemeClass(value) {
  const raw = normalizeFilterToken(value).replace(/[^a-z]/g, "");
  if (!raw) return "";
  if (raw.includes("outromundo") || raw.includes("overworld")) return "tribe-outromundo";
  if (raw.includes("submundo") || raw.includes("underworld")) return "tribe-submundo";
  if (raw.includes("danian")) return "tribe-danians";
  if (raw.includes("mipedian")) return "tribe-mipedians";
  return "";
}

function formatDurationLabel(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function setExpandedMode(enabled) {
  const menuWrapper = document.querySelector(".menu-wrapper");
  if (!menuWrapper) {
    return;
  }
  menuWrapper.classList.toggle("expanded-mode", Boolean(enabled));
}

function creatureStarsBadge(variant) {
  if (!variant || typeof variant !== "object") {
    return "";
  }
  const starsRaw = Number(variant.stars);
  const stars = Number.isFinite(starsRaw)
    ? Math.max(0, Math.min(5, starsRaw))
    : null;
  if (stars === null) {
    return "";
  }
  return `${stars.toFixed(1)}★`;
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
  const playerDromeTag = qs("player-drome-tag");
  const playerTitleTag = qs("player-title-tag");
  const avatarImg = qs("player-avatar-img");
  const avatarContainer = qs("avatar-container");
  const avatarUpload = qs("avatar-upload");
  const profileNotificationBell = qs("profile-notification-bell");
  const profileGlobalChatBubble = qs("profile-global-chat-bubble");
  const profileTop50Bubble = qs("profile-top50-bubble");
  const profileNotificationBadge = qs("profile-notification-badge");

  const profileModal = qs("profile-modal");
  const profileModalBackdrop = qs("profile-modal-backdrop");
  const profileModalClose = qs("profile-modal-close");
  const profileTabGeneralBtn = qs("profile-tab-general-btn");
  const profileTabFriendsBtn = qs("profile-tab-friends-btn");
  const profileTabNotificationsBtn = qs("profile-tab-notifications-btn");
  const profileTabGeneralPanel = qs("profile-tab-general");
  const profileTabFriendsPanel = qs("profile-tab-friends");
  const profileTabNotificationsPanel = qs("profile-tab-notifications");
  const profileNotificationsSection = qs("profile-notifications-section");
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
  const profileModalCurrentDrome = qs("profile-modal-current-drome");
  const profileModalCurrentTitle = qs("profile-modal-current-title");
  const profileNotificationsUnread = qs("profile-notifications-unread");
  const profileNotificationsList = qs("profile-notifications-list");
  const profileNotificationsReadAllBtn = qs("profile-notifications-read-all-btn");
  const profileFriendUsernameInput = qs("profile-friend-username-input");
  const profileFriendAddBtn = qs("profile-friend-add-btn");
  const profileFriendsIncoming = qs("profile-friends-incoming");
  const profileFriendsOutgoing = qs("profile-friends-outgoing");
  const profileFriendsList = qs("profile-friends-list");
  const profileFriendsSubtabListBtn = qs("profile-friends-subtab-list-btn");
  const profileFriendsSubtabRequestsBtn = qs("profile-friends-subtab-requests-btn");
  const profileFriendsSubtabList = qs("profile-friends-subtab-list");
  const profileFriendsSubtabRequests = qs("profile-friends-subtab-requests");
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
  const friendSummaryModal = qs("friend-summary-modal");
  const friendSummaryBackdrop = qs("friend-summary-backdrop");
  const friendSummaryClose = qs("friend-summary-close");
  const friendSummaryAvatar = qs("friend-summary-avatar");
  const friendSummaryName = qs("friend-summary-name");
  const friendSummaryPresence = qs("friend-summary-presence");
  const friendSummaryScore = qs("friend-summary-score");
  const friendSummaryWL = qs("friend-summary-wl");
  const friendSummaryWinrate = qs("friend-summary-winrate");
  const friendSummaryScansTotal = qs("friend-summary-scans-total");
  const friendSummaryTribe = qs("friend-summary-tribe");
  const friendSummaryDrome = qs("friend-summary-drome");
  const friendSummaryTag = qs("friend-summary-tag");
  const friendSummaryMostPlayed = qs("friend-summary-most-played");
  let profileSocialPollTimer = null;

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

  const setProfileTab = (tab) => {
    const normalizedTab = tab === "friends" || tab === "notifications" ? tab : "general";
    const isGeneral = normalizedTab === "general";
    const isFriends = normalizedTab === "friends";
    const isNotifications = normalizedTab === "notifications";
    if (profileTabGeneralBtn) {
      profileTabGeneralBtn.classList.toggle("active", isGeneral);
      profileTabGeneralBtn.setAttribute("aria-selected", isGeneral ? "true" : "false");
    }
    if (profileTabFriendsBtn) {
      profileTabFriendsBtn.classList.toggle("active", isFriends);
      profileTabFriendsBtn.setAttribute("aria-selected", isFriends ? "true" : "false");
    }
    if (profileTabNotificationsBtn) {
      profileTabNotificationsBtn.classList.toggle("active", isNotifications);
      profileTabNotificationsBtn.setAttribute("aria-selected", isNotifications ? "true" : "false");
    }
    if (profileTabGeneralPanel) {
      profileTabGeneralPanel.classList.toggle("active", isGeneral);
      profileTabGeneralPanel.setAttribute("aria-hidden", isGeneral ? "false" : "true");
    }
    if (profileTabFriendsPanel) {
      profileTabFriendsPanel.classList.toggle("active", isFriends);
      profileTabFriendsPanel.setAttribute("aria-hidden", isFriends ? "false" : "true");
    }
    if (profileTabNotificationsPanel) {
      profileTabNotificationsPanel.classList.toggle("active", isNotifications);
      profileTabNotificationsPanel.setAttribute("aria-hidden", isNotifications ? "false" : "true");
    }
  };

  const updateNotificationBell = () => {
    if (!profileNotificationBell || !profileNotificationBadge) {
      return;
    }
    const unread = Math.max(0, Number(socialState.unreadCount || 0));
    const hasUnread = unread > 0;
    profileNotificationBell.classList.toggle("has-unread", hasUnread);
    profileNotificationBell.setAttribute("aria-label", hasUnread ? `${unread} notificacoes nao lidas` : "Sem notificacoes nao lidas");
    if (!hasUnread) {
      profileNotificationBadge.classList.add("hidden");
      profileNotificationBadge.textContent = "0";
      return;
    }
    profileNotificationBadge.classList.remove("hidden");
    profileNotificationBadge.textContent = unread > 99 ? "99+" : String(unread);
  };

  const closeProfileModal = () => {
    if (!profileModal) {
      return;
    }
    if (profileSocialPollTimer) {
      clearInterval(profileSocialPollTimer);
      profileSocialPollTimer = null;
    }
    profileModal.classList.add("hidden");
    profileModal.setAttribute("aria-hidden", "true");
    if (profileNotificationsSection) {
      profileNotificationsSection.classList.remove("profile-section-focus");
    }
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

  const openProfileModal = ({ tab = "general", focusNotifications = false } = {}) => {
    if (!profileModal) {
      return;
    }
    const targetTab = focusNotifications ? "notifications" : tab;
    setProfileTab(targetTab);
    profileModal.classList.remove("hidden");
    profileModal.setAttribute("aria-hidden", "false");
    if (profileSocialPollTimer) {
      clearInterval(profileSocialPollTimer);
    }
    profileSocialPollTimer = setInterval(() => {
      void refreshProfileSocial({ silent: true });
    }, 20000);
  };

  const socialState = {
    notifications: [],
    unreadCount: 0,
    incoming: [],
    outgoing: [],
    friends: [],
  };

  const formatDateTimeLabel = (value) => {
    if (!value) {
      return "-";
    }
    try {
      return new Date(value).toLocaleString("pt-BR");
    } catch {
      return String(value);
    }
  };

  const setFriendsSubtab = (tab) => {
    const normalized = tab === "requests" ? "requests" : "list";
    const isList = normalized === "list";
    const isRequests = normalized === "requests";
    if (profileFriendsSubtabListBtn) {
      profileFriendsSubtabListBtn.classList.toggle("active", isList);
      profileFriendsSubtabListBtn.setAttribute("aria-selected", isList ? "true" : "false");
    }
    if (profileFriendsSubtabRequestsBtn) {
      profileFriendsSubtabRequestsBtn.classList.toggle("active", isRequests);
      profileFriendsSubtabRequestsBtn.setAttribute("aria-selected", isRequests ? "true" : "false");
    }
    if (profileFriendsSubtabList) {
      profileFriendsSubtabList.classList.toggle("active", isList);
      profileFriendsSubtabList.setAttribute("aria-hidden", isList ? "false" : "true");
    }
    if (profileFriendsSubtabRequests) {
      profileFriendsSubtabRequests.classList.toggle("active", isRequests);
      profileFriendsSubtabRequests.setAttribute("aria-hidden", isRequests ? "false" : "true");
    }
  };

  const closeFriendSummaryModal = () => {
    if (!friendSummaryModal) {
      return;
    }
    friendSummaryModal.classList.add("hidden");
    friendSummaryModal.setAttribute("aria-hidden", "true");
  };

  const openFriendSummaryModal = (friend) => {
    if (!friendSummaryModal || !friend) {
      return;
    }
    const friendSummaryCard = friendSummaryModal.querySelector(".friend-summary-card");
    if (friendSummaryCard) {
      friendSummaryCard.classList.remove("tribe-outromundo", "tribe-submundo", "tribe-danians", "tribe-mipedians");
      const tribeClass = normalizeTribeThemeClass(friend.favoriteTribe);
      if (tribeClass) {
        friendSummaryCard.classList.add(tribeClass);
      }
    }
    if (friendSummaryAvatar) {
      friendSummaryAvatar.src = String(friend.avatar || "/fundo%20cartas.png");
    }
    if (friendSummaryName) {
      friendSummaryName.textContent = String(friend.username || "Amigo");
    }
    if (friendSummaryPresence) {
      friendSummaryPresence.textContent = `${formatFriendPresenceLabel(friend.presence)} • ${formatFriendPresenceDetail(friend.presence)}`;
    }
    if (friendSummaryScore) {
      friendSummaryScore.textContent = String(Number(friend.score || 0));
    }
    if (friendSummaryWL) {
      friendSummaryWL.textContent = `${Number(friend.wins || 0)} / ${Number(friend.losses || 0)}`;
    }
    if (friendSummaryWinrate) {
      friendSummaryWinrate.textContent = `${Number(friend.winRate || 0).toFixed(2).replace(/\.00$/, "")}%`;
    }
    if (friendSummaryScansTotal) {
      friendSummaryScansTotal.textContent = String(Number(friend?.scans?.total || 0));
    }
    if (friendSummaryTribe) {
      friendSummaryTribe.textContent = String(friend.favoriteTribe || "Sem Tribo");
    }
    if (friendSummaryDrome) {
      friendSummaryDrome.textContent = String(friend.currentDrome?.name || "-");
    }
    if (friendSummaryTag) {
      friendSummaryTag.textContent = String(friend.currentTagTitle || "-");
    }
    if (friendSummaryMostPlayed) {
      if (friend?.mostPlayedCreature?.name) {
        friendSummaryMostPlayed.textContent = `${friend.mostPlayedCreature.name} (${Number(friend.mostPlayedCreature.count || 0)} usos)`;
      } else {
        friendSummaryMostPlayed.textContent = "Nenhum dado ainda.";
      }
    }
    friendSummaryModal.classList.remove("hidden");
    friendSummaryModal.setAttribute("aria-hidden", "false");
  };

  const renderNotifications = () => {
    updateNotificationBell();
    if (profileNotificationsUnread) {
      profileNotificationsUnread.textContent = `${Number(socialState.unreadCount || 0)} nao lidas`;
    }
    if (!profileNotificationsList) {
      return;
    }
    const notifications = Array.isArray(socialState.notifications) ? socialState.notifications : [];
    if (!notifications.length) {
      profileNotificationsList.innerHTML = '<div class="trades-empty">Nenhuma notificacao por enquanto.</div>';
      return;
    }
    profileNotificationsList.innerHTML = notifications
      .map((entry) => {
        const unreadClass = entry?.isRead ? "" : " unread";
        const button = entry?.isRead
          ? ""
          : `<button class="menu-btn ghost-btn" data-profile-notification-read="${Number(entry.id || 0)}" style="padding:0.25rem 0.45rem;">Lida</button>`;
        return `
          <div class="profile-notification-item${unreadClass}">
            <strong>${escapeHtml(entry?.title || "Notificacao")}</strong>
            <p>${escapeHtml(entry?.message || "")}</p>
            <small>${escapeHtml(formatDateTimeLabel(entry?.createdAt))}</small>
            ${button}
          </div>
        `;
      })
      .join("");
    profileNotificationsList.querySelectorAll("[data-profile-notification-read]").forEach((button) => {
      button.addEventListener("click", async () => {
        const id = Number(button.getAttribute("data-profile-notification-read") || 0);
        if (!id) {
          return;
        }
        try {
          const payload = await fetchJsonWithTimeout("/api/profile/notifications/read-one", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id }),
          });
          socialState.notifications = socialState.notifications.map((entry) => (
            Number(entry?.id || 0) === id ? { ...entry, isRead: true } : entry
          ));
          socialState.unreadCount = Math.max(0, Number(payload?.unreadCount || 0));
          renderNotifications();
        } catch (error) {
          alert(error?.message || "Falha ao marcar notificacao como lida.");
        }
      });
    });
  };

  const renderFriendRequests = () => {
    if (profileFriendsIncoming) {
      const incoming = Array.isArray(socialState.incoming) ? socialState.incoming : [];
      if (!incoming.length) {
        profileFriendsIncoming.innerHTML = '<div class="trades-empty">Sem pedidos pendentes.</div>';
      } else {
        profileFriendsIncoming.innerHTML = incoming
          .map((entry) => `
            <div class="profile-friend-row">
              <div class="profile-friend-meta">
                <strong>${escapeHtml(entry?.fromUsername || entry?.fromOwnerKey || "Jogador")}</strong>
                <span>${escapeHtml(formatDateTimeLabel(entry?.createdAt))}</span>
              </div>
              <div class="profile-friend-actions">
                <button class="menu-btn primary-btn" data-friend-accept="${Number(entry?.requestId || 0)}" style="padding:0.25rem 0.45rem;">Aceitar</button>
                <button class="menu-btn ghost-btn" data-friend-reject="${Number(entry?.requestId || 0)}" style="padding:0.25rem 0.45rem;">Recusar</button>
              </div>
            </div>
          `)
          .join("");
      }
      profileFriendsIncoming.querySelectorAll("[data-friend-accept]").forEach((button) => {
        button.addEventListener("click", () => {
          const requestId = Number(button.getAttribute("data-friend-accept") || 0);
          if (!requestId) return;
          void respondFriendRequest(requestId, "accept");
        });
      });
      profileFriendsIncoming.querySelectorAll("[data-friend-reject]").forEach((button) => {
        button.addEventListener("click", () => {
          const requestId = Number(button.getAttribute("data-friend-reject") || 0);
          if (!requestId) return;
          void respondFriendRequest(requestId, "reject");
        });
      });
    }

    if (profileFriendsOutgoing) {
      const outgoing = Array.isArray(socialState.outgoing) ? socialState.outgoing : [];
      if (!outgoing.length) {
        profileFriendsOutgoing.innerHTML = '<div class="trades-empty">Nenhum pedido enviado.</div>';
      } else {
        profileFriendsOutgoing.innerHTML = outgoing
          .map((entry) => `
            <div class="profile-friend-row">
              <div class="profile-friend-meta">
                <strong>${escapeHtml(entry?.toUsername || entry?.toOwnerKey || "Jogador")}</strong>
                <span>${escapeHtml(formatDateTimeLabel(entry?.createdAt))}</span>
              </div>
              <div class="profile-friend-actions">
                <span style="font-size:0.66rem;color:#9ec7de;">Aguardando</span>
              </div>
            </div>
          `)
          .join("");
      }
    }
  };

  const normalizePresenceStatus = (presence) => {
    const status = String(presence?.status || "").toLowerCase();
    if (status === "em_troca" || status === "em_perim" || status === "online") {
      return status;
    }
    return "offline";
  };

  const formatFriendPresenceLabel = (presence) => {
    const status = normalizePresenceStatus(presence);
    if (status === "em_troca") {
      return "Em troca";
    }
    if (status === "em_perim") {
      return "Em perim";
    }
    if (status === "online") {
      return "Online";
    }
    return "Offline";
  };

  const formatFriendPresenceDetail = (presence) => {
    const status = normalizePresenceStatus(presence);
    if (status === "em_perim") {
      const locationName = String(presence?.locationName || "-");
      const actionLabel = String(presence?.actionLabel || "-");
      return `Perim: ${locationName} • Acao: ${actionLabel}`;
    }
    if (status === "em_troca") {
      return "Negociando cartas agora";
    }
    if (status === "online") {
      return "Disponivel para convite direto";
    }
    return "Fora da sessao";
  };

  const renderFriendsList = () => {
    if (!profileFriendsList) {
      return;
    }
    const friends = Array.isArray(socialState.friends) ? socialState.friends : [];
    if (!friends.length) {
      profileFriendsList.innerHTML = '<div class="trades-empty">Voce ainda nao adicionou amigos.</div>';
      return;
    }
    profileFriendsList.innerHTML = friends
      .map((entry) => `
        <div class="profile-friend-row">
          <div class="profile-friend-meta">
            <strong>${escapeHtml(entry?.username || entry?.ownerKey || "Jogador")}</strong>
            <span>Pontuacao ${Number(entry?.score || 0)} • W/L ${Number(entry?.wins || 0)}/${Number(entry?.losses || 0)} • WR ${Number(entry?.winRate || 0).toFixed(2).replace(/\.00$/, "")}%</span>
            <span>Tribo: ${escapeHtml(entry?.favoriteTribe || "-")}</span>
            <span class="profile-friend-presence status-${escapeAttr(normalizePresenceStatus(entry?.presence))}">${escapeHtml(formatFriendPresenceLabel(entry?.presence))}</span>
            <span>${escapeHtml(formatFriendPresenceDetail(entry?.presence))}</span>
          </div>
          <div class="profile-friend-actions">
            <button class="menu-btn ghost-btn" data-friend-view="${escapeAttr(entry?.username || "")}" style="padding:0.25rem 0.45rem;">Ver perfil</button>
            <button class="menu-btn ghost-btn" data-friend-remove="${escapeAttr(entry?.username || "")}" style="padding:0.25rem 0.45rem;">Remover</button>
          </div>
        </div>
      `)
      .join("");
    profileFriendsList.querySelectorAll("[data-friend-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const friendUsername = String(button.getAttribute("data-friend-view") || "").trim();
        if (!friendUsername) return;
        void previewFriendProfile(friendUsername);
      });
    });
    profileFriendsList.querySelectorAll("[data-friend-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        const friendUsername = String(button.getAttribute("data-friend-remove") || "").trim();
        if (!friendUsername) return;
        void removeFriend(friendUsername);
      });
    });
  };

  async function previewFriendProfile(friendUsername) {
    try {
      const payload = await fetchJsonWithTimeout(
        `/api/profile/friends/${encodeURIComponent(friendUsername)}/summary`,
        { method: "GET" }
      );
      const friend = payload?.friend || null;
      if (!friend) {
        alert("Nao foi possivel carregar o perfil do amigo.");
        return;
      }
      openFriendSummaryModal(friend);
    } catch (error) {
      alert(error?.message || "Falha ao carregar perfil do amigo.");
    }
  }

  async function refreshProfileSocial({ silent = false } = {}) {
    try {
      const [notificationsPayload, friendsPayload, requestsPayload, presencePayload] = await Promise.all([
        fetchJsonWithTimeout("/api/profile/notifications?limit=30", { method: "GET" }),
        fetchJsonWithTimeout("/api/profile/friends", { method: "GET" }),
        fetchJsonWithTimeout("/api/profile/friends/requests", { method: "GET" }),
        fetchJsonWithTimeout("/api/profile/friends/presence", { method: "GET" }),
      ]);
      socialState.notifications = Array.isArray(notificationsPayload?.notifications) ? notificationsPayload.notifications : [];
      socialState.unreadCount = Math.max(0, Number(notificationsPayload?.unreadCount || 0));
      const presenceMap = presencePayload?.presence && typeof presencePayload.presence === "object"
        ? presencePayload.presence
        : {};
      const friends = Array.isArray(friendsPayload?.friends) ? friendsPayload.friends : [];
      socialState.friends = friends.map((entry) => {
        const ownerKey = normalizeUsername(entry?.ownerKey || entry?.username || "");
        return {
          ...entry,
          presence: presenceMap[ownerKey] || { status: "offline" },
        };
      });
      socialState.incoming = Array.isArray(requestsPayload?.incoming) ? requestsPayload.incoming : [];
      socialState.outgoing = Array.isArray(requestsPayload?.outgoing) ? requestsPayload.outgoing : [];
      renderNotifications();
      renderFriendRequests();
      renderFriendsList();
    } catch (error) {
      if (!silent) {
        alert(error?.message || "Falha ao carregar dados sociais do perfil.");
      }
    }
  }

  async function respondFriendRequest(requestId, decision) {
    try {
      const payload = await fetchJsonWithTimeout("/api/profile/friends/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, decision }),
      });
      socialState.friends = Array.isArray(payload?.friends) ? payload.friends : socialState.friends;
      socialState.incoming = Array.isArray(payload?.requests?.incoming) ? payload.requests.incoming : socialState.incoming;
      socialState.outgoing = Array.isArray(payload?.requests?.outgoing) ? payload.requests.outgoing : socialState.outgoing;
      renderFriendRequests();
      renderFriendsList();
      await refreshProfileSocial();
    } catch (error) {
      alert(error?.message || "Falha ao responder pedido de amizade.");
    }
  }

  async function addFriendByUsername() {
    const value = String(profileFriendUsernameInput?.value || "").trim();
    if (!value) {
      alert("Informe o username exato para enviar convite.");
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/profile/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value }),
      });
      if (profileFriendUsernameInput) {
        profileFriendUsernameInput.value = "";
      }
      await refreshProfileSocial();
    } catch (error) {
      alert(error?.message || "Falha ao enviar convite de amizade.");
    }
  }

  async function removeFriend(friendUsername) {
    if (!friendUsername) {
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/profile/friends/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: friendUsername }),
      });
      await refreshProfileSocial();
    } catch (error) {
      alert(error?.message || "Falha ao remover amigo.");
    }
  }

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
    const currentDromeName = String(profile?.currentDrome?.name || "-");
    const currentTagTitle = String(profile?.currentTagTitle || "-");

    // Apply tribe theme to profile modal card and avatar
    const tribeClass = normalizeTribeThemeClass(profile.favoriteTribe || currentUser?.tribe || "");
    const modalCardEl = profileModal?.querySelector(".profile-modal-card");
    if (modalCardEl) {
      modalCardEl.classList.remove("tribe-outromundo", "tribe-submundo", "tribe-danians", "tribe-mipedians");
      if (tribeClass) modalCardEl.classList.add(tribeClass);
    }
    if (avatarContainer) {
      avatarContainer.classList.remove("tribe-outromundo", "tribe-submundo", "tribe-danians", "tribe-mipedians");
      if (tribeClass) avatarContainer.classList.add(tribeClass);
    }

    if (nameEl) nameEl.textContent = displayName;
    if (scoreEl) scoreEl.textContent = String(score);
    if (playerDromeTag) playerDromeTag.textContent = `Dromo: ${currentDromeName}`;
    if (playerTitleTag) playerTitleTag.textContent = `Tag: ${currentTagTitle}`;
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
    if (profileModalCurrentDrome) profileModalCurrentDrome.textContent = currentDromeName;
    if (profileModalCurrentTitle) profileModalCurrentTitle.textContent = currentTagTitle;
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
    const avatarTribeClass = normalizeTribeThemeClass(currentUser.tribe);
    if (avatarTribeClass) {
      avatarContainer.classList.add(avatarTribeClass);
    }
  }

  if (avatarContainer) {
    avatarContainer.addEventListener("click", async () => {
      try {
        await Promise.all([
          refreshProfile(),
          refreshProfileSocial(),
        ]);
        openProfileModal({ tab: "general" });
      } catch (error) {
        alert(error?.message || "Falha ao carregar perfil.");
      }
    });
  }
  if (profileNotificationBell) {
    profileNotificationBell.addEventListener("click", async () => {
      try {
        await Promise.all([
          refreshProfile(),
          refreshProfileSocial(),
        ]);
        openProfileModal({ tab: "notifications" });
      } catch (error) {
        alert(error?.message || "Falha ao carregar notificacoes.");
      }
    });
  }
  if (profileGlobalChatBubble) {
    profileGlobalChatBubble.addEventListener("click", () => {
      if (menuHomePanelSettings.globalChatEnabled === false) {
        return;
      }
      window.dispatchEvent(new CustomEvent("menu:toggle-global-chat"));
    });
  }
  if (profileTop50Bubble) {
    profileTop50Bubble.addEventListener("click", () => {
      if (menuHomePanelSettings.top50Enabled === false) {
        return;
      }
      window.dispatchEvent(new CustomEvent("menu:toggle-top50"));
    });
  }
  if (profileTabGeneralBtn) {
    profileTabGeneralBtn.addEventListener("click", () => setProfileTab("general"));
  }
  if (profileTabFriendsBtn) {
    profileTabFriendsBtn.addEventListener("click", () => setProfileTab("friends"));
  }
  if (profileTabNotificationsBtn) {
    profileTabNotificationsBtn.addEventListener("click", () => setProfileTab("notifications"));
  }
  if (profileFriendsSubtabListBtn) {
    profileFriendsSubtabListBtn.addEventListener("click", () => setFriendsSubtab("list"));
  }
  if (profileFriendsSubtabRequestsBtn) {
    profileFriendsSubtabRequestsBtn.addEventListener("click", () => setFriendsSubtab("requests"));
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
    if (event.key === "Escape" && friendSummaryModal && !friendSummaryModal.classList.contains("hidden")) {
      closeFriendSummaryModal();
    }
  });

  if (profileCardClose) {
    profileCardClose.addEventListener("click", closeProfileCardModal);
  }
  if (profileCardBackdrop) {
    profileCardBackdrop.addEventListener("click", closeProfileCardModal);
  }
  if (friendSummaryClose) {
    friendSummaryClose.addEventListener("click", closeFriendSummaryModal);
  }
  if (friendSummaryBackdrop) {
    friendSummaryBackdrop.addEventListener("click", closeFriendSummaryModal);
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

  if (profileNotificationsReadAllBtn) {
    profileNotificationsReadAllBtn.addEventListener("click", async () => {
      try {
        const payload = await fetchJsonWithTimeout("/api/profile/notifications/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        socialState.notifications = socialState.notifications.map((entry) => ({ ...entry, isRead: true }));
        socialState.unreadCount = Math.max(0, Number(payload?.unreadCount || 0));
        renderNotifications();
      } catch (error) {
        alert(error?.message || "Falha ao marcar notificacoes.");
      }
    });
  }

  if (profileFriendAddBtn) {
    profileFriendAddBtn.addEventListener("click", () => {
      void addFriendByUsername();
    });
  }

  if (profileFriendUsernameInput) {
    profileFriendUsernameInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void addFriendByUsername();
      }
    });
  }

  try {
    await Promise.all([
      refreshProfile(),
      refreshProfileSocial(),
    ]);
    setProfileTab("general");
    setFriendsSubtab("list");
  } catch {
    if (nameEl) nameEl.textContent = username;
    if (scoreEl) scoreEl.textContent = "1200";
    if (winrateEl) winrateEl.textContent = "0%";
    updateNotificationBell();
  }
}

function bindSidePanels(username) {
  const globalSidebar = qs("global-chat-sidebar");
  const globalPinBtn = qs("global-chat-pin");
  const globalStateEl = qs("global-chat-state");
  const globalMessagesEl = qs("global-chat-messages");
  const globalInputEl = qs("global-chat-input");
  const globalSendBtn = qs("global-chat-send");

  const top50Sidebar = qs("top50-sidebar");
  const top50PinBtn = qs("top50-pin");
  const top50StateEl = qs("top50-state");
  const top50ListEl = qs("top50-list");
  const top50TabScore = qs("top50-tab-score");
  const top50TabScans = qs("top50-tab-scans");

  let chatEventSource = null;
  const chatState = {
    isEnabled: menuHomePanelSettings.globalChatEnabled !== false,
    isHomeVisible: !document.body.classList.contains("menu-sidebars-hidden"),
    isOpen: false,
    isPinned: false,
    position: null,
    isDragging: false,
    streamConnected: false,
    messages: [],
  };
  const rankingState = {
    isEnabled: menuHomePanelSettings.top50Enabled !== false,
    isHomeVisible: !document.body.classList.contains("menu-sidebars-hidden"),
    isOpen: false,
    isPinned: false,
    position: null,
    metric: "score",
  };

  const formatMessageTime = (value) => {
    const parsed = new Date(value || Date.now());
    if (Number.isNaN(parsed.getTime())) {
      return "--:--";
    }
    return parsed.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const readBool = (key, fallback = false) => {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined || raw === "") {
      return fallback;
    }
    return raw === "true";
  };

  const writeBool = (key, value) => {
    localStorage.setItem(key, value ? "true" : "false");
  };

  const readLegacyOpenFromCollapsed = (key, fallback = false) => {
    const parsed = safeJsonParse(localStorage.getItem(key), null);
    if (parsed && typeof parsed === "object" && typeof parsed.collapsed === "boolean") {
      return !parsed.collapsed;
    }
    return fallback;
  };

  const isMobileExclusiveSidebarMode = () => window.matchMedia("(max-width: 480px)").matches;
  const isSidebarDragEnabled = () => !isMobileExclusiveSidebarMode();
  const isMainMenuHomeVisible = () => !document.body.classList.contains("menu-sidebars-hidden");

  const readPanelPosition = (key) => {
    const parsed = safeJsonParse(localStorage.getItem(key), null);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const left = Number(parsed.left);
    const top = Number(parsed.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }
    return { left, top };
  };

  const writePanelPosition = (key, position) => {
    if (!position || !Number.isFinite(Number(position.left)) || !Number.isFinite(Number(position.top))) {
      return;
    }
    localStorage.setItem(
      key,
      JSON.stringify({
        left: Math.round(Number(position.left)),
        top: Math.round(Number(position.top)),
        updatedAt: Date.now(),
      })
    );
  };

  const clearInlineSidebarPosition = (sidebar) => {
    if (!sidebar) return;
    sidebar.style.left = "";
    sidebar.style.top = "";
    sidebar.style.right = "";
    sidebar.style.bottom = "";
  };

  const clampPanelPosition = (sidebar, rawLeft, rawTop) => {
    const margin = 8;
    const rect = sidebar.getBoundingClientRect();
    const width = Math.max(120, Number(rect.width || sidebar.offsetWidth || 0));
    const height = Math.max(120, Number(rect.height || sidebar.offsetHeight || 0));
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(margin, window.innerHeight - height - margin);
    return {
      left: Math.min(maxLeft, Math.max(margin, Number(rawLeft || 0))),
      top: Math.min(maxTop, Math.max(margin, Number(rawTop || 0))),
    };
  };

  const getDefaultAnchoredPanelPosition = (sidebar, side = "left") => {
    const menuAnchor = document.querySelector(".menu-panel") || document.querySelector(".menu-wrapper");
    const anchorRect = menuAnchor?.getBoundingClientRect?.() || null;
    const sidebarRect = sidebar.getBoundingClientRect();
    const width = Math.max(120, Number(sidebarRect.width || sidebar.offsetWidth || 0));
    const height = Math.max(120, Number(sidebarRect.height || sidebar.offsetHeight || 0));
    if (!anchorRect) {
      const rawLeftFallback = side === "right" ? window.innerWidth - width - 12 : 12;
      return clampPanelPosition(sidebar, rawLeftFallback, 12);
    }
    const rawTop = Number(anchorRect.top || 0) - height - 12;
    const rawLeft = side === "right"
      ? Number(anchorRect.right || 0) - width
      : Number(anchorRect.left || 0);
    return clampPanelPosition(sidebar, rawLeft, rawTop);
  };

  const applyPanelPosition = (sidebar, key, side) => {
    if (!sidebar) return;
    if (!isSidebarDragEnabled()) {
      clearInlineSidebarPosition(sidebar);
      return;
    }
    const stored = readPanelPosition(key);
    const clamped = stored && Number.isFinite(stored.left) && Number.isFinite(stored.top)
      ? clampPanelPosition(sidebar, stored.left, stored.top)
      : getDefaultAnchoredPanelPosition(sidebar, side);
    if (!clamped) return;
    sidebar.style.left = `${clamped.left}px`;
    sidebar.style.top = `${clamped.top}px`;
    sidebar.style.right = "auto";
    sidebar.style.bottom = "auto";
  };

  const persistCurrentPanelPosition = (sidebar, key) => {
    if (!sidebar || !isSidebarDragEnabled()) {
      return;
    }
    const rect = sidebar.getBoundingClientRect();
    const clamped = clampPanelPosition(sidebar, rect.left, rect.top);
    writePanelPosition(key, clamped);
    sidebar.style.left = `${clamped.left}px`;
    sidebar.style.top = `${clamped.top}px`;
    sidebar.style.right = "auto";
    sidebar.style.bottom = "auto";
  };

  const applyPanelOpenState = (sidebar, isOpen) => {
    if (!sidebar) return;
    sidebar.classList.toggle("is-open", Boolean(isOpen));
    sidebar.classList.toggle("is-closed", !isOpen);
    sidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
  };

  const applyPinButtonState = (button, pinned) => {
    if (!button) return;
    button.setAttribute("aria-pressed", pinned ? "true" : "false");
    button.textContent = pinned ? "Fixo" : "Pin";
    button.title = pinned ? "Desfixar posicao" : "Fixar posicao";
  };

  const bindPanelInteractionGuard = (sidebar) => {
    if (!sidebar) return;
    const stop = (event) => {
      event.stopPropagation();
    };
    sidebar.addEventListener("click", stop);
    sidebar.addEventListener("pointerdown", stop);
  };

  const closeGlobalChatStream = () => {
    if (chatEventSource) {
      try {
        chatEventSource.close();
      } catch (_) {}
      chatEventSource = null;
    }
    chatState.streamConnected = false;
  };

  const applyChatOpenState = () => {
    const shouldOpen = chatState.isEnabled && chatState.isHomeVisible && chatState.isOpen;
    applyPanelOpenState(globalSidebar, shouldOpen);
    if (!shouldOpen) {
      closeGlobalChatStream();
    }
  };

  const applyTop50OpenState = () => {
    const shouldOpen = rankingState.isEnabled && rankingState.isHomeVisible && rankingState.isOpen;
    applyPanelOpenState(top50Sidebar, shouldOpen);
  };

  const renderGlobalMessages = (messages) => {
    if (!globalMessagesEl) return;
    const list = Array.isArray(messages) ? messages.slice(-120) : [];
    chatState.messages = list;
    if (!list.length) {
      globalMessagesEl.innerHTML = '<div class="trades-empty">Sem mensagens no chat global.</div>';
      return;
    }
    globalMessagesEl.innerHTML = list.map((entry) => `
      <article class="side-panel-chat-msg">
        <strong>${escapeHtml(entry?.username || "Jogador")}</strong>
        <span>${escapeHtml(entry?.message || "")}</span>
        <small>${escapeHtml(formatMessageTime(entry?.createdAt || Date.now()))}</small>
      </article>
    `).join("");
    globalMessagesEl.scrollTop = globalMessagesEl.scrollHeight;
  };

  const connectGlobalEvents = () => {
    if (!globalStateEl) return;
    closeGlobalChatStream();
    chatEventSource = new EventSource(apiUrl("/api/chat/global/events"));
    chatState.streamConnected = true;
    chatEventSource.onmessage = (event) => {
      const payload = safeJsonParse(event.data, null);
      if (!payload) return;
      if (payload.type === "global_chat_snapshot") {
        renderGlobalMessages(payload.messages || []);
        globalStateEl.textContent = "Chat global online.";
        return;
      }
      if (payload.type === "global_chat_message" && payload.message) {
        renderGlobalMessages(chatState.messages.concat([payload.message]).slice(-120));
      }
    };
    chatEventSource.onerror = () => {
      chatState.streamConnected = false;
      if (globalStateEl) {
        globalStateEl.textContent = "Conexao instavel no chat global.";
      }
    };
  };

  const refreshGlobalChat = async (connectStream = true) => {
    if (!globalStateEl) return;
    try {
      const payload = await fetchJsonWithTimeout("/api/chat/global?limit=120", { method: "GET" });
      renderGlobalMessages(payload?.messages || []);
      globalStateEl.textContent = "Chat global online.";
      if (connectStream) {
        connectGlobalEvents();
      }
    } catch (error) {
      if (globalStateEl) {
        globalStateEl.textContent = error?.message || "Falha ao carregar chat global.";
      }
    }
  };

  const sendGlobalChatMessage = async () => {
    const message = String(globalInputEl?.value || "").trim();
    if (!message) return;
    try {
      if (globalSendBtn) globalSendBtn.disabled = true;
      await fetchJsonWithTimeout("/api/chat/global", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (globalInputEl) globalInputEl.value = "";
    } catch (error) {
      if (globalStateEl) {
        globalStateEl.textContent = error?.message || "Falha ao enviar mensagem.";
      }
    } finally {
      if (globalSendBtn) globalSendBtn.disabled = false;
    }
  };

  const renderTop50 = (players) => {
    if (!top50ListEl) return;
    const list = Array.isArray(players) ? players : [];
    if (!list.length) {
      top50ListEl.innerHTML = '<div class="trades-empty">Sem dados de ranking.</div>';
      return;
    }
    const valueLabel = rankingState.metric === "scans" ? "Scans" : "Score";
    top50ListEl.innerHTML = list.map((entry) => `
      <article class="top50-row">
        <img src="${escapeAttr(entry?.avatar || "/fundo%20cartas.png")}" alt="${escapeAttr(entry?.username || "Jogador")}" />
        <div>
          <strong>#${Number(entry?.rank || 0)} ${escapeHtml(entry?.username || "-")}</strong>
          <span>${valueLabel}: ${rankingState.metric === "scans" ? Number(entry?.totalScans || 0) : Number(entry?.score || 0)}</span>
          <span>Dromo: ${escapeHtml(entry?.currentDrome?.name || "-")}</span>
        </div>
      </article>
    `).join("");
  };

  const refreshTop50 = async () => {
    if (!top50StateEl) return;
    try {
      const payload = await fetchJsonWithTimeout(`/api/leaderboards/top50?metric=${encodeURIComponent(rankingState.metric)}`, { method: "GET" });
      renderTop50(payload?.players || []);
      top50StateEl.textContent = rankingState.metric === "scans" ? "Top 50 por scans." : "Top 50 por pontuacao.";
    } catch (error) {
      top50StateEl.textContent = error?.message || "Falha ao carregar top 50.";
      if (top50ListEl) top50ListEl.innerHTML = "";
    }
  };

  const setChatOpen = (nextOpen, persist = true) => {
    chatState.isOpen = Boolean(nextOpen);
    if (persist) {
      writeBool(GLOBAL_CHAT_OPEN_KEY, chatState.isOpen);
    }
    applyChatOpenState();
    if (chatState.isOpen && chatState.isEnabled && chatState.isHomeVisible) {
      void refreshGlobalChat(true);
    }
  };

  const setTop50Open = (nextOpen, persist = true) => {
    rankingState.isOpen = Boolean(nextOpen);
    if (persist) {
      writeBool(TOP50_OPEN_KEY, rankingState.isOpen);
    }
    applyTop50OpenState();
    if (rankingState.isOpen && rankingState.isEnabled && rankingState.isHomeVisible) {
      void refreshTop50();
    }
  };

  const toggleGlobalPanel = (eventOrOptions = null) => {
    const eventType = String(eventOrOptions?.type || "");
    const bypassHiddenGuard = eventType === "menu:toggle-global-chat" || Boolean(eventOrOptions?.bypassHiddenGuard);
    if (!chatState.isEnabled) {
      return;
    }
    if (!bypassHiddenGuard && !chatState.isHomeVisible) {
      return;
    }
    const nextOpen = !chatState.isOpen;
    if (nextOpen && isMobileExclusiveSidebarMode() && rankingState.isOpen) {
      setTop50Open(false, true);
    }
    setChatOpen(nextOpen, true);
  };

  const toggleTop50Panel = (eventOrOptions = null) => {
    const eventType = String(eventOrOptions?.type || "");
    const bypassHiddenGuard = eventType === "menu:toggle-top50" || Boolean(eventOrOptions?.bypassHiddenGuard);
    if (!rankingState.isEnabled) {
      return;
    }
    if (!bypassHiddenGuard && !rankingState.isHomeVisible) {
      return;
    }
    const nextOpen = !rankingState.isOpen;
    if (nextOpen && isMobileExclusiveSidebarMode() && chatState.isOpen) {
      setChatOpen(false, true);
    }
    setTop50Open(nextOpen, true);
  };

  const bindSidebarDrag = (sidebar, key, side, canDrag) => {
    if (!sidebar) return;
    let dragging = false;
    let dragIntent = false;
    let offsetX = 0;
    let offsetY = 0;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    const DRAG_THRESHOLD_PX = 5;

    const moveHandler = (event) => {
      if (!dragIntent) return;
      if (!dragging) {
        const deltaX = Math.abs(event.clientX - startX);
        const deltaY = Math.abs(event.clientY - startY);
        if (deltaX < DRAG_THRESHOLD_PX && deltaY < DRAG_THRESHOLD_PX) {
          return;
        }
        dragging = true;
        sidebar.classList.add("is-dragging");
      }
      const clamped = clampPanelPosition(sidebar, event.clientX - offsetX, event.clientY - offsetY);
      sidebar.style.left = `${clamped.left}px`;
      sidebar.style.top = `${clamped.top}px`;
      sidebar.style.right = "auto";
      sidebar.style.bottom = "auto";
    };

    const finishHandler = () => {
      if (!dragIntent) return;
      dragIntent = false;
      sidebar.classList.remove("is-drag-armed");
      if (pointerId !== null) {
        try {
          sidebar.releasePointerCapture(pointerId);
        } catch (_) {}
      }
      pointerId = null;
      if (dragging) {
        dragging = false;
        sidebar.classList.remove("is-dragging");
        const rect = sidebar.getBoundingClientRect();
        const clamped = clampPanelPosition(sidebar, rect.left, rect.top);
        sidebar.style.left = `${clamped.left}px`;
        sidebar.style.top = `${clamped.top}px`;
        sidebar.style.right = "auto";
        sidebar.style.bottom = "auto";
        writePanelPosition(key, clamped);
        if (side === "left") {
          chatState.position = clamped;
          chatState.isDragging = false;
        } else {
          rankingState.position = clamped;
        }
      }
    };

    sidebar.addEventListener("pointerdown", (event) => {
      if (!isSidebarDragEnabled() || event.button !== 0 || !canDrag()) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const dragHandle = target?.closest(".side-panel-header, .side-panel-head-row");
      if (!dragHandle || !sidebar.contains(dragHandle)) {
        return;
      }
      if (target && target.closest("button, input, textarea, select, a, label, [contenteditable='true']")) {
        return;
      }
      const rect = sidebar.getBoundingClientRect();
      dragging = false;
      dragIntent = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      const clamped = clampPanelPosition(sidebar, rect.left, rect.top);
      sidebar.style.left = `${clamped.left}px`;
      sidebar.style.top = `${clamped.top}px`;
      sidebar.style.right = "auto";
      sidebar.style.bottom = "auto";
      sidebar.classList.add("is-drag-armed");
      if (side === "left") {
        chatState.isDragging = true;
      }
      offsetX = event.clientX - clamped.left;
      offsetY = event.clientY - clamped.top;
      try {
        sidebar.setPointerCapture(pointerId);
      } catch (_) {}
    });

    sidebar.addEventListener("pointermove", moveHandler);
    sidebar.addEventListener("pointerup", finishHandler);
    sidebar.addEventListener("pointercancel", finishHandler);
    window.addEventListener("pointerup", finishHandler);
  };

  const syncPanelVisibilityFromContext = (homeVisibleOverride = null) => {
    const nextHomeVisible = typeof homeVisibleOverride === "boolean"
      ? homeVisibleOverride
      : isMainMenuHomeVisible();
    const wasChatVisible = chatState.isHomeVisible;
    const wasTopVisible = rankingState.isHomeVisible;
    chatState.isEnabled = menuHomePanelSettings.globalChatEnabled !== false;
    rankingState.isEnabled = menuHomePanelSettings.top50Enabled !== false;
    chatState.isHomeVisible = nextHomeVisible;
    rankingState.isHomeVisible = nextHomeVisible;
    applyChatOpenState();
    applyTop50OpenState();
    if (chatState.isOpen && chatState.isEnabled && chatState.isHomeVisible && (!wasChatVisible || !chatState.streamConnected)) {
      void refreshGlobalChat(true);
    }
    if (rankingState.isOpen && rankingState.isEnabled && rankingState.isHomeVisible && !wasTopVisible) {
      void refreshTop50();
    }
  };

  chatState.isOpen = readBool(GLOBAL_CHAT_OPEN_KEY, readLegacyOpenFromCollapsed(GLOBAL_CHAT_UI_KEY, false));
  chatState.isPinned = readBool(GLOBAL_CHAT_PIN_KEY, false);
  chatState.position = readPanelPosition(GLOBAL_CHAT_POS_KEY);
  rankingState.isOpen = readBool(TOP50_OPEN_KEY, readLegacyOpenFromCollapsed(TOP50_UI_KEY, false));
  rankingState.isPinned = readBool(TOP50_PIN_KEY, false);
  rankingState.position = readPanelPosition(TOP50_POS_KEY);
  writeBool(GLOBAL_CHAT_OPEN_KEY, chatState.isOpen);
  writeBool(TOP50_OPEN_KEY, rankingState.isOpen);
  writeBool(GLOBAL_CHAT_PIN_KEY, chatState.isPinned);
  writeBool(TOP50_PIN_KEY, rankingState.isPinned);

  applyPinButtonState(globalPinBtn, chatState.isPinned);
  applyPinButtonState(top50PinBtn, rankingState.isPinned);
  bindPanelInteractionGuard(globalSidebar);
  bindPanelInteractionGuard(top50Sidebar);
  applyPanelPosition(globalSidebar, GLOBAL_CHAT_POS_KEY, "left");
  applyPanelPosition(top50Sidebar, TOP50_POS_KEY, "right");
  syncPanelVisibilityFromContext();
  bindSidebarDrag(globalSidebar, GLOBAL_CHAT_POS_KEY, "left", () => chatState.isOpen && !chatState.isPinned);
  bindSidebarDrag(top50Sidebar, TOP50_POS_KEY, "right", () => rankingState.isOpen && !rankingState.isPinned);
  if (chatState.isOpen && chatState.isEnabled && chatState.isHomeVisible) {
    void refreshGlobalChat(true);
  }
  if (rankingState.isOpen && rankingState.isEnabled && rankingState.isHomeVisible) {
    void refreshTop50();
  }

  if (globalPinBtn) {
    globalPinBtn.addEventListener("click", () => {
      chatState.isPinned = !chatState.isPinned;
      writeBool(GLOBAL_CHAT_PIN_KEY, chatState.isPinned);
      applyPinButtonState(globalPinBtn, chatState.isPinned);
      if (chatState.isPinned) {
        persistCurrentPanelPosition(globalSidebar, GLOBAL_CHAT_POS_KEY);
      }
    });
  }
  if (top50PinBtn) {
    top50PinBtn.addEventListener("click", () => {
      rankingState.isPinned = !rankingState.isPinned;
      writeBool(TOP50_PIN_KEY, rankingState.isPinned);
      applyPinButtonState(top50PinBtn, rankingState.isPinned);
      if (rankingState.isPinned) {
        persistCurrentPanelPosition(top50Sidebar, TOP50_POS_KEY);
      }
    });
  }

  if (globalSendBtn) {
    globalSendBtn.addEventListener("click", () => {
      void sendGlobalChatMessage();
    });
  }
  if (globalInputEl) {
    globalInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void sendGlobalChatMessage();
      }
    });
  }

  if (top50TabScore) {
    top50TabScore.addEventListener("click", () => {
      rankingState.metric = "score";
      top50TabScore.classList.add("active");
      if (top50TabScans) top50TabScans.classList.remove("active");
      void refreshTop50();
    });
  }
  if (top50TabScans) {
    top50TabScans.addEventListener("click", () => {
      rankingState.metric = "scans";
      top50TabScans.classList.add("active");
      if (top50TabScore) top50TabScore.classList.remove("active");
      void refreshTop50();
    });
  }

  updateMainMenuSidebarVisibility();
  const onResize = () => {
    updateMainMenuSidebarVisibility();
    if (chatState.isOpen) {
      applyPanelPosition(globalSidebar, GLOBAL_CHAT_POS_KEY, "left");
    }
    if (rankingState.isOpen) {
      applyPanelPosition(top50Sidebar, TOP50_POS_KEY, "right");
    }
  };

  const sidebarVisibilityHandler = (event) => {
    const detail = event?.detail || {};
    const nextHomeVisible = typeof detail.navVisible === "boolean" && typeof detail.anyPanelVisible === "boolean"
      ? (detail.navVisible && !detail.anyPanelVisible)
      : isMainMenuHomeVisible();
    syncPanelVisibilityFromContext(nextHomeVisible);
  };

  const storageHandler = (event) => {
    if (
      event.key !== SETTINGS_KEY
      && event.key !== LEGACY_SETTINGS_KEY
      && event.key !== GLOBAL_CHAT_OPEN_KEY
      && event.key !== TOP50_OPEN_KEY
      && event.key !== GLOBAL_CHAT_PIN_KEY
      && event.key !== TOP50_PIN_KEY
      && event.key !== GLOBAL_CHAT_POS_KEY
      && event.key !== TOP50_POS_KEY
    ) {
      return;
    }
    if (event.key === GLOBAL_CHAT_OPEN_KEY) {
      chatState.isOpen = readBool(GLOBAL_CHAT_OPEN_KEY, chatState.isOpen);
      syncPanelVisibilityFromContext();
      return;
    }
    if (event.key === TOP50_OPEN_KEY) {
      rankingState.isOpen = readBool(TOP50_OPEN_KEY, rankingState.isOpen);
      syncPanelVisibilityFromContext();
      return;
    }
    if (event.key === GLOBAL_CHAT_PIN_KEY) {
      chatState.isPinned = readBool(GLOBAL_CHAT_PIN_KEY, chatState.isPinned);
      applyPinButtonState(globalPinBtn, chatState.isPinned);
      return;
    }
    if (event.key === TOP50_PIN_KEY) {
      rankingState.isPinned = readBool(TOP50_PIN_KEY, rankingState.isPinned);
      applyPinButtonState(top50PinBtn, rankingState.isPinned);
      return;
    }
    if (event.key === GLOBAL_CHAT_POS_KEY) {
      if (chatState.isOpen) {
        applyPanelPosition(globalSidebar, GLOBAL_CHAT_POS_KEY, "left");
      }
      return;
    }
    if (event.key === TOP50_POS_KEY) {
      if (rankingState.isOpen) {
        applyPanelPosition(top50Sidebar, TOP50_POS_KEY, "right");
      }
      return;
    }
    refreshMenuHomePanelSettingsFromStorage();
    updateMainMenuSidebarVisibility();
    syncPanelVisibilityFromContext();
  };

  window.addEventListener("resize", onResize);
  window.addEventListener("menu:toggle-global-chat", toggleGlobalPanel);
  window.addEventListener("menu:toggle-top50", toggleTop50Panel);
  window.addEventListener("menu:sidebar-visibility-updated", sidebarVisibilityHandler);
  window.addEventListener("storage", storageHandler);

  window.addEventListener("beforeunload", () => {
    window.removeEventListener("resize", onResize);
    window.removeEventListener("menu:toggle-global-chat", toggleGlobalPanel);
    window.removeEventListener("menu:toggle-top50", toggleTop50Panel);
    window.removeEventListener("menu:sidebar-visibility-updated", sidebarVisibilityHandler);
    window.removeEventListener("storage", storageHandler);
    closeGlobalChatStream();
  });
}

function bindNavigation() {
  const btnBuilder = qs("btn-builder");
  const btnSettings = qs("btn-settings");

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
  const dromosPanel = qs("dromos-panel");
  const perimPanel = qs("perim-panel");
  const tradesPanel = qs("trades-panel");
  const mpRoomsList = qs("mp-rooms-list");
  const selMpRulesMode = qs("mp-rules-mode");
  const statusEl = qs("mp-status");
  const createdRoomEl = qs("mp-created-room");
  const btnMpCreateOpen = qs("btn-mp-create-open");
  const selMpFriend = qs("mp-friend-select");
  const selMpFriendRulesMode = qs("mp-friend-rules-mode");
  const incomingInvitesEl = qs("mp-incoming-invites");
  const outgoingInvitesEl = qs("mp-outgoing-invites");

  const btnMultiplayer = qs("btn-multiplayer");
  const btnMpBack = qs("btn-mp-back");
  const btnMpConfirmCreate = qs("btn-mp-confirm-create");
  const btnMpRefreshRooms = qs("btn-mp-refresh-rooms");
  const btnMpSendFriendInvite = qs("btn-mp-send-friend-invite");
  const btnMpRefreshFriendInvites = qs("btn-mp-refresh-friend-invites");

  let invitePollTimer = null;
  let activeRoomSession = null;

  function stopInvitePolling() {
    if (invitePollTimer) {
      clearInterval(invitePollTimer);
      invitePollTimer = null;
    }
  }

  function startInvitePolling() {
    stopInvitePolling();
    invitePollTimer = setInterval(() => {
      void refreshFriendOptions(true);
      void refreshCasualInvites(true);
      void renderRoomList(true);
    }, 15000);
  }

  function setStatus(text, isError = false) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = String(text || "");
    statusEl.style.color = isError ? "#ff8e8e" : "#88b5d5";
  }

  function selectedRulesMode(selectEl) {
    const value = String(selectEl?.value || "").trim().toLowerCase();
    return ["casual", "competitive", "1v1"].includes(value) ? value : "competitive";
  }

  function renderCreatedRoomSession() {
    if (!createdRoomEl) {
      return;
    }
    if (!activeRoomSession?.roomId) {
      createdRoomEl.style.display = "none";
      createdRoomEl.innerHTML = "";
      if (btnMpCreateOpen) {
        btnMpCreateOpen.style.display = "none";
      }
      return;
    }
    createdRoomEl.style.display = "grid";
    const modeLabel = activeRoomSession.rulesMode === "casual"
      ? "Casual"
      : activeRoomSession.rulesMode === "1v1"
        ? "1v1"
        : "Competitivo";
    createdRoomEl.innerHTML = `
      <div class="dromos-row">
        <strong>Sala criada: ${escapeHtml(activeRoomSession.roomId)}</strong>
        <span>Modo ${modeLabel} • Aguardando oponente para abrir pre-combate.</span>
      </div>
    `;
    if (btnMpCreateOpen) {
      btnMpCreateOpen.style.display = "inline-flex";
    }
  }

  function openActiveRoom() {
    if (!activeRoomSession?.roomId) {
      return;
    }
    window.location.href = buildMultiplayerBattleUrl({
      roomId: activeRoomSession.roomId,
      seat: activeRoomSession.seat || "host",
      seatToken: activeRoomSession.seatToken || "",
    });
  }

  async function refreshFriendOptions(silent = false) {
    if (!selMpFriend) {
      return;
    }
    try {
      const [friendsPayload, presencePayload] = await Promise.all([
        fetchJsonWithTimeout("/api/profile/friends", { method: "GET" }),
        fetchJsonWithTimeout("/api/profile/friends/presence", { method: "GET" }),
      ]);
      const presenceMap = presencePayload?.presence && typeof presencePayload.presence === "object"
        ? presencePayload.presence
        : {};
      const friends = Array.isArray(friendsPayload?.friends) ? friendsPayload.friends : [];
      const onlineFriends = friends.filter((entry) => {
        const ownerKey = normalizeUsername(entry?.ownerKey || entry?.username || "");
        const status = String(presenceMap?.[ownerKey]?.status || "offline").toLowerCase();
        return status === "online";
      });
      if (!onlineFriends.length) {
        selMpFriend.innerHTML = '<option value="">Nenhum amigo online</option>';
        return;
      }
      selMpFriend.innerHTML = onlineFriends
        .map((entry) => `<option value="${escapeAttr(entry?.username || "")}">${escapeHtml(entry?.username || entry?.ownerKey || "Amigo")}</option>`)
        .join("");
    } catch (error) {
      if (!silent) {
        alert(error?.message || "Falha ao carregar amigos online.");
      }
      selMpFriend.innerHTML = '<option value="">Erro ao carregar amigos</option>';
    }
  }

  function renderCasualInvites(payload) {
    const incoming = Array.isArray(payload?.incoming) ? payload.incoming : [];
    const outgoing = Array.isArray(payload?.outgoing) ? payload.outgoing : [];
    if (incomingInvitesEl) {
      if (!incoming.length) {
        incomingInvitesEl.innerHTML = '<div class="trades-empty">Sem convites recebidos.</div>';
      } else {
        incomingInvitesEl.innerHTML = incoming.map((entry) => `
          <div class="trades-invite-row">
            <strong>${escapeHtml(entry.hostUsername || entry.hostKey || "Jogador")}</strong>
            <span>${escapeHtml(entry.status || "pending")} • expira em ${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min</span>
            <div class="trades-invite-actions">
              <button class="menu-btn primary-btn" data-mp-invite-accept="${escapeAttr(entry.inviteId)}">Aceitar</button>
              <button class="menu-btn ghost-btn" data-mp-invite-reject="${escapeAttr(entry.inviteId)}">Recusar</button>
            </div>
          </div>
        `).join("");
      }
      incomingInvitesEl.querySelectorAll("[data-mp-invite-accept]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-mp-invite-accept") || "").trim();
          if (!inviteId) return;
          void respondCasualInvite(inviteId, "accept");
        });
      });
      incomingInvitesEl.querySelectorAll("[data-mp-invite-reject]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-mp-invite-reject") || "").trim();
          if (!inviteId) return;
          void respondCasualInvite(inviteId, "reject");
        });
      });
    }
    if (outgoingInvitesEl) {
      if (!outgoing.length) {
        outgoingInvitesEl.innerHTML = '<div class="trades-empty">Sem convites enviados.</div>';
      } else {
        outgoingInvitesEl.innerHTML = outgoing.map((entry) => {
          const canJoin = Boolean(entry?.room?.roomId && entry?.status === "accepted");
          return `
            <div class="trades-invite-row">
              <strong>${escapeHtml(entry.targetUsername || entry.targetKey || "Amigo")}</strong>
              <span>${escapeHtml(entry.status || "pending")} • expira em ${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min</span>
              <div class="trades-invite-actions">
                ${entry.status === "pending"
                  ? `<button class="menu-btn ghost-btn" data-mp-invite-cancel="${escapeAttr(entry.inviteId)}">Cancelar</button>`
                  : ""}
                ${canJoin
                  ? `<button class="menu-btn primary-btn" data-mp-invite-join="${escapeAttr(entry.inviteId)}">Entrar</button>`
                  : ""}
              </div>
            </div>
          `;
        }).join("");
      }
      outgoingInvitesEl.querySelectorAll("[data-mp-invite-cancel]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-mp-invite-cancel") || "").trim();
          if (!inviteId) return;
          void respondCasualInvite(inviteId, "cancel");
        });
      });
      outgoingInvitesEl.querySelectorAll("[data-mp-invite-join]").forEach((button) => {
        button.addEventListener("click", async () => {
          const inviteId = String(button.getAttribute("data-mp-invite-join") || "").trim();
          if (!inviteId) return;
          const payload = await fetchJsonWithTimeout("/api/multiplayer/invites", { method: "GET" });
          const invites = Array.isArray(payload?.outgoing) ? payload.outgoing : [];
          const invite = invites.find((entry) => String(entry?.inviteId || "") === inviteId);
          const room = invite?.room || null;
          if (!room?.roomId || !room?.hostSeatToken) return;
          window.location.href = buildMultiplayerBattleUrl({
            roomId: room.roomId,
            seat: "host",
            seatToken: room.hostSeatToken,
          });
        });
      });
    }
  }

  async function refreshCasualInvites(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/multiplayer/invites", { method: "GET" });
      renderCasualInvites(payload);
    } catch (error) {
      if (!silent) {
        alert(error?.message || "Falha ao carregar convites multiplayer.");
      }
    }
  }

  async function sendCasualInvite() {
    const friendUsername = String(selMpFriend?.value || "").trim();
    const rulesMode = selectedRulesMode(selMpFriendRulesMode);
    if (!friendUsername) {
      alert("Selecione um amigo online.");
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/multiplayer/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendUsername,
          rulesMode,
        }),
      });
      await refreshCasualInvites(true);
      setStatus("Convite enviado com sucesso.");
    } catch (error) {
      setStatus(error?.message || "Falha ao enviar convite.", true);
    }
  }

  async function respondCasualInvite(inviteId, decision) {
    try {
      const payloadBody = {
        inviteId,
        decision,
      };
      const payload = await fetchJsonWithTimeout("/api/multiplayer/invites/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadBody),
      });
      await refreshCasualInvites(true);
      if (decision === "accept" && payload?.room?.roomId) {
        window.location.href = buildMultiplayerBattleUrl({
          roomId: payload.room.roomId,
          seat: payload.room.seat || "guest",
          seatToken: payload.room.seatToken || "",
        });
      }
    } catch (error) {
      setStatus(error?.message || "Falha ao responder convite.", true);
    }
  }

  async function renderRoomList(silent = false) {
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
        const isOwnRoom = normalizeUsername(room.hostUsername || room.hostName || "") === normalizeUsername(username);
        const statusLabel = room.status || `${room.occupancy || "1/2"} jogadores`;
        const phaseLabel = room.phase === "in_game"
          ? "Em jogo"
          : room.phase === "finished"
            ? "Finalizada"
            : room.phase === "deck_select"
              ? "Pre-combate"
              : "Aguardando";
        textDiv.innerHTML = `<strong>ID: ${room.id}${isOwnRoom ? " (Sua sala)" : ""}</strong><br><small>Host: ${room.hostName} | Regra: ${modeLabel} | ${statusLabel} | ${phaseLabel}</small>`;
        roomDiv.appendChild(textDiv);

        const actionBtn = document.createElement("button");
        actionBtn.style.padding = "0.3rem 0.6rem";
        const occupancy = String(room.occupancy || "1/2");
        const roomPhase = String(room.phase || "lobby");
        if (isOwnRoom && activeRoomSession?.roomId === room.id) {
          actionBtn.className = "menu-btn standard-btn";
          actionBtn.textContent = "Abrir";
          actionBtn.addEventListener("click", () => {
            openActiveRoom();
          });
        } else if (occupancy !== "2/2" && roomPhase === "lobby" && !isOwnRoom) {
          actionBtn.className = "menu-btn primary-btn";
          actionBtn.textContent = "Entrar";
          actionBtn.addEventListener("click", async () => {
            try {
              const joinPayload = await fetchJsonWithTimeout(`/api/multiplayer/rooms/${encodeURIComponent(room.id)}/join`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  spectator: false,
                  username: normalizeUsername(username),
                  playerName: username,
                }),
              });
              window.location.href = buildMultiplayerBattleUrl({
                roomId: room.id,
                seat: joinPayload.seat || "guest",
                seatToken: joinPayload.seatToken || "",
              });
            } catch (error) {
              setStatus(error?.message || "Falha ao entrar na sala.", true);
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
    } catch (error) {
      mpRoomsList.innerHTML = '<div style="text-align:center; color:#ff6a5c;">Erro ao buscar salas.</div>';
      if (!silent) {
        setStatus(error?.message || "Falha ao carregar salas multiplayer.", true);
      }
    }
  }

  async function createRoom() {
    if (!btnMpConfirmCreate) {
      return;
    }
    const mode = selectedRulesMode(selMpRulesMode);
    btnMpConfirmCreate.disabled = true;
    setStatus("Criando sala...", false);
    try {
      const payload = await fetchJsonWithTimeout("/api/multiplayer/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizeUsername(username),
          playerName: username,
          rulesMode: mode,
        }),
      });
      activeRoomSession = {
        roomId: String(payload.roomId || ""),
        seat: String(payload.seat || "host"),
        seatToken: String(payload.seatToken || ""),
        rulesMode: mode,
      };
      renderCreatedRoomSession();
      await renderRoomList(true);
      setStatus("Sala criada. Compartilhe o ID e abra a sala quando quiser.", false);
    } catch (error) {
      setStatus(error?.message || "Falha ao criar partida multiplayer.", true);
    } finally {
      btnMpConfirmCreate.disabled = false;
    }
  }

  if (btnMultiplayer) {
    btnMultiplayer.addEventListener("click", async () => {
      setExpandedMode(true);
      if (menuNav) menuNav.style.display = "none";
      if (dromosPanel) dromosPanel.style.display = "none";
      if (perimPanel) perimPanel.style.display = "none";
      if (tradesPanel) tradesPanel.style.display = "none";
      if (mpPanel) mpPanel.style.display = "block";
      updateMainMenuSidebarVisibility();
      setStatus("Carregando multiplayer...");
      renderCreatedRoomSession();
      await Promise.all([
        refreshFriendOptions(true),
        refreshCasualInvites(true),
        renderRoomList(true),
      ]);
      setStatus("Escolha um modo, crie sua sala ou entre em uma sala aberta.");
      startInvitePolling();
    });
  }

  if (btnMpBack) {
    btnMpBack.addEventListener("click", () => {
      stopInvitePolling();
      setExpandedMode(false);
      if (mpPanel) mpPanel.style.display = "none";
      if (menuNav) menuNav.style.display = "flex";
      updateMainMenuSidebarVisibility();
    });
  }

  if (btnMpConfirmCreate) {
    btnMpConfirmCreate.addEventListener("click", () => {
      void createRoom();
    });
  }

  if (btnMpCreateOpen) {
    btnMpCreateOpen.addEventListener("click", () => {
      openActiveRoom();
    });
  }

  if (btnMpRefreshRooms) {
    btnMpRefreshRooms.addEventListener("click", () => {
      void renderRoomList();
    });
  }

  if (btnMpSendFriendInvite) {
    btnMpSendFriendInvite.addEventListener("click", () => {
      void sendCasualInvite();
    });
  }

  if (btnMpRefreshFriendInvites) {
    btnMpRefreshFriendInvites.addEventListener("click", () => {
      void refreshFriendOptions();
      void refreshCasualInvites();
      void renderRoomList();
    });
  }

}

function bindDromos(username) {
  const menuNav = qs("menu-nav");
  const btnDromos = qs("btn-dromos");
  const btnDromosBack = qs("btn-dromos-back");
  const dromosPanel = qs("dromos-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const perimPanel = qs("perim-panel");
  const tradesPanel = qs("trades-panel");
  const statusEl = qs("dromos-status");
  const seasonSummaryEl = qs("dromos-season-summary");
  const selectCardEl = qs("dromos-select-card");
  const codemasterCardEl = qs("dromos-codemaster-card");
  const selectDromeEl = qs("dromos-select-drome");
  const leaderboardDromeEl = qs("dromos-leaderboard-drome");
  const codemasterDromeEl = qs("dromos-codemaster-drome");
  const codemasterDeckEl = qs("dromos-codemaster-deck");
  const challengeUsernameEl = qs("dromos-challenge-username");
  const leaderboardListEl = qs("dromos-leaderboard-list");
  const incomingInvitesEl = qs("dromos-incoming-invites");
  const outgoingInvitesEl = qs("dromos-outgoing-invites");
  const liveListEl = qs("dromos-live-list");
  const rankedQueueStateEl = qs("dromos-ranked-queue-state");
  const btnSelect = qs("btn-dromos-select");
  const btnLeaderboardRefresh = qs("btn-dromos-leaderboard-refresh");
  const btnRankedCreate = qs("btn-dromos-ranked-create");
  const btnRankedCancel = qs("btn-dromos-ranked-cancel");
  const btnCodemasterLock = qs("btn-dromos-codemaster-lock");
  const btnChallengeInvite = qs("btn-dromos-challenge-invite");
  const dromosTabButtons = Array.from(dromosPanel?.querySelectorAll?.("[data-dromos-tab]") || []);
  const dromosTabPanels = {
    season: qs("dromos-tab-season"),
    ranked: qs("dromos-tab-ranked"),
    leaderboard: qs("dromos-tab-leaderboard"),
    live: qs("dromos-tab-live"),
  };

  if (!btnDromos || !dromosPanel) {
    return;
  }

  const state = {
    seasonKey: "",
    dromes: [],
    selection: null,
    invites: { incoming: [], outgoing: [] },
    rankedQueue: null,
    rankedMatchedRoom: null,
    overview: null,
    pollTimer: null,
    activeTab: "season",
  };

  const setStatus = (text, isError = false) => {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = String(text || "");
    statusEl.style.color = isError ? "#ff8d8d" : "#88b5d5";
  };

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function setDromosTab(tabRaw) {
    const nextTab = ["season", "ranked", "leaderboard", "live"].includes(String(tabRaw || ""))
      ? String(tabRaw)
      : "season";
    state.activeTab = nextTab;
    dromosTabButtons.forEach((button) => {
      const tab = String(button.getAttribute("data-dromos-tab") || "");
      const active = tab === nextTab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(dromosTabPanels).forEach(([tab, panel]) => {
      if (!panel) {
        return;
      }
      const active = tab === nextTab;
      panel.classList.toggle("active", active);
      panel.setAttribute("aria-hidden", active ? "false" : "true");
    });
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
      void refreshOverview(true);
      void refreshLiveFights(true);
      void refreshInvites(true);
      void refreshRankedQueueState(true);
    }, 20000);
  }

  function dromeOptionsHtml(dromes, selectedId = "") {
    const options = Array.isArray(dromes) ? dromes : [];
    if (!options.length) {
      return '<option value="">Sem Dromos</option>';
    }
    return options
      .map((entry) => `<option value="${escapeAttr(entry.id)}" ${entry.id === selectedId ? "selected" : ""}>${escapeHtml(entry.name || entry.id)}</option>`)
      .join("");
  }

  function renderSeasonSummary() {
    if (!seasonSummaryEl) {
      return;
    }
    const overview = state.overview || {};
    const selection = overview.selection || null;
    const myStats = overview.mySelectedStats || null;
    const myTag = overview.myTag || null;
    const fallbackTag = String(overview?.myFallbackTag || "");
    const tagLabel = String(myTag?.title || fallbackTag || "-");
    const rows = [
      `Temporada: ${escapeHtml(overview.seasonKey || "-")}`,
      `Dromo selecionado: ${escapeHtml(selection?.dromeName || selection?.dromeId || "-")}`,
      `Pontuacao atual: ${myStats ? Number(myStats.score || 0) : 0}`,
      `W/L: ${myStats ? `${Number(myStats.wins || 0)} / ${Number(myStats.losses || 0)}` : "0 / 0"}`,
      `Tag atual: ${escapeHtml(tagLabel)}`,
    ];
    seasonSummaryEl.innerHTML = rows.map((row) => `<span>${row}</span>`).join("");
    if (selectCardEl) {
      selectCardEl.style.display = overview?.showSelectDrome ? "grid" : "none";
    }
    if (codemasterCardEl) {
      codemasterCardEl.style.display = overview?.showCodemasterActions ? "grid" : "none";
    }
  }

  function renderInvitesList() {
    const incoming = Array.isArray(state.invites?.incoming) ? state.invites.incoming : [];
    const outgoing = Array.isArray(state.invites?.outgoing) ? state.invites.outgoing : [];
    if (incomingInvitesEl) {
      if (!incoming.length) {
        incomingInvitesEl.innerHTML = '<div class="trades-empty">Nenhum convite recebido.</div>';
      } else {
        incomingInvitesEl.innerHTML = incoming.map((entry) => {
          const canJoin = Boolean(entry?.room?.roomId && (entry?.room?.phase === "lobby" || entry?.room?.phase === "in_game"));
          return `
            <div class="dromos-row">
              <strong>${escapeHtml(entry.codemasterUsername || entry.codemasterKey || "CodeMaster")}</strong>
              <span>${escapeHtml(entry.dromeName || entry.dromeId || "-")} • ${escapeHtml(String(entry.status || "pending"))}</span>
              <span>Expira em ${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min</span>
              <div class="dromos-row-actions">
                <button class="menu-btn primary-btn" data-dromos-invite-accept="${escapeAttr(entry.inviteId)}">Aceitar</button>
                <button class="menu-btn ghost-btn" data-dromos-invite-reject="${escapeAttr(entry.inviteId)}">Recusar</button>
                ${canJoin ? `<button class="menu-btn ghost-btn" data-dromos-invite-join="${escapeAttr(entry.inviteId)}">Entrar</button>` : ""}
              </div>
            </div>
          `;
        }).join("");
      }
      incomingInvitesEl.querySelectorAll("[data-dromos-invite-accept]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-dromos-invite-accept") || "").trim();
          if (!inviteId) return;
          void acceptChallengeInvite(inviteId);
        });
      });
      incomingInvitesEl.querySelectorAll("[data-dromos-invite-reject]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-dromos-invite-reject") || "").trim();
          if (!inviteId) return;
          void respondChallengeInvite(inviteId, "reject");
        });
      });
      incomingInvitesEl.querySelectorAll("[data-dromos-invite-join]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-dromos-invite-join") || "").trim();
          if (!inviteId) return;
          const invite = incoming.find((entry) => String(entry?.inviteId || "") === inviteId);
          const room = invite?.room || null;
          if (!room?.roomId) return;
          window.location.href = buildMultiplayerBattleUrl({
            roomId: room.roomId,
            seat: "guest",
            seatToken: room.seatToken || "",
          });
        });
      });
    }
    if (outgoingInvitesEl) {
      if (!outgoing.length) {
        outgoingInvitesEl.innerHTML = '<div class="trades-empty">Nenhum convite enviado.</div>';
      } else {
        outgoingInvitesEl.innerHTML = outgoing.map((entry) => `
          <div class="dromos-row">
            <strong>${escapeHtml(entry.challengerUsername || entry.challengerKey || "Desafiante")}</strong>
            <span>${escapeHtml(entry.dromeName || entry.dromeId || "-")} • ${escapeHtml(String(entry.status || "pending"))}</span>
            <span>Expira em ${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min</span>
          </div>
        `).join("");
      }
    }
  }

  async function refreshInvites(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/challenges/invites", { method: "GET" });
      state.invites = {
        incoming: Array.isArray(payload?.incoming) ? payload.incoming : [],
        outgoing: Array.isArray(payload?.outgoing) ? payload.outgoing : [],
      };
      renderInvitesList();
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || "Falha ao carregar convites de desafio.", true);
      }
    }
  }

  async function refreshLeaderboard() {
    const dromeId = String(leaderboardDromeEl?.value || "").trim();
    if (!dromeId) {
      if (leaderboardListEl) {
        leaderboardListEl.innerHTML = '<div class="trades-empty">Selecione um Dromo.</div>';
      }
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout(`/api/dromos/${encodeURIComponent(dromeId)}/leaderboard`, { method: "GET" });
      const codemaster = payload?.codemaster || null;
      const entries = Array.isArray(payload?.leaderboard) ? payload.leaderboard : [];
      const blocks = [];
      if (codemaster) {
        blocks.push(`
          <div class="dromos-row">
            <strong>CodeMaster: ${escapeHtml(codemaster.username || codemaster.ownerKey || "-")}</strong>
            <span>${escapeHtml(codemaster.dromeName || "-")} • Deck ${codemaster.deckLocked ? "travado" : "nao travado"}</span>
            <span>Tag: CodeMaster ${escapeHtml(codemaster.dromeName || "")}</span>
          </div>
        `);
      }
      if (!entries.length) {
        blocks.push('<div class="trades-empty">Ainda sem partidas neste Dromo.</div>');
      } else {
        blocks.push(...entries.map((entry) => `
          <div class="dromos-row">
            <strong>#${Number(entry.rank || 0)} ${escapeHtml(entry.username || "-")}</strong>
            <span>Score ${Number(entry.score || 0)} • W/L ${Number(entry.wins || 0)}/${Number(entry.losses || 0)}</span>
            <span>${escapeHtml(entry.title || "-")}</span>
          </div>
        `));
      }
      if (leaderboardListEl) {
        leaderboardListEl.innerHTML = blocks.join("");
      }
    } catch (error) {
      if (leaderboardListEl) {
        leaderboardListEl.innerHTML = '<div class="trades-empty">Falha ao carregar leaderboard.</div>';
      }
      setStatus(error?.message || "Falha ao carregar leaderboard.", true);
    }
  }

  async function refreshLiveFights(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/live", { method: "GET" });
      const rooms = Array.isArray(payload?.rooms) ? payload.rooms : [];
      if (!liveListEl) {
        return;
      }
      if (!rooms.length) {
        liveListEl.innerHTML = '<div class="trades-empty">Nenhuma luta de Dromo ativa no momento.</div>';
        return;
      }
      liveListEl.innerHTML = rooms.map((entry) => `
        <article class="dromos-live-card">
          <strong>${entry.highlight ? "[CodeMaster] " : ""}${escapeHtml(entry.dromeName || "-")} • ${escapeHtml(entry.matchType || "-")}</strong>
          <div class="dromos-live-versus">
            <div class="dromos-live-player">
              <img src="${escapeAttr(entry.hostAvatar || "/fundo%20cartas.png")}" alt="${escapeAttr(entry.hostName || "Host")}" />
              <div>
                <strong>${escapeHtml(entry.hostName || "Host")}</strong>
                <span>Score ${Number(entry.hostScore || 0)} • ${escapeHtml(entry.hostDeckName || "-")}</span>
                <span>${escapeHtml(entry.hostMessage || `${entry.hostName || "Host"} esta jogando de ${entry.hostDeckName || "-"}`)}</span>
              </div>
            </div>
            <div class="dromos-live-x">X</div>
            <div class="dromos-live-player">
              <img src="${escapeAttr(entry.guestAvatar || "/fundo%20cartas.png")}" alt="${escapeAttr(entry.guestName || "Guest")}" />
              <div>
                <strong>${escapeHtml(entry.guestName || "Guest")}</strong>
                <span>Score ${Number(entry.guestScore || 0)} • ${escapeHtml(entry.guestDeckName || "-")}</span>
                <span>${escapeHtml(entry.guestMessage || `${entry.guestName || "Guest"} esta jogando de ${entry.guestDeckName || "-"}`)}</span>
              </div>
            </div>
          </div>
          <div class="dromos-row-actions">
            <button class="menu-btn ghost-btn" data-dromos-watch-room="${escapeAttr(entry.roomId)}">Assistir</button>
          </div>
        </article>
      `).join("");
      liveListEl.querySelectorAll("[data-dromos-watch-room]").forEach((button) => {
        button.addEventListener("click", () => {
          const roomId = String(button.getAttribute("data-dromos-watch-room") || "").trim();
          if (!roomId) return;
          window.location.href = buildMultiplayerBattleUrl({ roomId, seat: "spectator" });
        });
      });
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || "Falha ao carregar lutas ao vivo.", true);
      }
    }
  }

  function renderRankedQueueState() {
    if (!rankedQueueStateEl) {
      return;
    }
    const matchedRoom = state.rankedMatchedRoom || null;
    if (matchedRoom?.roomId) {
      rankedQueueStateEl.innerHTML = `
        <div class="dromos-row">
          <strong>Partida encontrada!</strong>
          <span>Dromo ${escapeHtml(matchedRoom.dromeId || state.selection?.dromeId || "-")} • entrando no combate...</span>
        </div>
      `;
      return;
    }
    const queue = state.rankedQueue;
    if (!queue) {
      rankedQueueStateEl.innerHTML = '<div class="trades-empty">Clique em "Buscar ranked". O deck sera escolhido no pre-combate apos encontrar oponente.</div>';
      return;
    }
    rankedQueueStateEl.innerHTML = `
      <div class="dromos-row">
        <strong>Buscando oponente...</strong>
        <span>Dromo: ${escapeHtml(queue.dromeName || queue.dromeId || "-")}</span>
        <span>Tempo: ${Math.max(0, Math.floor(Number(queue.waitMs || 0) / 1000))}s • Faixa: ±${Number(queue.range || 0)} • Posicao: ${Number(queue.position || 1)}</span>
      </div>
    `;
  }

  async function refreshRankedQueueState(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/ranked/queue/state", { method: "GET" });
      state.rankedQueue = payload?.queued ? (payload.queue || null) : null;
      state.rankedMatchedRoom = payload?.room || null;
      renderRankedQueueState();
      if (state.rankedMatchedRoom?.roomId) {
        window.location.href = buildMultiplayerBattleUrl({
          roomId: state.rankedMatchedRoom.roomId,
          seat: state.rankedMatchedRoom.seat || "host",
          seatToken: state.rankedMatchedRoom.seatToken || "",
        });
      }
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || "Falha ao consultar fila ranked.", true);
      }
    }
  }

  async function refreshOverview(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/overview", { method: "GET" });
      state.overview = payload;
      state.seasonKey = String(payload?.seasonKey || "");
      state.dromes = Array.isArray(payload?.dromes) ? payload.dromes : [];
      state.selection = payload?.selection || null;
      state.invites = payload?.invites && typeof payload.invites === "object"
        ? payload.invites
        : { incoming: [], outgoing: [] };
      const selectedDromeId = String(state.selection?.dromeId || state.dromes?.[0]?.id || "");
      const optionsHtml = dromeOptionsHtml(state.dromes, selectedDromeId);
      if (selectDromeEl) selectDromeEl.innerHTML = optionsHtml;
      if (leaderboardDromeEl) leaderboardDromeEl.innerHTML = optionsHtml;
      if (codemasterDromeEl) codemasterDromeEl.innerHTML = optionsHtml;
      renderSeasonSummary();
      renderInvitesList();
      await refreshLeaderboard();
      await refreshRankedQueueState(true);
    } catch (error) {
      if (!silent) {
        setStatus(error?.message || "Falha ao carregar overview de Dromos.", true);
      }
    }
  }

  async function selectDrome() {
    const dromeId = String(selectDromeEl?.value || "").trim();
    if (!dromeId) {
      setStatus("Selecione um Dromo valido.", true);
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/dromos/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dromeId }),
      });
      setStatus("Dromo selecionado com sucesso.");
      await refreshOverview(true);
    } catch (error) {
      setStatus(error?.message || "Falha ao selecionar Dromo.", true);
    }
  }

  async function createRankedRoom() {
    const dromeId = String(state.selection?.dromeId || "");
    if (!dromeId) {
      setStatus("Selecione seu Dromo da temporada antes de buscar ranked.", true);
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/ranked/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      state.rankedQueue = payload?.queue || null;
      state.rankedMatchedRoom = payload?.room || null;
      renderRankedQueueState();
      if (state.rankedMatchedRoom?.roomId) {
        window.location.href = buildMultiplayerBattleUrl({
          roomId: state.rankedMatchedRoom.roomId,
          seat: state.rankedMatchedRoom.seat || "host",
          seatToken: state.rankedMatchedRoom.seatToken || "",
        });
        return;
      }
      setStatus("Fila ranked iniciada. Procurando oponente...", false);
    } catch (error) {
      setStatus(error?.message || "Falha ao entrar na fila ranked.", true);
    }
  }

  async function cancelRankedQueue() {
    try {
      await fetchJsonWithTimeout("/api/dromos/ranked/queue/cancel", { method: "POST" });
      state.rankedQueue = null;
      state.rankedMatchedRoom = null;
      renderRankedQueueState();
      setStatus("Busca ranked cancelada.");
    } catch (error) {
      setStatus(error?.message || "Falha ao cancelar busca ranked.", true);
    }
  }

  async function lockCodemasterDeck() {
    const dromeId = String(codemasterDromeEl?.value || "").trim();
    const deckName = String(codemasterDeckEl?.value || "").trim();
    if (!dromeId || !deckName) {
      setStatus("Selecione dromo e deck para travar.", true);
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/dromos/codemaster/deck-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dromeId, deckName }),
      });
      setStatus("Deck de CodeMaster travado com sucesso.");
      await refreshOverview(true);
    } catch (error) {
      setStatus(error?.message || "Falha ao travar deck de CodeMaster.", true);
    }
  }

  async function inviteChallenge() {
    const dromeId = String(codemasterDromeEl?.value || "").trim();
    const challengerUsername = String(challengeUsernameEl?.value || "").trim();
    if (!dromeId || !challengerUsername) {
      setStatus("Informe dromo e username do desafiante.", true);
      return;
    }
    try {
      await fetchJsonWithTimeout("/api/dromos/challenges/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dromeId, challengerUsername }),
      });
      if (challengeUsernameEl) {
        challengeUsernameEl.value = "";
      }
      setStatus("Convite de desafio enviado.");
      await refreshInvites(true);
    } catch (error) {
      setStatus(error?.message || "Falha ao enviar convite de desafio.", true);
    }
  }

  async function respondChallengeInvite(inviteId, decision) {
    try {
      await fetchJsonWithTimeout("/api/dromos/challenges/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, decision }),
      });
      setStatus(decision === "reject" ? "Convite recusado." : "Convite respondido.");
      await refreshInvites(true);
    } catch (error) {
      setStatus(error?.message || "Falha ao responder convite.", true);
    }
  }

  async function acceptChallengeInvite(inviteId) {
    const deckName = String(codemasterDeckEl?.value || "").trim();
    if (!deckName) {
      setStatus("Selecione um deck para aceitar o desafio.", true);
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout("/api/dromos/challenges/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, decision: "accept", deckName }),
      });
      const acceptedRoom = payload?.room || null;
      if (!acceptedRoom?.roomId) {
        await refreshInvites(true);
        setStatus("Convite aceito.");
        return;
      }
      window.location.href = buildMultiplayerBattleUrl({
        roomId: acceptedRoom.roomId,
        seat: acceptedRoom.seat || "guest",
        seatToken: acceptedRoom.seatToken || "",
      });
    } catch (error) {
      setStatus(error?.message || "Falha ao aceitar convite.", true);
    }
  }

  btnDromos.addEventListener("click", async () => {
    setExpandedMode(true);
    if (menuNav) menuNav.style.display = "none";
    if (multiplayerPanel) multiplayerPanel.style.display = "none";
    if (perimPanel) perimPanel.style.display = "none";
    if (tradesPanel) tradesPanel.style.display = "none";
    dromosPanel.style.display = "block";
    updateMainMenuSidebarVisibility();
    await Promise.all([
      populateDecks(codemasterDeckEl, username),
    ]);
    await refreshOverview();
    await Promise.all([
      refreshLiveFights(true),
      refreshInvites(true),
    ]);
    setDromosTab(state.activeTab || "season");
    startPolling();
  });

  if (btnDromosBack) {
    btnDromosBack.addEventListener("click", () => {
      stopPolling();
      setExpandedMode(false);
      dromosPanel.style.display = "none";
      if (menuNav) {
        menuNav.style.display = "flex";
      }
      updateMainMenuSidebarVisibility();
    });
  }
  dromosTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tab = String(button.getAttribute("data-dromos-tab") || "season");
      setDromosTab(tab);
      if (tab === "leaderboard") {
        void refreshLeaderboard();
      }
      if (tab === "live") {
        void refreshLiveFights(true);
      }
      if (tab === "ranked") {
        void refreshRankedQueueState(true);
      }
    });
  });
  if (btnSelect) {
    btnSelect.addEventListener("click", () => {
      void selectDrome();
    });
  }
  if (btnLeaderboardRefresh) {
    btnLeaderboardRefresh.addEventListener("click", () => {
      void refreshLeaderboard();
      void refreshLiveFights(true);
    });
  }
  if (leaderboardDromeEl) {
    leaderboardDromeEl.addEventListener("change", () => {
      void refreshLeaderboard();
    });
  }
  if (btnRankedCreate) {
    btnRankedCreate.addEventListener("click", () => {
      void createRankedRoom();
    });
  }
  if (btnRankedCancel) {
    btnRankedCancel.addEventListener("click", () => {
      void cancelRankedQueue();
    });
  }
  if (btnCodemasterLock) {
    btnCodemasterLock.addEventListener("click", () => {
      void lockCodemasterDeck();
    });
  }
  if (btnChallengeInvite) {
    btnChallengeInvite.addEventListener("click", () => {
      void inviteChallenge();
    });
  }

}

function bindPerim(username) {
  const menuNav = qs("menu-nav");
  const perimPanel = qs("perim-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const tradesPanel = qs("trades-panel");
  const dromosPanel = qs("dromos-panel");
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
  const chatStateEl = qs("perim-chat-state");
  const chatMessagesEl = qs("perim-chat-messages");
  const chatInputEl = qs("perim-chat-input");
  const chatSendBtn = qs("perim-chat-send");

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
    chatMessages: [],
    chatEventSource: null,
    chatLocationId: "",
    chatLoading: false,
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

  function closeChatEventSource() {
    if (state.chatEventSource) {
      try {
        state.chatEventSource.close();
      } catch (_) {}
      state.chatEventSource = null;
    }
  }

  function formatChatTimeLabel(rawIso) {
    const date = new Date(String(rawIso || ""));
    if (Number.isNaN(date.getTime())) {
      return "--:--";
    }
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function renderLocationChat() {
    if (!chatStateEl || !chatMessagesEl) {
      return;
    }
    const chatMeta = state.payload?.chat || {};
    const canChat = Boolean(chatMeta?.canChat && chatMeta?.locationId);
    const locationId = String(chatMeta?.locationId || "");
    const locationNameRaw = String(chatMeta?.locationName || "").trim();
    const selectedLocationName = (() => {
      const locations = Array.isArray(state.payload?.locations) ? state.payload.locations : [];
      const bySelectedCard = locations.find((entry) => String(entry?.cardId || "") === String(state.selectedLocationCardId || ""));
      if (bySelectedCard?.name) {
        return String(bySelectedCard.name).trim();
      }
      const byLocationId = locations.find((entry) => String(entry?.cardId || "") === locationId);
      if (byLocationId?.name) {
        return String(byLocationId.name).trim();
      }
      const activeRunName = String(state.payload?.activeRun?.locationName || "").trim();
      if (activeRunName) {
        return activeRunName;
      }
      return "";
    })();
    const displayLocationName = locationNameRaw || selectedLocationName || "local atual";
    const activeChatterCount = Math.max(0, Number(chatMeta?.activeChatterCount || 0));
    const chatterLabel = activeChatterCount === 1 ? "jogador" : "jogadores";
    chatStateEl.textContent = canChat
      ? `Conversa ativa no local ${displayLocationName}. ${activeChatterCount} ${chatterLabel} no chat deste local. Mensagens visiveis ate o fim do dia.`
      : "Somente jogadores em acao ativa no local podem conversar.";
    if (!canChat) {
      chatMessagesEl.innerHTML = '<div class="trades-empty">Inicie uma acao para liberar o chat deste local.</div>';
      if (chatInputEl) {
        chatInputEl.disabled = true;
      }
      if (chatSendBtn) {
        chatSendBtn.disabled = true;
      }
      return;
    }
    if (chatInputEl) {
      chatInputEl.disabled = false;
    }
    if (chatSendBtn) {
      chatSendBtn.disabled = false;
    }
    const messages = Array.isArray(state.chatMessages) ? state.chatMessages : [];
    if (!messages.length) {
      chatMessagesEl.innerHTML = '<div class="trades-empty">Sem mensagens neste local ainda.</div>';
      return;
    }
    chatMessagesEl.innerHTML = messages
      .map((entry) => `
        <article class="perim-chat-msg">
          <strong>${escapeHtml(entry?.username || entry?.ownerKey || "Jogador")}</strong>
          <span>${escapeHtml(entry?.message || "")}</span>
          <small>${escapeHtml(formatChatTimeLabel(entry?.createdAt))}</small>
        </article>
      `)
      .join("");
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function refreshLocationChat(force = false) {
    const chatMeta = state.payload?.chat || {};
    const canChat = Boolean(chatMeta?.canChat && chatMeta?.locationId);
    const locationId = String(chatMeta?.locationId || "");
    if (!canChat || !locationId) {
      state.chatMessages = [];
      state.chatLocationId = "";
      closeChatEventSource();
      renderLocationChat();
      return;
    }
    if (!force && state.chatLoading) {
      return;
    }
    state.chatLoading = true;
    try {
      const payload = await fetchJsonWithTimeout(`/api/perim/locations/${encodeURIComponent(locationId)}/chat?limit=120`, { method: "GET" });
      state.chatMessages = Array.isArray(payload?.messages) ? payload.messages : [];
      state.chatLocationId = locationId;
      renderLocationChat();
      if (!state.chatEventSource || force) {
        closeChatEventSource();
        const source = new EventSource(apiUrl(`/api/perim/locations/${encodeURIComponent(locationId)}/chat/events`));
        state.chatEventSource = source;
        source.onmessage = (event) => {
          const data = safeJsonParse(event.data, null);
          if (!data || typeof data !== "object") {
            return;
          }
          if (data.type === "perim_location_chat_snapshot") {
            state.chatMessages = Array.isArray(data.messages) ? data.messages : [];
            renderLocationChat();
            return;
          }
          if (data.type === "perim_location_chat_message" && data.message) {
            const next = Array.isArray(state.chatMessages) ? [...state.chatMessages] : [];
            next.push(data.message);
            state.chatMessages = next.slice(-120);
            renderLocationChat();
            return;
          }
          if (data.type === "perim_location_chat_revoked") {
            closeChatEventSource();
            void refreshPerimState();
          }
        };
        source.onerror = () => {
          if (chatStateEl) {
            chatStateEl.textContent = "Conexao do chat instavel. Tentando manter atualizacao.";
          }
        };
      }
    } catch (error) {
      if (chatStateEl) {
        chatStateEl.textContent = error?.message || "Falha ao carregar chat deste local.";
      }
    } finally {
      state.chatLoading = false;
    }
  }

  async function sendLocationChatMessage() {
    const chatMeta = state.payload?.chat || {};
    const locationId = String(chatMeta?.locationId || "");
    const message = String(chatInputEl?.value || "").trim();
    if (!locationId || !message) {
      return;
    }
    if (chatSendBtn) {
      chatSendBtn.disabled = true;
    }
    try {
      await fetchJsonWithTimeout(`/api/perim/locations/${encodeURIComponent(locationId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (chatInputEl) {
        chatInputEl.value = "";
      }
    } catch (error) {
      if (chatStateEl) {
        chatStateEl.textContent = error?.message || "Falha ao enviar mensagem no chat.";
      }
    } finally {
      if (chatSendBtn) {
        chatSendBtn.disabled = false;
      }
    }
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
    const campWaitCount = Math.max(0, Number(selected?.campWaitCount ?? 0));
    const campCreatureBonusPercent = Math.max(0, Number(selected?.campCreatureBonusPercent ?? 0));
    const campCreatureBonusMaxRarity = String(selected?.campCreatureBonusMaxRarity || "super rare");
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
      <p class="perim-camp-wait-line">Esperas no local (acampar): <strong>${campWaitCount}</strong> <span class="perim-camp-wait-mark" title="Quanto mais esperas, maior a chance bonus de criatura ate super rara">rastros</span></p>
      <p>Bônus atual de criatura no acampar: <strong>+${campCreatureBonusPercent}%</strong> (ate ${escapeHtml(campCreatureBonusMaxRarity)})</p>
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
    const selectedLocation = resolveSelectedLocation();
    const ownedLocationSet = new Set(
      getLocations()
        .map((entry) => String(entry?.cardId || "").trim())
        .filter(Boolean)
    );
    const computeExploreProgress = () => {
      if (!selectedLocation) {
        return { nearbyOwnedCount: 0, nearbyTotalCount: 0, progressPercent: 0 };
      }
      const linkedIds = [...new Set(
        (Array.isArray(selectedLocation?.linkedLocationIds) ? selectedLocation.linkedLocationIds : [])
          .map((cardId) => String(cardId || "").trim())
          .filter((cardId) => cardId && cardId !== String(selectedLocation?.cardId || ""))
      )];
      const nearbyTotalCount = linkedIds.length;
      if (!nearbyTotalCount) {
        return { nearbyOwnedCount: 0, nearbyTotalCount: 0, progressPercent: 0 };
      }
      const nearbyOwnedCount = linkedIds.reduce(
        (count, cardId) => count + (ownedLocationSet.has(cardId) ? 1 : 0),
        0
      );
      const progressPercent = Math.max(0, Math.min(100, Math.round((nearbyOwnedCount / nearbyTotalCount) * 100)));
      return { nearbyOwnedCount, nearbyTotalCount, progressPercent };
    };
    const exploreProgress = computeExploreProgress();
    actions.forEach((action) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `perim-action-item${state.selectedActionId === action.id ? " selected" : ""}`;
      item.disabled = Boolean(activeRun);
      const exploreProgressHtml = action.id === "explore"
        ? `
          <div class="perim-explore-progress">
            <div class="perim-explore-progress-header">
              <span>Locais proximos descobertos</span>
              <span>${exploreProgress.nearbyOwnedCount}/${exploreProgress.nearbyTotalCount}</span>
            </div>
            <div class="perim-explore-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${exploreProgress.progressPercent}">
              <div class="perim-explore-progress-fill" style="width:${exploreProgress.progressPercent}%;"></div>
            </div>
          </div>
        `
        : "";
      item.innerHTML = `
        <strong>${escapeHtml(action.name)}</strong>
        <small>${escapeHtml(action.description)}</small>
        ${exploreProgressHtml}
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

  async function savePerimChoiceSelections(runId, choiceSelections) {
    await fetchJsonWithTimeout("/api/perim/claim/choices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: normalizeUsername(username),
        runId,
        choiceSelections,
      }),
    });
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
    const choiceGroups = Array.isArray(entry.choiceGroups) ? entry.choiceGroups : [];
    const needsChoice = Boolean(entry.needsChoice);
    const chips = (entry.rewards || [])
      .map((reward) => `<span class="perim-reward-chip">${escapeHtml(reward.type)}: ${escapeHtml(reward.cardDisplayName || reward.cardName || reward.cardId || "Carta")}</span>`)
      .join("");
    const choicesHtml = choiceGroups.length
      ? `
        <div style="margin-top:0.5rem;display:grid;gap:0.42rem;">
          ${choiceGroups.map((group) => `
            <div style="display:grid;gap:0.2rem;">
              <label for="perim-choice-${escapeAttr(group.groupId)}" style="font-size:0.68rem;color:#9cc0d8;">
                Escolha 1 carta de ${escapeHtml(group.type)}:
              </label>
              <select id="perim-choice-${escapeAttr(group.groupId)}" data-perim-choice-group="${escapeAttr(group.groupId)}" style="min-height:34px;background:rgba(4,10,16,0.8);color:#d7edfb;border:1px solid rgba(0,210,255,0.32);border-radius:8px;padding:0.35rem;">
                <option value="">Selecione...</option>
                ${(Array.isArray(group.options) ? group.options : []).map((option) => `
                  <option value="${Number(option.optionIndex)}" ${option.optionIndex === group.selectedOptionIndex ? "selected" : ""}>
                    ${escapeHtml(option.reward?.cardDisplayName || option.reward?.cardName || option.reward?.cardId || "Carta")}
                  </option>
                `).join("")}
              </select>
            </div>
          `).join("")}
          <button id="perim-save-choices-btn" class="menu-btn standard-btn" style="padding:0.46rem;">Salvar escolhas</button>
        </div>
      `
      : "";
    pendingRewardsEl.innerHTML = `
      <div class="perim-run-title">Recompensas prontas</div>
      <div style="font-size:0.74rem;">Run: ${escapeHtml(entry.runId || "")}</div>
      <div style="font-size:0.74rem;">Local: <strong>${escapeHtml(entry.locationName || "Desconhecido")}</strong></div>
      <div style="font-size:0.74rem;">Acao: <strong>${escapeHtml(entry.actionName || entry.actionId || "N/A")}</strong></div>
      <div style="margin-top:0.3rem;">${chips || '<span style="font-size:0.72rem;color:#8ea8bf;">Sem cartas sorteadas.</span>'}</div>
      ${choicesHtml}
      <button id="perim-claim-btn" class="menu-btn primary-btn" style="padding:0.5rem; margin-top:0.55rem;" ${needsChoice ? "disabled" : ""}>${needsChoice ? "Escolha cartas antes de coletar" : "Coletar recompensas"}</button>
    `;
    const saveChoicesBtn = qs("perim-save-choices-btn");
    if (saveChoicesBtn) {
      saveChoicesBtn.addEventListener("click", async () => {
        const selections = {};
        let invalid = false;
        pendingRewardsEl.querySelectorAll("[data-perim-choice-group]").forEach((selectEl) => {
          const groupId = String(selectEl.getAttribute("data-perim-choice-group") || "").trim();
          const rawValue = String(selectEl.value || "").trim();
          if (!groupId) {
            return;
          }
          if (!rawValue) {
            invalid = true;
            return;
          }
          selections[groupId] = Number(rawValue);
        });
        if (invalid) {
          setStatus("Escolha uma opcao em todos os grupos antes de salvar.", true);
          return;
        }
        saveChoicesBtn.disabled = true;
        try {
          await savePerimChoiceSelections(entry.runId, selections);
          setStatus("Escolhas salvas. Agora voce pode coletar.");
          await refreshPerimState();
        } catch (error) {
          setStatus(error?.message || "Falha ao salvar escolhas.", true);
        } finally {
          saveChoicesBtn.disabled = false;
        }
      });
    }
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
            if (data?.needsChoices) {
              setStatus(data?.error || "Escolha as cartas duplicadas antes de coletar.", true);
              await refreshPerimState();
              return;
            }
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
    renderLocationChat();
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
      await refreshLocationChat(true);
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
  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", () => {
      void sendLocationChatMessage();
    });
  }
  if (chatInputEl) {
    chatInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void sendLocationChatMessage();
      }
    });
  }
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
    setExpandedMode(true);
    if (menuNav) {
      menuNav.style.display = "none";
    }
    if (multiplayerPanel) {
      multiplayerPanel.style.display = "none";
    }
    if (dromosPanel) {
      dromosPanel.style.display = "none";
    }
    if (tradesPanel) {
      tradesPanel.style.display = "none";
    }
    perimPanel.style.display = "block";
    updateMainMenuSidebarVisibility();
    await refreshPerimState();
  });

    if (btnPerimBack) {
    btnPerimBack.addEventListener("click", () => {
      stopCountdownTicker();
      closeChatEventSource();
      closePreview();
      closeEventsModal();
      setExpandedMode(false);
      perimPanel.style.display = "none";
      if (menuNav) {
        menuNav.style.display = "flex";
      }
      updateMainMenuSidebarVisibility();
    });
  }
}

function bindTrades(username) {
  const menuNav = qs("menu-nav");
  const btnTrades = qs("btn-trades");
  const btnTradesBack = qs("btn-trades-back");
  const tradesPanel = qs("trades-panel");
  const multiplayerPanel = qs("multiplayer-panel");
  const perimPanel = qs("perim-panel");
  const dromosPanel = qs("dromos-panel");
  const tradesStatus = qs("trades-status");
  const monthlyUsageEl = qs("trades-monthly-usage");
  const hubView = qs("trades-hub-view");
  const roomView = qs("trades-room-view");
  const roomCodeInput = qs("trades-room-code-input");
  const btnCreateRoom = qs("btn-trades-create-room");
  const btnJoinRoom = qs("btn-trades-join-room");
  const friendSelect = qs("trades-friend-select");
  const btnInviteFriend = qs("btn-trades-invite-friend");
  const btnRefreshFriends = qs("btn-trades-refresh-friends");
  const incomingInvitesEl = qs("trades-incoming-invites");
  const outgoingInvitesEl = qs("trades-outgoing-invites");
  const roomCodeLabel = qs("trades-room-code-label");
  const seatLabel = qs("trades-seat-label");
  const roomPresence = qs("trades-room-presence");
  const roomSectionTabs = qs("trades-room-section-tabs");
  const myOfferEl = qs("trades-my-offer");
  const oppOfferEl = qs("trades-opponent-offer");
  const inventoryType = qs("trades-inventory-type");
  const inventorySearch = qs("trades-inventory-search");
  const inventoryList = qs("trades-inventory-list");
  const btnAcceptToggle = qs("btn-trades-accept-toggle");
  const btnFinalize = qs("btn-trades-finalize");
  const btnCancelRoom = qs("btn-trades-cancel-room");
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
    invitePollTimer: null,
    activeSection: "inventory",
    friendOptions: [],
    monthlyUsage: null,
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

  function renderTradeMonthlyUsage() {
    if (!monthlyUsageEl) {
      return;
    }
    const usage = state.monthlyUsage;
    if (!usage || typeof usage !== "object") {
      monthlyUsageEl.textContent = "Trocas no mes: --/2";
      return;
    }
    const used = Number(usage.used || 0);
    const limit = Number(usage.limit || 2);
    const remaining = Number(usage.remaining ?? Math.max(0, limit - used));
    monthlyUsageEl.textContent = `Trocas no mes: ${used}/${limit} • Restantes: ${remaining}`;
  }

  function stopHubPolling() {
    if (state.invitePollTimer) {
      clearInterval(state.invitePollTimer);
      state.invitePollTimer = null;
    }
  }

  function startHubPolling() {
    stopHubPolling();
    state.invitePollTimer = setInterval(() => {
      if (state.snapshot) {
        return;
      }
      void refreshFriendTradeOptions(true);
      void refreshTradeInvites(true);
    }, 20000);
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

  function setTradeSection(section) {
    const normalized = section === "my-offer" || section === "opponent-offer" ? section : "inventory";
    state.activeSection = normalized;
    if (!roomSectionTabs) {
      return;
    }
    roomSectionTabs.querySelectorAll("[data-trade-section-tab]").forEach((button) => {
      const tab = String(button.getAttribute("data-trade-section-tab") || "");
      button.classList.toggle("active", tab === normalized);
    });
    ["inventory", "my-offer", "opponent-offer"].forEach((tab) => {
      const panel = qs(`trades-section-${tab}`);
      if (!panel) {
        return;
      }
      panel.classList.toggle("active", tab === normalized);
    });
  }

  function renderTradeCard(entry, actionHtml = "", offered = false) {
    if (!entry || !entry.scanEntryId) {
      return "";
    }
    const variantBadge = creatureStarsBadge(entry?.variant);
    const variantTag = variantBadge ? ` (${variantBadge})` : "";
    const offeredTag = offered ? "Ofertada" : "";
    const lockedTag = entry?.lockedByOtherRoom ? "Travada em outra troca" : "";
    const stateLine = [offeredTag, lockedTag].filter(Boolean).join(" • ");
    return `
      <div class="trades-card-item">
        <img class="trades-card-thumb" src="${escapeAttr(entry.image || "/fundo%20cartas.png")}" alt="${escapeAttr(entry.cardName || entry.cardId || "Carta")}" />
        <div class="trades-card-body">
          <strong>${escapeHtml(entry.cardName || entry.cardId || "Carta")}${variantTag}</strong>
          <span>${escapeHtml(formatCardType(entry.cardType))} • ${escapeHtml(entry.rarity || "Unknown")}</span>
          <span>${escapeHtml(entry.set || "Unknown")}${stateLine ? ` • ${escapeHtml(stateLine)}` : ""}</span>
          <div class="trades-card-actions">
            ${actionHtml}
          </div>
        </div>
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
      state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
      renderTradeMonthlyUsage();
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
        return renderTradeCard(entry, button, false);
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
    const searchToken = normalizeFilterToken(inventorySearch?.value || "");
    const filtered = myInventory.filter((entry) => {
      const cardToken = normalizeFilterToken(
        `${entry?.cardName || ""} ${entry?.cardId || ""} ${entry?.rarity || ""} ${entry?.set || ""} ${formatCardType(entry?.cardType)}`
      );
      if (filter === "all") {
        return !searchToken || cardToken.includes(searchToken);
      }
      if (String(entry?.cardType || "").toLowerCase() !== filter) {
        return false;
      }
      return !searchToken || cardToken.includes(searchToken);
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
        return renderTradeCard(entry, actionHtml, Boolean(entry.offered));
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
      startHubPolling();
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
    stopHubPolling();

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
    setTradeSection(state.activeSection);
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
    state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
    renderTradeMonthlyUsage();
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
    setTradeSection("inventory");
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
    startHubPolling();
  }

  function renderFriendTradeOptions() {
    if (!friendSelect) {
      return;
    }
    const options = Array.isArray(state.friendOptions) ? state.friendOptions : [];
    if (!options.length) {
      friendSelect.innerHTML = '<option value="">Nenhum amigo online disponivel</option>';
      return;
    }
    friendSelect.innerHTML = '<option value="">Selecione um amigo online</option>'
      + options
        .map((entry) => `<option value="${escapeAttr(entry.username)}">${escapeHtml(entry.username)} • Score ${Number(entry.score || 0)}</option>`)
        .join("");
  }

  async function refreshFriendTradeOptions(silent = false) {
    try {
      const [friendsPayload, presencePayload] = await Promise.all([
        fetchJsonWithTimeout("/api/profile/friends", { method: "GET" }),
        fetchJsonWithTimeout("/api/profile/friends/presence", { method: "GET" }),
      ]);
      const friends = Array.isArray(friendsPayload?.friends) ? friendsPayload.friends : [];
      const presence = presencePayload?.presence && typeof presencePayload.presence === "object"
        ? presencePayload.presence
        : {};
      state.friendOptions = friends.filter((entry) => {
        const key = normalizeUsername(entry?.ownerKey || entry?.username || "");
        const status = String(presence[key]?.status || "offline").toLowerCase();
        return status === "online";
      });
      renderFriendTradeOptions();
    } catch (error) {
      if (!silent) {
        setTradesStatus(error?.message || "Falha ao carregar amigos online.", true);
      }
    }
  }

  function renderTradeInvites(payload) {
    const incoming = Array.isArray(payload?.incoming) ? payload.incoming : [];
    const outgoing = Array.isArray(payload?.outgoing) ? payload.outgoing : [];
    if (incomingInvitesEl) {
      if (!incoming.length) {
        incomingInvitesEl.innerHTML = '<div class="trades-empty">Nenhum convite recebido.</div>';
      } else {
        incomingInvitesEl.innerHTML = incoming
          .map((entry) => `
            <div class="trades-invite-row">
              <strong>${escapeHtml(entry.hostUsername || entry.hostKey || "Jogador")}</strong>
              <span>Expira em ${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min</span>
              <div class="trades-invite-actions">
                <button class="menu-btn primary-btn" data-trade-invite-accept="${escapeAttr(entry.inviteId)}">Aceitar</button>
                <button class="menu-btn ghost-btn" data-trade-invite-reject="${escapeAttr(entry.inviteId)}">Recusar</button>
              </div>
            </div>
          `)
          .join("");
      }
      incomingInvitesEl.querySelectorAll("[data-trade-invite-accept]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-trade-invite-accept") || "").trim();
          if (!inviteId) {
            return;
          }
          void respondTradeInvite(inviteId, "accept");
        });
      });
      incomingInvitesEl.querySelectorAll("[data-trade-invite-reject]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-trade-invite-reject") || "").trim();
          if (!inviteId) {
            return;
          }
          void respondTradeInvite(inviteId, "reject");
        });
      });
    }
    if (outgoingInvitesEl) {
      if (!outgoing.length) {
        outgoingInvitesEl.innerHTML = '<div class="trades-empty">Nenhum convite enviado.</div>';
      } else {
        outgoingInvitesEl.innerHTML = outgoing
          .map((entry) => `
            <div class="trades-invite-row">
              <strong>${escapeHtml(entry.guestUsername || entry.guestKey || "Jogador")}</strong>
              <span>Aguardando resposta (${Math.max(0, Math.ceil(Number(entry.expiresInMs || 0) / 60000))} min)</span>
              <div class="trades-invite-actions">
                <button class="menu-btn ghost-btn" data-trade-invite-cancel="${escapeAttr(entry.inviteId)}">Cancelar</button>
              </div>
            </div>
          `)
          .join("");
      }
      outgoingInvitesEl.querySelectorAll("[data-trade-invite-cancel]").forEach((button) => {
        button.addEventListener("click", () => {
          const inviteId = String(button.getAttribute("data-trade-invite-cancel") || "").trim();
          if (!inviteId) {
            return;
          }
          void cancelTradeInvite(inviteId);
        });
      });
    }
  }

  async function refreshTradeInvites(silent = false) {
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/invites", { method: "GET" });
      state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
      renderTradeMonthlyUsage();
      renderTradeInvites(payload);
    } catch (error) {
      if (!silent) {
        setTradesStatus(error?.message || "Falha ao carregar convites de troca.", true);
      }
    }
  }

  async function createTradeInvite() {
    const friendUsername = String(friendSelect?.value || "").trim();
    if (!friendUsername) {
      setTradesStatus("Selecione um amigo online para convidar.", true);
      return;
    }
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/invites/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendUsername,
          playerName: username,
        }),
      });
      state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
      renderTradeMonthlyUsage();
      state.roomCode = String(payload?.room?.roomCode || "");
      state.seatToken = String(payload?.room?.seatToken || "");
      state.seat = String(payload?.room?.seat || "host");
      persistTradeSession();
      setTradesStatus(`Convite enviado para ${friendUsername}. Aguardando aceitar...`);
      await fetchTradeState();
      connectTradeEvents();
      await refreshTradeInvites(true);
    } catch (error) {
      setTradesStatus(error?.message || "Falha ao convidar amigo para troca.", true);
    }
  }

  async function respondTradeInvite(inviteId, decision) {
    try {
      const payload = await fetchJsonWithTimeout("/api/trades/invites/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inviteId,
          decision,
          playerName: username,
        }),
      });
      state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
      renderTradeMonthlyUsage();
      if (decision === "accept" && payload?.room) {
        state.roomCode = String(payload.room.roomCode || "");
        state.seatToken = String(payload.room.seatToken || "");
        state.seat = String(payload.room.seat || "guest");
        persistTradeSession();
        setTradesStatus("Convite aceito. Conectando na troca...");
        await fetchTradeState();
        connectTradeEvents();
        return;
      }
      await refreshTradeInvites(true);
      setTradesStatus("Convite recusado.");
    } catch (error) {
      setTradesStatus(error?.message || "Falha ao responder convite de troca.", true);
    }
  }

  async function cancelTradeInvite(inviteId) {
    try {
      await fetchJsonWithTimeout("/api/trades/invites/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId }),
      });
      await refreshTradeInvites(true);
      setTradesStatus("Convite cancelado.");
    } catch (error) {
      setTradesStatus(error?.message || "Falha ao cancelar convite.", true);
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
      if (payload?.monthlyUsage) {
        state.monthlyUsage = payload.monthlyUsage;
        renderTradeMonthlyUsage();
      }
      persistTradeSession();
      setTradesStatus(`Sala criada: ${state.roomCode}. Compartilhe o codigo com outro jogador.`);
      await fetchTradeState();
      connectTradeEvents();
      await refreshTradeInvites(true);
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
      state.monthlyUsage = payload?.monthlyUsage || state.monthlyUsage;
      renderTradeMonthlyUsage();
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
    setExpandedMode(true);
    if (menuNav) {
      menuNav.style.display = "none";
    }
    if (multiplayerPanel) {
      multiplayerPanel.style.display = "none";
    }
    if (dromosPanel) {
      dromosPanel.style.display = "none";
    }
    if (perimPanel) {
      perimPanel.style.display = "none";
    }
    tradesPanel.style.display = "block";
    updateMainMenuSidebarVisibility();
    renderTradeMonthlyUsage();
    clearEventSource();
    void refreshFriendTradeOptions(true);
    void refreshTradeInvites(true);
    if (!restoreTradeSession()) {
      if (hubView) {
        hubView.style.display = "grid";
      }
      if (roomView) {
        roomView.style.display = "none";
      }
      startHubPolling();
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
  if (btnInviteFriend) {
    btnInviteFriend.addEventListener("click", () => {
      void createTradeInvite();
    });
  }
  if (btnRefreshFriends) {
    btnRefreshFriends.addEventListener("click", () => {
      void refreshFriendTradeOptions();
      void refreshTradeInvites();
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
  if (inventorySearch) {
    inventorySearch.addEventListener("input", () => {
      renderInventoryList();
    });
  }
  if (roomSectionTabs) {
    roomSectionTabs.querySelectorAll("[data-trade-section-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const section = String(button.getAttribute("data-trade-section-tab") || "inventory");
        setTradeSection(section);
      });
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

  if (btnTradesBack) {
    btnTradesBack.addEventListener("click", () => {
      clearEventSource();
      stopHubPolling();
      setExpandedMode(false);
      tradesPanel.style.display = "none";
      if (menuNav) {
        menuNav.style.display = "flex";
      }
      updateMainMenuSidebarVisibility();
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
  refreshMenuHomePanelSettingsFromStorage();
  try {
    await loadMenuHomePanelSettings();
  } catch (_) {
    refreshMenuHomePanelSettingsFromStorage();
  }
  updateMainMenuSidebarVisibility();

  await bindProfile(username, sessionData);
  bindSidePanels(username);
  bindNavigation();
  bindMultiplayer(username);
  bindDromos(username);
  bindPerim(username);
  bindTrades(username);
  bindFooterActions();
  updateMainMenuSidebarVisibility();
  await initMenuMusic();
});



