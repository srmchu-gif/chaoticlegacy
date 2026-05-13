const LEGACY_SESSION_TOKEN_KEY = "chaotic_session_token";
try {
  localStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
} catch (_) {}

function ensureLeadingSlash(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeBasePath(value) {
  const withLeading = ensureLeadingSlash(value);
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

function sanitizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const rawConfig = window.APP_CONFIG && typeof window.APP_CONFIG === "object" ? window.APP_CONFIG : {};
const BASE_PATH = normalizeBasePath(rawConfig.basePath || "/");
const API_BASE = sanitizeApiBase(rawConfig.apiBase || "");
const TURNSTILE_SITE_KEY = String(rawConfig.turnstileSiteKey || "").trim();
const API_PREFIXES = ["/api/", "/downloads/", "/music/", "/health"];

export function getRuntimeConfig() {
  return {
    basePath: BASE_PATH,
    apiBase: API_BASE,
    turnstileSiteKey: TURNSTILE_SITE_KEY,
  };
}

export function toPage(path = "") {
  const value = String(path || "").trim();
  if (!value) {
    return BASE_PATH;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  const normalized = value.startsWith("/") ? value.slice(1) : value;
  return `${BASE_PATH}${normalized}`;
}

export function assetUrl(path = "") {
  const value = String(path || "").trim();
  if (!value) return toPage("");
  if (/^https?:\/\//i.test(value)) return value;
  return toPage(value);
}

function shouldUseApiBase(pathname) {
  return API_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

export function apiUrl(path = "") {
  const value = String(path || "").trim();
  if (!value) return API_BASE || BASE_PATH;
  if (/^https?:\/\//i.test(value)) return value;
  const normalizedPath = ensureLeadingSlash(value);
  if (API_BASE && shouldUseApiBase(normalizedPath)) {
    return `${API_BASE}${normalizedPath}`;
  }
  return toPage(normalizedPath);
}

function rewriteRequestUrl(inputUrl) {
  const value = String(inputUrl || "").trim();
  if (!value) {
    return value;
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("//")) {
    return `${window.location.protocol}${value}`;
  }
  return apiUrl(value);
}

export function setSessionToken(token) {
  // Legacy no-op: auth now relies on HttpOnly session cookie only.
  void token;
}

export function getSessionToken() {
  return "";
}

export function clearSessionToken() {
  // Legacy no-op: no client-side session token is persisted anymore.
}

// Install once: rewrites relative API/music/download URLs.
if (!window.__chaoticFetchPatched) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    let requestUrl = input;
    let nextInit = init;

    if (typeof input === "string" || input instanceof URL) {
      requestUrl = rewriteRequestUrl(String(input));
    } else if (input instanceof Request) {
      requestUrl = rewriteRequestUrl(input.url);
      nextInit = {
        method: input.method,
        headers: input.headers,
        body: input.body,
        mode: input.mode,
        credentials: input.credentials,
        cache: input.cache,
        redirect: input.redirect,
        referrer: input.referrer,
        referrerPolicy: input.referrerPolicy,
        integrity: input.integrity,
        keepalive: input.keepalive,
        signal: input.signal,
        ...init,
      };
    }

    return nativeFetch(requestUrl, nextInit);
  };
  window.__chaoticFetchPatched = true;
}
