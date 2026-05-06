const fs = require("fs");
const path = require("path");

const ROOT_DIR = process.cwd();

const REQUIRED_PATHS = [
  "server.js",
  "package.json",
  "lib/library.js",
  "lib/effect-parser.js",
];

function existsFile(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
}

function readJsonSafe(relativePath) {
  try {
    const absolutePath = path.join(ROOT_DIR, relativePath);
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function main() {
  const missing = REQUIRED_PATHS.filter((relativePath) => !existsFile(relativePath));
  if (missing.length) {
    console.error("[RENDER PREFLIGHT] Arquivos obrigatorios ausentes:");
    missing.forEach((entry) => console.error(`  - ${entry}`));
    process.exit(1);
  }

  const pkg = readJsonSafe("package.json");
  const startScript = String(pkg?.scripts?.start || "").trim();
  if (startScript !== "node server.js") {
    console.warn(`[RENDER PREFLIGHT] Aviso: scripts.start atual = "${startScript || "(vazio)"}". Recomendado: "node server.js".`);
  } else {
    console.log('[RENDER PREFLIGHT] scripts.start OK: "node server.js".');
  }

  const renderIgnorePath = path.join(ROOT_DIR, ".renderignore");
  if (fs.existsSync(renderIgnorePath)) {
    const content = fs.readFileSync(renderIgnorePath, "utf8");
    if (/^\s*lib\/?\s*$/m.test(content) || /^\s*\*\*\/lib\/?\s*$/m.test(content)) {
      console.error("[RENDER PREFLIGHT] .renderignore esta excluindo a pasta lib/. Remova essa regra.");
      process.exit(1);
    }
    console.log("[RENDER PREFLIGHT] .renderignore encontrado e sem exclusao direta de lib/.");
  } else {
    console.log("[RENDER PREFLIGHT] .renderignore nao encontrado (OK).");
  }

  console.log("[RENDER PREFLIGHT] Estrutura local validada com sucesso.");
  console.log("[RENDER PREFLIGHT] Proximo passo: commit + push para a branch conectada no Render (evite upload parcial).");
}

main();
