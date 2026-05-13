# Chaotic Data-Driven Arena

Jogo digital do Chaotic totalmente orientado a dados locais.

## Como funciona

- O servidor varre automaticamente todos os `.json` do projeto (exceto arquivos de build).
- As cartas sao classificadas por tipo (`creatures`, `attacks`, `battlegear`, `locations`, `mugic`) sem cadastro manual.
- A pasta `downloads/` e escaneada recursivamente.
- A imagem de cada carta e associada automaticamente pelo nome normalizado do arquivo.
- Novos arquivos JSON/imagens entram no jogo apenas adicionando-os na pasta e clicando em **Recarregar Dados**.

## Recursos implementados

- Biblioteca completa de cartas carregada via JSON local.
- Deck Builder:
  - listar cartas por tipo;
  - busca textual;
  - modo de deck (`Casual` ou `Competitivo`);
  - validacao competitiva automatica (quantidades por tipo + limite de copias);
  - adicionar/remover cartas;
  - salvar e carregar decks em `decks/*.json`.
- Campo de batalha:
  - layout estilo Chaotic Online (mesa central, trilhas laterais, cartas espelhadas e HUD lateral minima);
  - selecao de dois decks com modo de regras;
  - 6 slots fixos de criaturas por jogador;
  - battle gear anexado visualmente em cada criatura;
  - location ativa no centro da mesa;
  - ataques escolhidos pelos dois jogadores antes do calculo (revelacao simultanea);
  - fluxo completo por fases: Start Turn -> Select Battling Creatures -> Players Choose Attacks -> Reveal -> Location -> Mugic -> Passive -> Compare Elements -> Calculate Damage -> Apply Status -> Update Energy -> Check Defeat -> Next Turn;
  - parser generico de efeitos textuais (challenge, stat check/fail, dano, cura, begin combat, modificadores de status/elemento e reducao de dano);
  - log completo da partida.

## Rodar o projeto

```bash
npm start
```

Servidor: `http://localhost:3000`

## Publicar 100% funcional (GitHub Pages + Render)

Para funcionar com todas as funcionalidades (auth, PERIM, trocas, multiplayer, perfil e admin):

1. **Backend no Render (Node + SQLite persistente)**
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check: `/health`
   - Persistent Disk mount path: `/var/data`
   - Vars obrigatorias:
     - `NODE_ENV=production`
     - `PORT=10000` (ou porta definida pelo provider)
     - `SQLITE_FILE=/var/data/chaotic.db`
     - `PERSIST_DIR=/var/data`
    - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
    - `TURNSTILE_SECRET_KEY` (captcha anti-bot do cadastro)
     - `CORS_ALLOWED_ORIGINS=https://SEU-USUARIO.github.io`

2. **Frontend no GitHub Pages**
   - Workflow pronto em `.github/workflows/pages.yml` (publica pasta `public/`).
   - Arquivo `public/.nojekyll` ja incluido.

3. **Configurar frontend para ambiente publicado**
   - Edite `public/config.js`:
     - `apiBase`: URL do backend Render (ex.: `https://seu-backend.onrender.com`)
     - `basePath`: subpasta do repo no Pages (ex.: `/nome-do-repo/`)
     - `turnstileSiteKey`: site key publico do Turnstile

4. **Depois do deploy**
   - Acesse: `https://SEU-USUARIO.github.io/NOME-DO-REPO/`
   - Se o navegador estiver com cache antigo, faca hard refresh (Ctrl+F5).

### Hotfix rapido para erro no Render (`Cannot find module './lib/library'`)

Se o Render mostrar esse erro, normalmente foi deploy parcial via upload manual.

1. Rode preflight local:
   ```bash
   npm run render:preflight
   ```
2. Garanta commit/push na branch conectada ao Render (ex.: `main`).
3. No Render:
   - confirmar repo/branch corretos;
   - `Root Directory` vazio (raiz do repo);
   - `Build Command`: `npm ci`;
   - `Start Command`: `npm start`.
4. Fazer **Manual Deploy** da ultima commit.
5. Se persistir, use **Clear build cache & deploy**.

Arquivos que obrigatoriamente precisam existir na tree do GitHub:
- `server.js`
- `lib/library.js`
- `lib/effect-parser.js`
- `package.json`

## Testes

```bash
npm test
```

## Build do launcher EXE

Requisitos no Windows:
- PowerShell com suporte a `Add-Type`;
- Node.js instalado no PATH;
- Microsoft Edge instalado.

Gerar o executavel do jogo:

```bash
npm run build:exe
```

O launcher abre o jogo em modo app full-screen no Deck Builder (`?view=builder`) e encerra o servidor local automaticamente quando a janela do jogo e fechada.
O build gera um executavel versionado (`Chaotic-YYYYMMDD-HHmmss.exe`) com o icone embutido a partir de `favicon.ico` para evitar cache antigo de icone no Explorer.

## Estrutura principal

- `server.js`: servidor HTTP + API (`/api/library`, `/api/decks`, `/api/reload`).
- `lib/library.js`: loader automatico de JSON e imagens.
- `lib/effect-parser.js`: parser generico de habilidades/efeitos.
- `public/js/battle/board-state.js`: estado da mesa (posicoes, engajamento, cartas em jogo).
- `public/js/battle/engine.js`: motor de batalha data-driven por fases.
- `public/`: interface web (deck builder + camada visual da batalha).
- `decks/`: decks salvos.
- `tests/`: testes automatizados.

## Pre-deploy Security Checklist

- Confirmar que `actions-runner/`, `logs/`, `debug-logs/` e `chaotic.db` nao estao versionados.
- Rotacionar segredos antes de publicar (`SMTP_*`, `TURNSTILE_SECRET_KEY`, tokens de deploy/runner/tunnel).
- Validar acesso admin por `role` (nao apenas por username).
- Executar `node --check server.js`, `node --check public/js/menu.js`, `node --check public/js/app.js`.
- Executar `npm test` e `npm audit --omit=dev` antes de cada deploy.
