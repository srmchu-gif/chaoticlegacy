# Tutorial do Painel Admin Local (PT-BR)

Arquivo principal da ferramenta:
- `C:\Users\samue\Downloads\1\LIVRE PARA O CODEX\chaotic-api-main\scripts\delete-user-safe.ps1`

Inicialização:
- Execute `C:\Users\samue\Downloads\1\LIVRE PARA O CODEX\chaotic-api-main\admin-delete-user.bat`.
- A ferramenta cria backup automaticamente antes de qualquer operação de escrita.

## Visão geral das abas

### 1) Usuários
Para que serve:
- Consultar usuários do banco.
- Ver resumo de registros por tabela.
- Ver detalhes completos do usuário.
- Alterar senha.
- Excluir usuário (com confirmação).

Como usar:
1. Selecione o usuário no combo.
2. Clique `Atualizar` para recarregar lista.
3. Use `Ver detalhes` para abrir snapshot textual.
4. Use `Alterar senha` para reset operacional.
5. Use `Excluir usuário` somente em casos necessários.

Cuidados:
- Excluir usuário é irreversível sem restore de backup.
- Usuário `admin` tem confirmação extra.

---

### 2) Eventos
Para que serve:
- Criar, editar e excluir eventos de drop.
- Definir chance, período de início/fim e status ativo.
- Enviar notificação global no salvar (quando marcado).
- Configurar tribo por local (bloco “Tribo dos Locais”).

Como usar:
1. Na grade da esquerda, selecione um evento para editar.
2. No formulário da direita, ajuste campos.
3. Opcional: marque `Enviar notificação para todos` e preencha texto.
4. Clique `Salvar`.
5. Para tribo por local, escolha local + tribo e use `Salvar tribo`.

Cuidados:
- Edição com checkbox de notificação marcado reenviará broadcast.
- Sempre confira janela de tempo (`Início`/`Fim`).

---

### 3) Quests
Para que serve:
- Criar/editar/excluir templates de quest.
- Definir carta de recompensa, local de resgate e requisitos.

Como usar:
1. `Nova` para iniciar formulário.
2. Defina `Quest key`, título e descrição.
3. Configure recompensa e local de resgate.
4. Adicione requisitos com `Adicionar req`.
5. Clique `Salvar`.

Cuidados:
- Quests seguem validação de sets permitidos (DOP/ZOTH/SS).
- Remover requisito errado antes de salvar (`Remover req`).

---

### 4) Inventário/Scans
Para que serve:
- Listar scans por usuário (com filtro por tipo/set/busca).
- Conceder cartas manualmente (grant).
- Remover scans selecionados.

Como usar:
1. Selecione usuário e filtros.
2. Clique `Atualizar lista`.
3. Para grant: escolha tipo/carta/qtd/estrelas/source e clique `Grant carta`.
4. Para remover: selecione linhas e clique `Remover selecionados`.

Cuidados:
- Remoção exige confirmação dupla.
- Para criaturas, confira estrelas/variant antes de grant.

---

### 5) Perfil/Ranked
Para que serve:
- Ajustar perfil (`score`, `wins`, `losses`, tribo favorita, avatar).
- Ajustar ranked global e mensal por dromo.
- Aplicar reset mensal/streak por dromo.

Como usar:
1. Selecione usuário, temporada e dromo.
2. Clique `Carregar`.
3. Ajuste campos necessários.
4. Clique `Salvar ajustes`.
5. Use reset apenas quando necessário operacionalmente.

Cuidados:
- Reset mensal/streak tem confirmação dupla e backup.
- Confira temporada (`YYYY-MM`) antes de reset.

---

### 6) Estado PERIM
Para que serve:
- Inspecionar `state`, runs ativas e rewards pendentes.
- Encerrar run travada.
- Limpar rewards pendentes.
- Ajustar camp progress por local.

Como usar:
1. Selecione usuário e clique `Carregar estado`.
2. Use as grades para revisar runs/rewards/camp.
3. Execute ações corretivas quando necessário.

Cuidados:
- `Limpar recompensas` pode remover pendências ainda úteis ao jogador.
- Ajuste de camp progress impacta progressão de acampamento.

---

### 7) Logs
Para que serve:
- Visualizar log operacional consolidado da ferramenta.
- Confirmar execução de backups e mutações.

Como usar:
1. Abra a aba `Logs`.
2. Clique `Atualizar logs`.
3. Verifique entradas recentes após operações críticas.

## Fluxos recomendados (rápidos)

### Grant de carta para jogador
1. Inventário/Scans → filtrar usuário.
2. Grant Manual → tipo/carta/qtd/source.
3. `Grant carta`.
4. `Atualizar lista` e confirmar item novo.

### Criar evento com broadcast
1. Eventos → `Novo`.
2. Preencher campos do evento.
3. Marcar `Enviar notificação para todos` + texto.
4. `Salvar`.
5. Validar contador de envio no status da aba.

### Corrigir PERIM travado
1. Estado PERIM → selecionar usuário.
2. `Carregar estado`.
3. `Encerrar run ativa` e/ou `Limpar recompensas`.
4. Recarregar estado e confirmar normalização.

## Solução de problemas comuns

- **“Falha no backup”**
  - Verifique permissão de escrita em `backups/`.
  - Verifique espaço em disco.

- **Tela com elementos cortados**
  - Redimensione a janela e reabra a aba.
  - Use escala do Windows 100%/125%.

- **Engine não responde**
  - Verifique se `node` está instalado no PATH.
  - Rode manualmente: `node --check scripts/delete-user-safe.js`.

- **Dados não atualizam após salvar**
  - Clique no botão `Atualizar` da própria aba.
  - Consulte a aba `Logs` para confirmar operação.

## Boas práticas operacionais
- Preferir alterações pontuais e documentadas.
- Evitar operações destrutivas em lote sem necessidade.
- Sempre validar usuário alvo antes de confirmar.
- Em caso de dúvida, registrar ação e horário para auditoria.
