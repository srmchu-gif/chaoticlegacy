const fs = require("fs");
const path = require("path");
const axios = require("axios");
const sanitize = require("sanitize-filename");

const DATA_PATH = "./chaotic_locations.json";
const BASE_DIR = "./downloads/locations";

const imageFields = ["ic", "if", "ia"];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url, savePath) {
  try {
    // acha o que houver nao apague isso aqui, é por aqui que os sites vao pensar que e um ser humano fazendo o download
    const res = await axios.get(url, {
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    await fs.promises.mkdir(path.dirname(savePath), { recursive: true });
    const writer = fs.createWriteStream(savePath);
    res.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  } catch (err) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'];
      const wait = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
      console.warn(`⚠️ Rate limit atingido em ${url}. Aguardando ${wait / 1000}s...`);
      await sleep(wait);
      const nextUrl = fallbackUrl || url;
      console.log(`🔁 Re-tentando: ${nextUrl}`);
      return await downloadImage(nextUrl, savePath, null);
    } else {
      console.error(`❌ Erro ao baixar ${url}: ${err.message}`);
    }
    console.error(`❌ Erro ao baixar ${url}: ${err.message}`);
  }
}

function buildFolderPath(set, tribe, rarity) {
  return path.join(BASE_DIR, sanitize(set || "Unknown"), sanitize(tribe || "Unknown"), sanitize(rarity || "Unknown"));
}

async function processCards() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

  for (const card of data) {
    const name = sanitize(card["name"] || "Unknown");
    const set = card["set"] || "UnknownSet";
    const tribe = card["tribe"] || "UnknownTribe";
    const rarity = card["rarity"] || "UnknownRarity";
    const splashId = card["splash"];

    const folderPath = buildFolderPath(set, tribe, rarity);

    for (const field of imageFields) {
      let url = card[field];
      if (!url || !url.startsWith("http")) {
        if (splashId && splashId.trim() !== "") {
          url = `https://drive.google.com/uc?id=${splashId}`;
        }
      }

      if (url && url.startsWith("http")) {
        const suffix = field.replace("", "");
        let ext = path.extname(new URL(url).pathname).split("?")[0];
        if (!ext) ext = ".jpg";

        const filename = `${name} - ${suffix}${ext}`;
        const fullPath = path.join(folderPath, filename);

        console.log(`🔽 Baixando ${filename}`);
        await downloadImage(url, fullPath);
      } else {
        console.log(`⚠️ Sem URL válida para o campo ${field} da carta ${name}`);
      }
    }
  }

  console.log("✅ Download finalizado.");
}

processCards();
