# Sistema de Drops de Criaturas - Documentação

## Visão Geral

Implementei um sistema completo de drops de criaturas para o Perimetr com as seguintes funcionalidades:

### 1. **Corrigido: Bug de Cargas Desnecessárias ao Salvar Deck**
- **Problema:** Ao salvar um deck com nome, todas as cartas reaparecia na biblioteca
- **Solução:** Removida chamada desnecessária de `refreshScansData()` na função `saveDeck()` em `public/js/app.js`
- **Resultado:** Apenas a lista de decks é atualizada, melhorando performance

---

## 2. **Sistema de Drops com Raridades**

### Configuração de Raridades
As raridades têm as seguintes porcentagens de aparição:
- **Common**: 60%
- **Uncommon**: 25%
- **Rare**: 10%
- **Super Rare**: 4%
- **Ultra Rare**: 1%

### Localização de Criaturas
Baseado nos dados do Excel fornecido:

#### **ENCONTRADO SOMENTE NESSE LOCAL / ENCONTRADO SOMENTE NESSE LOCAL 2**
- Criaturas com esta configuração têm **70% de chance** de estar nestes locais
- Prioridade máxima na rotação diária

#### **ENCONTRADO PROXIMO A ESSE LOCAL**
- Criatura pode aparecer no local especificado OU em locais adjacentes
- Sistema de adjacência carrega automaticamente dos dados de "LIGADO A LOCAL" do Excel

#### **Overworld / Underworld**
- Se a coluna contiver "Overworld" ou "Underworld", a criatura será restrita a esses tipos de locais
- Funciona em qualquer configuração de localização

---

## 3. **Rotação Diária de Criaturas**

### Como Funciona
- **Horário**: Cada dia à meia-noite (00:00) as criaturas se movem
- **Movimento**: Se uma criatura estava em um local, ela se move para um local adjacente
- **Preferência**: Criaturas com "SOMENTE NESSE LOCAL" têm 70% de chance de permanecer nesses locais
- **Uma por dia**: Cada criatura pode estar em apenas UM local por dia

### Banco de Dados
Três tabelas SQLite gerenciam o sistema:

1. **`location_adjacencies`**
   - Armazena mapa de adjacências de cada local
   - Campos: `location_name`, `adjacent_names` (JSON), `world_type`, `rarity_level`

2. **`creature_rarity_settings`**
   - Configuração de raridade e localização possível
   - Campos: `creature_loki`, `rarity_percent`, `possible_locations` (JSON), etc.

3. **`creature_daily_locations`**
   - Localização atual de cada criatura por data
   - Chave primária: `(location_date, creature_loki)`

---

## 4. **API Endpoints**

### GET `/api/creature-drops/location/:locationName`
Retorna criaturas disponíveis em um local específico hoje.

**Resposta:**
```json
{
  "location": "Castle Bodhran",
  "creatures": [
    {
      "creature_loki": 1016,
      "creature_name": "Arias",
      "types": "OverWorld Warrior",
      "rarity": "Common"
    }
  ]
}
```

### GET `/api/creature-drops/world-type/:worldType`
Retorna todas as criaturas disponíveis em um tipo de mundo (Overworld/Underworld).

**Resposta:**
```json
{
  "worldType": "Overworld",
  "date": "2026-04-30",
  "creatures": [
    { "creature_loki": 1016, "creature_name": "Arias", ... }
  ]
}
```

### GET `/api/creature-drops/news-ticker/:locationName`
Retorna dados formatados para o news ticker (tipos + flavortext).

**Resposta:**
```json
{
  "location": "Castle Bodhran",
  "newsItems": [
    {
      "name": "Arias",
      "types": "OverWorld Warrior",
      "flavortext": "If you think he looks angry now...",
      "tribe": "OverWorld",
      "rarity": "Common"
    }
  ]
}
```

---

## 5. **News Ticker na Tela de Ação**

### Funcionalidade
- Aparece automaticamente na parte inferior da seção "Ação em Andamento" no Perimetr
- Exibe tipos de criaturas e flavortext em scroll contínuo
- Atualiza a cada vez que uma ação é iniciada

### Formato do Ticker
```
I am [TYPES] | [FLAVORTEXT] • I am [TYPES] | [FLAVORTEXT] • ...
```

**Exemplo:**
```
I am OverWorld Warrior | If you think he looks angry now... • I am Mipedian Conjuror | A criatura misteriosa... • ...
```

### CSS Classes
- `.perim-news-ticker` - Container do ticker
- `.perim-ticker-text` - Texto que faz scroll
- `.hidden` - Para esconder o ticker quando não há criaturas

---

## 6. **Arquivos Modificados/Criados**

### Criados:
- `lib/creature-drop-manager.js` - Gerenciador principal de drops
- `lib/creature-drops-db.js` - Funções de banco de dados
- `lib/creature-daily-rotation.js` - Serviço de rotação diária

### Modificados:
- `server.js` - Integração com banco, endpoints, inicialização do serviço
- `public/js/app.js` - Correção do bug de cargas desnecessárias
- `public/js/menu.js` - Renderização do news ticker
- `public/menu.html` - HTML do news ticker
- `public/css/menu.css` - Estilo do news ticker

### Removidos/Descontinuados:
- `test-excel.js` - Arquivo temporário de teste (pode ser deletado)

---

## 7. **Configuração & Inicialização**

### Autoinicialização
O sistema se inicializa automaticamente ao iniciar o servidor:

```javascript
if (sqliteDb) {
  creatureDailyRotation = new CreatureDailyRotationService(
    sqliteDb, 
    PERIM_LOCATIONS_FILE,  // locais.xlsx
    PERIM_CREATURES_FILE   // criaturas.xlsx
  );
  creatureDailyRotation.initialize();
}
```

### Sincronização com Excel
- Dados são carregados de `locais.xlsx` e `criaturas.xlsx`
- Automaticamente sincronizados para banco SQLite na primeira execução
- Mapa de adjacências é construído a partir de "LIGADO A LOCAL" 1-11

---

## 8. **Próximas Integrações Sugeridas**

### Integrar com Sistema de Scan
Quando o jogador faz scan em um local:
```javascript
// Verificar se há criatura disponível hoje naquele local
const creaturesAtLocation = getCreaturesAtLocation(location);
if (creaturesAtLocation.length > 0) {
  // Calcular se dropou baseado na raridade
  const dropChance = RARITY_PERCENTAGES[creatureRarity];
}
```

### Eventos Especiais
Possibilidade de eventos que alteram a localização de criaturas fora da meia-noite.

### Interface de Administrador
Dashboard para visualizar/editar localizações de criaturas manualmente.

---

## 9. **Troubleshooting**

### O News Ticker não aparece?
1. Verifique se há criaturas no local (`/api/creature-drops/location/LocalName`)
2. Verifique se `perim-news-ticker` está no HTML
3. Verifique console para erros em `renderNewsTicker()`

### Criaturas não estão se movendo?
1. Verifique se `creature_daily_locations` está sendo atualizado
2. Verifique meia-noite local do servidor
3. Verifique `creatureDailyRotation.lastRotationDate`

### Erro: "Sistema de drops não inicializado"
1. Verifique se SQLite está disponível
2. Verifique caminho dos arquivos Excel
3. Verifique logs do console

---

## 10. **Exemplo de Uso no Frontend**

```javascript
// Obter criaturas em um local
async function getCreaturesAtLocation(locationName) {
  const response = await fetch(
    `/api/creature-drops/location/${encodeURIComponent(locationName)}`
  );
  const data = await response.json();
  return data.creatures;
}

// Usar no scan
async function performScan(location) {
  const creatures = await getCreaturesAtLocation(location.name);
  const rarityTable = RARITY_PERCENTAGES;
  
  for (const creature of creatures) {
    const chance = rarityTable[creature.rarity];
    if (Math.random() < chance) {
      // Criatura foi dropada!
      addToInventory(creature);
    }
  }
}
```

---

**Sistema implementado e pronto para uso! 🚀**
