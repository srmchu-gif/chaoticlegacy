const fs = require("fs");
const path = require("path");

const arquivos = [
  "./chaotic_creatures.json",
  "./chaotic_battlegear.json",
  "./chaotic_attacks.json",
  "./chaotic_mugic.json",
  "./chaotic_locations.json"
];

function getTodasHabilidades() {
  const habilidadesSet = new Set();

  for (const arquivo of arquivos) {
    if (!fs.existsSync(arquivo)) {
      console.warn(`Arquivo não encontrado: ${arquivo}`);
      continue;
    }

    const conteudo = fs.readFileSync(arquivo, "utf-8");
    let cartas;

    try {
      cartas = JSON.parse(conteudo);
    } catch (erro) {
      console.error(`Erro ao ler ${arquivo}:`, erro.message);
      continue;
    }

    for (const carta of cartas) {
      let habilidade = carta.ability;

      if (typeof habilidade === "string" && habilidade.trim() !== "") {
        habilidade = habilidade
          .replace(/\r\n/g, "\n")
          .replace(/\s+$/g, "")
          .replace(/^\s+/g, "");

        habilidadesSet.add(habilidade);
      }
    }
  }

  const listaFinal = Array.from(habilidadesSet)
    .sort()
    .map((habilidade, index) => ({
      number: index + 1,
      ability: habilidade
    }));

  const destino = path.join(__dirname, "habilidades.json");
  fs.writeFileSync(destino, JSON.stringify(listaFinal, null, 2), "utf-8");

  console.log(`Habilidades extraídas: ${listaFinal.length}`);
  console.log(`Salvo em: ${destino}`);
}

getTodasHabilidades();
