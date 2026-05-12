param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$dbPath = Join-Path $ProjectRoot "runtime\chaotic.db"
$enginePath = Join-Path $ProjectRoot "scripts\delete-user-safe.js"
$backupScript = Join-Path $ProjectRoot "scripts\backup-sqlite.ps1"
$logsDir = Join-Path $ProjectRoot "logs"

if (!(Test-Path $dbPath)) { throw "Banco SQLite nao encontrado em: $dbPath" }
if (!(Test-Path $enginePath)) { throw "Script do painel admin nao encontrado em: $enginePath" }
if (!(Test-Path $backupScript)) { throw "Script de backup nao encontrado em: $backupScript" }

function ConvertFrom-JsonCompat {
  param([Parameter(Mandatory = $true)][string]$Text)
  $cmd = Get-Command ConvertFrom-Json
  if ($cmd -and $cmd.Parameters -and $cmd.Parameters.ContainsKey("Depth")) {
    return ($Text | ConvertFrom-Json -Depth 100)
  }
  return ($Text | ConvertFrom-Json)
}

function Ensure-LogsDir {
  if (!(Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
  }
}

function Add-AdminLog {
  param(
    [string]$Operation,
    [string]$Target = "",
    [string]$BackupPath = ""
  )
  Ensure-LogsDir
  $line = "{0} | op={1} | target={2} | backup={3} | operator=local-admin" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Operation, $Target, $BackupPath
  Add-Content -Path (Join-Path $logsDir "admin-panel.log") -Value $line -Encoding UTF8
}

function Invoke-AdminEngine {
  param(
    [Parameter(Mandatory = $true)][string]$Action,
    [string]$Username = "",
    [string]$Password = "",
    [string]$Id = "",
    [string]$QuestKey = "",
    [object]$Payload = $null,
    [string]$CardType = ""
  )

  $oldWarnings = $env:NODE_NO_WARNINGS
  $env:NODE_NO_WARNINGS = "1"
  try {
    $args = @($enginePath, "--action", $Action, "--db", $dbPath)
    if ($Username) { $args += @("--username", $Username) }
    if ($Password) { $args += @("--password", $Password) }
    if ($Id) { $args += @("--id", $Id) }
    if ($QuestKey) { $args += @("--questKey", $QuestKey) }
    if ($CardType) { $args += @("--cardType", $CardType) }
    if ($null -ne $Payload) {
      $json = ConvertTo-Json $Payload -Depth 20 -Compress
      $payloadB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
      $args += @("--payloadB64", $payloadB64)
    }

    $output = & node @args 2>&1
    $exitCode = $LASTEXITCODE
    $raw = ($output | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw "Resposta vazia do motor admin."
    }

    $payload = $null
    try {
      $lines = @($output | ForEach-Object { [string]$_ })
      $markerLine = $lines | Where-Object { $_ -like "__DELETE_USER_SAFE_JSON_B64__:*" } | Select-Object -Last 1
      if ($markerLine) {
        $b64 = $markerLine.Substring("__DELETE_USER_SAFE_JSON_B64__:".Length)
        $jsonText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64))
        $payload = ConvertFrom-JsonCompat -Text $jsonText
      } else {
        $payload = ConvertFrom-JsonCompat -Text $raw
      }
    } catch {
      throw "Falha ao interpretar retorno do motor: $raw"
    }

    if ($exitCode -ne 0 -or -not $payload.ok) {
      $err = if ($payload.error) { [string]$payload.error } else { "erro_desconhecido" }
      throw "Motor admin retornou erro: $err"
    }

    return $payload
  } finally {
    if ($null -eq $oldWarnings) {
      Remove-Item Env:NODE_NO_WARNINGS -ErrorAction SilentlyContinue
    } else {
      $env:NODE_NO_WARNINGS = $oldWarnings
    }
  }
}

function Run-Backup {
  $output = & $backupScript -ProjectRoot $ProjectRoot 2>&1
  $text = ($output | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Falha no backup: $text"
  }
  if ($text -match "Backup gerado:\s*(.+)$") { return $matches[1].Trim() }
  return "(caminho nao identificado)"
}

function Show-TextPrompt {
  param(
    [string]$Title,
    [string]$Message,
    [bool]$UsePassword = $false
  )
  $promptForm = New-Object System.Windows.Forms.Form
  $promptForm.Text = $Title
  $promptForm.StartPosition = "CenterParent"
  $promptForm.Size = New-Object System.Drawing.Size(450, 180)
  $promptForm.FormBorderStyle = "FixedDialog"
  $promptForm.MaximizeBox = $false
  $promptForm.MinimizeBox = $false

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Message
  $label.AutoSize = $false
  $label.Size = New-Object System.Drawing.Size(410, 42)
  $label.Location = New-Object System.Drawing.Point(15, 10)
  $promptForm.Controls.Add($label)

  $textbox = New-Object System.Windows.Forms.TextBox
  $textbox.Size = New-Object System.Drawing.Size(410, 24)
  $textbox.Location = New-Object System.Drawing.Point(15, 58)
  if ($UsePassword) {
    $textbox.UseSystemPasswordChar = $true
  }
  $promptForm.Controls.Add($textbox)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = "Confirmar"
  $ok.Location = New-Object System.Drawing.Point(260, 95)
  $ok.Size = New-Object System.Drawing.Size(80, 28)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $promptForm.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = "Cancelar"
  $cancel.Location = New-Object System.Drawing.Point(345, 95)
  $cancel.Size = New-Object System.Drawing.Size(80, 28)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $promptForm.Controls.Add($cancel)

  $promptForm.AcceptButton = $ok
  $promptForm.CancelButton = $cancel

  $result = $promptForm.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    return $textbox.Text
  }
  return $null
}

function New-DisplayItem {
  param([string]$Label, [string]$Value)
  $obj = New-Object PSObject -Property @{ Label = $Label; Value = $Value }
  return $obj
}

function Set-ComboItems {
  param(
    [Parameter(Mandatory = $true)]$Combo,
    [Parameter(Mandatory = $true)][object[]]$Items
  )
  $Combo.DataSource = $null
  $binding = New-Object System.Collections.ArrayList
  foreach ($item in $Items) {
    [void]$binding.Add($item)
  }
  $Combo.DisplayMember = "Label"
  $Combo.ValueMember = "Value"
  $Combo.DataSource = $binding
}

function Get-SelectedValue {
  param([Parameter(Mandatory = $true)]$Combo)
  if ($null -eq $Combo.SelectedItem) { return "" }
  try {
    return [string]$Combo.SelectedItem.Value
  } catch {
    return ""
  }
}

$script:CatalogCards = @()
$script:LocationCards = @()
$script:Users = @()
$script:EventsCache = @()
$script:QuestsCache = @()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Painel Admin Local - Usuarios / Eventos / Quests"
$form.Size = New-Object System.Drawing.Size(1260, 820)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(1160, 760)

$tab = New-Object System.Windows.Forms.TabControl
$tab.Dock = "Fill"
$form.Controls.Add($tab)

$status = New-Object System.Windows.Forms.Label
$status.Dock = "Bottom"
$status.Height = 26
$status.TextAlign = "MiddleLeft"
$status.Text = "Pronto."
$status.Padding = New-Object System.Windows.Forms.Padding(8, 0, 0, 0)
$form.Controls.Add($status)

function Set-Status {
  param([string]$Text)
  $status.Text = $Text
  $status.Refresh()
}

$tabUsers = New-Object System.Windows.Forms.TabPage
$tabUsers.Text = "Usuarios"
$tab.Controls.Add($tabUsers)

$tabEvents = New-Object System.Windows.Forms.TabPage
$tabEvents.Text = "Eventos"
$tab.Controls.Add($tabEvents)

$tabQuests = New-Object System.Windows.Forms.TabPage
$tabQuests.Text = "Quests"
$tab.Controls.Add($tabQuests)

$tabLogs = New-Object System.Windows.Forms.TabPage
$tabLogs.Text = "Logs"
$tab.Controls.Add($tabLogs)

# Usuarios tab
$usersTop = New-Object System.Windows.Forms.Panel
$usersTop.Dock = "Top"
$usersTop.Height = 56
$tabUsers.Controls.Add($usersTop)

$usersBody = New-Object System.Windows.Forms.SplitContainer
$usersBody.Dock = "Fill"
$usersBody.Orientation = "Horizontal"
$usersBody.SplitterDistance = 330
$tabUsers.Controls.Add($usersBody)

$userLabel = New-Object System.Windows.Forms.Label
$userLabel.Text = "Usuario:"
$userLabel.Location = New-Object System.Drawing.Point(12, 17)
$userLabel.Size = New-Object System.Drawing.Size(60, 22)
$usersTop.Controls.Add($userLabel)

$userCombo = New-Object System.Windows.Forms.ComboBox
$userCombo.DropDownStyle = "DropDownList"
$userCombo.Location = New-Object System.Drawing.Point(74, 14)
$userCombo.Size = New-Object System.Drawing.Size(260, 28)
$usersTop.Controls.Add($userCombo)

$btnUsersRefresh = New-Object System.Windows.Forms.Button
$btnUsersRefresh.Text = "Atualizar"
$btnUsersRefresh.Location = New-Object System.Drawing.Point(346, 12)
$btnUsersRefresh.Size = New-Object System.Drawing.Size(90, 30)
$usersTop.Controls.Add($btnUsersRefresh)

$btnUserDetail = New-Object System.Windows.Forms.Button
$btnUserDetail.Text = "Ver detalhes"
$btnUserDetail.Location = New-Object System.Drawing.Point(442, 12)
$btnUserDetail.Size = New-Object System.Drawing.Size(110, 30)
$usersTop.Controls.Add($btnUserDetail)

$btnUserPassword = New-Object System.Windows.Forms.Button
$btnUserPassword.Text = "Alterar senha"
$btnUserPassword.Location = New-Object System.Drawing.Point(558, 12)
$btnUserPassword.Size = New-Object System.Drawing.Size(120, 30)
$usersTop.Controls.Add($btnUserPassword)

$btnUserDelete = New-Object System.Windows.Forms.Button
$btnUserDelete.Text = "Excluir usuario"
$btnUserDelete.Location = New-Object System.Drawing.Point(684, 12)
$btnUserDelete.Size = New-Object System.Drawing.Size(120, 30)
$usersTop.Controls.Add($btnUserDelete)

$usersPreviewGrid = New-Object System.Windows.Forms.DataGridView
$usersPreviewGrid.Dock = "Fill"
$usersPreviewGrid.ReadOnly = $true
$usersPreviewGrid.AllowUserToAddRows = $false
$usersPreviewGrid.AllowUserToDeleteRows = $false
$usersPreviewGrid.RowHeadersVisible = $false
$usersPreviewGrid.SelectionMode = "FullRowSelect"
$usersPreviewGrid.AutoSizeColumnsMode = "Fill"
$usersPreviewGrid.ColumnCount = 3
$usersPreviewGrid.Columns[0].Name = "Tabela"
$usersPreviewGrid.Columns[1].Name = "Registros"
$usersPreviewGrid.Columns[2].Name = "Detalhe"
$usersBody.Panel1.Controls.Add($usersPreviewGrid)

$usersDetail = New-Object System.Windows.Forms.TextBox
$usersDetail.Multiline = $true
$usersDetail.ReadOnly = $true
$usersDetail.ScrollBars = "Vertical"
$usersDetail.Dock = "Fill"
$usersBody.Panel2.Controls.Add($usersDetail)

# Eventos tab
$eventsSplit = New-Object System.Windows.Forms.SplitContainer
$eventsSplit.Dock = "Fill"
$eventsSplit.Orientation = "Vertical"
$eventsSplit.SplitterDistance = 620
$tabEvents.Controls.Add($eventsSplit)

$eventsGrid = New-Object System.Windows.Forms.DataGridView
$eventsGrid.Dock = "Fill"
$eventsGrid.ReadOnly = $true
$eventsGrid.AllowUserToAddRows = $false
$eventsGrid.AllowUserToDeleteRows = $false
$eventsGrid.RowHeadersVisible = $false
$eventsGrid.SelectionMode = "FullRowSelect"
$eventsGrid.AutoSizeColumnsMode = "Fill"
$eventsGrid.ColumnCount = 8
$eventsGrid.Columns[0].Name = "ID"
$eventsGrid.Columns[1].Name = "Texto"
$eventsGrid.Columns[2].Name = "Carta"
$eventsGrid.Columns[3].Name = "Tipo"
$eventsGrid.Columns[4].Name = "Local"
$eventsGrid.Columns[5].Name = "Chance%"
$eventsGrid.Columns[6].Name = "Inicio"
$eventsGrid.Columns[7].Name = "Fim"
$eventsSplit.Panel1.Controls.Add($eventsGrid)

$eventsPanel = New-Object System.Windows.Forms.Panel
$eventsPanel.Dock = "Fill"
$eventsSplit.Panel2.Controls.Add($eventsPanel)

$eventIdLabel = New-Object System.Windows.Forms.Label
$eventIdLabel.Text = "Evento selecionado: novo"
$eventIdLabel.Location = New-Object System.Drawing.Point(12, 12)
$eventIdLabel.Size = New-Object System.Drawing.Size(520, 22)
$eventsPanel.Controls.Add($eventIdLabel)

$lblEventText = New-Object System.Windows.Forms.Label
$lblEventText.Text = "Texto do evento:"
$lblEventText.Location = New-Object System.Drawing.Point(12, 40)
$lblEventText.Size = New-Object System.Drawing.Size(140, 20)
$eventsPanel.Controls.Add($lblEventText)

$txtEventText = New-Object System.Windows.Forms.TextBox
$txtEventText.Location = New-Object System.Drawing.Point(12, 62)
$txtEventText.Size = New-Object System.Drawing.Size(520, 24)
$eventsPanel.Controls.Add($txtEventText)

$lblEventType = New-Object System.Windows.Forms.Label
$lblEventType.Text = "Tipo da carta:"
$lblEventType.Location = New-Object System.Drawing.Point(12, 92)
$lblEventType.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventType)

$comboEventType = New-Object System.Windows.Forms.ComboBox
$comboEventType.DropDownStyle = "DropDownList"
$comboEventType.Location = New-Object System.Drawing.Point(12, 114)
$comboEventType.Size = New-Object System.Drawing.Size(180, 28)
$eventsPanel.Controls.Add($comboEventType)

$lblEventCard = New-Object System.Windows.Forms.Label
$lblEventCard.Text = "Carta:"
$lblEventCard.Location = New-Object System.Drawing.Point(12, 148)
$lblEventCard.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventCard)

$comboEventCard = New-Object System.Windows.Forms.ComboBox
$comboEventCard.DropDownStyle = "DropDownList"
$comboEventCard.Location = New-Object System.Drawing.Point(12, 170)
$comboEventCard.Size = New-Object System.Drawing.Size(520, 28)
$eventsPanel.Controls.Add($comboEventCard)

$lblEventLoc = New-Object System.Windows.Forms.Label
$lblEventLoc.Text = "Local:"
$lblEventLoc.Location = New-Object System.Drawing.Point(12, 204)
$lblEventLoc.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventLoc)

$comboEventLocation = New-Object System.Windows.Forms.ComboBox
$comboEventLocation.DropDownStyle = "DropDownList"
$comboEventLocation.Location = New-Object System.Drawing.Point(12, 226)
$comboEventLocation.Size = New-Object System.Drawing.Size(520, 28)
$eventsPanel.Controls.Add($comboEventLocation)

$lblEventChance = New-Object System.Windows.Forms.Label
$lblEventChance.Text = "Chance (%):"
$lblEventChance.Location = New-Object System.Drawing.Point(12, 260)
$lblEventChance.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventChance)

$numEventChance = New-Object System.Windows.Forms.NumericUpDown
$numEventChance.Location = New-Object System.Drawing.Point(12, 282)
$numEventChance.Size = New-Object System.Drawing.Size(120, 24)
$numEventChance.Minimum = 0
$numEventChance.Maximum = 100
$numEventChance.DecimalPlaces = 2
$numEventChance.Increment = 0.5
$eventsPanel.Controls.Add($numEventChance)

$lblEventStart = New-Object System.Windows.Forms.Label
$lblEventStart.Text = "Inicio:"
$lblEventStart.Location = New-Object System.Drawing.Point(12, 312)
$lblEventStart.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventStart)

$dtEventStart = New-Object System.Windows.Forms.DateTimePicker
$dtEventStart.Location = New-Object System.Drawing.Point(12, 334)
$dtEventStart.Size = New-Object System.Drawing.Size(250, 24)
$dtEventStart.Format = "Custom"
$dtEventStart.CustomFormat = "yyyy-MM-dd HH:mm:ss"
$eventsPanel.Controls.Add($dtEventStart)

$lblEventEnd = New-Object System.Windows.Forms.Label
$lblEventEnd.Text = "Fim:"
$lblEventEnd.Location = New-Object System.Drawing.Point(282, 312)
$lblEventEnd.Size = New-Object System.Drawing.Size(100, 20)
$eventsPanel.Controls.Add($lblEventEnd)

$dtEventEnd = New-Object System.Windows.Forms.DateTimePicker
$dtEventEnd.Location = New-Object System.Drawing.Point(282, 334)
$dtEventEnd.Size = New-Object System.Drawing.Size(250, 24)
$dtEventEnd.Format = "Custom"
$dtEventEnd.CustomFormat = "yyyy-MM-dd HH:mm:ss"
$eventsPanel.Controls.Add($dtEventEnd)

$chkEventEnabled = New-Object System.Windows.Forms.CheckBox
$chkEventEnabled.Text = "Ativo"
$chkEventEnabled.Location = New-Object System.Drawing.Point(12, 366)
$chkEventEnabled.Size = New-Object System.Drawing.Size(100, 26)
$chkEventEnabled.Checked = $true
$eventsPanel.Controls.Add($chkEventEnabled)

$btnEventNew = New-Object System.Windows.Forms.Button
$btnEventNew.Text = "Novo"
$btnEventNew.Location = New-Object System.Drawing.Point(12, 404)
$btnEventNew.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventNew)

$btnEventSave = New-Object System.Windows.Forms.Button
$btnEventSave.Text = "Salvar"
$btnEventSave.Location = New-Object System.Drawing.Point(98, 404)
$btnEventSave.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventSave)

$btnEventDelete = New-Object System.Windows.Forms.Button
$btnEventDelete.Text = "Excluir"
$btnEventDelete.Location = New-Object System.Drawing.Point(184, 404)
$btnEventDelete.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventDelete)

$btnEventRefresh = New-Object System.Windows.Forms.Button
$btnEventRefresh.Text = "Atualizar"
$btnEventRefresh.Location = New-Object System.Drawing.Point(270, 404)
$btnEventRefresh.Size = New-Object System.Drawing.Size(90, 30)
$eventsPanel.Controls.Add($btnEventRefresh)

# Quests tab
$questSplit = New-Object System.Windows.Forms.SplitContainer
$questSplit.Dock = "Fill"
$questSplit.Orientation = "Vertical"
$questSplit.SplitterDistance = 620
$tabQuests.Controls.Add($questSplit)

$questsGrid = New-Object System.Windows.Forms.DataGridView
$questsGrid.Dock = "Fill"
$questsGrid.ReadOnly = $true
$questsGrid.AllowUserToAddRows = $false
$questsGrid.AllowUserToDeleteRows = $false
$questsGrid.RowHeadersVisible = $false
$questsGrid.SelectionMode = "FullRowSelect"
$questsGrid.AutoSizeColumnsMode = "Fill"
$questsGrid.ColumnCount = 6
$questsGrid.Columns[0].Name = "QuestKey"
$questsGrid.Columns[1].Name = "Titulo"
$questsGrid.Columns[2].Name = "Recompensa"
$questsGrid.Columns[3].Name = "Local resgate"
$questsGrid.Columns[4].Name = "Ativa"
$questsGrid.Columns[5].Name = "Reqs"
$questSplit.Panel1.Controls.Add($questsGrid)

$questPanel = New-Object System.Windows.Forms.Panel
$questPanel.Dock = "Fill"
$questSplit.Panel2.Controls.Add($questPanel)

$lblQuestKey = New-Object System.Windows.Forms.Label
$lblQuestKey.Text = "Quest key:"
$lblQuestKey.Location = New-Object System.Drawing.Point(12, 12)
$lblQuestKey.Size = New-Object System.Drawing.Size(100, 20)
$questPanel.Controls.Add($lblQuestKey)

$txtQuestKey = New-Object System.Windows.Forms.TextBox
$txtQuestKey.Location = New-Object System.Drawing.Point(12, 34)
$txtQuestKey.Size = New-Object System.Drawing.Size(220, 24)
$questPanel.Controls.Add($txtQuestKey)

$lblQuestTitle = New-Object System.Windows.Forms.Label
$lblQuestTitle.Text = "Titulo:"
$lblQuestTitle.Location = New-Object System.Drawing.Point(238, 12)
$lblQuestTitle.Size = New-Object System.Drawing.Size(80, 20)
$questPanel.Controls.Add($lblQuestTitle)

$txtQuestTitle = New-Object System.Windows.Forms.TextBox
$txtQuestTitle.Location = New-Object System.Drawing.Point(238, 34)
$txtQuestTitle.Size = New-Object System.Drawing.Size(294, 24)
$questPanel.Controls.Add($txtQuestTitle)

$lblQuestDesc = New-Object System.Windows.Forms.Label
$lblQuestDesc.Text = "Descricao:"
$lblQuestDesc.Location = New-Object System.Drawing.Point(12, 64)
$lblQuestDesc.Size = New-Object System.Drawing.Size(100, 20)
$questPanel.Controls.Add($lblQuestDesc)

$txtQuestDesc = New-Object System.Windows.Forms.TextBox
$txtQuestDesc.Location = New-Object System.Drawing.Point(12, 86)
$txtQuestDesc.Size = New-Object System.Drawing.Size(520, 50)
$txtQuestDesc.Multiline = $true
$questPanel.Controls.Add($txtQuestDesc)

$lblRewardType = New-Object System.Windows.Forms.Label
$lblRewardType.Text = "Tipo recompensa:"
$lblRewardType.Location = New-Object System.Drawing.Point(12, 140)
$lblRewardType.Size = New-Object System.Drawing.Size(120, 20)
$questPanel.Controls.Add($lblRewardType)

$comboRewardType = New-Object System.Windows.Forms.ComboBox
$comboRewardType.DropDownStyle = "DropDownList"
$comboRewardType.Location = New-Object System.Drawing.Point(12, 162)
$comboRewardType.Size = New-Object System.Drawing.Size(180, 28)
$questPanel.Controls.Add($comboRewardType)

$lblRewardCard = New-Object System.Windows.Forms.Label
$lblRewardCard.Text = "Carta recompensa:"
$lblRewardCard.Location = New-Object System.Drawing.Point(198, 140)
$lblRewardCard.Size = New-Object System.Drawing.Size(130, 20)
$questPanel.Controls.Add($lblRewardCard)

$comboRewardCard = New-Object System.Windows.Forms.ComboBox
$comboRewardCard.DropDownStyle = "DropDownList"
$comboRewardCard.Location = New-Object System.Drawing.Point(198, 162)
$comboRewardCard.Size = New-Object System.Drawing.Size(334, 28)
$questPanel.Controls.Add($comboRewardCard)

$lblTargetLocation = New-Object System.Windows.Forms.Label
$lblTargetLocation.Text = "Local de resgate:"
$lblTargetLocation.Location = New-Object System.Drawing.Point(12, 194)
$lblTargetLocation.Size = New-Object System.Drawing.Size(120, 20)
$questPanel.Controls.Add($lblTargetLocation)

$comboQuestTargetLocation = New-Object System.Windows.Forms.ComboBox
$comboQuestTargetLocation.DropDownStyle = "DropDownList"
$comboQuestTargetLocation.Location = New-Object System.Drawing.Point(12, 216)
$comboQuestTargetLocation.Size = New-Object System.Drawing.Size(520, 28)
$questPanel.Controls.Add($comboQuestTargetLocation)

$lblAnomalyIds = New-Object System.Windows.Forms.Label
$lblAnomalyIds.Text = "Locais de anomalia (ids separados por virgula):"
$lblAnomalyIds.Location = New-Object System.Drawing.Point(12, 248)
$lblAnomalyIds.Size = New-Object System.Drawing.Size(320, 20)
$questPanel.Controls.Add($lblAnomalyIds)

$txtAnomalyIds = New-Object System.Windows.Forms.TextBox
$txtAnomalyIds.Location = New-Object System.Drawing.Point(12, 270)
$txtAnomalyIds.Size = New-Object System.Drawing.Size(520, 24)
$questPanel.Controls.Add($txtAnomalyIds)

$chkQuestEnabled = New-Object System.Windows.Forms.CheckBox
$chkQuestEnabled.Text = "Ativa"
$chkQuestEnabled.Location = New-Object System.Drawing.Point(12, 300)
$chkQuestEnabled.Size = New-Object System.Drawing.Size(90, 24)
$chkQuestEnabled.Checked = $true
$questPanel.Controls.Add($chkQuestEnabled)

$lblReqTitle = New-Object System.Windows.Forms.Label
$lblReqTitle.Text = "Requisitos:"
$lblReqTitle.Location = New-Object System.Drawing.Point(12, 328)
$lblReqTitle.Size = New-Object System.Drawing.Size(120, 20)
$questPanel.Controls.Add($lblReqTitle)

$comboReqType = New-Object System.Windows.Forms.ComboBox
$comboReqType.DropDownStyle = "DropDownList"
$comboReqType.Location = New-Object System.Drawing.Point(12, 350)
$comboReqType.Size = New-Object System.Drawing.Size(180, 28)
$questPanel.Controls.Add($comboReqType)

$comboReqCard = New-Object System.Windows.Forms.ComboBox
$comboReqCard.DropDownStyle = "DropDownList"
$comboReqCard.Location = New-Object System.Drawing.Point(198, 350)
$comboReqCard.Size = New-Object System.Drawing.Size(246, 28)
$questPanel.Controls.Add($comboReqCard)

$numReqAmount = New-Object System.Windows.Forms.NumericUpDown
$numReqAmount.Location = New-Object System.Drawing.Point(450, 350)
$numReqAmount.Size = New-Object System.Drawing.Size(82, 24)
$numReqAmount.Minimum = 1
$numReqAmount.Maximum = 99
$numReqAmount.Value = 1
$questPanel.Controls.Add($numReqAmount)

$btnReqAdd = New-Object System.Windows.Forms.Button
$btnReqAdd.Text = "Adicionar req"
$btnReqAdd.Location = New-Object System.Drawing.Point(12, 384)
$btnReqAdd.Size = New-Object System.Drawing.Size(110, 28)
$questPanel.Controls.Add($btnReqAdd)

$btnReqRemove = New-Object System.Windows.Forms.Button
$btnReqRemove.Text = "Remover req"
$btnReqRemove.Location = New-Object System.Drawing.Point(128, 384)
$btnReqRemove.Size = New-Object System.Drawing.Size(110, 28)
$questPanel.Controls.Add($btnReqRemove)

$reqList = New-Object System.Windows.Forms.ListView
$reqList.Location = New-Object System.Drawing.Point(12, 418)
$reqList.Size = New-Object System.Drawing.Size(520, 170)
$reqList.View = "Details"
$reqList.FullRowSelect = $true
$reqList.GridLines = $true
[void]$reqList.Columns.Add("Tipo", 100)
[void]$reqList.Columns.Add("CardId", 150)
[void]$reqList.Columns.Add("Carta", 190)
[void]$reqList.Columns.Add("Qtd", 60)
$questPanel.Controls.Add($reqList)

$btnQuestNew = New-Object System.Windows.Forms.Button
$btnQuestNew.Text = "Nova"
$btnQuestNew.Location = New-Object System.Drawing.Point(12, 596)
$btnQuestNew.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestNew)

$btnQuestSave = New-Object System.Windows.Forms.Button
$btnQuestSave.Text = "Salvar"
$btnQuestSave.Location = New-Object System.Drawing.Point(98, 596)
$btnQuestSave.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestSave)

$btnQuestDelete = New-Object System.Windows.Forms.Button
$btnQuestDelete.Text = "Excluir"
$btnQuestDelete.Location = New-Object System.Drawing.Point(184, 596)
$btnQuestDelete.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestDelete)

$btnQuestRefresh = New-Object System.Windows.Forms.Button
$btnQuestRefresh.Text = "Atualizar"
$btnQuestRefresh.Location = New-Object System.Drawing.Point(270, 596)
$btnQuestRefresh.Size = New-Object System.Drawing.Size(90, 30)
$questPanel.Controls.Add($btnQuestRefresh)

# Logs tab
$logsPanel = New-Object System.Windows.Forms.Panel
$logsPanel.Dock = "Fill"
$tabLogs.Controls.Add($logsPanel)

$btnLogsRefresh = New-Object System.Windows.Forms.Button
$btnLogsRefresh.Text = "Atualizar logs"
$btnLogsRefresh.Location = New-Object System.Drawing.Point(12, 12)
$btnLogsRefresh.Size = New-Object System.Drawing.Size(110, 30)
$logsPanel.Controls.Add($btnLogsRefresh)

$logsBox = New-Object System.Windows.Forms.TextBox
$logsBox.Location = New-Object System.Drawing.Point(12, 48)
$logsBox.Size = New-Object System.Drawing.Size(1200, 680)
$logsBox.Multiline = $true
$logsBox.ReadOnly = $true
$logsBox.ScrollBars = "Vertical"
$logsPanel.Controls.Add($logsBox)

function Load-Catalog {
  $payload = Invoke-AdminEngine -Action "catalog-cards"
  $script:CatalogCards = @($payload.cards)
  $script:LocationCards = @($script:CatalogCards | Where-Object { [string]$_.type -eq "locations" })
}

function Build-CardItems {
  param([string]$Type = "")
  $cards = if ($Type) {
    @($script:CatalogCards | Where-Object { [string]$_.type -eq $Type })
  } else {
    @($script:CatalogCards)
  }
  return @($cards | Sort-Object -Property @{Expression = { [string]$_.name }}, @{Expression = { [string]$_.id }} | ForEach-Object {
    $label = "{0} [{1}] ({2})" -f [string]$_.name, [string]$_.id, [string]$_.setName
    New-DisplayItem -Label $label -Value ([string]$_.id
    )
  })
}

function Build-LocationItems {
  return @($script:LocationCards | Sort-Object -Property @{Expression = { [string]$_.name }}, @{Expression = { [string]$_.id }} | ForEach-Object {
    $label = "{0} [{1}]" -f [string]$_.name, [string]$_.id
    New-DisplayItem -Label $label -Value ([string]$_.id)
  })
}

function Refresh-TypeCardCombos {
  $eventType = Get-SelectedValue -Combo $comboEventType
  Set-ComboItems -Combo $comboEventCard -Items (Build-CardItems -Type $eventType)

  $rewardType = Get-SelectedValue -Combo $comboRewardType
  Set-ComboItems -Combo $comboRewardCard -Items (Build-CardItems -Type $rewardType)

  $reqType = Get-SelectedValue -Combo $comboReqType
  Set-ComboItems -Combo $comboReqCard -Items (Build-CardItems -Type $reqType)
}

function Load-Users {
  Set-Status "Carregando usuarios..."
  $payload = Invoke-AdminEngine -Action "list-users"
  $script:Users = @($payload.users)
  $items = @($script:Users | ForEach-Object { New-DisplayItem -Label ([string]$_) -Value ([string]$_) })
  Set-ComboItems -Combo $userCombo -Items $items
  Set-Status "Usuarios carregados."
}

function Load-UserPreview {
  $username = Get-SelectedValue -Combo $userCombo
  if (-not $username) {
    $usersPreviewGrid.Rows.Clear()
    $usersDetail.Text = "Selecione um usuario."
    return
  }
  Set-Status "Gerando preview para '$username'..."
  $payload = Invoke-AdminEngine -Action "preview" -Username $username
  $usersPreviewGrid.Rows.Clear()
  $ordered = $payload.impact | Sort-Object -Property @{Expression = { [int]$_.count }; Descending = $true }, @{Expression = { [string]$_.table }; Descending = $false}
  foreach ($line in $ordered) {
    [void]$usersPreviewGrid.Rows.Add([string]$line.table, [string]$line.count, [string]$line.label)
  }
  $missingCount = ($payload.coverage | Where-Object { $_.status -eq "missing_table" }).Count
  $usersDetail.Text = "Usuario: $($payload.username)`r`nowner_key: $($payload.ownerKey)`r`nTotal de linhas a remover: $($payload.totalMatchedRows)`r`nTabelas ausentes no schema atual: $missingCount"
  Set-Status "Preview pronto para '$username'."
}

function Load-UserDetail {
  $username = Get-SelectedValue -Combo $userCombo
  if (-not $username) { return }
  Set-Status "Carregando detalhes de '$username'..."
  $payload = Invoke-AdminEngine -Action "user-detail" -Username $username
  $u = $payload.user
  $p = $u.profile
  $usersDetail.Text = @"
Username: $($u.username)
Email: $($u.email)
Verified: $($u.verified)
Tribe: $($u.tribe)
Session expires: $($u.sessionExpiresAt)
Session IP/device: $($u.sessionIp) / $($u.sessionDevice)
Last login: $($u.lastLoginAt)
Created: $($u.createdAt)
Updated: $($u.updatedAt)

Profile:
Favorite tribe: $($p.favoriteTribe)
Score: $($p.score)
Wins/Losses: $($p.wins) / $($p.losses)
WinRate: $($p.winRate)
Most played: $($p.mostPlayedName)
"@
  Set-Status "Detalhes carregados para '$username'."
}

$script:CurrentEventId = 0
function Reset-EventForm {
  $script:CurrentEventId = 0
  $eventIdLabel.Text = "Evento selecionado: novo"
  $txtEventText.Text = ""
  $numEventChance.Value = 0
  $dtEventStart.Value = [datetime]::Now
  $dtEventEnd.Value = [datetime]::Now.AddDays(1)
  $chkEventEnabled.Checked = $true
}

function Load-Events {
  Set-Status "Carregando eventos..."
  $payload = Invoke-AdminEngine -Action "events-list"
  $script:EventsCache = @($payload.events)
  $eventsGrid.Rows.Clear()
  foreach ($ev in $script:EventsCache) {
    [void]$eventsGrid.Rows.Add(
      [string]$ev.id,
      [string]$ev.eventText,
      [string]$ev.cardId,
      [string]$ev.cardType,
      [string]$ev.locationCardId,
      [string]$ev.chancePercent,
      [string]$ev.startAt,
      [string]$ev.endAt
    )
  }
  Set-Status "Eventos carregados."
}

function Fill-EventFormById {
  param([int]$EventId)
  $event = $script:EventsCache | Where-Object { [int]$_.id -eq $EventId } | Select-Object -First 1
  if (-not $event) { return }
  $script:CurrentEventId = [int]$event.id
  $eventIdLabel.Text = "Evento selecionado: ID $($event.id)"
  $txtEventText.Text = [string]$event.eventText
  $comboEventType.SelectedValue = [string]$event.cardType
  Refresh-TypeCardCombos
  $comboEventCard.SelectedValue = [string]$event.cardId
  $comboEventLocation.SelectedValue = [string]$event.locationCardId
  $numEventChance.Value = [decimal]([double]$event.chancePercent)
  try { $dtEventStart.Value = [datetime]::Parse([string]$event.startAt) } catch {}
  try { $dtEventEnd.Value = [datetime]::Parse([string]$event.endAt) } catch {}
  $chkEventEnabled.Checked = [bool]$event.enabled
}

function Build-EventPayload {
  return @{
    eventText = $txtEventText.Text.Trim()
    cardType = Get-SelectedValue -Combo $comboEventType
    cardId = Get-SelectedValue -Combo $comboEventCard
    locationCardId = Get-SelectedValue -Combo $comboEventLocation
    chancePercent = [double]$numEventChance.Value
    startAt = $dtEventStart.Value.ToString("yyyy-MM-ddTHH:mm:ss")
    endAt = $dtEventEnd.Value.ToString("yyyy-MM-ddTHH:mm:ss")
    enabled = [bool]$chkEventEnabled.Checked
  }
}

$script:CurrentQuestKey = ""
function Reset-QuestForm {
  $script:CurrentQuestKey = ""
  $txtQuestKey.Text = ""
  $txtQuestKey.Enabled = $true
  $txtQuestTitle.Text = ""
  $txtQuestDesc.Text = ""
  $comboRewardType.SelectedIndex = 0
  Refresh-TypeCardCombos
  $txtAnomalyIds.Text = ""
  $chkQuestEnabled.Checked = $true
  $reqList.Items.Clear()
}

function Load-Quests {
  Set-Status "Carregando quests..."
  $payload = Invoke-AdminEngine -Action "quests-list"
  $script:QuestsCache = @($payload.quests)
  $questsGrid.Rows.Clear()
  foreach ($q in $script:QuestsCache) {
    $reqCount = @($q.requirements).Count
    [void]$questsGrid.Rows.Add(
      [string]$q.questKey,
      [string]$q.title,
      ([string]$q.rewardType + ":" + [string]$q.rewardCardId),
      [string]$q.targetLocationCardId,
      [string]$q.enabled,
      [string]$reqCount
    )
  }
  Set-Status "Quests carregadas."
}

function Fill-QuestForm {
  param([string]$QuestKey)
  $quest = $script:QuestsCache | Where-Object { [string]$_.questKey -eq $QuestKey } | Select-Object -First 1
  if (-not $quest) { return }
  $script:CurrentQuestKey = [string]$quest.questKey
  $txtQuestKey.Text = [string]$quest.questKey
  $txtQuestKey.Enabled = $false
  $txtQuestTitle.Text = [string]$quest.title
  $txtQuestDesc.Text = [string]$quest.description
  $comboRewardType.SelectedValue = [string]$quest.rewardType
  Refresh-TypeCardCombos
  $comboRewardCard.SelectedValue = [string]$quest.rewardCardId
  $comboQuestTargetLocation.SelectedValue = [string]$quest.targetLocationCardId
  $txtAnomalyIds.Text = ([string[]]$quest.anomalyLocationIds -join ",")
  $chkQuestEnabled.Checked = [bool]$quest.enabled
  $reqList.Items.Clear()
  foreach ($req in $quest.requirements) {
    $card = $script:CatalogCards | Where-Object { [string]$_.id -eq [string]$req.cardId } | Select-Object -First 1
    $name = if ($card) { [string]$card.name } else { [string]$req.cardId }
    $item = New-Object System.Windows.Forms.ListViewItem([string]$req.cardType)
    [void]$item.SubItems.Add([string]$req.cardId)
    [void]$item.SubItems.Add($name)
    [void]$item.SubItems.Add([string]$req.required)
    [void]$reqList.Items.Add($item)
  }
}

function Build-QuestPayload {
  $reqs = @()
  foreach ($item in $reqList.Items) {
    $reqs += @{
      cardType = [string]$item.SubItems[0].Text
      cardId = [string]$item.SubItems[1].Text
      required = [int]$item.SubItems[3].Text
    }
  }
  $anomalyIds = @($txtAnomalyIds.Text.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  return @{
    questKey = $txtQuestKey.Text.Trim()
    title = $txtQuestTitle.Text.Trim()
    description = $txtQuestDesc.Text.Trim()
    rewardType = Get-SelectedValue -Combo $comboRewardType
    rewardCardId = Get-SelectedValue -Combo $comboRewardCard
    targetLocationCardId = Get-SelectedValue -Combo $comboQuestTargetLocation
    anomalyLocationIds = $anomalyIds
    requirements = $reqs
    enabled = [bool]$chkQuestEnabled.Checked
  }
}

function Load-Logs {
  Ensure-LogsDir
  $paths = @(
    (Join-Path $logsDir "admin-panel.log"),
    (Join-Path $logsDir "user-delete-operations.log")
  )
  $buffer = @()
  foreach ($p in $paths) {
    if (Test-Path $p) {
      $buffer += "===== $p ====="
      $buffer += Get-Content $p
      $buffer += ""
    }
  }
  if (-not $buffer.Count) {
    $buffer = @("Nenhum log encontrado.")
  }
  $logsBox.Text = ($buffer -join [Environment]::NewLine)
}

function Invoke-MutatingOperation {
  param(
    [string]$OperationName,
    [scriptblock]$ActionBlock,
    [string]$Target = ""
  )
  Set-Status "Criando backup para $OperationName..."
  $backupPath = Run-Backup
  $result = & $ActionBlock
  Add-AdminLog -Operation $OperationName -Target $Target -BackupPath $backupPath
  return @{ result = $result; backup = $backupPath }
}

$btnUsersRefresh.Add_Click({
  try {
    Load-Users
    Load-UserPreview
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar usuarios: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$userCombo.Add_SelectedIndexChanged({
  try {
    Load-UserPreview
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro no preview: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnUserDetail.Add_Click({
  try { Load-UserDetail } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar detalhes: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnUserPassword.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $userCombo
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $password1 = Show-TextPrompt -Title "Alterar senha" -Message "Digite a nova senha para '$username':" -UsePassword $true
    if ($null -eq $password1) { return }
    $password2 = Show-TextPrompt -Title "Confirmar senha" -Message "Digite novamente a nova senha:" -UsePassword $true
    if ($null -eq $password2) { return }
    if ($password1 -ne $password2) {
      [System.Windows.Forms.MessageBox]::Show("As senhas nao conferem.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $op = Invoke-MutatingOperation -OperationName "set-password" -Target $username -ActionBlock {
      Invoke-AdminEngine -Action "set-password" -Username $username -Password $password1
    }
    [System.Windows.Forms.MessageBox]::Show("Senha alterada com sucesso.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Set-Status "Senha alterada para '$username'."
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao alterar senha: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnUserDelete.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $userCombo
    if (-not $username) { return }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Excluir permanentemente '$username'?", "Confirmar exclusao", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    if ($username.Trim().ToLower() -eq "admin") {
      $confirmAdmin = [System.Windows.Forms.MessageBox]::Show("ATENCAO: voce vai excluir ADMIN. Continuar?", "Confirmacao extra", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
      if ($confirmAdmin -ne [System.Windows.Forms.DialogResult]::Yes) { return }
      $typed = Show-TextPrompt -Title "Confirmacao final (admin)" -Message "Digite ADMIN para confirmar:"
      if ([string]::IsNullOrWhiteSpace($typed) -or $typed.Trim() -cne "ADMIN") {
        [System.Windows.Forms.MessageBox]::Show("Confirmacao invalida. Operacao cancelada.", "Cancelado", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        return
      }
    }
    $op = Invoke-MutatingOperation -OperationName "delete-user" -Target $username -ActionBlock {
      Invoke-AdminEngine -Action "delete" -Username $username
    }
    [System.Windows.Forms.MessageBox]::Show("Usuario removido.`r`nTotal removido: $($op.result.totalRemoved)`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Users
    Load-UserPreview
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao excluir usuario: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$comboEventType.Add_SelectedIndexChanged({ Refresh-TypeCardCombos })
$comboRewardType.Add_SelectedIndexChanged({ Refresh-TypeCardCombos })
$comboReqType.Add_SelectedIndexChanged({ Refresh-TypeCardCombos })

$btnEventNew.Add_Click({ Reset-EventForm })
$btnEventRefresh.Add_Click({
  try { Load-Events } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar eventos: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$eventsGrid.Add_SelectionChanged({
  if ($eventsGrid.SelectedRows.Count -lt 1) { return }
  $idText = [string]$eventsGrid.SelectedRows[0].Cells[0].Value
  $id = 0
  if ([int]::TryParse($idText, [ref]$id)) { Fill-EventFormById -EventId $id }
})

$btnEventSave.Add_Click({
  try {
    $payload = Build-EventPayload
    if ($script:CurrentEventId -gt 0) {
      $op = Invoke-MutatingOperation -OperationName "event-update" -Target ("event:" + $script:CurrentEventId) -ActionBlock {
        Invoke-AdminEngine -Action "event-update" -Id ([string]$script:CurrentEventId) -Payload $payload
      }
      [System.Windows.Forms.MessageBox]::Show("Evento atualizado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      $op = Invoke-MutatingOperation -OperationName "event-create" -Target "event:new" -ActionBlock {
        Invoke-AdminEngine -Action "event-create" -Payload $payload
      }
      [System.Windows.Forms.MessageBox]::Show("Evento criado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
    Load-Events
    Reset-EventForm
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar evento: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnEventDelete.Add_Click({
  try {
    if ($script:CurrentEventId -le 0) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um evento para excluir.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Excluir evento ID $($script:CurrentEventId)?", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $op = Invoke-MutatingOperation -OperationName "event-delete" -Target ("event:" + $script:CurrentEventId) -ActionBlock {
      Invoke-AdminEngine -Action "event-delete" -Id ([string]$script:CurrentEventId)
    }
    [System.Windows.Forms.MessageBox]::Show("Evento excluido.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Events
    Reset-EventForm
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao excluir evento: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnReqAdd.Add_Click({
  $cardType = Get-SelectedValue -Combo $comboReqType
  $cardId = Get-SelectedValue -Combo $comboReqCard
  if (-not $cardType -or -not $cardId) { return }
  $card = $script:CatalogCards | Where-Object { [string]$_.id -eq $cardId } | Select-Object -First 1
  $name = if ($card) { [string]$card.name } else { $cardId }
  $item = New-Object System.Windows.Forms.ListViewItem($cardType)
  [void]$item.SubItems.Add($cardId)
  [void]$item.SubItems.Add($name)
  [void]$item.SubItems.Add([string][int]$numReqAmount.Value)
  [void]$reqList.Items.Add($item)
})

$btnReqRemove.Add_Click({
  foreach ($item in @($reqList.SelectedItems)) {
    $reqList.Items.Remove($item)
  }
})

$btnQuestNew.Add_Click({ Reset-QuestForm })
$btnQuestRefresh.Add_Click({
  try { Load-Quests } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar quests: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$questsGrid.Add_SelectionChanged({
  if ($questsGrid.SelectedRows.Count -lt 1) { return }
  $questKey = [string]$questsGrid.SelectedRows[0].Cells[0].Value
  if ($questKey) { Fill-QuestForm -QuestKey $questKey }
})

$btnQuestSave.Add_Click({
  try {
    $payload = Build-QuestPayload
    $questKey = [string]$payload.questKey
    if (-not $questKey) {
      [System.Windows.Forms.MessageBox]::Show("Quest key obrigatoria.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if ($txtQuestKey.Enabled) {
      $op = Invoke-MutatingOperation -OperationName "quest-create" -Target ("quest:" + $questKey) -ActionBlock {
        Invoke-AdminEngine -Action "quest-create" -Payload $payload
      }
      [System.Windows.Forms.MessageBox]::Show("Quest criada.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      $op = Invoke-MutatingOperation -OperationName "quest-update" -Target ("quest:" + $questKey) -ActionBlock {
        Invoke-AdminEngine -Action "quest-update" -QuestKey $questKey -Payload $payload
      }
      [System.Windows.Forms.MessageBox]::Show("Quest atualizada.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
    Load-Quests
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar quest: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnQuestDelete.Add_Click({
  try {
    $questKey = if ($txtQuestKey.Enabled) { "" } else { $txtQuestKey.Text.Trim() }
    if (-not $questKey) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma quest para excluir.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Excluir quest '$questKey'?", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $op = Invoke-MutatingOperation -OperationName "quest-delete" -Target ("quest:" + $questKey) -ActionBlock {
      Invoke-AdminEngine -Action "quest-delete" -QuestKey $questKey
    }
    [System.Windows.Forms.MessageBox]::Show("Quest excluida.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Quests
    Reset-QuestForm
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao excluir quest: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLogsRefresh.Add_Click({
  try { Load-Logs } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar logs: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

try {
  Set-Status "Inicializando painel admin..."
  Load-Catalog

  $typeItems = @(
    New-DisplayItem -Label "Creatures" -Value "creatures"
    New-DisplayItem -Label "Attacks" -Value "attacks"
    New-DisplayItem -Label "Battlegear" -Value "battlegear"
    New-DisplayItem -Label "Locations" -Value "locations"
    New-DisplayItem -Label "Mugic" -Value "mugic"
  )
  Set-ComboItems -Combo $comboEventType -Items $typeItems
  Set-ComboItems -Combo $comboRewardType -Items $typeItems
  Set-ComboItems -Combo $comboReqType -Items $typeItems
  Set-ComboItems -Combo $comboEventLocation -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboQuestTargetLocation -Items (Build-LocationItems)
  Refresh-TypeCardCombos
  Reset-EventForm
  Reset-QuestForm

  Load-Users
  if ($userCombo.Items.Count -gt 0) { Load-UserPreview }
  Load-Events
  Load-Quests
  Load-Logs
  Set-Status "Painel admin pronto."
} catch {
  [System.Windows.Forms.MessageBox]::Show("Falha ao inicializar painel admin: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  Set-Status "Falha na inicializacao."
}

[void]$form.ShowDialog()
