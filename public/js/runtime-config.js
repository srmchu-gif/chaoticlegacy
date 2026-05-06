const SESSION_TOKEN_KEY = "chaotic_session_token";

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
const API_PREFIXES = ["/api/", "/downloads/", "/music/", "/health"];

export function getRuntimeConfig() {
  return {
    basePath: BASE_PATH,
    apiBase: API_BASE,
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
  const value = String(token || "").trim();
  if (!value) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  localStorage.setItem(SESSION_TOKEN_KEY, value);
}

export function getSessionToken() {
  return String(localStorage.getItem(SESSION_TOKEN_KEY) || "").trim();
}

export function clearSessionToken() {
  localStorage.removeItem(SESSION_TOKEN_KEY);
}

// Install once: rewrites relative API/music/download URLs and injects Bearer token.
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

    try {
      const parsed = new URL(String(requestUrl), window.location.origin);
      const token = getSessionToken();
      if (token && shouldUseApiBase(parsed.pathname)) {
        const headers = new Headers(nextInit?.headers || {});
        if (!headers.has("Authorization")) {
          headers.set("Authorization", `Bearer ${token}`);
        }
        nextInit = {
          ...(nextInit || {}),
          headers,
        };
      }
    } catch (_) {
      // Ignore URL parse errors and defer to native fetch.
    }

    return nativeFetch(requestUrl, nextInit);
  };
  window.__chaoticFetchPatched = true;
}
