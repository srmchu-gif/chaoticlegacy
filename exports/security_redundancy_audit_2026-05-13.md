# Auditoria de Redundância + Segurança

Data: 2026-05-13
Escopo: API + Frontend + operação local/CI

## Status rápido
- ✅ Segredos e artefatos sensíveis removidos do versionamento Git (mantidos localmente)
- ✅ Hardening inicial de autenticação/autorização aplicado (RBAC com `role`)
- ✅ Headers de segurança HTTP aplicados no backend
- ✅ Isolamento de leitura XLSX (path/size/ext) aplicado
- ✅ Dependência `axios` atualizada
- ⚠️ `xlsx` continua com advisory de alto risco (sem fix upstream disponível)

## Findings priorizados

### Crítico
1. Artefatos sensíveis em repositório (runner/credenciais/logs/db)
   - Risco: vazamento de credenciais e takeover de automações
   - Correção aplicada:
     - removido do índice Git: `actions-runner/`, `logs/`, `debug-logs/`, `chaotic.db`
     - `.gitignore` endurecido para bloquear recorrência
   - Ação operacional pendente:
     - rotacionar segredos (SMTP, Turnstile, tokens de runner, qualquer chave de deploy)

### Alto
2. Controle de admin baseado só em username (escalada por identidade)
   - Risco: usuário malicioso com username "admin" em cenário legado
   - Correção aplicada:
     - `users.role` criado/migrado com default `player`
     - seed e migração forçam `admin` com role `admin`
     - guard admin agora exige role (com fallback legado auditado)

3. Vetores XSS em renderização dinâmica
   - Risco: injeção de HTML/script em listas/salas/chats
   - Correção aplicada:
     - hardening de render de salas multiplayer (`escapeHtml` em campos de backend)
     - helper `escapeHtml` adicionado no `app.js` para blocos de observabilidade
   - Pendência:
     - revisão ampla de todos os `innerHTML` com dados externos

4. Dependências vulneráveis
   - `axios`: corrigido via update
   - `xlsx`: sem fix disponível (upstream)
   - Mitigação aplicada:
     - leitura XLSX agora só por helper seguro com:
       - limite de tamanho (`XLSX_MAX_FILE_BYTES`)
       - extensão obrigatória `.xlsx`
       - path restrito ao projeto

### Médio
5. Compatibilidade legada de senha hash no cliente
   - Risco: fluxo legado aumenta superfície de ataque
   - Correção aplicada:
     - logs de auditoria quando login/cadastro chegam via `passwordHash` legado
   - Próximo passo recomendado:
     - remover definitivamente o modo legado em janela controlada

6. Hardening de sessão e resposta de sessão
   - Correção aplicada:
     - `/api/auth/session` agora expõe `role` para UI/admin gating consistente
     - cookies e sessão seguem fluxo seguro existente

## Redundâncias detectadas
- `actions-runner/` e artefatos de execução não devem ficar no repositório de aplicação
- `public/js/menu_temp.txt` identificado como arquivo legado/temporário
- dependências `fs` e `path` removidas do `package.json` (eram redundantes)

## Evidências de validação
- `npm audit --omit=dev`:
  - alta restante: `xlsx` (mitigado operacionalmente)
- checks locais recomendados (executar em cada release):
  - `node --check server.js`
  - `node --check public/js/menu.js`
  - `node --check public/js/app.js`
  - `npm test`

## Checklist operacional pós-patch
1. Rotacionar todas as credenciais potencialmente expostas
2. Revisar GitHub Actions/Render/Cloudflare para segredos novos
3. Confirmar permissões de repo privado e workflows
4. Validar login/admin/chat/perim em ambiente de produção
5. Planejar fase 2: remover fallback legado admin + passwordHash
