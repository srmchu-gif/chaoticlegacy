(function initAppConfig() {
  const host = String(window.location.hostname || "").toLowerCase();
  const pathSegments = String(window.location.pathname || "/")
    .split("/")
    .filter(Boolean);
  const detectedBasePath = host.endsWith(".github.io") && pathSegments.length
    ? `/${pathSegments[0]}/`
    : "/";

  const defaults = {
    // Exemplo de producao: "https://seu-backend.onrender.com"
    apiBase: "https://chaoticdriven.onrender.com",
    // Exemplo de repo Pages: "/chaotic-api-main/lib/library/"
    basePath: "/chaotic-api-main/lib/library/",
  };

window.APP_CONFIG = {
  apiBase: "https://game.chaoticlegacy.qzz.io",
  basePath: "/chaoticlegacy/"
};
})();
