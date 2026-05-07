(function initAppConfig() {
  const host = String(window.location.hostname || "").toLowerCase();
  const protocol = String(window.location.protocol || "http:");
  const origin = window.location.origin || "";
  const pathSegments = String(window.location.pathname || "/")
    .split("/")
    .filter(Boolean);

  const isGitHubPages = host.endsWith(".github.io");
  const detectedBasePath = isGitHubPages && pathSegments.length
    ? `/${pathSegments[0]}/`
    : "/";

  // Override manual opcional:
  // window.__CHAOTIC_CONFIG = { apiBase: "https://sua-api.com", basePath: "/seu-repo/" }
  const manual = window.__CHAOTIC_CONFIG && typeof window.__CHAOTIC_CONFIG === "object"
    ? window.__CHAOTIC_CONFIG
    : {};

  // Em Pages usamos backend externo; fora do Pages usamos mesma origem.
  const defaultApiBase = isGitHubPages
    ? "https://chaoticlegacy-1.onrender.com"
    : (origin || `${protocol}//${window.location.host}`);

  window.APP_CONFIG = {
    apiBase: String(manual.apiBase || defaultApiBase).trim(),
    basePath: String(manual.basePath || detectedBasePath).trim() || "/",
    turnstileSiteKey: String(manual.turnstileSiteKey || "").trim(),
  };
})();
