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
  $tempPayloadPath = ""
  try {
    $args = @($enginePath, "--action", $Action, "--db", $dbPath)
    if ($Username) { $args += @("--username", $Username) }
    if ($Password) { $args += @("--password", $Password) }
    if ($Id) { $args += @("--id", $Id) }
    if ($QuestKey) { $args += @("--questKey", $QuestKey) }
    if ($CardType) { $args += @("--cardType", $CardType) }
    if ($null -ne $Payload) {
      $json = ConvertTo-Json $Payload -Depth 20 -Compress
      if ($json.Length -gt 1500) {
        $tempPayloadPath = [IO.Path]::GetTempFileName()
        [IO.File]::WriteAllText($tempPayloadPath, $json, [Text.Encoding]::UTF8)
        $args += @("--payloadFile", $tempPayloadPath)
      } else {
        $payloadB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
        $args += @("--payloadB64", $payloadB64)
      }
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
    if ($tempPayloadPath -and (Test-Path $tempPayloadPath)) {
      Remove-Item -LiteralPath $tempPayloadPath -Force -ErrorAction SilentlyContinue
    }
    if ($null -eq $oldWarnings) {
      Remove-Item Env:NODE_NO_WARNINGS -ErrorAction SilentlyContinue
    } else {
      $env:NODE_NO_WARNINGS = $oldWarnings
    }
  }
}

function Run-Backup {
  try {
    $output = & $backupScript -ProjectRoot $ProjectRoot 2>&1
  } catch {
    $message = if ($_.Exception -and $_.Exception.Message) { $_.Exception.Message } else { "$_" }
    throw "Falha no backup: $message"
  }
  $text = ($output | Out-String).Trim()
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
$script:LocationTribesCache = @()
$script:LocationClimateRulesCache = @()
$script:LocationLinksCache = @()
$script:BattlegearSpawnRulesCache = @()
$script:RankedBanlistsCache = @()
$script:ScansCache = @()
$script:ProfileRankedSnapshot = $null
$script:PerimSnapshot = $null
$script:PerimConfigSnapshot = $null
$script:CurrentBanlistId = 0

$form = New-Object System.Windows.Forms.Form
$form.Text = "Painel Admin Local - Usuarios / Eventos / Quests"
$form.Size = New-Object System.Drawing.Size(1260, 820)
$form.StartPosition = "CenterScreen"
$form.MinimumSize = New-Object System.Drawing.Size(1160, 760)
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.Padding = New-Object System.Windows.Forms.Padding(8)

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

function Apply-GridResponsiveStyle {
  param([Parameter(Mandatory = $true)]$Grid)
  $Grid.ColumnHeadersVisible = $true
  $Grid.ColumnHeadersHeightSizeMode = [System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode]::AutoSize
  $Grid.ColumnHeadersHeight = [Math]::Max(30, [int]$Grid.ColumnHeadersHeight)
  $Grid.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
  $Grid.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle
  $Grid.BackgroundColor = [System.Drawing.Color]::White
  $Grid.EnableHeadersVisualStyles = $false
  $Grid.GridColor = [System.Drawing.Color]::FromArgb(220, 225, 232)
  $Grid.ColumnHeadersDefaultCellStyle.BackColor = [System.Drawing.Color]::FromArgb(241, 244, 248)
  $Grid.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(25, 29, 36)
  $Grid.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
  $Grid.DefaultCellStyle.BackColor = [System.Drawing.Color]::White
  $Grid.DefaultCellStyle.ForeColor = [System.Drawing.Color]::FromArgb(25, 29, 36)
  $Grid.DefaultCellStyle.SelectionBackColor = [System.Drawing.Color]::FromArgb(0, 120, 215)
  $Grid.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
  $Grid.RowTemplate.Height = [Math]::Max(24, [int]$Grid.RowTemplate.Height)
  $Grid.RowHeadersVisible = $false
}

function Set-SplitterLayoutSafe {
  param(
    [Parameter(Mandatory = $true)]$Splitter,
    [int]$Panel1Min = 180,
    [int]$Panel2Min = 140,
    [int]$PreferredDistance = -1
  )
  try { $Splitter.Panel1MinSize = [Math]::Max(0, $Panel1Min) } catch {}
  try { $Splitter.Panel2MinSize = [Math]::Max(0, $Panel2Min) } catch {}
  try {
    $total = if ($Splitter.Orientation -eq [System.Windows.Forms.Orientation]::Vertical) { [int]$Splitter.ClientSize.Width } else { [int]$Splitter.ClientSize.Height }
    $min = [int]$Splitter.Panel1MinSize
    $max = [Math]::Max($min, $total - [int]$Splitter.Panel2MinSize)
    $target = if ($PreferredDistance -gt 0) { $PreferredDistance } else { [int]$Splitter.SplitterDistance }
    $Splitter.SplitterDistance = [Math]::Max($min, [Math]::Min($max, $target))
  } catch {}
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

$tabScans = New-Object System.Windows.Forms.TabPage
$tabScans.Text = "Inventario/Scans"
$tab.Controls.Add($tabScans)

$tabProfileRanked = New-Object System.Windows.Forms.TabPage
$tabProfileRanked.Text = "Perfil/Ranked"
$tab.Controls.Add($tabProfileRanked)

$tabPerimState = New-Object System.Windows.Forms.TabPage
$tabPerimState.Text = "Estado PERIM"
$tab.Controls.Add($tabPerimState)

$tabPerimConfig = New-Object System.Windows.Forms.TabPage
$tabPerimConfig.Text = "Config PERIM"
$tab.Controls.Add($tabPerimConfig)

$tabLocationClimateRules = New-Object System.Windows.Forms.TabPage
$tabLocationClimateRules.Text = "Climas por Local"
$tab.Controls.Add($tabLocationClimateRules)

$tabLocationLinks = New-Object System.Windows.Forms.TabPage
$tabLocationLinks.Text = "Adjacencia Locais"
$tab.Controls.Add($tabLocationLinks)

$tabBattlegearSpawns = New-Object System.Windows.Forms.TabPage
$tabBattlegearSpawns.Text = "Spawn Equipamentos"
$tab.Controls.Add($tabBattlegearSpawns)

$tabRankedBanlists = New-Object System.Windows.Forms.TabPage
$tabRankedBanlists.Text = "Banlists Ranked"
$tab.Controls.Add($tabRankedBanlists)

$tabLogs = New-Object System.Windows.Forms.TabPage
$tabLogs.Text = "Logs"
$tab.Controls.Add($tabLogs)

# Usuarios tab
$usersTop = New-Object System.Windows.Forms.Panel
$usersTop.Dock = "Top"
$usersTop.Height = 56
$usersTop.AutoScroll = $true
$usersTop.Padding = New-Object System.Windows.Forms.Padding(6)
$tabUsers.Controls.Add($usersTop)

$usersBody = New-Object System.Windows.Forms.SplitContainer
$usersBody.Dock = "Fill"
$usersBody.Orientation = "Horizontal"
Set-SplitterLayoutSafe -Splitter $usersBody -Panel1Min 220 -Panel2Min 180 -PreferredDistance 330
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
$usersPreviewGrid.ColumnCount = 3
$usersPreviewGrid.Columns[0].Name = "Tabela"
$usersPreviewGrid.Columns[1].Name = "Registros"
$usersPreviewGrid.Columns[2].Name = "Detalhe"
$usersBody.Panel1.Controls.Add($usersPreviewGrid)
Apply-GridResponsiveStyle -Grid $usersPreviewGrid

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
Set-SplitterLayoutSafe -Splitter $eventsSplit -Panel1Min 460 -Panel2Min 420 -PreferredDistance 620
$eventsSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$eventsSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabEvents.Controls.Add($eventsSplit)

$eventsGrid = New-Object System.Windows.Forms.DataGridView
$eventsGrid.Dock = "Fill"
$eventsGrid.ReadOnly = $true
$eventsGrid.AllowUserToAddRows = $false
$eventsGrid.AllowUserToDeleteRows = $false
$eventsGrid.RowHeadersVisible = $false
$eventsGrid.SelectionMode = "FullRowSelect"
$eventsGrid.ColumnHeadersVisible = $true
$eventsGrid.ColumnHeadersHeightSizeMode = [System.Windows.Forms.DataGridViewColumnHeadersHeightSizeMode]::EnableResizing
$eventsGrid.ColumnHeadersHeight = 32
$eventsGrid.AutoSizeRowsMode = [System.Windows.Forms.DataGridViewAutoSizeRowsMode]::None
$eventsGrid.RowTemplate.Height = 24
$eventsGrid.ColumnCount = 8
$eventsGrid.Columns[0].Name = "ID"
$eventsGrid.Columns[1].Name = "Texto"
$eventsGrid.Columns[2].Name = "Carta"
$eventsGrid.Columns[3].Name = "Tipo"
$eventsGrid.Columns[4].Name = "Local"
$eventsGrid.Columns[5].Name = "Chance%"
$eventsGrid.Columns[6].Name = "Inicio"
$eventsGrid.Columns[7].Name = "Fim"

$eventsGridToolbar = New-Object System.Windows.Forms.Panel
$eventsGridToolbar.Dock = "Top"
$eventsGridToolbar.Height = 34
$eventsGridToolbar.Padding = New-Object System.Windows.Forms.Padding(6, 6, 6, 0)

$chkEventsOnlyActive = New-Object System.Windows.Forms.CheckBox
$chkEventsOnlyActive.Text = "Somente ativos agora"
$chkEventsOnlyActive.Location = New-Object System.Drawing.Point(4, 8)
$chkEventsOnlyActive.Size = New-Object System.Drawing.Size(180, 22)
$chkEventsOnlyActive.Checked = $false
$eventsGridToolbar.Controls.Add($chkEventsOnlyActive)

$eventsSplit.Panel1.Controls.Add($eventsGrid)
$eventsSplit.Panel1.Controls.Add($eventsGridToolbar)
Apply-GridResponsiveStyle -Grid $eventsGrid

$eventsPanel = New-Object System.Windows.Forms.Panel
$eventsPanel.Dock = "Fill"
$eventsPanel.AutoScroll = $true
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
$txtEventText.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$comboEventCard.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$comboEventLocation.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$dtEventEnd.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$eventsPanel.Controls.Add($dtEventEnd)

$chkEventEnabled = New-Object System.Windows.Forms.CheckBox
$chkEventEnabled.Text = "Ativo"
$chkEventEnabled.Location = New-Object System.Drawing.Point(12, 366)
$chkEventEnabled.Size = New-Object System.Drawing.Size(100, 26)
$chkEventEnabled.Checked = $true
$eventsPanel.Controls.Add($chkEventEnabled)

$chkEventNotifyAll = New-Object System.Windows.Forms.CheckBox
$chkEventNotifyAll.Text = "Enviar notificacao para todos"
$chkEventNotifyAll.Location = New-Object System.Drawing.Point(130, 366)
$chkEventNotifyAll.Size = New-Object System.Drawing.Size(230, 26)
$chkEventNotifyAll.Checked = $false
$eventsPanel.Controls.Add($chkEventNotifyAll)

$lblEventNotifyText = New-Object System.Windows.Forms.Label
$lblEventNotifyText.Text = "Texto da notificacao global:"
$lblEventNotifyText.Location = New-Object System.Drawing.Point(12, 394)
$lblEventNotifyText.Size = New-Object System.Drawing.Size(220, 20)
$eventsPanel.Controls.Add($lblEventNotifyText)

$txtEventNotifyText = New-Object System.Windows.Forms.TextBox
$txtEventNotifyText.Location = New-Object System.Drawing.Point(12, 416)
$txtEventNotifyText.Size = New-Object System.Drawing.Size(520, 42)
$txtEventNotifyText.Multiline = $true
$txtEventNotifyText.Enabled = $false
$txtEventNotifyText.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$eventsPanel.Controls.Add($txtEventNotifyText)

$lblEventNotifyStatus = New-Object System.Windows.Forms.Label
$lblEventNotifyStatus.Text = "Notificacao global: nao enviada neste formulario."
$lblEventNotifyStatus.Location = New-Object System.Drawing.Point(12, 460)
$lblEventNotifyStatus.Size = New-Object System.Drawing.Size(520, 22)
$lblEventNotifyStatus.ForeColor = [System.Drawing.Color]::FromArgb(130, 150, 170)
$eventsPanel.Controls.Add($lblEventNotifyStatus)

$btnEventNew = New-Object System.Windows.Forms.Button
$btnEventNew.Text = "Novo"
$btnEventNew.Location = New-Object System.Drawing.Point(12, 488)
$btnEventNew.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventNew)

$btnEventSave = New-Object System.Windows.Forms.Button
$btnEventSave.Text = "Salvar"
$btnEventSave.Location = New-Object System.Drawing.Point(98, 488)
$btnEventSave.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventSave)

$btnEventDelete = New-Object System.Windows.Forms.Button
$btnEventDelete.Text = "Excluir"
$btnEventDelete.Location = New-Object System.Drawing.Point(184, 488)
$btnEventDelete.Size = New-Object System.Drawing.Size(80, 30)
$eventsPanel.Controls.Add($btnEventDelete)

$btnEventRefresh = New-Object System.Windows.Forms.Button
$btnEventRefresh.Text = "Atualizar"
$btnEventRefresh.Location = New-Object System.Drawing.Point(270, 488)
$btnEventRefresh.Size = New-Object System.Drawing.Size(90, 30)
$eventsPanel.Controls.Add($btnEventRefresh)

$lblLocationTribeTitle = New-Object System.Windows.Forms.Label
$lblLocationTribeTitle.Text = "Tribo dos Locais (PERIM)"
$lblLocationTribeTitle.Location = New-Object System.Drawing.Point(12, 530)
$lblLocationTribeTitle.Size = New-Object System.Drawing.Size(220, 22)
$eventsPanel.Controls.Add($lblLocationTribeTitle)

$lblLocationTribeLoc = New-Object System.Windows.Forms.Label
$lblLocationTribeLoc.Text = "Local:"
$lblLocationTribeLoc.Location = New-Object System.Drawing.Point(12, 554)
$lblLocationTribeLoc.Size = New-Object System.Drawing.Size(80, 20)
$eventsPanel.Controls.Add($lblLocationTribeLoc)

$comboLocationTribeLocation = New-Object System.Windows.Forms.ComboBox
$comboLocationTribeLocation.DropDownStyle = "DropDownList"
$comboLocationTribeLocation.Location = New-Object System.Drawing.Point(12, 576)
$comboLocationTribeLocation.Size = New-Object System.Drawing.Size(520, 28)
$comboLocationTribeLocation.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$eventsPanel.Controls.Add($comboLocationTribeLocation)

$lblLocationTribeKey = New-Object System.Windows.Forms.Label
$lblLocationTribeKey.Text = "Tribo:"
$lblLocationTribeKey.Location = New-Object System.Drawing.Point(12, 610)
$lblLocationTribeKey.Size = New-Object System.Drawing.Size(80, 20)
$eventsPanel.Controls.Add($lblLocationTribeKey)

$comboLocationTribeKey = New-Object System.Windows.Forms.ComboBox
$comboLocationTribeKey.DropDownStyle = "DropDownList"
$comboLocationTribeKey.Location = New-Object System.Drawing.Point(12, 632)
$comboLocationTribeKey.Size = New-Object System.Drawing.Size(220, 28)
$eventsPanel.Controls.Add($comboLocationTribeKey)

$btnLocationTribeSave = New-Object System.Windows.Forms.Button
$btnLocationTribeSave.Text = "Salvar tribo"
$btnLocationTribeSave.Location = New-Object System.Drawing.Point(242, 630)
$btnLocationTribeSave.Size = New-Object System.Drawing.Size(96, 30)
$eventsPanel.Controls.Add($btnLocationTribeSave)

$btnLocationTribeDelete = New-Object System.Windows.Forms.Button
$btnLocationTribeDelete.Text = "Remover"
$btnLocationTribeDelete.Location = New-Object System.Drawing.Point(344, 630)
$btnLocationTribeDelete.Size = New-Object System.Drawing.Size(88, 30)
$eventsPanel.Controls.Add($btnLocationTribeDelete)

$btnLocationTribeRefresh = New-Object System.Windows.Forms.Button
$btnLocationTribeRefresh.Text = "Atualizar"
$btnLocationTribeRefresh.Location = New-Object System.Drawing.Point(438, 630)
$btnLocationTribeRefresh.Size = New-Object System.Drawing.Size(94, 30)
$btnLocationTribeRefresh.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right
$eventsPanel.Controls.Add($btnLocationTribeRefresh)

$locationTribesGrid = New-Object System.Windows.Forms.DataGridView
$locationTribesGrid.Location = New-Object System.Drawing.Point(12, 666)
$locationTribesGrid.Size = New-Object System.Drawing.Size(520, 146)
$locationTribesGrid.ReadOnly = $true
$locationTribesGrid.AllowUserToAddRows = $false
$locationTribesGrid.AllowUserToDeleteRows = $false
$locationTribesGrid.RowHeadersVisible = $false
$locationTribesGrid.SelectionMode = "FullRowSelect"
$locationTribesGrid.ColumnCount = 4
$locationTribesGrid.Columns[0].Name = "Local"
$locationTribesGrid.Columns[1].Name = "ID"
$locationTribesGrid.Columns[2].Name = "Tribo"
$locationTribesGrid.Columns[3].Name = "Atualizado"
$locationTribesGrid.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$eventsPanel.Controls.Add($locationTribesGrid)
Apply-GridResponsiveStyle -Grid $locationTribesGrid

# Banlists Ranked tab
$banlistSplit = New-Object System.Windows.Forms.SplitContainer
$banlistSplit.Dock = "Fill"
$banlistSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $banlistSplit -Panel1Min 480 -Panel2Min 360 -PreferredDistance 700
$banlistSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$banlistSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabRankedBanlists.Controls.Add($banlistSplit)

$banlistsGrid = New-Object System.Windows.Forms.DataGridView
$banlistsGrid.Dock = "Fill"
$banlistsGrid.ReadOnly = $true
$banlistsGrid.AllowUserToAddRows = $false
$banlistsGrid.AllowUserToDeleteRows = $false
$banlistsGrid.RowHeadersVisible = $false
$banlistsGrid.SelectionMode = "FullRowSelect"
$banlistsGrid.ColumnCount = 6
$banlistsGrid.Columns[0].Name = "ID"
$banlistsGrid.Columns[1].Name = "Nome"
$banlistsGrid.Columns[2].Name = "Descricao"
$banlistsGrid.Columns[3].Name = "Ativa"
$banlistsGrid.Columns[4].Name = "Cartas"
$banlistsGrid.Columns[5].Name = "Atualizado"
$banlistSplit.Panel1.Controls.Add($banlistsGrid)
Apply-GridResponsiveStyle -Grid $banlistsGrid

$banlistPanel = New-Object System.Windows.Forms.Panel
$banlistPanel.Dock = "Fill"
$banlistPanel.AutoScroll = $true
$banlistSplit.Panel2.Controls.Add($banlistPanel)

$lblBanlistSelected = New-Object System.Windows.Forms.Label
$lblBanlistSelected.Text = "Banlist selecionada: nova"
$lblBanlistSelected.Location = New-Object System.Drawing.Point(12, 12)
$lblBanlistSelected.Size = New-Object System.Drawing.Size(520, 22)
$banlistPanel.Controls.Add($lblBanlistSelected)

$lblBanlistName = New-Object System.Windows.Forms.Label
$lblBanlistName.Text = "Nome:"
$lblBanlistName.Location = New-Object System.Drawing.Point(12, 40)
$lblBanlistName.Size = New-Object System.Drawing.Size(80, 20)
$banlistPanel.Controls.Add($lblBanlistName)

$txtBanlistName = New-Object System.Windows.Forms.TextBox
$txtBanlistName.Location = New-Object System.Drawing.Point(12, 62)
$txtBanlistName.Size = New-Object System.Drawing.Size(420, 24)
$banlistPanel.Controls.Add($txtBanlistName)

$lblBanlistDescription = New-Object System.Windows.Forms.Label
$lblBanlistDescription.Text = "Descricao:"
$lblBanlistDescription.Location = New-Object System.Drawing.Point(12, 92)
$lblBanlistDescription.Size = New-Object System.Drawing.Size(100, 20)
$banlistPanel.Controls.Add($lblBanlistDescription)

$txtBanlistDescription = New-Object System.Windows.Forms.TextBox
$txtBanlistDescription.Location = New-Object System.Drawing.Point(12, 114)
$txtBanlistDescription.Size = New-Object System.Drawing.Size(420, 48)
$txtBanlistDescription.Multiline = $true
$banlistPanel.Controls.Add($txtBanlistDescription)

$btnBanlistNew = New-Object System.Windows.Forms.Button
$btnBanlistNew.Text = "Nova"
$btnBanlistNew.Location = New-Object System.Drawing.Point(12, 170)
$btnBanlistNew.Size = New-Object System.Drawing.Size(70, 30)
$banlistPanel.Controls.Add($btnBanlistNew)

$btnBanlistSave = New-Object System.Windows.Forms.Button
$btnBanlistSave.Text = "Salvar"
$btnBanlistSave.Location = New-Object System.Drawing.Point(88, 170)
$btnBanlistSave.Size = New-Object System.Drawing.Size(70, 30)
$banlistPanel.Controls.Add($btnBanlistSave)

$btnBanlistDelete = New-Object System.Windows.Forms.Button
$btnBanlistDelete.Text = "Excluir"
$btnBanlistDelete.Location = New-Object System.Drawing.Point(164, 170)
$btnBanlistDelete.Size = New-Object System.Drawing.Size(70, 30)
$banlistPanel.Controls.Add($btnBanlistDelete)

$btnBanlistActivate = New-Object System.Windows.Forms.Button
$btnBanlistActivate.Text = "Ativar"
$btnBanlistActivate.Location = New-Object System.Drawing.Point(240, 170)
$btnBanlistActivate.Size = New-Object System.Drawing.Size(70, 30)
$banlistPanel.Controls.Add($btnBanlistActivate)

$btnBanlistRefresh = New-Object System.Windows.Forms.Button
$btnBanlistRefresh.Text = "Atualizar"
$btnBanlistRefresh.Location = New-Object System.Drawing.Point(316, 170)
$btnBanlistRefresh.Size = New-Object System.Drawing.Size(80, 30)
$banlistPanel.Controls.Add($btnBanlistRefresh)

$lblBanlistCard = New-Object System.Windows.Forms.Label
$lblBanlistCard.Text = "Carta (card_id):"
$lblBanlistCard.Location = New-Object System.Drawing.Point(12, 208)
$lblBanlistCard.Size = New-Object System.Drawing.Size(120, 20)
$banlistPanel.Controls.Add($lblBanlistCard)

$comboBanlistCard = New-Object System.Windows.Forms.ComboBox
$comboBanlistCard.DropDownStyle = "DropDownList"
$comboBanlistCard.Location = New-Object System.Drawing.Point(12, 230)
$comboBanlistCard.Size = New-Object System.Drawing.Size(300, 28)
$banlistPanel.Controls.Add($comboBanlistCard)

$lblBanlistAllowedCopies = New-Object System.Windows.Forms.Label
$lblBanlistAllowedCopies.Text = "Permitido:"
$lblBanlistAllowedCopies.Location = New-Object System.Drawing.Point(318, 208)
$lblBanlistAllowedCopies.Size = New-Object System.Drawing.Size(90, 20)
$banlistPanel.Controls.Add($lblBanlistAllowedCopies)

$comboBanlistAllowedCopies = New-Object System.Windows.Forms.ComboBox
$comboBanlistAllowedCopies.DropDownStyle = "DropDownList"
$comboBanlistAllowedCopies.Location = New-Object System.Drawing.Point(318, 230)
$comboBanlistAllowedCopies.Size = New-Object System.Drawing.Size(114, 28)
$banlistPanel.Controls.Add($comboBanlistAllowedCopies)

$btnBanlistCardAdd = New-Object System.Windows.Forms.Button
$btnBanlistCardAdd.Text = "Adicionar carta"
$btnBanlistCardAdd.Location = New-Object System.Drawing.Point(12, 264)
$btnBanlistCardAdd.Size = New-Object System.Drawing.Size(120, 30)
$banlistPanel.Controls.Add($btnBanlistCardAdd)

$btnBanlistCardRemove = New-Object System.Windows.Forms.Button
$btnBanlistCardRemove.Text = "Remover carta"
$btnBanlistCardRemove.Location = New-Object System.Drawing.Point(138, 264)
$btnBanlistCardRemove.Size = New-Object System.Drawing.Size(120, 30)
$banlistPanel.Controls.Add($btnBanlistCardRemove)

$listBanlistCards = New-Object System.Windows.Forms.ListView
$listBanlistCards.Location = New-Object System.Drawing.Point(12, 300)
$listBanlistCards.Size = New-Object System.Drawing.Size(420, 240)
$listBanlistCards.View = "Details"
$listBanlistCards.FullRowSelect = $true
$listBanlistCards.GridLines = $true
[void]$listBanlistCards.Columns.Add("CardId", 190)
[void]$listBanlistCards.Columns.Add("Carta", 150)
[void]$listBanlistCards.Columns.Add("Permitido", 70)
$banlistPanel.Controls.Add($listBanlistCards)

# Quests tab
$questSplit = New-Object System.Windows.Forms.SplitContainer
$questSplit.Dock = "Fill"
$questSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $questSplit -Panel1Min 440 -Panel2Min 420 -PreferredDistance 620
$questSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$questSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabQuests.Controls.Add($questSplit)

$questsGrid = New-Object System.Windows.Forms.DataGridView
$questsGrid.Dock = "Fill"
$questsGrid.ReadOnly = $true
$questsGrid.AllowUserToAddRows = $false
$questsGrid.AllowUserToDeleteRows = $false
$questsGrid.RowHeadersVisible = $false
$questsGrid.SelectionMode = "FullRowSelect"
$questsGrid.ColumnCount = 9
$questsGrid.Columns[0].Name = "QuestKey"
$questsGrid.Columns[1].Name = "Titulo"
$questsGrid.Columns[2].Name = "Recompensa"
$questsGrid.Columns[3].Name = "Set"
$questsGrid.Columns[4].Name = "Dificuldade"
$questsGrid.Columns[5].Name = "Rascunho"
$questsGrid.Columns[6].Name = "Local resgate"
$questsGrid.Columns[7].Name = "Ativa"
$questsGrid.Columns[8].Name = "Reqs"
$questSplit.Panel1.Controls.Add($questsGrid)
Apply-GridResponsiveStyle -Grid $questsGrid

$questPanel = New-Object System.Windows.Forms.Panel
$questPanel.Dock = "Fill"
$questPanel.AutoScroll = $true
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
$txtQuestTitle.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$txtQuestDesc.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$comboRewardCard.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
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
$comboQuestTargetLocation.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$questPanel.Controls.Add($comboQuestTargetLocation)

$lblAnomalyIds = New-Object System.Windows.Forms.Label
$lblAnomalyIds.Text = "Locais de anomalia (ids separados por virgula):"
$lblAnomalyIds.Location = New-Object System.Drawing.Point(12, 248)
$lblAnomalyIds.Size = New-Object System.Drawing.Size(320, 20)
$questPanel.Controls.Add($lblAnomalyIds)

$txtAnomalyIds = New-Object System.Windows.Forms.TextBox
$txtAnomalyIds.Location = New-Object System.Drawing.Point(12, 270)
$txtAnomalyIds.Size = New-Object System.Drawing.Size(520, 24)
$txtAnomalyIds.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$questPanel.Controls.Add($txtAnomalyIds)

$lblQuestSetKey = New-Object System.Windows.Forms.Label
$lblQuestSetKey.Text = "Set da quest:"
$lblQuestSetKey.Location = New-Object System.Drawing.Point(12, 298)
$lblQuestSetKey.Size = New-Object System.Drawing.Size(110, 20)
$questPanel.Controls.Add($lblQuestSetKey)

$txtQuestSetKey = New-Object System.Windows.Forms.TextBox
$txtQuestSetKey.Location = New-Object System.Drawing.Point(12, 320)
$txtQuestSetKey.Size = New-Object System.Drawing.Size(120, 24)
$txtQuestSetKey.ReadOnly = $true
$questPanel.Controls.Add($txtQuestSetKey)

$lblQuestDifficulty = New-Object System.Windows.Forms.Label
$lblQuestDifficulty.Text = "Dificuldade:"
$lblQuestDifficulty.Location = New-Object System.Drawing.Point(138, 298)
$lblQuestDifficulty.Size = New-Object System.Drawing.Size(110, 20)
$questPanel.Controls.Add($lblQuestDifficulty)

$comboQuestDifficulty = New-Object System.Windows.Forms.ComboBox
$comboQuestDifficulty.DropDownStyle = "DropDownList"
$comboQuestDifficulty.Location = New-Object System.Drawing.Point(138, 320)
$comboQuestDifficulty.Size = New-Object System.Drawing.Size(150, 28)
$questPanel.Controls.Add($comboQuestDifficulty)

$chkQuestEnabled = New-Object System.Windows.Forms.CheckBox
$chkQuestEnabled.Text = "Ativa"
$chkQuestEnabled.Location = New-Object System.Drawing.Point(300, 321)
$chkQuestEnabled.Size = New-Object System.Drawing.Size(90, 24)
$chkQuestEnabled.Checked = $false
$questPanel.Controls.Add($chkQuestEnabled)

$chkQuestDraft = New-Object System.Windows.Forms.CheckBox
$chkQuestDraft.Text = "Rascunho"
$chkQuestDraft.Location = New-Object System.Drawing.Point(390, 321)
$chkQuestDraft.Size = New-Object System.Drawing.Size(110, 24)
$chkQuestDraft.Checked = $true
$questPanel.Controls.Add($chkQuestDraft)

$lblReqTitle = New-Object System.Windows.Forms.Label
$lblReqTitle.Text = "Requisitos:"
$lblReqTitle.Location = New-Object System.Drawing.Point(12, 356)
$lblReqTitle.Size = New-Object System.Drawing.Size(120, 20)
$questPanel.Controls.Add($lblReqTitle)

$comboReqType = New-Object System.Windows.Forms.ComboBox
$comboReqType.DropDownStyle = "DropDownList"
$comboReqType.Location = New-Object System.Drawing.Point(12, 378)
$comboReqType.Size = New-Object System.Drawing.Size(180, 28)
$questPanel.Controls.Add($comboReqType)

$comboReqCard = New-Object System.Windows.Forms.ComboBox
$comboReqCard.DropDownStyle = "DropDownList"
$comboReqCard.Location = New-Object System.Drawing.Point(198, 378)
$comboReqCard.Size = New-Object System.Drawing.Size(246, 28)
$comboReqCard.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$questPanel.Controls.Add($comboReqCard)

$numReqAmount = New-Object System.Windows.Forms.NumericUpDown
$numReqAmount.Location = New-Object System.Drawing.Point(450, 378)
$numReqAmount.Size = New-Object System.Drawing.Size(82, 24)
$numReqAmount.Minimum = 1
$numReqAmount.Maximum = 99
$numReqAmount.Value = 1
$questPanel.Controls.Add($numReqAmount)

$btnReqAdd = New-Object System.Windows.Forms.Button
$btnReqAdd.Text = "Adicionar req"
$btnReqAdd.Location = New-Object System.Drawing.Point(12, 412)
$btnReqAdd.Size = New-Object System.Drawing.Size(110, 28)
$questPanel.Controls.Add($btnReqAdd)

$btnReqRemove = New-Object System.Windows.Forms.Button
$btnReqRemove.Text = "Remover req"
$btnReqRemove.Location = New-Object System.Drawing.Point(128, 412)
$btnReqRemove.Size = New-Object System.Drawing.Size(110, 28)
$questPanel.Controls.Add($btnReqRemove)

$reqList = New-Object System.Windows.Forms.ListView
$reqList.Location = New-Object System.Drawing.Point(12, 446)
$reqList.Size = New-Object System.Drawing.Size(520, 170)
$reqList.View = "Details"
$reqList.FullRowSelect = $true
$reqList.GridLines = $true
[void]$reqList.Columns.Add("Tipo", 100)
[void]$reqList.Columns.Add("CardId", 150)
[void]$reqList.Columns.Add("Carta", 190)
[void]$reqList.Columns.Add("Qtd", 60)
$reqList.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$questPanel.Controls.Add($reqList)

$btnQuestNew = New-Object System.Windows.Forms.Button
$btnQuestNew.Text = "Nova"
$btnQuestNew.Location = New-Object System.Drawing.Point(12, 624)
$btnQuestNew.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestNew)

$btnQuestSave = New-Object System.Windows.Forms.Button
$btnQuestSave.Text = "Salvar"
$btnQuestSave.Location = New-Object System.Drawing.Point(98, 624)
$btnQuestSave.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestSave)

$btnQuestDelete = New-Object System.Windows.Forms.Button
$btnQuestDelete.Text = "Excluir"
$btnQuestDelete.Location = New-Object System.Drawing.Point(184, 624)
$btnQuestDelete.Size = New-Object System.Drawing.Size(80, 30)
$questPanel.Controls.Add($btnQuestDelete)

$btnQuestRefresh = New-Object System.Windows.Forms.Button
$btnQuestRefresh.Text = "Atualizar"
$btnQuestRefresh.Location = New-Object System.Drawing.Point(270, 624)
$btnQuestRefresh.Size = New-Object System.Drawing.Size(90, 30)
$questPanel.Controls.Add($btnQuestRefresh)

# Inventario/Scans tab
$scansSplit = New-Object System.Windows.Forms.SplitContainer
$scansSplit.Dock = "Fill"
$scansSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $scansSplit -Panel1Min 620 -Panel2Min 300 -PreferredDistance 860
$scansSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$scansSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabScans.Controls.Add($scansSplit)

$scansLeft = New-Object System.Windows.Forms.Panel
$scansLeft.Dock = "Fill"
$scansSplit.Panel1.Controls.Add($scansLeft)

$scansTop = New-Object System.Windows.Forms.Panel
$scansTop.Dock = "Top"
$scansTop.Height = 110
$scansTop.AutoScroll = $true
$scansTop.Padding = New-Object System.Windows.Forms.Padding(6, 4, 6, 4)
$scansLeft.Controls.Add($scansTop)

$scansFiltersLayout = New-Object System.Windows.Forms.TableLayoutPanel
$scansFiltersLayout.Dock = "Fill"
$scansFiltersLayout.AutoSize = $false
$scansFiltersLayout.ColumnCount = 4
$scansFiltersLayout.RowCount = 4
[void]$scansFiltersLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 22)))
[void]$scansFiltersLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 18)))
[void]$scansFiltersLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 14)))
[void]$scansFiltersLayout.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 46)))
[void]$scansFiltersLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 20)))
[void]$scansFiltersLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 30)))
[void]$scansFiltersLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 8)))
[void]$scansFiltersLayout.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Absolute, 34)))
$scansTop.Controls.Add($scansFiltersLayout)

$lblScansUser = New-Object System.Windows.Forms.Label
$lblScansUser.Text = "Usuario:"
$lblScansUser.Dock = "Fill"
$lblScansUser.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$scansFiltersLayout.Controls.Add($lblScansUser, 0, 0)

$comboScansUser = New-Object System.Windows.Forms.ComboBox
$comboScansUser.DropDownStyle = "DropDownList"
$comboScansUser.Dock = "Fill"
$scansFiltersLayout.Controls.Add($comboScansUser, 0, 1)

$lblScansType = New-Object System.Windows.Forms.Label
$lblScansType.Text = "Tipo:"
$lblScansType.Dock = "Fill"
$lblScansType.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$scansFiltersLayout.Controls.Add($lblScansType, 1, 0)

$comboScansType = New-Object System.Windows.Forms.ComboBox
$comboScansType.DropDownStyle = "DropDownList"
$comboScansType.Dock = "Fill"
$scansFiltersLayout.Controls.Add($comboScansType, 1, 1)

$lblScansSet = New-Object System.Windows.Forms.Label
$lblScansSet.Text = "Set:"
$lblScansSet.Dock = "Fill"
$lblScansSet.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$scansFiltersLayout.Controls.Add($lblScansSet, 2, 0)

$txtScansSet = New-Object System.Windows.Forms.TextBox
$txtScansSet.Dock = "Fill"
$scansFiltersLayout.Controls.Add($txtScansSet, 2, 1)

$lblScansQuery = New-Object System.Windows.Forms.Label
$lblScansQuery.Text = "Busca:"
$lblScansQuery.Dock = "Fill"
$lblScansQuery.TextAlign = [System.Drawing.ContentAlignment]::BottomLeft
$scansFiltersLayout.Controls.Add($lblScansQuery, 3, 0)

$txtScansQuery = New-Object System.Windows.Forms.TextBox
$txtScansQuery.Dock = "Fill"
$scansFiltersLayout.Controls.Add($txtScansQuery, 3, 1)

$btnScansLoad = New-Object System.Windows.Forms.Button
$btnScansLoad.Text = "Atualizar lista"
$btnScansLoad.Dock = "Left"
$btnScansLoad.Width = 120
$scansFiltersLayout.Controls.Add($btnScansLoad, 0, 3)

$btnScansDeleteSelected = New-Object System.Windows.Forms.Button
$btnScansDeleteSelected.Text = "Remover selecionados"
$btnScansDeleteSelected.Dock = "Fill"
$scansFiltersLayout.Controls.Add($btnScansDeleteSelected, 1, 3)
$scansFiltersLayout.SetColumnSpan($btnScansDeleteSelected, 2)

$scansGrid = New-Object System.Windows.Forms.DataGridView
$scansGrid.Dock = "Fill"
$scansGrid.AllowUserToAddRows = $false
$scansGrid.AllowUserToDeleteRows = $false
$scansGrid.SelectionMode = "FullRowSelect"
$scansGrid.MultiSelect = $true
$scansGrid.ReadOnly = $true
[void]$scansGrid.Columns.Add("scanEntryId", "scan_entry_id")
[void]$scansGrid.Columns.Add("cardType", "Tipo")
[void]$scansGrid.Columns.Add("cardName", "Carta")
[void]$scansGrid.Columns.Add("cardId", "card_id")
[void]$scansGrid.Columns.Add("setName", "Set")
[void]$scansGrid.Columns.Add("obtainedAt", "Obtido em")
[void]$scansGrid.Columns.Add("source", "Source")
[void]$scansGrid.Columns.Add("variant", "variant_json")
$scansGrid.Columns["scanEntryId"].MinimumWidth = 210
$scansGrid.Columns["cardId"].MinimumWidth = 220
$scansGrid.Columns["obtainedAt"].MinimumWidth = 165
$scansGrid.Columns["cardName"].FillWeight = 150
$scansGrid.Columns["scanEntryId"].FillWeight = 130
$scansGrid.Columns["cardId"].FillWeight = 130
$scansGrid.Columns["obtainedAt"].FillWeight = 110
$scansGrid.Columns["variant"].FillWeight = 120
$scansLeft.Controls.Add($scansGrid)
Apply-GridResponsiveStyle -Grid $scansGrid

$scansGrantPanel = New-Object System.Windows.Forms.Panel
$scansGrantPanel.Dock = "Fill"
$scansGrantPanel.AutoScroll = $true
$scansGrantPanel.Padding = New-Object System.Windows.Forms.Padding(10)
$scansSplit.Panel2.Controls.Add($scansGrantPanel)

$grantTitle = New-Object System.Windows.Forms.Label
$grantTitle.Text = "Grant Manual"
$grantTitle.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$grantTitle.Location = New-Object System.Drawing.Point(12, 10)
$grantTitle.Size = New-Object System.Drawing.Size(220, 24)
$scansGrantPanel.Controls.Add($grantTitle)

$lblGrantType = New-Object System.Windows.Forms.Label
$lblGrantType.Text = "Grant tipo:"
$lblGrantType.Location = New-Object System.Drawing.Point(12, 42)
$lblGrantType.Size = New-Object System.Drawing.Size(100, 20)
$scansGrantPanel.Controls.Add($lblGrantType)

$comboGrantCardType = New-Object System.Windows.Forms.ComboBox
$comboGrantCardType.DropDownStyle = "DropDownList"
$comboGrantCardType.Location = New-Object System.Drawing.Point(12, 64)
$comboGrantCardType.Size = New-Object System.Drawing.Size(250, 28)
$comboGrantCardType.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$scansGrantPanel.Controls.Add($comboGrantCardType)

$lblGrantCard = New-Object System.Windows.Forms.Label
$lblGrantCard.Text = "Carta:"
$lblGrantCard.Location = New-Object System.Drawing.Point(12, 96)
$lblGrantCard.Size = New-Object System.Drawing.Size(80, 20)
$scansGrantPanel.Controls.Add($lblGrantCard)

$comboGrantCard = New-Object System.Windows.Forms.ComboBox
$comboGrantCard.DropDownStyle = "DropDownList"
$comboGrantCard.Location = New-Object System.Drawing.Point(12, 118)
$comboGrantCard.Size = New-Object System.Drawing.Size(250, 28)
$comboGrantCard.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$scansGrantPanel.Controls.Add($comboGrantCard)

$lblGrantQty = New-Object System.Windows.Forms.Label
$lblGrantQty.Text = "Qtd"
$lblGrantQty.Location = New-Object System.Drawing.Point(12, 152)
$lblGrantQty.Size = New-Object System.Drawing.Size(80, 20)
$scansGrantPanel.Controls.Add($lblGrantQty)

$numGrantQty = New-Object System.Windows.Forms.NumericUpDown
$numGrantQty.Location = New-Object System.Drawing.Point(12, 174)
$numGrantQty.Minimum = 1
$numGrantQty.Maximum = 100
$numGrantQty.Value = 1
$numGrantQty.Size = New-Object System.Drawing.Size(80, 26)
$scansGrantPanel.Controls.Add($numGrantQty)

$lblGrantStars = New-Object System.Windows.Forms.Label
$lblGrantStars.Text = "Estrelas"
$lblGrantStars.Location = New-Object System.Drawing.Point(110, 152)
$lblGrantStars.Size = New-Object System.Drawing.Size(80, 20)
$scansGrantPanel.Controls.Add($lblGrantStars)

$numGrantStars = New-Object System.Windows.Forms.NumericUpDown
$numGrantStars.Location = New-Object System.Drawing.Point(110, 174)
$numGrantStars.Minimum = 1
$numGrantStars.Maximum = 3
$numGrantStars.DecimalPlaces = 1
$numGrantStars.Increment = [decimal]0.5
$numGrantStars.Value = [decimal]2.0
$numGrantStars.Size = New-Object System.Drawing.Size(80, 26)
$scansGrantPanel.Controls.Add($numGrantStars)

$lblGrantSource = New-Object System.Windows.Forms.Label
$lblGrantSource.Text = "Source:"
$lblGrantSource.Location = New-Object System.Drawing.Point(12, 206)
$lblGrantSource.Size = New-Object System.Drawing.Size(100, 20)
$scansGrantPanel.Controls.Add($lblGrantSource)

$txtGrantSource = New-Object System.Windows.Forms.TextBox
$txtGrantSource.Location = New-Object System.Drawing.Point(12, 228)
$txtGrantSource.Size = New-Object System.Drawing.Size(250, 26)
$txtGrantSource.Text = "admin_manual_grant"
$txtGrantSource.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$scansGrantPanel.Controls.Add($txtGrantSource)

$btnScansGrant = New-Object System.Windows.Forms.Button
$btnScansGrant.Text = "Grant carta"
$btnScansGrant.Location = New-Object System.Drawing.Point(12, 268)
$btnScansGrant.Size = New-Object System.Drawing.Size(250, 34)
$btnScansGrant.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$scansGrantPanel.Controls.Add($btnScansGrant)

# Perfil/Ranked tab
$profileTop = New-Object System.Windows.Forms.Panel
$profileTop.Dock = "Top"
$profileTop.Height = 74
$profileTop.AutoScroll = $true
$profileTop.Padding = New-Object System.Windows.Forms.Padding(6, 4, 6, 4)
$tabProfileRanked.Controls.Add($profileTop)

$lblProfileUser = New-Object System.Windows.Forms.Label
$lblProfileUser.Text = "Usuario:"
$lblProfileUser.Location = New-Object System.Drawing.Point(12, 10)
$profileTop.Controls.Add($lblProfileUser)

$comboProfileUser = New-Object System.Windows.Forms.ComboBox
$comboProfileUser.DropDownStyle = "DropDownList"
$comboProfileUser.Location = New-Object System.Drawing.Point(12, 32)
$comboProfileUser.Size = New-Object System.Drawing.Size(200, 28)
$profileTop.Controls.Add($comboProfileUser)

$lblProfileSeason = New-Object System.Windows.Forms.Label
$lblProfileSeason.Text = "Temporada (YYYY-MM):"
$lblProfileSeason.Location = New-Object System.Drawing.Point(224, 10)
$profileTop.Controls.Add($lblProfileSeason)

$txtProfileSeason = New-Object System.Windows.Forms.TextBox
$txtProfileSeason.Location = New-Object System.Drawing.Point(224, 32)
$txtProfileSeason.Size = New-Object System.Drawing.Size(120, 26)
$profileTop.Controls.Add($txtProfileSeason)

$lblProfileDrome = New-Object System.Windows.Forms.Label
$lblProfileDrome.Text = "Dromo:"
$lblProfileDrome.Location = New-Object System.Drawing.Point(356, 10)
$profileTop.Controls.Add($lblProfileDrome)

$comboProfileDrome = New-Object System.Windows.Forms.ComboBox
$comboProfileDrome.DropDownStyle = "DropDownList"
$comboProfileDrome.Location = New-Object System.Drawing.Point(356, 32)
$comboProfileDrome.Size = New-Object System.Drawing.Size(140, 28)
$profileTop.Controls.Add($comboProfileDrome)

$btnProfileLoad = New-Object System.Windows.Forms.Button
$btnProfileLoad.Text = "Carregar"
$btnProfileLoad.Location = New-Object System.Drawing.Point(508, 30)
$btnProfileLoad.Size = New-Object System.Drawing.Size(96, 30)
$profileTop.Controls.Add($btnProfileLoad)

$btnProfileSave = New-Object System.Windows.Forms.Button
$btnProfileSave.Text = "Salvar ajustes"
$btnProfileSave.Location = New-Object System.Drawing.Point(610, 30)
$btnProfileSave.Size = New-Object System.Drawing.Size(120, 30)
$profileTop.Controls.Add($btnProfileSave)

$btnProfileResetMonthly = New-Object System.Windows.Forms.Button
$btnProfileResetMonthly.Text = "Reset mensal dromo"
$btnProfileResetMonthly.Location = New-Object System.Drawing.Point(736, 30)
$btnProfileResetMonthly.Size = New-Object System.Drawing.Size(150, 30)
$profileTop.Controls.Add($btnProfileResetMonthly)

$btnProfileResetStreak = New-Object System.Windows.Forms.Button
$btnProfileResetStreak.Text = "Reset streak dromo"
$btnProfileResetStreak.Location = New-Object System.Drawing.Point(892, 30)
$btnProfileResetStreak.Size = New-Object System.Drawing.Size(130, 30)
$profileTop.Controls.Add($btnProfileResetStreak)

$profileBody = New-Object System.Windows.Forms.SplitContainer
$profileBody.Dock = "Fill"
$profileBody.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $profileBody -Panel1Min 460 -Panel2Min 320 -PreferredDistance 640
$profileBody.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$profileBody.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabProfileRanked.Controls.Add($profileBody)

$profileEditorPanel = New-Object System.Windows.Forms.Panel
$profileEditorPanel.Dock = "Fill"
$profileEditorPanel.AutoScroll = $true
$profileBody.Panel1.Controls.Add($profileEditorPanel)

$profileGridStats = New-Object System.Windows.Forms.DataGridView
$profileGridStats.Dock = "Bottom"
$profileGridStats.Height = 280
$profileGridStats.AllowUserToAddRows = $false
$profileGridStats.AllowUserToDeleteRows = $false
$profileGridStats.ReadOnly = $true
$profileGridStats.SelectionMode = "FullRowSelect"
[void]$profileGridStats.Columns.Add("drome", "Dromo")
[void]$profileGridStats.Columns.Add("score", "Score")
[void]$profileGridStats.Columns.Add("wins", "Wins")
[void]$profileGridStats.Columns.Add("losses", "Losses")
[void]$profileGridStats.Columns.Add("streak", "Streak atual")
[void]$profileGridStats.Columns.Add("best", "Melhor streak")
$profileBody.Panel1.Controls.Add($profileGridStats)
Apply-GridResponsiveStyle -Grid $profileGridStats

$lblPScore = New-Object System.Windows.Forms.Label
$lblPScore.Text = "Perfil score/wins/losses"
$lblPScore.Location = New-Object System.Drawing.Point(12, 14)
$profileEditorPanel.Controls.Add($lblPScore)

$numProfileScore = New-Object System.Windows.Forms.NumericUpDown
$numProfileScore.Location = New-Object System.Drawing.Point(12, 38)
$numProfileScore.Maximum = 999999
$numProfileScore.Size = New-Object System.Drawing.Size(100, 26)
$profileEditorPanel.Controls.Add($numProfileScore)

$numProfileWins = New-Object System.Windows.Forms.NumericUpDown
$numProfileWins.Location = New-Object System.Drawing.Point(118, 38)
$numProfileWins.Maximum = 999999
$numProfileWins.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numProfileWins)

$numProfileLosses = New-Object System.Windows.Forms.NumericUpDown
$numProfileLosses.Location = New-Object System.Drawing.Point(204, 38)
$numProfileLosses.Maximum = 999999
$numProfileLosses.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numProfileLosses)

$txtProfileFavoriteTribe = New-Object System.Windows.Forms.TextBox
$txtProfileFavoriteTribe.Location = New-Object System.Drawing.Point(290, 38)
$txtProfileFavoriteTribe.Size = New-Object System.Drawing.Size(130, 26)
$profileEditorPanel.Controls.Add($txtProfileFavoriteTribe)

$txtProfileAvatar = New-Object System.Windows.Forms.TextBox
$txtProfileAvatar.Location = New-Object System.Drawing.Point(426, 38)
$txtProfileAvatar.Size = New-Object System.Drawing.Size(190, 26)
$profileEditorPanel.Controls.Add($txtProfileAvatar)

$lblGlobal = New-Object System.Windows.Forms.Label
$lblGlobal.Text = "Ranked global (ELO/wins/losses)"
$lblGlobal.Location = New-Object System.Drawing.Point(12, 74)
$profileEditorPanel.Controls.Add($lblGlobal)

$numGlobalElo = New-Object System.Windows.Forms.NumericUpDown
$numGlobalElo.Location = New-Object System.Drawing.Point(12, 98)
$numGlobalElo.Maximum = 6000
$numGlobalElo.Size = New-Object System.Drawing.Size(100, 26)
$profileEditorPanel.Controls.Add($numGlobalElo)

$numGlobalWins = New-Object System.Windows.Forms.NumericUpDown
$numGlobalWins.Location = New-Object System.Drawing.Point(118, 98)
$numGlobalWins.Maximum = 999999
$numGlobalWins.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numGlobalWins)

$numGlobalLosses = New-Object System.Windows.Forms.NumericUpDown
$numGlobalLosses.Location = New-Object System.Drawing.Point(204, 98)
$numGlobalLosses.Maximum = 999999
$numGlobalLosses.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numGlobalLosses)

$lblDromeEdit = New-Object System.Windows.Forms.Label
$lblDromeEdit.Text = "Ranked mensal dromo (score/wins/losses)"
$lblDromeEdit.Location = New-Object System.Drawing.Point(12, 134)
$profileEditorPanel.Controls.Add($lblDromeEdit)

$numDromeScore = New-Object System.Windows.Forms.NumericUpDown
$numDromeScore.Location = New-Object System.Drawing.Point(12, 158)
$numDromeScore.Maximum = 999999
$numDromeScore.Size = New-Object System.Drawing.Size(100, 26)
$profileEditorPanel.Controls.Add($numDromeScore)

$numDromeWins = New-Object System.Windows.Forms.NumericUpDown
$numDromeWins.Location = New-Object System.Drawing.Point(118, 158)
$numDromeWins.Maximum = 999999
$numDromeWins.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numDromeWins)

$numDromeLosses = New-Object System.Windows.Forms.NumericUpDown
$numDromeLosses.Location = New-Object System.Drawing.Point(204, 158)
$numDromeLosses.Maximum = 999999
$numDromeLosses.Size = New-Object System.Drawing.Size(80, 26)
$profileEditorPanel.Controls.Add($numDromeLosses)

$profileSnapshotBox = New-Object System.Windows.Forms.TextBox
$profileSnapshotBox.Dock = "Fill"
$profileSnapshotBox.Multiline = $true
$profileSnapshotBox.ReadOnly = $true
$profileSnapshotBox.ScrollBars = "Vertical"
$profileBody.Panel2.Controls.Add($profileSnapshotBox)

# Estado PERIM tab
$perimTop = New-Object System.Windows.Forms.Panel
$perimTop.Dock = "Top"
$perimTop.Height = 72
$perimTop.AutoScroll = $true
$perimTop.Padding = New-Object System.Windows.Forms.Padding(6, 4, 6, 4)
$tabPerimState.Controls.Add($perimTop)

$lblPerimUser = New-Object System.Windows.Forms.Label
$lblPerimUser.Text = "Usuario:"
$lblPerimUser.Location = New-Object System.Drawing.Point(12, 10)
$perimTop.Controls.Add($lblPerimUser)

$comboPerimUser = New-Object System.Windows.Forms.ComboBox
$comboPerimUser.DropDownStyle = "DropDownList"
$comboPerimUser.Location = New-Object System.Drawing.Point(12, 32)
$comboPerimUser.Size = New-Object System.Drawing.Size(200, 28)
$perimTop.Controls.Add($comboPerimUser)

$btnPerimLoad = New-Object System.Windows.Forms.Button
$btnPerimLoad.Text = "Carregar estado"
$btnPerimLoad.Location = New-Object System.Drawing.Point(220, 30)
$btnPerimLoad.Size = New-Object System.Drawing.Size(120, 30)
$perimTop.Controls.Add($btnPerimLoad)

$btnPerimFixRun = New-Object System.Windows.Forms.Button
$btnPerimFixRun.Text = "Encerrar run ativa"
$btnPerimFixRun.Location = New-Object System.Drawing.Point(348, 30)
$btnPerimFixRun.Size = New-Object System.Drawing.Size(130, 30)
$perimTop.Controls.Add($btnPerimFixRun)

$btnPerimClearRewards = New-Object System.Windows.Forms.Button
$btnPerimClearRewards.Text = "Limpar recompensas"
$btnPerimClearRewards.Location = New-Object System.Drawing.Point(486, 30)
$btnPerimClearRewards.Size = New-Object System.Drawing.Size(135, 30)
$perimTop.Controls.Add($btnPerimClearRewards)

$comboPerimCampLocation = New-Object System.Windows.Forms.ComboBox
$comboPerimCampLocation.DropDownStyle = "DropDownList"
$comboPerimCampLocation.Location = New-Object System.Drawing.Point(628, 32)
$comboPerimCampLocation.Size = New-Object System.Drawing.Size(280, 28)
$perimTop.Controls.Add($comboPerimCampLocation)

$numPerimCampProgress = New-Object System.Windows.Forms.NumericUpDown
$numPerimCampProgress.Location = New-Object System.Drawing.Point(914, 33)
$numPerimCampProgress.Maximum = 9999
$numPerimCampProgress.Size = New-Object System.Drawing.Size(70, 26)
$perimTop.Controls.Add($numPerimCampProgress)

$btnPerimCampSave = New-Object System.Windows.Forms.Button
$btnPerimCampSave.Text = "Salvar camp"
$btnPerimCampSave.Location = New-Object System.Drawing.Point(990, 30)
$btnPerimCampSave.Size = New-Object System.Drawing.Size(96, 30)
$perimTop.Controls.Add($btnPerimCampSave)

$perimBody = New-Object System.Windows.Forms.SplitContainer
$perimBody.Dock = "Fill"
$perimBody.Orientation = "Horizontal"
Set-SplitterLayoutSafe -Splitter $perimBody -Panel1Min 220 -Panel2Min 160 -PreferredDistance 330
$perimBody.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$perimBody.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabPerimState.Controls.Add($perimBody)

$perimUpperSplit = New-Object System.Windows.Forms.SplitContainer
$perimUpperSplit.Dock = "Fill"
$perimUpperSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $perimUpperSplit -Panel1Min 360 -Panel2Min 320 -PreferredDistance 600
$perimUpperSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(0, 0, 4, 0)
$perimUpperSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4, 0, 0, 0)
$perimBody.Panel1.Controls.Add($perimUpperSplit)

$perimRunsGrid = New-Object System.Windows.Forms.DataGridView
$perimRunsGrid.Dock = "Fill"
$perimRunsGrid.AllowUserToAddRows = $false
$perimRunsGrid.AllowUserToDeleteRows = $false
$perimRunsGrid.ReadOnly = $true
$perimRunsGrid.SelectionMode = "FullRowSelect"
$perimRunsGrid.MultiSelect = $false
[void]$perimRunsGrid.Columns.Add("runId", "run_id")
[void]$perimRunsGrid.Columns.Add("action", "Acao")
[void]$perimRunsGrid.Columns.Add("status", "Status")
[void]$perimRunsGrid.Columns.Add("location", "Local")
[void]$perimRunsGrid.Columns.Add("startAt", "Inicio")
$perimUpperSplit.Panel1.Controls.Add($perimRunsGrid)
Apply-GridResponsiveStyle -Grid $perimRunsGrid

$perimRewardsGrid = New-Object System.Windows.Forms.DataGridView
$perimRewardsGrid.Dock = "Fill"
$perimRewardsGrid.AllowUserToAddRows = $false
$perimRewardsGrid.AllowUserToDeleteRows = $false
$perimRewardsGrid.ReadOnly = $true
$perimRewardsGrid.SelectionMode = "FullRowSelect"
$perimRewardsGrid.MultiSelect = $true
[void]$perimRewardsGrid.Columns.Add("rewardId", "reward_id")
[void]$perimRewardsGrid.Columns.Add("runId", "run_id")
[void]$perimRewardsGrid.Columns.Add("rewardType", "Tipo")
[void]$perimRewardsGrid.Columns.Add("cardId", "card_id")
[void]$perimRewardsGrid.Columns.Add("isNew", "Novo")
$perimUpperSplit.Panel2.Controls.Add($perimRewardsGrid)
Apply-GridResponsiveStyle -Grid $perimRewardsGrid

$perimCampGrid = New-Object System.Windows.Forms.DataGridView
$perimCampGrid.Dock = "Fill"
$perimCampGrid.AllowUserToAddRows = $false
$perimCampGrid.AllowUserToDeleteRows = $false
$perimCampGrid.ReadOnly = $true
$perimCampGrid.SelectionMode = "FullRowSelect"
$perimCampGrid.MultiSelect = $false
[void]$perimCampGrid.Columns.Add("locationCardId", "location_card_id")
[void]$perimCampGrid.Columns.Add("progress", "Camp progress")
$perimBody.Panel2.Controls.Add($perimCampGrid)
Apply-GridResponsiveStyle -Grid $perimCampGrid

# Config PERIM tab
$perimConfigPanel = New-Object System.Windows.Forms.Panel
$perimConfigPanel.Dock = "Fill"
$perimConfigPanel.AutoScroll = $true
$perimConfigPanel.Padding = New-Object System.Windows.Forms.Padding(12)
$tabPerimConfig.Controls.Add($perimConfigPanel)

$lblPerimConfigTitle = New-Object System.Windows.Forms.Label
$lblPerimConfigTitle.Text = "Configuracao de Drops e Caminhada (PERIM)"
$lblPerimConfigTitle.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$lblPerimConfigTitle.Location = New-Object System.Drawing.Point(12, 10)
$lblPerimConfigTitle.Size = New-Object System.Drawing.Size(640, 24)
$perimConfigPanel.Controls.Add($lblPerimConfigTitle)

$lblPerimConfigSets = New-Object System.Windows.Forms.Label
$lblPerimConfigSets.Text = "Sets liberados para drop no PERIM:"
$lblPerimConfigSets.Location = New-Object System.Drawing.Point(12, 42)
$lblPerimConfigSets.Size = New-Object System.Drawing.Size(320, 20)
$perimConfigPanel.Controls.Add($lblPerimConfigSets)

$checkedPerimSets = New-Object System.Windows.Forms.CheckedListBox
$checkedPerimSets.Location = New-Object System.Drawing.Point(12, 64)
$checkedPerimSets.Size = New-Object System.Drawing.Size(300, 180)
$checkedPerimSets.CheckOnClick = $true
$checkedPerimSets.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left
$perimConfigPanel.Controls.Add($checkedPerimSets)

$lblPerimConfigWalk = New-Object System.Windows.Forms.Label
$lblPerimConfigWalk.Text = "Horarios de caminhada diaria (HH:mm):"
$lblPerimConfigWalk.Location = New-Object System.Drawing.Point(340, 42)
$lblPerimConfigWalk.Size = New-Object System.Drawing.Size(320, 20)
$perimConfigPanel.Controls.Add($lblPerimConfigWalk)

$listPerimWalkTimes = New-Object System.Windows.Forms.ListBox
$listPerimWalkTimes.Location = New-Object System.Drawing.Point(340, 64)
$listPerimWalkTimes.Size = New-Object System.Drawing.Size(220, 180)
$listPerimWalkTimes.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left
$perimConfigPanel.Controls.Add($listPerimWalkTimes)

$txtPerimWalkTime = New-Object System.Windows.Forms.TextBox
$txtPerimWalkTime.Location = New-Object System.Drawing.Point(570, 64)
$txtPerimWalkTime.Size = New-Object System.Drawing.Size(80, 24)
$txtPerimWalkTime.Text = "00:00"
$perimConfigPanel.Controls.Add($txtPerimWalkTime)

$btnPerimWalkAdd = New-Object System.Windows.Forms.Button
$btnPerimWalkAdd.Text = "Adicionar"
$btnPerimWalkAdd.Location = New-Object System.Drawing.Point(660, 62)
$btnPerimWalkAdd.Size = New-Object System.Drawing.Size(90, 28)
$perimConfigPanel.Controls.Add($btnPerimWalkAdd)

$btnPerimWalkRemove = New-Object System.Windows.Forms.Button
$btnPerimWalkRemove.Text = "Remover"
$btnPerimWalkRemove.Location = New-Object System.Drawing.Point(660, 96)
$btnPerimWalkRemove.Size = New-Object System.Drawing.Size(90, 28)
$perimConfigPanel.Controls.Add($btnPerimWalkRemove)

$lblPerimWalkCount = New-Object System.Windows.Forms.Label
$lblPerimWalkCount.Text = "Caminhadas por dia: 0"
$lblPerimWalkCount.Location = New-Object System.Drawing.Point(340, 252)
$lblPerimWalkCount.Size = New-Object System.Drawing.Size(260, 22)
$perimConfigPanel.Controls.Add($lblPerimWalkCount)

$btnPerimConfigLoad = New-Object System.Windows.Forms.Button
$btnPerimConfigLoad.Text = "Carregar configuracao"
$btnPerimConfigLoad.Location = New-Object System.Drawing.Point(12, 286)
$btnPerimConfigLoad.Size = New-Object System.Drawing.Size(170, 32)
$perimConfigPanel.Controls.Add($btnPerimConfigLoad)

$btnPerimConfigSave = New-Object System.Windows.Forms.Button
$btnPerimConfigSave.Text = "Salvar configuracao"
$btnPerimConfigSave.Location = New-Object System.Drawing.Point(188, 286)
$btnPerimConfigSave.Size = New-Object System.Drawing.Size(170, 32)
$perimConfigPanel.Controls.Add($btnPerimConfigSave)

$lblPerimConfigHint = New-Object System.Windows.Forms.Label
$lblPerimConfigHint.Text = "Ao salvar, a configuracao passa a valer imediatamente no servidor."
$lblPerimConfigHint.Location = New-Object System.Drawing.Point(12, 324)
$lblPerimConfigHint.Size = New-Object System.Drawing.Size(560, 22)
$lblPerimConfigHint.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$perimConfigPanel.Controls.Add($lblPerimConfigHint)

# Climas por Local tab
$climateRulesSplit = New-Object System.Windows.Forms.SplitContainer
$climateRulesSplit.Dock = "Fill"
$climateRulesSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $climateRulesSplit -Panel1Min 460 -Panel2Min 420 -PreferredDistance 640
$climateRulesSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$climateRulesSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabLocationClimateRules.Controls.Add($climateRulesSplit)

$climateRulesGrid = New-Object System.Windows.Forms.DataGridView
$climateRulesGrid.Dock = "Fill"
$climateRulesGrid.ReadOnly = $true
$climateRulesGrid.AllowUserToAddRows = $false
$climateRulesGrid.AllowUserToDeleteRows = $false
$climateRulesGrid.RowHeadersVisible = $false
$climateRulesGrid.SelectionMode = "FullRowSelect"
$climateRulesGrid.MultiSelect = $false
$climateRulesGrid.ColumnCount = 5
$climateRulesGrid.Columns[0].Name = "Local"
$climateRulesGrid.Columns[1].Name = "ID"
$climateRulesGrid.Columns[2].Name = "Set"
$climateRulesGrid.Columns[3].Name = "Climas permitidos"
$climateRulesGrid.Columns[4].Name = "Atualizado"
$climateRulesSplit.Panel1.Controls.Add($climateRulesGrid)
Apply-GridResponsiveStyle -Grid $climateRulesGrid

$climateRulesPanel = New-Object System.Windows.Forms.Panel
$climateRulesPanel.Dock = "Fill"
$climateRulesPanel.AutoScroll = $true
$climateRulesSplit.Panel2.Controls.Add($climateRulesPanel)

$lblClimateRulesTitle = New-Object System.Windows.Forms.Label
$lblClimateRulesTitle.Text = "Allowlist de Climas por Local (PERIM)"
$lblClimateRulesTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblClimateRulesTitle.Location = New-Object System.Drawing.Point(12, 10)
$lblClimateRulesTitle.Size = New-Object System.Drawing.Size(480, 24)
$climateRulesPanel.Controls.Add($lblClimateRulesTitle)

$lblClimateRuleLocation = New-Object System.Windows.Forms.Label
$lblClimateRuleLocation.Text = "Local:"
$lblClimateRuleLocation.Location = New-Object System.Drawing.Point(12, 40)
$lblClimateRuleLocation.Size = New-Object System.Drawing.Size(120, 20)
$climateRulesPanel.Controls.Add($lblClimateRuleLocation)

$comboClimateRuleLocation = New-Object System.Windows.Forms.ComboBox
$comboClimateRuleLocation.DropDownStyle = "DropDownList"
$comboClimateRuleLocation.Location = New-Object System.Drawing.Point(12, 62)
$comboClimateRuleLocation.Size = New-Object System.Drawing.Size(520, 28)
$comboClimateRuleLocation.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$climateRulesPanel.Controls.Add($comboClimateRuleLocation)

$lblClimateRuleStatus = New-Object System.Windows.Forms.Label
$lblClimateRuleStatus.Text = "Status: sem regra (todos os climas permitidos)."
$lblClimateRuleStatus.Location = New-Object System.Drawing.Point(12, 94)
$lblClimateRuleStatus.Size = New-Object System.Drawing.Size(520, 20)
$lblClimateRuleStatus.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$climateRulesPanel.Controls.Add($lblClimateRuleStatus)

$lblClimateChecklist = New-Object System.Windows.Forms.Label
$lblClimateChecklist.Text = "Climas permitidos:"
$lblClimateChecklist.Location = New-Object System.Drawing.Point(12, 118)
$lblClimateChecklist.Size = New-Object System.Drawing.Size(220, 20)
$climateRulesPanel.Controls.Add($lblClimateChecklist)

$checkedClimateKeys = New-Object System.Windows.Forms.CheckedListBox
$checkedClimateKeys.Location = New-Object System.Drawing.Point(12, 140)
$checkedClimateKeys.Size = New-Object System.Drawing.Size(260, 120)
$checkedClimateKeys.CheckOnClick = $true
$climateRulesPanel.Controls.Add($checkedClimateKeys)

$btnClimateRuleSave = New-Object System.Windows.Forms.Button
$btnClimateRuleSave.Text = "Salvar"
$btnClimateRuleSave.Location = New-Object System.Drawing.Point(12, 272)
$btnClimateRuleSave.Size = New-Object System.Drawing.Size(100, 30)
$climateRulesPanel.Controls.Add($btnClimateRuleSave)

$btnClimateRuleDelete = New-Object System.Windows.Forms.Button
$btnClimateRuleDelete.Text = "Remover regra"
$btnClimateRuleDelete.Location = New-Object System.Drawing.Point(118, 272)
$btnClimateRuleDelete.Size = New-Object System.Drawing.Size(120, 30)
$climateRulesPanel.Controls.Add($btnClimateRuleDelete)

$btnClimateRuleRefresh = New-Object System.Windows.Forms.Button
$btnClimateRuleRefresh.Text = "Atualizar"
$btnClimateRuleRefresh.Location = New-Object System.Drawing.Point(244, 272)
$btnClimateRuleRefresh.Size = New-Object System.Drawing.Size(100, 30)
$climateRulesPanel.Controls.Add($btnClimateRuleRefresh)

$btnClimateRuleSeedStormAll = New-Object System.Windows.Forms.Button
$btnClimateRuleSeedStormAll.Text = "Preencher todos com Tempestade"
$btnClimateRuleSeedStormAll.Location = New-Object System.Drawing.Point(12, 308)
$btnClimateRuleSeedStormAll.Size = New-Object System.Drawing.Size(332, 32)
$climateRulesPanel.Controls.Add($btnClimateRuleSeedStormAll)

$lblClimateRuleHint = New-Object System.Windows.Forms.Label
$lblClimateRuleHint.Text = "Sem regra: local usa todos os climas. Ao salvar, a regra aplica imediatamente."
$lblClimateRuleHint.Location = New-Object System.Drawing.Point(12, 346)
$lblClimateRuleHint.Size = New-Object System.Drawing.Size(560, 40)
$lblClimateRuleHint.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$climateRulesPanel.Controls.Add($lblClimateRuleHint)

# Adjacencia de Locais tab
$locationLinksSplit = New-Object System.Windows.Forms.SplitContainer
$locationLinksSplit.Dock = "Fill"
$locationLinksSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $locationLinksSplit -Panel1Min 500 -Panel2Min 380 -PreferredDistance 700
$locationLinksSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$locationLinksSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabLocationLinks.Controls.Add($locationLinksSplit)

$locationLinksGrid = New-Object System.Windows.Forms.DataGridView
$locationLinksGrid.Dock = "Fill"
$locationLinksGrid.ReadOnly = $true
$locationLinksGrid.AllowUserToAddRows = $false
$locationLinksGrid.AllowUserToDeleteRows = $false
$locationLinksGrid.RowHeadersVisible = $false
$locationLinksGrid.SelectionMode = "FullRowSelect"
$locationLinksGrid.MultiSelect = $false
$locationLinksGrid.ColumnCount = 5
$locationLinksGrid.Columns[0].Name = "Origem"
$locationLinksGrid.Columns[1].Name = "Origem ID"
$locationLinksGrid.Columns[2].Name = "Destino"
$locationLinksGrid.Columns[3].Name = "Destino ID"
$locationLinksGrid.Columns[4].Name = "Atualizado"
$locationLinksSplit.Panel1.Controls.Add($locationLinksGrid)
Apply-GridResponsiveStyle -Grid $locationLinksGrid

$locationLinksPanel = New-Object System.Windows.Forms.Panel
$locationLinksPanel.Dock = "Fill"
$locationLinksPanel.AutoScroll = $true
$locationLinksSplit.Panel2.Controls.Add($locationLinksPanel)

$lblLocationLinksTitle = New-Object System.Windows.Forms.Label
$lblLocationLinksTitle.Text = "Adjacencia de Locais (A -> B)"
$lblLocationLinksTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblLocationLinksTitle.Location = New-Object System.Drawing.Point(12, 10)
$lblLocationLinksTitle.Size = New-Object System.Drawing.Size(460, 24)
$locationLinksPanel.Controls.Add($lblLocationLinksTitle)

$lblLocationLinkFrom = New-Object System.Windows.Forms.Label
$lblLocationLinkFrom.Text = "Local origem:"
$lblLocationLinkFrom.Location = New-Object System.Drawing.Point(12, 40)
$lblLocationLinkFrom.Size = New-Object System.Drawing.Size(160, 20)
$locationLinksPanel.Controls.Add($lblLocationLinkFrom)

$comboLocationLinkFrom = New-Object System.Windows.Forms.ComboBox
$comboLocationLinkFrom.DropDownStyle = "DropDownList"
$comboLocationLinkFrom.Location = New-Object System.Drawing.Point(12, 62)
$comboLocationLinkFrom.Size = New-Object System.Drawing.Size(520, 28)
$comboLocationLinkFrom.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$locationLinksPanel.Controls.Add($comboLocationLinkFrom)

$lblLocationLinkTo = New-Object System.Windows.Forms.Label
$lblLocationLinkTo.Text = "Local destino:"
$lblLocationLinkTo.Location = New-Object System.Drawing.Point(12, 98)
$lblLocationLinkTo.Size = New-Object System.Drawing.Size(160, 20)
$locationLinksPanel.Controls.Add($lblLocationLinkTo)

$comboLocationLinkTo = New-Object System.Windows.Forms.ComboBox
$comboLocationLinkTo.DropDownStyle = "DropDownList"
$comboLocationLinkTo.Location = New-Object System.Drawing.Point(12, 120)
$comboLocationLinkTo.Size = New-Object System.Drawing.Size(520, 28)
$comboLocationLinkTo.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$locationLinksPanel.Controls.Add($comboLocationLinkTo)

$lblLocationLinkStatus = New-Object System.Windows.Forms.Label
$lblLocationLinkStatus.Text = "Status: ligacao direcionada (somente ida)."
$lblLocationLinkStatus.Location = New-Object System.Drawing.Point(12, 154)
$lblLocationLinkStatus.Size = New-Object System.Drawing.Size(560, 20)
$lblLocationLinkStatus.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$locationLinksPanel.Controls.Add($lblLocationLinkStatus)

$btnLocationLinksAdd = New-Object System.Windows.Forms.Button
$btnLocationLinksAdd.Text = "Adicionar"
$btnLocationLinksAdd.Location = New-Object System.Drawing.Point(12, 182)
$btnLocationLinksAdd.Size = New-Object System.Drawing.Size(110, 30)
$locationLinksPanel.Controls.Add($btnLocationLinksAdd)

$btnLocationLinksRemove = New-Object System.Windows.Forms.Button
$btnLocationLinksRemove.Text = "Remover"
$btnLocationLinksRemove.Location = New-Object System.Drawing.Point(128, 182)
$btnLocationLinksRemove.Size = New-Object System.Drawing.Size(110, 30)
$locationLinksPanel.Controls.Add($btnLocationLinksRemove)

$btnLocationLinksRefresh = New-Object System.Windows.Forms.Button
$btnLocationLinksRefresh.Text = "Atualizar"
$btnLocationLinksRefresh.Location = New-Object System.Drawing.Point(244, 182)
$btnLocationLinksRefresh.Size = New-Object System.Drawing.Size(110, 30)
$locationLinksPanel.Controls.Add($btnLocationLinksRefresh)

$btnLocationLinksImport = New-Object System.Windows.Forms.Button
$btnLocationLinksImport.Text = "Importar da planilha"
$btnLocationLinksImport.Location = New-Object System.Drawing.Point(360, 182)
$btnLocationLinksImport.Size = New-Object System.Drawing.Size(172, 30)
$locationLinksPanel.Controls.Add($btnLocationLinksImport)

$lblLocationLinksHint = New-Object System.Windows.Forms.Label
$lblLocationLinksHint.Text = "A ligacao e A -> B (somente ida). Para retorno, crie tambem B -> A."
$lblLocationLinksHint.Location = New-Object System.Drawing.Point(12, 218)
$lblLocationLinksHint.Size = New-Object System.Drawing.Size(560, 36)
$lblLocationLinksHint.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$locationLinksPanel.Controls.Add($lblLocationLinksHint)

# Spawn Equipamentos tab
$battlegearSpawnSplit = New-Object System.Windows.Forms.SplitContainer
$battlegearSpawnSplit.Dock = "Fill"
$battlegearSpawnSplit.Orientation = "Vertical"
Set-SplitterLayoutSafe -Splitter $battlegearSpawnSplit -Panel1Min 520 -Panel2Min 380 -PreferredDistance 760
$battlegearSpawnSplit.Panel1.Padding = New-Object System.Windows.Forms.Padding(4)
$battlegearSpawnSplit.Panel2.Padding = New-Object System.Windows.Forms.Padding(4)
$tabBattlegearSpawns.Controls.Add($battlegearSpawnSplit)

$battlegearSpawnGrid = New-Object System.Windows.Forms.DataGridView
$battlegearSpawnGrid.Dock = "Fill"
$battlegearSpawnGrid.ReadOnly = $true
$battlegearSpawnGrid.AllowUserToAddRows = $false
$battlegearSpawnGrid.AllowUserToDeleteRows = $false
$battlegearSpawnGrid.RowHeadersVisible = $false
$battlegearSpawnGrid.SelectionMode = "FullRowSelect"
$battlegearSpawnGrid.MultiSelect = $false
$battlegearSpawnGrid.ColumnCount = 12
$battlegearSpawnGrid.Columns[0].Name = "Equipamento"
$battlegearSpawnGrid.Columns[1].Name = "Card ID"
$battlegearSpawnGrid.Columns[2].Name = "Local 1"
$battlegearSpawnGrid.Columns[3].Name = "Local 1 ID"
$battlegearSpawnGrid.Columns[4].Name = "Local 2"
$battlegearSpawnGrid.Columns[5].Name = "Local 2 ID"
$battlegearSpawnGrid.Columns[6].Name = "Chance (%)"
$battlegearSpawnGrid.Columns[7].Name = "Ativo"
$battlegearSpawnGrid.Columns[8].Name = "Hoje"
$battlegearSpawnGrid.Columns[9].Name = "Roll Hoje"
$battlegearSpawnGrid.Columns[10].Name = "Quest-only"
$battlegearSpawnGrid.Columns[11].Name = "Atualizado"
$battlegearSpawnSplit.Panel1.Controls.Add($battlegearSpawnGrid)
Apply-GridResponsiveStyle -Grid $battlegearSpawnGrid

$battlegearSpawnPanel = New-Object System.Windows.Forms.Panel
$battlegearSpawnPanel.Dock = "Fill"
$battlegearSpawnPanel.AutoScroll = $true
$battlegearSpawnSplit.Panel2.Controls.Add($battlegearSpawnPanel)

$lblBattlegearSpawnTitle = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnTitle.Text = "Spawn Diario de Equipamentos por Local"
$lblBattlegearSpawnTitle.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$lblBattlegearSpawnTitle.Location = New-Object System.Drawing.Point(12, 10)
$lblBattlegearSpawnTitle.Size = New-Object System.Drawing.Size(560, 24)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnTitle)

$lblBattlegearSpawnCard = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnCard.Text = "Equipamento:"
$lblBattlegearSpawnCard.Location = New-Object System.Drawing.Point(12, 40)
$lblBattlegearSpawnCard.Size = New-Object System.Drawing.Size(140, 20)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnCard)

$comboBattlegearSpawnCard = New-Object System.Windows.Forms.ComboBox
$comboBattlegearSpawnCard.DropDownStyle = "DropDownList"
$comboBattlegearSpawnCard.Location = New-Object System.Drawing.Point(12, 62)
$comboBattlegearSpawnCard.Size = New-Object System.Drawing.Size(520, 28)
$comboBattlegearSpawnCard.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$battlegearSpawnPanel.Controls.Add($comboBattlegearSpawnCard)

$lblBattlegearSpawnLoc1 = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnLoc1.Text = "Local 1:"
$lblBattlegearSpawnLoc1.Location = New-Object System.Drawing.Point(12, 98)
$lblBattlegearSpawnLoc1.Size = New-Object System.Drawing.Size(140, 20)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnLoc1)

$comboBattlegearSpawnLoc1 = New-Object System.Windows.Forms.ComboBox
$comboBattlegearSpawnLoc1.DropDownStyle = "DropDownList"
$comboBattlegearSpawnLoc1.Location = New-Object System.Drawing.Point(12, 120)
$comboBattlegearSpawnLoc1.Size = New-Object System.Drawing.Size(520, 28)
$comboBattlegearSpawnLoc1.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$battlegearSpawnPanel.Controls.Add($comboBattlegearSpawnLoc1)

$lblBattlegearSpawnLoc2 = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnLoc2.Text = "Local 2:"
$lblBattlegearSpawnLoc2.Location = New-Object System.Drawing.Point(12, 156)
$lblBattlegearSpawnLoc2.Size = New-Object System.Drawing.Size(140, 20)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnLoc2)

$comboBattlegearSpawnLoc2 = New-Object System.Windows.Forms.ComboBox
$comboBattlegearSpawnLoc2.DropDownStyle = "DropDownList"
$comboBattlegearSpawnLoc2.Location = New-Object System.Drawing.Point(12, 178)
$comboBattlegearSpawnLoc2.Size = New-Object System.Drawing.Size(520, 28)
$comboBattlegearSpawnLoc2.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
$battlegearSpawnPanel.Controls.Add($comboBattlegearSpawnLoc2)

$lblBattlegearSpawnChance = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnChance.Text = "Chance (%):"
$lblBattlegearSpawnChance.Location = New-Object System.Drawing.Point(12, 214)
$lblBattlegearSpawnChance.Size = New-Object System.Drawing.Size(120, 20)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnChance)

$numBattlegearSpawnChance = New-Object System.Windows.Forms.NumericUpDown
$numBattlegearSpawnChance.Location = New-Object System.Drawing.Point(12, 236)
$numBattlegearSpawnChance.Size = New-Object System.Drawing.Size(140, 24)
$numBattlegearSpawnChance.Minimum = 0
$numBattlegearSpawnChance.Maximum = 100
$numBattlegearSpawnChance.DecimalPlaces = 2
$numBattlegearSpawnChance.Increment = 0.5
$numBattlegearSpawnChance.Value = 50
$battlegearSpawnPanel.Controls.Add($numBattlegearSpawnChance)

$chkBattlegearSpawnEnabled = New-Object System.Windows.Forms.CheckBox
$chkBattlegearSpawnEnabled.Text = "Regra ativa"
$chkBattlegearSpawnEnabled.Location = New-Object System.Drawing.Point(166, 236)
$chkBattlegearSpawnEnabled.Size = New-Object System.Drawing.Size(140, 24)
$chkBattlegearSpawnEnabled.Checked = $true
$battlegearSpawnPanel.Controls.Add($chkBattlegearSpawnEnabled)

$lblBattlegearSpawnStatus = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnStatus.Text = "Hoje: sem roll para este equipamento."
$lblBattlegearSpawnStatus.Location = New-Object System.Drawing.Point(12, 266)
$lblBattlegearSpawnStatus.Size = New-Object System.Drawing.Size(560, 36)
$lblBattlegearSpawnStatus.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnStatus)

$btnBattlegearSpawnSave = New-Object System.Windows.Forms.Button
$btnBattlegearSpawnSave.Text = "Salvar regra"
$btnBattlegearSpawnSave.Location = New-Object System.Drawing.Point(12, 306)
$btnBattlegearSpawnSave.Size = New-Object System.Drawing.Size(130, 30)
$battlegearSpawnPanel.Controls.Add($btnBattlegearSpawnSave)

$btnBattlegearSpawnDelete = New-Object System.Windows.Forms.Button
$btnBattlegearSpawnDelete.Text = "Remover regra"
$btnBattlegearSpawnDelete.Location = New-Object System.Drawing.Point(148, 306)
$btnBattlegearSpawnDelete.Size = New-Object System.Drawing.Size(130, 30)
$battlegearSpawnPanel.Controls.Add($btnBattlegearSpawnDelete)

$btnBattlegearSpawnRefresh = New-Object System.Windows.Forms.Button
$btnBattlegearSpawnRefresh.Text = "Atualizar"
$btnBattlegearSpawnRefresh.Location = New-Object System.Drawing.Point(284, 306)
$btnBattlegearSpawnRefresh.Size = New-Object System.Drawing.Size(100, 30)
$battlegearSpawnPanel.Controls.Add($btnBattlegearSpawnRefresh)

$lblBattlegearSpawnHint = New-Object System.Windows.Forms.Label
$lblBattlegearSpawnHint.Text = "Virada 00:00: escolhe Local 1/2 (50/50) e rola chance uma vez. Falha = indisponivel no dia."
$lblBattlegearSpawnHint.Location = New-Object System.Drawing.Point(12, 342)
$lblBattlegearSpawnHint.Size = New-Object System.Drawing.Size(560, 40)
$lblBattlegearSpawnHint.ForeColor = [System.Drawing.Color]::FromArgb(90, 110, 140)
$battlegearSpawnPanel.Controls.Add($lblBattlegearSpawnHint)

# Logs tab
$logsPanel = New-Object System.Windows.Forms.Panel
$logsPanel.Dock = "Fill"
$tabLogs.Controls.Add($logsPanel)

$logsTop = New-Object System.Windows.Forms.Panel
$logsTop.Dock = "Top"
$logsTop.Height = 44
$logsTop.Padding = New-Object System.Windows.Forms.Padding(6)
$logsPanel.Controls.Add($logsTop)

$btnLogsRefresh = New-Object System.Windows.Forms.Button
$btnLogsRefresh.Text = "Atualizar logs"
$btnLogsRefresh.Location = New-Object System.Drawing.Point(12, 6)
$btnLogsRefresh.Size = New-Object System.Drawing.Size(110, 30)
$logsTop.Controls.Add($btnLogsRefresh)

$logsBox = New-Object System.Windows.Forms.TextBox
$logsBox.Dock = "Fill"
$logsBox.Multiline = $true
$logsBox.ReadOnly = $true
$logsBox.ScrollBars = "Vertical"
$logsPanel.Controls.Add($logsBox)
$logsTop.BringToFront()

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

function Build-OptionalLocationItems {
  $items = @((New-DisplayItem -Label "(Nao definido)" -Value ""))
  $items += @(Build-LocationItems)
  return $items
}

function Get-LocationTribeDisplayLabel {
  param([string]$TribeKey)
  switch ($TribeKey) {
    "overworld" { return "Outromundo" }
    "underworld" { return "Submundo" }
    "danian" { return "Danian" }
    "mipedian" { return "Mipedian" }
    "marrillian" { return "Marrillian" }
    "tribeless" { return "Sem tribo (Generic)" }
    default { return [string]$TribeKey }
  }
}

function Build-LocationTribeKeyItems {
  return @(
    (New-DisplayItem -Label "Outromundo" -Value "overworld")
    (New-DisplayItem -Label "Submundo" -Value "underworld")
    (New-DisplayItem -Label "Danian" -Value "danian")
    (New-DisplayItem -Label "Mipedian" -Value "mipedian")
    (New-DisplayItem -Label "Marrillian" -Value "marrillian")
    (New-DisplayItem -Label "Sem tribo (Generic)" -Value "tribeless")
  )
}

function Get-ClimateDisplayLabel {
  param([string]$ClimateKey)
  switch ($ClimateKey) {
    "ensolarado" { return "Ensolarado" }
    "chuvoso" { return "Chuvoso" }
    "ventania" { return "Ventania" }
    "tempestade" { return "Tempestade" }
    "nublado" { return "Nublado" }
    "umido" { return "Umido" }
    "seco" { return "Seco" }
    "frio" { return "Frio" }
    "quente" { return "Quente" }
    "lugar_fechado" { return "Lugar Fechado" }
    default { return [string]$ClimateKey }
  }
}

function Build-LocationClimateItems {
  return @(
    (New-DisplayItem -Label "Ensolarado" -Value "ensolarado")
    (New-DisplayItem -Label "Chuvoso" -Value "chuvoso")
    (New-DisplayItem -Label "Ventania" -Value "ventania")
    (New-DisplayItem -Label "Tempestade" -Value "tempestade")
    (New-DisplayItem -Label "Nublado" -Value "nublado")
    (New-DisplayItem -Label "Umido" -Value "umido")
    (New-DisplayItem -Label "Seco" -Value "seco")
    (New-DisplayItem -Label "Frio" -Value "frio")
    (New-DisplayItem -Label "Quente" -Value "quente")
    (New-DisplayItem -Label "Lugar Fechado" -Value "lugar_fechado")
  )
}

function Build-DromeItems {
  return @(
    (New-DisplayItem -Label "Crellan" -Value "crellan")
    (New-DisplayItem -Label "Hotekk" -Value "hotekk")
    (New-DisplayItem -Label "Amzen" -Value "amzen")
    (New-DisplayItem -Label "Oron" -Value "oron")
    (New-DisplayItem -Label "Tirasis" -Value "tirasis")
    (New-DisplayItem -Label "Imthor" -Value "imthor")
    (New-DisplayItem -Label "Chirrul" -Value "chirrul")
    (New-DisplayItem -Label "Beta" -Value "beta")
  )
}

function Build-ScansTypeItems {
  return @(
    (New-DisplayItem -Label "Todos" -Value "")
    (New-DisplayItem -Label "Creatures" -Value "creatures")
    (New-DisplayItem -Label "Attacks" -Value "attacks")
    (New-DisplayItem -Label "Battlegear" -Value "battlegear")
    (New-DisplayItem -Label "Locations" -Value "locations")
    (New-DisplayItem -Label "Mugic" -Value "mugic")
  )
}

function Build-QuestDifficultyItems {
  return @(
    (New-DisplayItem -Label "OK" -Value "ok")
    (New-DisplayItem -Label "Muito dificil" -Value "muito_dificil")
    (New-DisplayItem -Label "Impossivel" -Value "impossivel")
  )
}

function Update-QuestSetFromRewardSelection {
  $rewardCardId = Get-SelectedValue -Combo $comboRewardCard
  $setKey = ""
  if ($rewardCardId) {
    $card = $script:CatalogCards | Where-Object { [string]$_.id -eq [string]$rewardCardId } | Select-Object -First 1
    if ($card) {
      $setKey = ([string]$card.setName).ToLowerInvariant().Trim()
    }
  }
  $txtQuestSetKey.Text = $setKey
}

function Refresh-TypeCardCombos {
  $eventType = Get-SelectedValue -Combo $comboEventType
  Set-ComboItems -Combo $comboEventCard -Items (Build-CardItems -Type $eventType)

  $rewardType = Get-SelectedValue -Combo $comboRewardType
  Set-ComboItems -Combo $comboRewardCard -Items (Build-CardItems -Type $rewardType)
  Update-QuestSetFromRewardSelection

  $reqType = Get-SelectedValue -Combo $comboReqType
  Set-ComboItems -Combo $comboReqCard -Items (Build-CardItems -Type $reqType)
}

function Load-LocationTribes {
  Set-Status "Carregando tribos de locais..."
  $payload = Invoke-AdminEngine -Action "location-tribes-list"
  $script:LocationTribesCache = @($payload.locationTribes)
  $locationTribesGrid.Rows.Clear()
  foreach ($entry in $script:LocationTribesCache) {
    $label = Get-LocationTribeDisplayLabel -TribeKey ([string]$entry.tribeKey)
    [void]$locationTribesGrid.Rows.Add(
      [string]$entry.locationName,
      [string]$entry.locationCardId,
      $label,
      [string]$entry.updatedAt
    )
  }
  Set-Status "Tribos de locais carregadas."
}

function Set-CheckedClimateSelections {
  param([string[]]$ClimateKeys)
  $selected = @($ClimateKeys | ForEach-Object { [string]$_ })
  for ($idx = 0; $idx -lt $checkedClimateKeys.Items.Count; $idx += 1) {
    $item = $checkedClimateKeys.Items[$idx]
    $value = [string]$item.Value
    $checkedClimateKeys.SetItemChecked($idx, ($selected -contains $value))
  }
}

function Collect-CheckedClimateSelections {
  $selected = @()
  foreach ($item in $checkedClimateKeys.CheckedItems) {
    $value = [string]$item.Value
    if (-not [string]::IsNullOrWhiteSpace($value) -and -not ($selected -contains $value)) {
      $selected += $value
    }
  }
  return @($selected)
}

function Load-LocationClimateRules {
  Set-Status "Carregando regras de climas por local..."
  $payload = Invoke-AdminEngine -Action "location-climates-list"
  $script:LocationClimateRulesCache = @($payload.locationClimateRules)
  $climateRulesGrid.Rows.Clear()
  foreach ($entry in $script:LocationClimateRulesCache) {
    $climateLabels = @()
    foreach ($k in @($entry.allowedClimateKeys)) {
      $climateLabels += (Get-ClimateDisplayLabel -ClimateKey ([string]$k))
    }
    [void]$climateRulesGrid.Rows.Add(
      [string]$entry.locationName,
      [string]$entry.locationCardId,
      [string]$entry.locationSet,
      ($climateLabels -join ", "),
      [string]$entry.updatedAt
    )
  }
  $selectedLocationCardId = Get-SelectedValue -Combo $comboClimateRuleLocation
  if ($selectedLocationCardId) {
    $entry = $script:LocationClimateRulesCache | Where-Object { [string]$_.locationCardId -eq $selectedLocationCardId } | Select-Object -First 1
    if ($entry) {
      Set-CheckedClimateSelections -ClimateKeys @($entry.allowedClimateKeys)
      $lblClimateRuleStatus.Text = "Status: regra ativa para este local."
    } else {
      Set-CheckedClimateSelections -ClimateKeys @()
      $lblClimateRuleStatus.Text = "Status: sem regra (todos os climas permitidos)."
    }
  } else {
    Set-CheckedClimateSelections -ClimateKeys @()
    $lblClimateRuleStatus.Text = "Status: sem regra (todos os climas permitidos)."
  }
  Set-Status "Regras de climas carregadas."
}

function Load-LocationLinks {
  Set-Status "Carregando adjacencias de locais..."
  $payload = Invoke-AdminEngine -Action "location-links-list"
  $script:LocationLinksCache = @($payload.locationLinks)
  $locationLinksGrid.Rows.Clear()
  foreach ($entry in $script:LocationLinksCache) {
    [void]$locationLinksGrid.Rows.Add(
      [string]$entry.fromLocationName,
      [string]$entry.fromLocationCardId,
      [string]$entry.toLocationName,
      [string]$entry.toLocationCardId,
      [string]$entry.updatedAt
    )
  }
  $fromId = Get-SelectedValue -Combo $comboLocationLinkFrom
  $toId = Get-SelectedValue -Combo $comboLocationLinkTo
  if ($fromId -and $toId) {
    $lblLocationLinkStatus.Text = "Status: origem '$fromId' e destino '$toId'."
  } else {
    $lblLocationLinkStatus.Text = "Status: ligacao direcionada (somente ida)."
  }
  Set-Status "Adjacencias carregadas."
}

function Update-BattlegearSpawnFormFromCardId {
  param([string]$CardId)
  $cardId = [string]$CardId
  if (-not $cardId) {
    $lblBattlegearSpawnStatus.Text = "Hoje: sem roll para este equipamento."
    return
  }
  $entry = $script:BattlegearSpawnRulesCache | Where-Object { [string]$_.cardId -eq $cardId } | Select-Object -First 1
  if ($entry) {
    $comboBattlegearSpawnLoc1.SelectedValue = [string]$entry.location1CardId
    $comboBattlegearSpawnLoc2.SelectedValue = [string]$entry.location2CardId
    try {
      $chanceValue = [decimal]([double]$entry.chancePercent)
      if ($chanceValue -lt $numBattlegearSpawnChance.Minimum) { $chanceValue = $numBattlegearSpawnChance.Minimum }
      if ($chanceValue -gt $numBattlegearSpawnChance.Maximum) { $chanceValue = $numBattlegearSpawnChance.Maximum }
      $numBattlegearSpawnChance.Value = $chanceValue
    } catch {
      $numBattlegearSpawnChance.Value = 0
    }
    $chkBattlegearSpawnEnabled.Checked = [bool]$entry.enabled
    if ([bool]$entry.questExclusive) {
      $lblBattlegearSpawnStatus.Text = "Quest-only: este equipamento so pode ser obtido por quest (spawn por local ignorado)."
      return
    }
    if ($null -ne $entry.dailyIsAvailable) {
      $dailyLabel = if ([bool]$entry.dailyIsAvailable) { "DISPONIVEL" } else { "INDISPONIVEL" }
      $dailyLocation = [string]$entry.dailySelectedLocationName
      if (-not $dailyLocation) { $dailyLocation = [string]$entry.dailySelectedLocationCardId }
      $dailyRoll = if ($null -ne $entry.dailyRollValue -and "$($entry.dailyRollValue)" -ne "") { [string]$entry.dailyRollValue } else { "-" }
      $dailyChance = if ($null -ne $entry.dailyChancePercent -and "$($entry.dailyChancePercent)" -ne "") { [string]$entry.dailyChancePercent } else { "-" }
      $lblBattlegearSpawnStatus.Text = "Hoje ($([string]$entry.dailyDateKey)): $dailyLabel em '$dailyLocation' (roll=$dailyRoll / chance=$dailyChance)."
    } else {
      $lblBattlegearSpawnStatus.Text = "Hoje: sem roll para este equipamento (ainda nao processado)."
    }
  } else {
    $lblBattlegearSpawnStatus.Text = "Status: sem regra salva para este equipamento."
  }
}

function Load-BattlegearSpawnRules {
  Set-Status "Carregando regras de spawn de equipamentos..."
  $payload = Invoke-AdminEngine -Action "battlegear-spawn-rules-list"
  $script:BattlegearSpawnRulesCache = @($payload.battlegearSpawnRules)
  $battlegearSpawnGrid.Rows.Clear()
  foreach ($entry in $script:BattlegearSpawnRulesCache) {
    $activeText = if ([bool]$entry.enabled) { "Sim" } else { "Nao" }
    $todayText = if ($null -eq $entry.dailyIsAvailable) {
      "-"
    } elseif ([bool]$entry.dailyIsAvailable) {
      "Disponivel"
    } else {
      "Indisponivel"
    }
    $todayRollText = if ($null -eq $entry.dailyRollValue -or "$($entry.dailyRollValue)" -eq "") {
      "-"
    } else {
      "{0} / {1}" -f [string]$entry.dailyRollValue, [string]$entry.dailyChancePercent
    }
    $questOnlyText = if ([bool]$entry.questExclusive) { "Sim" } else { "Nao" }
    [void]$battlegearSpawnGrid.Rows.Add(
      [string]$entry.cardName,
      [string]$entry.cardId,
      [string]$entry.location1Name,
      [string]$entry.location1CardId,
      [string]$entry.location2Name,
      [string]$entry.location2CardId,
      [string]$entry.chancePercent,
      $activeText,
      $todayText,
      $todayRollText,
      $questOnlyText,
      [string]$entry.updatedAt
    )
  }
  $selectedCardId = Get-SelectedValue -Combo $comboBattlegearSpawnCard
  Update-BattlegearSpawnFormFromCardId -CardId $selectedCardId
  Set-Status "Regras de spawn de equipamentos carregadas."
}

function Load-Users {
  Set-Status "Carregando usuarios..."
  $payload = Invoke-AdminEngine -Action "list-users"
  $script:Users = @($payload.users)
  $items = @($script:Users | ForEach-Object { New-DisplayItem -Label ([string]$_) -Value ([string]$_) })
  Set-ComboItems -Combo $userCombo -Items $items
  Set-ComboItems -Combo $comboScansUser -Items $items
  Set-ComboItems -Combo $comboProfileUser -Items $items
  Set-ComboItems -Combo $comboPerimUser -Items $items
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
function Set-EventNotifyStatus {
  param(
    [int]$Count = 0,
    [bool]$Enabled = $false
  )
  if ($Enabled -and $Count -gt 0) {
    $lblEventNotifyStatus.Text = "BROADCAST: notificacao global enviada para $Count jogador(es)."
    $lblEventNotifyStatus.ForeColor = [System.Drawing.Color]::FromArgb(80, 180, 110)
    return
  }
  if ($Enabled) {
    $lblEventNotifyStatus.Text = "BROADCAST: envio solicitado, mas nenhum jogador elegivel foi encontrado."
    $lblEventNotifyStatus.ForeColor = [System.Drawing.Color]::FromArgb(220, 170, 90)
    return
  }
  $lblEventNotifyStatus.Text = "Notificacao global: nao enviada neste formulario."
  $lblEventNotifyStatus.ForeColor = [System.Drawing.Color]::FromArgb(130, 150, 170)
}

function Reset-EventForm {
  $script:CurrentEventId = 0
  $eventIdLabel.Text = "Evento selecionado: novo"
  $txtEventText.Text = ""
  $txtEventNotifyText.Text = ""
  $chkEventNotifyAll.Checked = $false
  $txtEventNotifyText.Enabled = $false
  $numEventChance.Value = 0
  $dtEventStart.Value = [datetime]::Now
  $dtEventEnd.Value = [datetime]::Now.AddDays(1)
  $chkEventEnabled.Checked = $true
  Set-EventNotifyStatus -Count 0 -Enabled $false
}

function Load-Events {
  Set-Status "Carregando eventos..."
  $payload = Invoke-AdminEngine -Action "events-list"
  $script:EventsCache = @($payload.events)
  $onlyActiveNow = [bool]$chkEventsOnlyActive.Checked
  $nowUtc = [DateTime]::UtcNow
  $eventsGrid.Rows.Clear()
  foreach ($ev in $script:EventsCache) {
    $enabled = [bool]$ev.enabled
    $startUtc = [datetime]::MinValue
    $endUtc = [datetime]::MinValue
    $hasStart = [datetime]::TryParse([string]$ev.startAt, [ref]$startUtc)
    $hasEnd = [datetime]::TryParse([string]$ev.endAt, [ref]$endUtc)
    $isActiveNow = $enabled -and $hasStart -and $hasEnd -and ($startUtc.ToUniversalTime() -le $nowUtc) -and ($endUtc.ToUniversalTime() -ge $nowUtc)
    if ($onlyActiveNow -and (-not $isActiveNow)) {
      continue
    }
    $textLabel = if ($isActiveNow) { "[ATIVO] " + [string]$ev.eventText } else { [string]$ev.eventText }
    [void]$eventsGrid.Rows.Add(
      [string]$ev.id,
      $textLabel,
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

function Get-SelectedBanlist {
  $selectedId = [int]$script:CurrentBanlistId
  if ($selectedId -le 0) { return $null }
  return $script:RankedBanlistsCache | Where-Object { [int]$_.banlistId -eq $selectedId } | Select-Object -First 1
}

function Reset-BanlistForm {
  $script:CurrentBanlistId = 0
  $lblBanlistSelected.Text = "Banlist selecionada: nova"
  $txtBanlistName.Text = ""
  $txtBanlistDescription.Text = ""
  if ($comboBanlistAllowedCopies.Items.Count -gt 0) {
    $comboBanlistAllowedCopies.SelectedIndex = 0
  }
  $listBanlistCards.Items.Clear()
}

function Fill-BanlistFormById {
  param([int]$BanlistId)
  $entry = $script:RankedBanlistsCache | Where-Object { [int]$_.banlistId -eq $BanlistId } | Select-Object -First 1
  if (-not $entry) { return }
  $script:CurrentBanlistId = [int]$entry.banlistId
  $activeLabel = if ([bool]$entry.isActive) { " (ATIVA)" } else { "" }
  $lblBanlistSelected.Text = "Banlist selecionada: ID $($entry.banlistId)$activeLabel"
  $txtBanlistName.Text = [string]$entry.name
  $txtBanlistDescription.Text = [string]$entry.description
  $listBanlistCards.Items.Clear()
  foreach ($card in @($entry.cards)) {
    $item = New-Object System.Windows.Forms.ListViewItem([string]$card.cardId)
    [void]$item.SubItems.Add([string]$card.cardName)
    $allowedValue = if ($null -eq $card.allowedCopies) { 0 } else { [int]$card.allowedCopies }
    $allowedText = [string]$allowedValue
    [void]$item.SubItems.Add($allowedText)
    [void]$listBanlistCards.Items.Add($item)
  }
}

function Load-Banlists {
  Set-Status "Carregando banlists ranked..."
  $payload = Invoke-AdminEngine -Action "banlists-list"
  $script:RankedBanlistsCache = @($payload.banlists)
  $banlistsGrid.Rows.Clear()
  foreach ($entry in $script:RankedBanlistsCache) {
    $activeText = if ([bool]$entry.isActive) { "Sim" } else { "Nao" }
    [void]$banlistsGrid.Rows.Add(
      [string]$entry.banlistId,
      [string]$entry.name,
      [string]$entry.description,
      $activeText,
      [string]$entry.cardsCount,
      [string]$entry.updatedAt
    )
  }
  if ($script:CurrentBanlistId -gt 0) {
    Fill-BanlistFormById -BanlistId ([int]$script:CurrentBanlistId)
  } else {
    $active = $script:RankedBanlistsCache | Where-Object { [bool]$_.isActive } | Select-Object -First 1
    if ($active) {
      Fill-BanlistFormById -BanlistId ([int]$active.banlistId)
    } else {
      Reset-BanlistForm
    }
  }
  Set-Status "Banlists ranked carregadas."
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
  $chkEventNotifyAll.Checked = $false
  $txtEventNotifyText.Text = ""
  $txtEventNotifyText.Enabled = $false
  Set-EventNotifyStatus -Count 0 -Enabled $false
}

function Build-EventPayload {
  return @{
    eventText = $txtEventText.Text.Trim()
    notifyAllPlayers = [bool]$chkEventNotifyAll.Checked
    notificationText = $txtEventNotifyText.Text.Trim()
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
  $txtQuestSetKey.Text = ""
  $chkQuestDraft.Checked = $true
  $chkQuestEnabled.Checked = $false
  $comboQuestDifficulty.SelectedValue = "ok"
  $comboRewardType.SelectedIndex = 0
  Refresh-TypeCardCombos
  $comboQuestTargetLocation.SelectedValue = ""
  $txtAnomalyIds.Text = ""
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
      [string]$q.questSetKey,
      [string]$q.difficultyKey,
      [string]$q.isDraft,
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
  $txtQuestSetKey.Text = [string]$quest.questSetKey
  $comboQuestDifficulty.SelectedValue = [string]$quest.difficultyKey
  $chkQuestDraft.Checked = [bool]$quest.isDraft
  $comboRewardType.SelectedValue = [string]$quest.rewardType
  Refresh-TypeCardCombos
  $comboRewardCard.SelectedValue = [string]$quest.rewardCardId
  Update-QuestSetFromRewardSelection
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
    questSetKey = $txtQuestSetKey.Text.Trim()
    difficultyKey = Get-SelectedValue -Combo $comboQuestDifficulty
    isDraft = [bool]$chkQuestDraft.Checked
    targetLocationCardId = Get-SelectedValue -Combo $comboQuestTargetLocation
    anomalyLocationIds = $anomalyIds
    requirements = $reqs
    enabled = [bool]$chkQuestEnabled.Checked
  }
}

function Get-PreferredSelectedUsername {
  foreach ($combo in @($comboScansUser, $comboProfileUser, $comboPerimUser, $userCombo)) {
    if ($null -ne $combo) {
      $value = Get-SelectedValue -Combo $combo
      if (-not [string]::IsNullOrWhiteSpace($value)) {
        return $value
      }
    }
  }
  return ""
}

function Confirm-StrictDestructiveAction {
  param(
    [string]$Title,
    [string]$Message,
    [string]$Phrase = "CONFIRMAR"
  )
  $confirm = [System.Windows.Forms.MessageBox]::Show($Message, $Title, [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
  if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
    return $false
  }
  $typed = Show-TextPrompt -Title $Title -Message "Digite $Phrase para confirmar:"
  if ([string]::IsNullOrWhiteSpace($typed) -or $typed.Trim() -cne $Phrase) {
    [System.Windows.Forms.MessageBox]::Show("Confirmacao invalida. Operacao cancelada.", "Cancelado", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    return $false
  }
  return $true
}

function Build-ScansFilterPayload {
  return @{
    cardType = Get-SelectedValue -Combo $comboScansType
    setKey = $txtScansSet.Text.Trim()
    query = $txtScansQuery.Text.Trim()
    limit = 2000
  }
}

function Load-Scans {
  $username = Get-SelectedValue -Combo $comboScansUser
  if (-not $username) {
    $scansGrid.Rows.Clear()
    return
  }
  Set-Status "Carregando scans de '$username'..."
  $payload = Invoke-AdminEngine -Action "scans-list" -Username $username -Payload (Build-ScansFilterPayload)
  $script:ScansCache = @($payload.scans)
  $scansGrid.Rows.Clear()
  foreach ($entry in $script:ScansCache) {
    [void]$scansGrid.Rows.Add(
      [string]$entry.scanEntryId,
      [string]$entry.cardType,
      [string]$entry.cardName,
      [string]$entry.cardId,
      [string]$entry.setName,
      [string]$entry.obtainedAt,
      [string]$entry.source,
      [string]$entry.variantJson
    )
  }
  Set-Status "Scans carregados para '$username'."
}

function Refresh-GrantCardCombo {
  $grantType = Get-SelectedValue -Combo $comboGrantCardType
  Set-ComboItems -Combo $comboGrantCard -Items (Build-CardItems -Type $grantType)
}

function Build-ProfileRankedPayload {
  return @{
    seasonKey = $txtProfileSeason.Text.Trim()
    dromeId = Get-SelectedValue -Combo $comboProfileDrome
    profile = @{
      score = [int]$numProfileScore.Value
      wins = [int]$numProfileWins.Value
      losses = [int]$numProfileLosses.Value
      favoriteTribe = $txtProfileFavoriteTribe.Text.Trim()
      avatar = $txtProfileAvatar.Text.Trim()
    }
    rankedGlobal = @{
      elo = [int]$numGlobalElo.Value
      wins = [int]$numGlobalWins.Value
      losses = [int]$numGlobalLosses.Value
    }
    drome = @{
      dromeId = Get-SelectedValue -Combo $comboProfileDrome
      score = [int]$numDromeScore.Value
      wins = [int]$numDromeWins.Value
      losses = [int]$numDromeLosses.Value
    }
  }
}

function Render-ProfileRankedSnapshot {
  param([object]$Snapshot)
  if ($null -eq $Snapshot) {
    $profileSnapshotBox.Text = "Sem dados."
    return
  }
  $profile = $Snapshot.profile
  if (-not $profile) {
    $profile = @{ score = 0; wins = 0; losses = 0; favoriteTribe = ""; avatar = "" }
  }
  $global = $Snapshot.rankedGlobal
  if (-not $global) {
    $global = @{ elo = 1200; wins = 0; losses = 0 }
  }
  $selection = $Snapshot.rankedSelection
  if (-not $selection) {
    $selection = @{ dromeId = ""; lockedAt = "" }
  }
  $avatarPreview = [string]$profile.avatar
  if ($avatarPreview.Length -gt 96) {
    $avatarPreview = $avatarPreview.Substring(0, 96) + "... (truncado)"
  }
  $profileSnapshotBox.Text = @"
Usuario: $($Snapshot.username)
owner_key: $($Snapshot.ownerKey)
Temporada: $($Snapshot.seasonKey)
Selecao Dromo: $($selection.dromeId) (lock: $($selection.lockedAt))

Perfil:
  score: $($profile.score)
  wins/losses: $($profile.wins)/$($profile.losses)
  favorite_tribe: $($profile.favoriteTribe)
  avatar: $avatarPreview

Ranked Global:
  elo: $($global.elo)
  wins/losses: $($global.wins)/$($global.losses)
"@
  $profileGridStats.Rows.Clear()
  $streakMap = @{}
  foreach ($s in @($Snapshot.rankedDromeStreaks)) {
    $streakMap[[string]$s.dromeId] = $s
  }
  foreach ($row in @($Snapshot.rankedDromeStats)) {
    $streak = $streakMap[[string]$row.dromeId]
    $currentStreak = if ($streak) { [string]$streak.currentStreak } else { "0" }
    $bestStreak = if ($streak) { [string]$streak.bestStreak } else { "0" }
    [void]$profileGridStats.Rows.Add(
      [string]$row.dromeId,
      [string]$row.score,
      [string]$row.wins,
      [string]$row.losses,
      $currentStreak,
      $bestStreak
    )
  }
}

function Load-ProfileRanked {
  $username = Get-SelectedValue -Combo $comboProfileUser
  if (-not $username) { return }
  $seasonKey = $txtProfileSeason.Text.Trim()
  if (-not $seasonKey) {
    $seasonKey = (Get-Date).ToUniversalTime().ToString("yyyy-MM")
    $txtProfileSeason.Text = $seasonKey
  }
  Set-Status "Carregando perfil/ranked de '$username'..."
  $payload = Invoke-AdminEngine -Action "profile-ranked-fetch" -Username $username -Payload @{ seasonKey = $seasonKey }
  $script:ProfileRankedSnapshot = $payload
  $profile = $payload.profile
  $global = $payload.rankedGlobal
  if ($profile) {
    $numProfileScore.Value = [decimal]([Math]::Max(0, [int]$profile.score))
    $numProfileWins.Value = [decimal]([Math]::Max(0, [int]$profile.wins))
    $numProfileLosses.Value = [decimal]([Math]::Max(0, [int]$profile.losses))
    $txtProfileFavoriteTribe.Text = [string]$profile.favoriteTribe
    $txtProfileAvatar.Text = [string]$profile.avatar
  }
  if ($global) {
    $numGlobalElo.Value = [decimal]([Math]::Max(0, [int]$global.elo))
    $numGlobalWins.Value = [decimal]([Math]::Max(0, [int]$global.wins))
    $numGlobalLosses.Value = [decimal]([Math]::Max(0, [int]$global.losses))
  }
  $selectedDrome = Get-SelectedValue -Combo $comboProfileDrome
  $dromeRow = @($payload.rankedDromeStats | Where-Object { [string]$_.dromeId -eq $selectedDrome } | Select-Object -First 1)
  if ($dromeRow.Count -gt 0) {
    $numDromeScore.Value = [decimal]([Math]::Max(0, [int]$dromeRow[0].score))
    $numDromeWins.Value = [decimal]([Math]::Max(0, [int]$dromeRow[0].wins))
    $numDromeLosses.Value = [decimal]([Math]::Max(0, [int]$dromeRow[0].losses))
  }
  Render-ProfileRankedSnapshot -Snapshot $payload
  Set-Status "Perfil/ranked carregado para '$username'."
}

function Render-PerimSnapshot {
  param([object]$Snapshot)
  $perimRunsGrid.Rows.Clear()
  foreach ($run in @($Snapshot.activeRuns)) {
    [void]$perimRunsGrid.Rows.Add(
      [string]$run.runId,
      [string]$run.actionId,
      [string]$run.status,
      [string]$run.locationName,
      [string]$run.startAt
    )
  }
  $perimRewardsGrid.Rows.Clear()
  foreach ($reward in @($Snapshot.pendingRewards)) {
    [void]$perimRewardsGrid.Rows.Add(
      [string]$reward.id,
      [string]$reward.runId,
      [string]$reward.rewardType,
      [string]$reward.cardId,
      [string]$reward.isNew
    )
  }
  $perimCampGrid.Rows.Clear()
  $camp = @{}
  if ($Snapshot.state -and $Snapshot.state.campWaitJson) {
    $camp = $Snapshot.state.campWaitJson
  }
  foreach ($key in @($camp.Keys | Sort-Object)) {
    [void]$perimCampGrid.Rows.Add([string]$key, [string]$camp[$key])
  }
}

function Load-PerimState {
  $username = Get-SelectedValue -Combo $comboPerimUser
  if (-not $username) { return }
  Set-Status "Carregando estado PERIM de '$username'..."
  $payload = Invoke-AdminEngine -Action "perim-state-fetch" -Username $username
  $script:PerimSnapshot = $payload
  Render-PerimSnapshot -Snapshot $payload
  Set-Status "Estado PERIM carregado para '$username'."
}

function Normalize-WalkTimeToken {
  param([string]$Raw)
  $text = [string]$Raw
  if ([string]::IsNullOrWhiteSpace($text)) { return "" }
  $match = [regex]::Match($text.Trim(), "^(\d{1,2}):(\d{1,2})$")
  if (-not $match.Success) { return "" }
  $hour = 0
  $minute = 0
  if (-not [int]::TryParse($match.Groups[1].Value, [ref]$hour)) { return "" }
  if (-not [int]::TryParse($match.Groups[2].Value, [ref]$minute)) { return "" }
  if ($hour -lt 0 -or $hour -gt 23 -or $minute -lt 0 -or $minute -gt 59) { return "" }
  return ("{0:D2}:{1:D2}" -f $hour, $minute)
}

function Sort-WalkTimes {
  param([string[]]$Times)
  return @($Times | Sort-Object {
    $parts = [string]$_ -split ":"
    if ($parts.Count -lt 2) { return 0 }
    return (([int]$parts[0]) * 60) + ([int]$parts[1])
  })
}

function Update-PerimWalkCountLabel {
  $count = $listPerimWalkTimes.Items.Count
  $lblPerimWalkCount.Text = "Caminhadas por dia: $count"
}

function Collect-PerimConfigPayload {
  $allowedSets = @()
  foreach ($item in $checkedPerimSets.CheckedItems) {
    $setKey = [string]$item
    if (-not [string]::IsNullOrWhiteSpace($setKey)) {
      $allowedSets += $setKey.Trim().ToLower()
    }
  }
  $walkTimes = @()
  foreach ($item in $listPerimWalkTimes.Items) {
    $normalized = Normalize-WalkTimeToken -Raw ([string]$item)
    if ($normalized) {
      $walkTimes += $normalized
    }
  }
  $walkTimes = @(Sort-WalkTimes -Times @($walkTimes | Select-Object -Unique))
  return @{
    allowedDropSets = @($allowedSets | Select-Object -Unique)
    dailyWalkTimes = $walkTimes
  }
}

function Render-PerimConfigSnapshot {
  param([object]$Snapshot)
  $script:PerimConfigSnapshot = $Snapshot
  $availableSetKeys = @()
  if ($Snapshot -and $Snapshot.availableSetKeys) {
    $availableSetKeys = @($Snapshot.availableSetKeys | ForEach-Object { [string]$_ })
  }
  $checkedPerimSets.Items.Clear()
  foreach ($setKey in ($availableSetKeys | Sort-Object)) {
    [void]$checkedPerimSets.Items.Add($setKey)
  }
  $activeSetKeys = @()
  if ($Snapshot -and $Snapshot.config -and $Snapshot.config.allowedDropSets) {
    $activeSetKeys = @($Snapshot.config.allowedDropSets | ForEach-Object { [string]$_ })
  }
  for ($i = 0; $i -lt $checkedPerimSets.Items.Count; $i += 1) {
    $setKey = [string]$checkedPerimSets.Items[$i]
    $checkedPerimSets.SetItemChecked($i, $activeSetKeys -contains $setKey)
  }

  $listPerimWalkTimes.Items.Clear()
  $walkTimes = @()
  if ($Snapshot -and $Snapshot.config -and $Snapshot.config.dailyWalkTimes) {
    $walkTimes = @($Snapshot.config.dailyWalkTimes | ForEach-Object { Normalize-WalkTimeToken -Raw ([string]$_) } | Where-Object { $_ })
  }
  foreach ($time in (Sort-WalkTimes -Times @($walkTimes | Select-Object -Unique))) {
    [void]$listPerimWalkTimes.Items.Add($time)
  }
  if ($listPerimWalkTimes.Items.Count -gt 0) {
    $txtPerimWalkTime.Text = [string]$listPerimWalkTimes.Items[0]
  }
  Update-PerimWalkCountLabel
}

function Load-PerimConfig {
  Set-Status "Carregando configuracao PERIM..."
  $payload = Invoke-AdminEngine -Action "perim-config-get"
  Render-PerimConfigSnapshot -Snapshot $payload
  Set-Status "Configuracao PERIM carregada."
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
$comboRewardCard.Add_SelectedIndexChanged({ Update-QuestSetFromRewardSelection })
$comboReqType.Add_SelectedIndexChanged({ Refresh-TypeCardCombos })

$btnEventNew.Add_Click({ Reset-EventForm })
$btnEventRefresh.Add_Click({
  try { Load-Events } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar eventos: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationTribeRefresh.Add_Click({
  try { Load-LocationTribes } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar tribos de locais: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$eventsGrid.Add_SelectionChanged({
  if ($eventsGrid.SelectedRows.Count -lt 1) { return }
  $idText = [string]$eventsGrid.SelectedRows[0].Cells[0].Value
  $id = 0
  if ([int]::TryParse($idText, [ref]$id)) { Fill-EventFormById -EventId $id }
})

$chkEventNotifyAll.Add_CheckedChanged({
  $txtEventNotifyText.Enabled = [bool]$chkEventNotifyAll.Checked
  if (-not $chkEventNotifyAll.Checked) {
    $txtEventNotifyText.Text = ""
    Set-EventNotifyStatus -Count 0 -Enabled $false
  }
})

$chkEventsOnlyActive.Add_CheckedChanged({
  try {
    Load-Events
  } catch {}
})

$locationTribesGrid.Add_SelectionChanged({
  if ($locationTribesGrid.SelectedRows.Count -lt 1) { return }
  $locationCardId = [string]$locationTribesGrid.SelectedRows[0].Cells[1].Value
  $tribeLabel = [string]$locationTribesGrid.SelectedRows[0].Cells[2].Value
  if (-not [string]::IsNullOrWhiteSpace($locationCardId)) {
    $comboLocationTribeLocation.SelectedValue = $locationCardId
  }
  foreach ($item in $comboLocationTribeKey.Items) {
    if ([string]$item.Label -eq $tribeLabel) {
      $comboLocationTribeKey.SelectedItem = $item
      break
    }
  }
})

$climateRulesGrid.Add_SelectionChanged({
  if ($climateRulesGrid.SelectedRows.Count -lt 1) { return }
  $locationCardId = [string]$climateRulesGrid.SelectedRows[0].Cells[1].Value
  if (-not [string]::IsNullOrWhiteSpace($locationCardId)) {
    $comboClimateRuleLocation.SelectedValue = $locationCardId
  }
})

$comboClimateRuleLocation.Add_SelectedIndexChanged({
  try {
    $locationCardId = Get-SelectedValue -Combo $comboClimateRuleLocation
    if (-not $locationCardId) {
      Set-CheckedClimateSelections -ClimateKeys @()
      $lblClimateRuleStatus.Text = "Status: sem regra (todos os climas permitidos)."
      return
    }
    $entry = $script:LocationClimateRulesCache | Where-Object { [string]$_.locationCardId -eq $locationCardId } | Select-Object -First 1
    if ($entry) {
      Set-CheckedClimateSelections -ClimateKeys @($entry.allowedClimateKeys)
      $lblClimateRuleStatus.Text = "Status: regra ativa para este local."
    } else {
      Set-CheckedClimateSelections -ClimateKeys @()
      $lblClimateRuleStatus.Text = "Status: sem regra (todos os climas permitidos)."
    }
  } catch {}
})

$locationLinksGrid.Add_SelectionChanged({
  if ($locationLinksGrid.SelectedRows.Count -lt 1) { return }
  $fromLocationCardId = [string]$locationLinksGrid.SelectedRows[0].Cells[1].Value
  $toLocationCardId = [string]$locationLinksGrid.SelectedRows[0].Cells[3].Value
  if (-not [string]::IsNullOrWhiteSpace($fromLocationCardId)) {
    $comboLocationLinkFrom.SelectedValue = $fromLocationCardId
  }
  if (-not [string]::IsNullOrWhiteSpace($toLocationCardId)) {
    $comboLocationLinkTo.SelectedValue = $toLocationCardId
  }
  $lblLocationLinkStatus.Text = "Status: linha selecionada para origem/destino."
})

$comboLocationLinkFrom.Add_SelectedIndexChanged({
  try {
    $fromId = Get-SelectedValue -Combo $comboLocationLinkFrom
    $toId = Get-SelectedValue -Combo $comboLocationLinkTo
    if ($fromId -and $toId) {
      $lblLocationLinkStatus.Text = "Status: ligacao pronta para A -> B."
    } else {
      $lblLocationLinkStatus.Text = "Status: ligacao direcionada (somente ida)."
    }
  } catch {}
})

$comboLocationLinkTo.Add_SelectedIndexChanged({
  try {
    $fromId = Get-SelectedValue -Combo $comboLocationLinkFrom
    $toId = Get-SelectedValue -Combo $comboLocationLinkTo
    if ($fromId -and $toId) {
      $lblLocationLinkStatus.Text = "Status: ligacao pronta para A -> B."
    } else {
      $lblLocationLinkStatus.Text = "Status: ligacao direcionada (somente ida)."
    }
  } catch {}
})

$btnEventSave.Add_Click({
  try {
    $payload = Build-EventPayload
    $savedEventId = 0
    $savedNotifiedCount = 0
    if ($payload.notifyAllPlayers -and [string]::IsNullOrWhiteSpace([string]$payload.notificationText)) {
      [System.Windows.Forms.MessageBox]::Show("Digite o texto da notificacao global antes de enviar para todos.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if ($script:CurrentEventId -gt 0) {
      $op = Invoke-MutatingOperation -OperationName "event-update" -Target ("event:" + $script:CurrentEventId) -ActionBlock {
        Invoke-AdminEngine -Action "event-update" -Id ([string]$script:CurrentEventId) -Payload $payload
      }
      $notifiedCount = 0
      try { $notifiedCount = [int]($op.result.notifiedCount) } catch {}
      $savedNotifiedCount = $notifiedCount
      $savedEventId = [int]$script:CurrentEventId
      Set-EventNotifyStatus -Count $notifiedCount -Enabled $payload.notifyAllPlayers
      if ($payload.notifyAllPlayers -and $notifiedCount -gt 0) {
        $eventIdLabel.Text = "Evento selecionado: ID $($script:CurrentEventId) [BROADCAST]"
      }
      $notifyLine = if ($notifiedCount -gt 0) { "`r`nNotificacoes enviadas: $notifiedCount" } else { "" }
      [System.Windows.Forms.MessageBox]::Show("Evento atualizado.$notifyLine`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      $op = Invoke-MutatingOperation -OperationName "event-create" -Target "event:new" -ActionBlock {
        Invoke-AdminEngine -Action "event-create" -Payload $payload
      }
      $notifiedCount = 0
      try { $notifiedCount = [int]($op.result.notifiedCount) } catch {}
      $savedNotifiedCount = $notifiedCount
      try { $savedEventId = [int]($op.result.createdId) } catch { $savedEventId = 0 }
      Set-EventNotifyStatus -Count $notifiedCount -Enabled $payload.notifyAllPlayers
      if ($payload.notifyAllPlayers -and $notifiedCount -gt 0) {
        $eventIdLabel.Text = "Evento selecionado: novo [BROADCAST]"
      }
      $notifyLine = if ($notifiedCount -gt 0) { "`r`nNotificacoes enviadas: $notifiedCount" } else { "" }
      [System.Windows.Forms.MessageBox]::Show("Evento criado.$notifyLine`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
    Load-Events
    if ($savedEventId -gt 0) {
      Fill-EventFormById -EventId $savedEventId
      Set-EventNotifyStatus -Count $savedNotifiedCount -Enabled $payload.notifyAllPlayers
      if ($payload.notifyAllPlayers -and $savedNotifiedCount -gt 0) {
        $eventIdLabel.Text = "Evento selecionado: ID $savedEventId [BROADCAST]"
      }
    } else {
      Reset-EventForm
    }
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

$btnLocationTribeSave.Add_Click({
  try {
    $locationCardId = Get-SelectedValue -Combo $comboLocationTribeLocation
    $tribeKey = Get-SelectedValue -Combo $comboLocationTribeKey
    if (-not $locationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um local para salvar a tribo.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not $tribeKey) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma tribo valida.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      locationCardId = $locationCardId
      tribeKey = $tribeKey
    }
    $op = Invoke-MutatingOperation -OperationName "location-tribe-set" -Target ("location-tribe:" + $locationCardId) -ActionBlock {
      Invoke-AdminEngine -Action "location-tribe-set" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Tribo do local salva.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationTribes
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar tribo do local: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationTribeDelete.Add_Click({
  try {
    $locationCardId = Get-SelectedValue -Combo $comboLocationTribeLocation
    if (-not $locationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um local para remover o override de tribo.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Remover override de tribo deste local e voltar para o padrao da carta?", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $payload = @{ locationCardId = $locationCardId }
    $op = Invoke-MutatingOperation -OperationName "location-tribe-delete" -Target ("location-tribe:" + $locationCardId) -ActionBlock {
      Invoke-AdminEngine -Action "location-tribe-delete" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Override de tribo removido.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationTribes
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover tribo do local: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnClimateRuleRefresh.Add_Click({
  try { Load-LocationClimateRules } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar regras de clima: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnClimateRuleSave.Add_Click({
  try {
    $locationCardId = Get-SelectedValue -Combo $comboClimateRuleLocation
    if (-not $locationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um local para salvar a regra de clima.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $allowedClimates = @(Collect-CheckedClimateSelections)
    if (-not $allowedClimates -or $allowedClimates.Count -lt 1) {
      [System.Windows.Forms.MessageBox]::Show("Selecione ao menos 1 clima permitido.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      locationCardId = $locationCardId
      allowedClimates = $allowedClimates
    }
    $op = Invoke-MutatingOperation -OperationName "location-climate-set" -Target ("location-climate:" + $locationCardId) -ActionBlock {
      Invoke-AdminEngine -Action "location-climate-set" -Payload $payload
    }
    $climateUpdateText = ""
    if ($op.result.appliedClimateUpdate -and [bool]$op.result.appliedClimateUpdate.changed) {
      $climateUpdateText = "`r`nClima atual do local foi recalculado para: $([string]$op.result.appliedClimateUpdate.climate)"
    }
    [System.Windows.Forms.MessageBox]::Show("Regra de clima salva.$climateUpdateText`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationClimateRules
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar regra de clima: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnClimateRuleDelete.Add_Click({
  try {
    $locationCardId = Get-SelectedValue -Combo $comboClimateRuleLocation
    if (-not $locationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um local para remover a regra de clima.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Remover regra de clima deste local? (volta para todos permitidos)", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $payload = @{ locationCardId = $locationCardId }
    $op = Invoke-MutatingOperation -OperationName "location-climate-delete" -Target ("location-climate:" + $locationCardId) -ActionBlock {
      Invoke-AdminEngine -Action "location-climate-delete" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Regra de clima removida.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationClimateRules
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover regra de clima: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnClimateRuleSeedStormAll.Add_Click({
  try {
    $confirm = [System.Windows.Forms.MessageBox]::Show(
      "Isso vai sobrescrever as regras de clima atuais e definir TODOS os locais como Tempestade. Continuar?",
      "Confirmar preenchimento em lote",
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }

    $op = Invoke-MutatingOperation -OperationName "location-climates-seed-tempestade-all" -Target "location-climates:all" -ActionBlock {
      Invoke-AdminEngine -Action "location-climates-seed-tempestade-all"
    }
    $summary = $op.result.summary
    $msg = "Preenchimento concluido.`r`nLocais totais: $([string]$summary.totalLocations)`r`nRegras sobrescritas: $([string]$summary.overwrittenRules)`r`nAplicados: $([string]$summary.affected)`r`nEstados climaticos ajustados agora: $([string]$summary.climateStateChanged)`r`nBackup: $($op.backup)"
    [System.Windows.Forms.MessageBox]::Show($msg, "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationClimateRules
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao preencher climas com Tempestade: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationLinksRefresh.Add_Click({
  try { Load-LocationLinks } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar adjacencias: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationLinksAdd.Add_Click({
  try {
    $fromLocationCardId = Get-SelectedValue -Combo $comboLocationLinkFrom
    $toLocationCardId = Get-SelectedValue -Combo $comboLocationLinkTo
    if (-not $fromLocationCardId -or -not $toLocationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione origem e destino para criar a ligacao.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if ($fromLocationCardId -eq $toLocationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Origem e destino nao podem ser iguais.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      fromLocationCardId = $fromLocationCardId
      toLocationCardId = $toLocationCardId
    }
    $targetText = "location-link:$fromLocationCardId->$toLocationCardId"
    $op = Invoke-MutatingOperation -OperationName "location-link-add" -Target $targetText -ActionBlock {
      Invoke-AdminEngine -Action "location-link-add" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Ligacao adicionada (A -> B).`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationLinks
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao adicionar ligacao: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationLinksRemove.Add_Click({
  try {
    $fromLocationCardId = Get-SelectedValue -Combo $comboLocationLinkFrom
    $toLocationCardId = Get-SelectedValue -Combo $comboLocationLinkTo
    if (-not $fromLocationCardId -or -not $toLocationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione origem e destino para remover a ligacao.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Remover ligacao $fromLocationCardId -> $toLocationCardId?", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $payload = @{
      fromLocationCardId = $fromLocationCardId
      toLocationCardId = $toLocationCardId
    }
    $targetText = "location-link:$fromLocationCardId->$toLocationCardId"
    $op = Invoke-MutatingOperation -OperationName "location-link-remove" -Target $targetText -ActionBlock {
      Invoke-AdminEngine -Action "location-link-remove" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Ligacao removida.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationLinks
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover ligacao: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLocationLinksImport.Add_Click({
  try {
    $confirm = [System.Windows.Forms.MessageBox]::Show("Importar ligacoes de locais.xlsx e substituir as atuais?", "Confirmar importacao", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $payload = @{ replace = $true }
    $op = Invoke-MutatingOperation -OperationName "location-links-import-from-matrix" -Target "location-links:matrix" -ActionBlock {
      Invoke-AdminEngine -Action "location-links-import-from-matrix" -Payload $payload
    }
    $summary = $op.result.summary
    $msg = "Importacao concluida.`r`nLinhas matriz: $([string]$summary.matrixRows)`r`nLinks importados: $([string]$summary.imported)`r`nNao resolvidos (origem): $([string]$summary.unresolvedSources)`r`nNao resolvidos (destino): $([string]$summary.unresolvedTargets)`r`nTotal final: $([string]$summary.linksAfter)`r`nBackup: $($op.backup)"
    [System.Windows.Forms.MessageBox]::Show($msg, "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-LocationLinks
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao importar ligacoes da planilha: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$battlegearSpawnGrid.Add_SelectionChanged({
  if ($battlegearSpawnGrid.SelectedRows.Count -lt 1) { return }
  $cardId = [string]$battlegearSpawnGrid.SelectedRows[0].Cells[1].Value
  if (-not [string]::IsNullOrWhiteSpace($cardId)) {
    $comboBattlegearSpawnCard.SelectedValue = $cardId
    Update-BattlegearSpawnFormFromCardId -CardId $cardId
  }
})

$comboBattlegearSpawnCard.Add_SelectedIndexChanged({
  try {
    $cardId = Get-SelectedValue -Combo $comboBattlegearSpawnCard
    Update-BattlegearSpawnFormFromCardId -CardId $cardId
  } catch {}
})

$btnBattlegearSpawnRefresh.Add_Click({
  try { Load-BattlegearSpawnRules } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao atualizar regras de spawn de equipamentos: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBattlegearSpawnSave.Add_Click({
  try {
    $cardId = Get-SelectedValue -Combo $comboBattlegearSpawnCard
    $location1CardId = Get-SelectedValue -Combo $comboBattlegearSpawnLoc1
    $location2CardId = Get-SelectedValue -Combo $comboBattlegearSpawnLoc2
    if (-not $cardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um equipamento.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not $location1CardId -or -not $location2CardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione Local 1 e Local 2.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if ($location1CardId -eq $location2CardId) {
      [System.Windows.Forms.MessageBox]::Show("Local 1 e Local 2 devem ser diferentes.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      cardId = $cardId
      location1CardId = $location1CardId
      location2CardId = $location2CardId
      chancePercent = [double]$numBattlegearSpawnChance.Value
      enabled = [bool]$chkBattlegearSpawnEnabled.Checked
    }
    $op = Invoke-MutatingOperation -OperationName "battlegear-spawn-rule-set" -Target ("battlegear-spawn:" + $cardId) -ActionBlock {
      Invoke-AdminEngine -Action "battlegear-spawn-rule-set" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Regra de spawn salva.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-BattlegearSpawnRules
    $comboBattlegearSpawnCard.SelectedValue = $cardId
    Update-BattlegearSpawnFormFromCardId -CardId $cardId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar regra de spawn: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBattlegearSpawnDelete.Add_Click({
  try {
    $cardId = Get-SelectedValue -Combo $comboBattlegearSpawnCard
    if (-not $cardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um equipamento para remover a regra.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $confirm = [System.Windows.Forms.MessageBox]::Show("Remover regra de spawn do equipamento '$cardId'?", "Confirmar", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    $payload = @{ cardId = $cardId }
    $op = Invoke-MutatingOperation -OperationName "battlegear-spawn-rule-delete" -Target ("battlegear-spawn:" + $cardId) -ActionBlock {
      Invoke-AdminEngine -Action "battlegear-spawn-rule-delete" -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Regra removida.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-BattlegearSpawnRules
    Update-BattlegearSpawnFormFromCardId -CardId $cardId
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover regra de spawn: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
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

$comboGrantCardType.Add_SelectedIndexChanged({ Refresh-GrantCardCombo })

$btnScansLoad.Add_Click({
  try { Load-Scans } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar scans: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnScansGrant.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboScansUser
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario para grant.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $cardId = Get-SelectedValue -Combo $comboGrantCard
    if (-not $cardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma carta para grant.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      cardId = $cardId
      quantity = [int]$numGrantQty.Value
      starsPreset = [double]$numGrantStars.Value
      source = $txtGrantSource.Text.Trim()
    }
    $op = Invoke-MutatingOperation -OperationName "scans-grant" -Target ("scans:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "scans-grant" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Grant aplicado. Novas entradas: $($op.result.granted)`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Scans
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao aplicar grant: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnScansDeleteSelected.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboScansUser
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $ids = @()
    foreach ($row in @($scansGrid.SelectedRows)) {
      $id = [string]$row.Cells[0].Value
      if ($id) { $ids += $id }
    }
    if (-not $ids.Count) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma ou mais linhas para remover.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Remover scans" -Message "Remover $($ids.Count) scan(s) selecionados do usuario '$username'?")) { return }
    $payload = @{ scanEntryIds = $ids }
    $op = Invoke-MutatingOperation -OperationName "scans-delete" -Target ("scans:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "scans-delete" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Remocao concluida. Itens removidos: $($op.result.deleted)`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Scans
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover scans: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnProfileLoad.Add_Click({
  try { Load-ProfileRanked } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar perfil/ranked: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnProfileSave.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboProfileUser
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = Build-ProfileRankedPayload
    $op = Invoke-MutatingOperation -OperationName "profile-ranked-update" -Target ("profile-ranked:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "profile-ranked-update" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Perfil/ranked atualizado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:ProfileRankedSnapshot = $op.result
    Render-ProfileRankedSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar perfil/ranked: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnProfileResetMonthly.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboProfileUser
    $dromeId = Get-SelectedValue -Combo $comboProfileDrome
    $seasonKey = $txtProfileSeason.Text.Trim()
    if (-not $username -or -not $dromeId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione usuario e dromo para reset mensal.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Reset mensal do dromo" -Message "Resetar score/wins/losses mensal de '$username' em '$dromeId'?")) { return }
    $payload = @{ mode = "drome-monthly"; seasonKey = $seasonKey; dromeId = $dromeId }
    $op = Invoke-MutatingOperation -OperationName "profile-ranked-reset-monthly" -Target ("profile-ranked:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "profile-ranked-reset" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Reset mensal aplicado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:ProfileRankedSnapshot = $op.result
    Render-ProfileRankedSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha no reset mensal: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnProfileResetStreak.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboProfileUser
    $dromeId = Get-SelectedValue -Combo $comboProfileDrome
    $seasonKey = $txtProfileSeason.Text.Trim()
    if (-not $username -or -not $dromeId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione usuario e dromo para reset de streak.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Reset streak do dromo" -Message "Resetar streak mensal de '$username' em '$dromeId'?")) { return }
    $payload = @{ mode = "drome-streak"; seasonKey = $seasonKey; dromeId = $dromeId }
    $op = Invoke-MutatingOperation -OperationName "profile-ranked-reset-streak" -Target ("profile-ranked:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "profile-ranked-reset" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Reset de streak aplicado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:ProfileRankedSnapshot = $op.result
    Render-ProfileRankedSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha no reset de streak: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimLoad.Add_Click({
  try { Load-PerimState } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar PERIM: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimFixRun.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboPerimUser
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $runId = ""
    if ($perimRunsGrid.SelectedRows.Count -gt 0) {
      $runId = [string]$perimRunsGrid.SelectedRows[0].Cells[0].Value
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Encerrar run ativa" -Message "Encerrar run ativa de '$username'?" )) { return }
    $payload = @{ runId = $runId }
    $op = Invoke-MutatingOperation -OperationName "perim-fix-run" -Target ("perim:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "perim-fix-run" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Runs ajustadas: $($op.result.fixedRuns)`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:PerimSnapshot = $op.result
    Render-PerimSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao ajustar run PERIM: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimClearRewards.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboPerimUser
    if (-not $username) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $ids = @()
    foreach ($row in @($perimRewardsGrid.SelectedRows)) {
      $id = [int]$row.Cells[0].Value
      if ($id -gt 0) { $ids += $id }
    }
    if (-not $ids.Count) {
      [System.Windows.Forms.MessageBox]::Show("Selecione recompensas para limpar.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Limpar recompensas PERIM" -Message "Limpar $($ids.Count) recompensa(s) pendentes de '$username'?")) { return }
    $payload = @{ rewardIds = $ids }
    $op = Invoke-MutatingOperation -OperationName "perim-clear-rewards" -Target ("perim:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "perim-clear-rewards" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Recompensas removidas: $($op.result.deletedRewards)`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:PerimSnapshot = $op.result
    Render-PerimSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao limpar recompensas PERIM: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimCampSave.Add_Click({
  try {
    $username = Get-SelectedValue -Combo $comboPerimUser
    $locationCardId = Get-SelectedValue -Combo $comboPerimCampLocation
    if (-not $username -or -not $locationCardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione usuario e local para atualizar camp.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      locationCardId = $locationCardId
      progress = [int]$numPerimCampProgress.Value
    }
    $op = Invoke-MutatingOperation -OperationName "perim-update-camp-progress" -Target ("perim-camp:" + $username) -ActionBlock {
      Invoke-AdminEngine -Action "perim-update-camp-progress" -Username $username -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Camp progress atualizado.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    $script:PerimSnapshot = $op.result
    Render-PerimSnapshot -Snapshot $op.result
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao atualizar camp progress: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimWalkAdd.Add_Click({
  try {
    $normalized = Normalize-WalkTimeToken -Raw $txtPerimWalkTime.Text
    if (-not $normalized) {
      [System.Windows.Forms.MessageBox]::Show("Horario invalido. Use HH:mm (ex.: 06:30).", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $existing = @()
    foreach ($item in $listPerimWalkTimes.Items) { $existing += [string]$item }
    if ($existing -contains $normalized) {
      return
    }
    $existing += $normalized
    $listPerimWalkTimes.Items.Clear()
    foreach ($item in (Sort-WalkTimes -Times $existing)) {
      [void]$listPerimWalkTimes.Items.Add($item)
    }
    Update-PerimWalkCountLabel
    $txtPerimWalkTime.Text = $normalized
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao adicionar horario: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimWalkRemove.Add_Click({
  try {
    if ($listPerimWalkTimes.SelectedItems.Count -lt 1) { return }
    $selected = @($listPerimWalkTimes.SelectedItems | ForEach-Object { [string]$_ })
    $remaining = @()
    foreach ($item in $listPerimWalkTimes.Items) {
      $time = [string]$item
      if (-not ($selected -contains $time)) {
        $remaining += $time
      }
    }
    $listPerimWalkTimes.Items.Clear()
    foreach ($item in (Sort-WalkTimes -Times $remaining)) {
      [void]$listPerimWalkTimes.Items.Add($item)
    }
    Update-PerimWalkCountLabel
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover horario: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimConfigLoad.Add_Click({
  try {
    Load-PerimConfig
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar configuracao PERIM: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnPerimConfigSave.Add_Click({
  try {
    $payload = Collect-PerimConfigPayload
    if (-not $payload.allowedDropSets -or $payload.allowedDropSets.Count -lt 1) {
      [System.Windows.Forms.MessageBox]::Show("Selecione ao menos 1 set liberado para drop.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not $payload.dailyWalkTimes -or $payload.dailyWalkTimes.Count -lt 1) {
      [System.Windows.Forms.MessageBox]::Show("Defina ao menos 1 horario de caminhada.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $op = Invoke-MutatingOperation -OperationName "perim-config-save" -Target "perim:runtime-config" -ActionBlock {
      Invoke-AdminEngine -Action "perim-config-save" -Payload $payload
    }
    Render-PerimConfigSnapshot -Snapshot $op.result
    [System.Windows.Forms.MessageBox]::Show("Configuracao PERIM salva com sucesso.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Set-Status "Configuracao PERIM salva e aplicada."
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar configuracao PERIM: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$perimCampGrid.Add_SelectionChanged({
  if ($perimCampGrid.SelectedRows.Count -lt 1) { return }
  $locationCardId = [string]$perimCampGrid.SelectedRows[0].Cells[0].Value
  $progress = [int]$perimCampGrid.SelectedRows[0].Cells[1].Value
  if ($locationCardId) { $comboPerimCampLocation.SelectedValue = $locationCardId }
  if ($progress -ge 0) { $numPerimCampProgress.Value = [decimal]$progress }
})

$profileGridStats.Add_SelectionChanged({
  if ($profileGridStats.SelectedRows.Count -lt 1) { return }
  $dromeId = [string]$profileGridStats.SelectedRows[0].Cells[0].Value
  $score = [int]$profileGridStats.SelectedRows[0].Cells[1].Value
  $wins = [int]$profileGridStats.SelectedRows[0].Cells[2].Value
  $losses = [int]$profileGridStats.SelectedRows[0].Cells[3].Value
  if ($dromeId) { $comboProfileDrome.SelectedValue = $dromeId }
  $numDromeScore.Value = [decimal]([Math]::Max(0, $score))
  $numDromeWins.Value = [decimal]([Math]::Max(0, $wins))
  $numDromeLosses.Value = [decimal]([Math]::Max(0, $losses))
})

$banlistsGrid.Add_SelectionChanged({
  if ($banlistsGrid.SelectedRows.Count -lt 1) { return }
  $banlistId = [int]$banlistsGrid.SelectedRows[0].Cells[0].Value
  if ($banlistId -gt 0) {
    Fill-BanlistFormById -BanlistId $banlistId
  }
})

$btnBanlistNew.Add_Click({
  Reset-BanlistForm
})

$btnBanlistRefresh.Add_Click({
  try {
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar banlists: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBanlistSave.Add_Click({
  try {
    $name = $txtBanlistName.Text.Trim()
    if (-not $name) {
      [System.Windows.Forms.MessageBox]::Show("Informe o nome da banlist.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $payload = @{
      name = $name
      description = $txtBanlistDescription.Text.Trim()
    }
    if ([int]$script:CurrentBanlistId -gt 0) {
      $targetId = [int]$script:CurrentBanlistId
      $op = Invoke-MutatingOperation -OperationName "banlist-update" -Target ("banlist:" + $targetId) -ActionBlock {
        Invoke-AdminEngine -Action "banlist-update" -Id ([string]$targetId) -Payload $payload
      }
      [System.Windows.Forms.MessageBox]::Show("Banlist atualizada.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    } else {
      $op = Invoke-MutatingOperation -OperationName "banlist-create" -Target "banlist:new" -ActionBlock {
        Invoke-AdminEngine -Action "banlist-create" -Payload $payload
      }
      $script:CurrentBanlistId = [int]($op.result.createdBanlistId)
      [System.Windows.Forms.MessageBox]::Show("Banlist criada.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    }
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao salvar banlist: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBanlistDelete.Add_Click({
  try {
    $banlist = Get-SelectedBanlist
    if (-not $banlist) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma banlist para excluir.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if (-not (Confirm-StrictDestructiveAction -Title "Excluir banlist" -Message "Excluir a banlist '$([string]$banlist.name)'?")) { return }
    $targetId = [int]$banlist.banlistId
    $op = Invoke-MutatingOperation -OperationName "banlist-delete" -Target ("banlist:" + $targetId) -ActionBlock {
      Invoke-AdminEngine -Action "banlist-delete" -Id ([string]$targetId)
    }
    [System.Windows.Forms.MessageBox]::Show("Banlist excluida.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Reset-BanlistForm
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao excluir banlist: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBanlistActivate.Add_Click({
  try {
    $banlist = Get-SelectedBanlist
    if (-not $banlist) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma banlist para ativar.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $targetId = [int]$banlist.banlistId
    $op = Invoke-MutatingOperation -OperationName "banlist-set-active" -Target ("banlist:" + $targetId) -ActionBlock {
      Invoke-AdminEngine -Action "banlist-set-active" -Id ([string]$targetId)
    }
    [System.Windows.Forms.MessageBox]::Show("Banlist ativa atualizada.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao ativar banlist: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBanlistCardAdd.Add_Click({
  try {
    $banlist = Get-SelectedBanlist
    if (-not $banlist) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma banlist antes de adicionar cartas.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $cardId = Get-SelectedValue -Combo $comboBanlistCard
    if (-not $cardId) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma carta para configurar.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $allowedCopiesRaw = $comboBanlistAllowedCopies.SelectedItem
    $allowedCopies = 0
    if ($null -ne $allowedCopiesRaw) {
      try {
        $allowedCopies = [int]$allowedCopiesRaw
      } catch {
        $allowedCopies = 0
      }
    }
    $targetId = [int]$banlist.banlistId
    $payload = @{
      cardId = $cardId
      allowedCopies = $allowedCopies
    }
    $op = Invoke-MutatingOperation -OperationName "banlist-card-add" -Target ("banlist:" + $targetId) -ActionBlock {
      Invoke-AdminEngine -Action "banlist-card-add" -Id ([string]$targetId) -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Carta adicionada na banlist.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao adicionar carta na banlist: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnBanlistCardRemove.Add_Click({
  try {
    $banlist = Get-SelectedBanlist
    if (-not $banlist) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma banlist antes de remover cartas.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    if ($listBanlistCards.SelectedItems.Count -lt 1) {
      [System.Windows.Forms.MessageBox]::Show("Selecione uma carta da lista para remover.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }
    $cardId = [string]$listBanlistCards.SelectedItems[0].Text
    if (-not $cardId) { return }
    $targetId = [int]$banlist.banlistId
    $payload = @{ cardId = $cardId }
    $op = Invoke-MutatingOperation -OperationName "banlist-card-remove" -Target ("banlist:" + $targetId) -ActionBlock {
      Invoke-AdminEngine -Action "banlist-card-remove" -Id ([string]$targetId) -Payload $payload
    }
    [System.Windows.Forms.MessageBox]::Show("Carta removida da banlist.`r`nBackup: $($op.backup)", "Sucesso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    Load-Banlists
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao remover carta da banlist: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

$btnLogsRefresh.Add_Click({
  try { Load-Logs } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha ao carregar logs: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  }
})

function Apply-TabSplitLayoutDefaults {
  Set-SplitterLayoutSafe -Splitter $usersBody -Panel1Min 220 -Panel2Min 180 -PreferredDistance 330
  Set-SplitterLayoutSafe -Splitter $eventsSplit -Panel1Min 460 -Panel2Min 420 -PreferredDistance 620
  Set-SplitterLayoutSafe -Splitter $questSplit -Panel1Min 440 -Panel2Min 420 -PreferredDistance 620
  Set-SplitterLayoutSafe -Splitter $scansSplit -Panel1Min 620 -Panel2Min 300 -PreferredDistance 860
  Set-SplitterLayoutSafe -Splitter $profileBody -Panel1Min 460 -Panel2Min 320 -PreferredDistance 640
  Set-SplitterLayoutSafe -Splitter $perimBody -Panel1Min 220 -Panel2Min 160 -PreferredDistance 330
  Set-SplitterLayoutSafe -Splitter $perimUpperSplit -Panel1Min 360 -Panel2Min 320 -PreferredDistance 600
  Set-SplitterLayoutSafe -Splitter $climateRulesSplit -Panel1Min 460 -Panel2Min 420 -PreferredDistance 640
  Set-SplitterLayoutSafe -Splitter $locationLinksSplit -Panel1Min 500 -Panel2Min 380 -PreferredDistance 700
  Set-SplitterLayoutSafe -Splitter $battlegearSpawnSplit -Panel1Min 520 -Panel2Min 380 -PreferredDistance 760
  Set-SplitterLayoutSafe -Splitter $banlistSplit -Panel1Min 480 -Panel2Min 360 -PreferredDistance 700
}

$form.Add_Shown({ Apply-TabSplitLayoutDefaults })
$form.Add_ResizeEnd({ Apply-TabSplitLayoutDefaults })
$tab.Add_SelectedIndexChanged({ Apply-TabSplitLayoutDefaults })

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
  Set-ComboItems -Combo $comboQuestTargetLocation -Items (Build-OptionalLocationItems)
  Set-ComboItems -Combo $comboQuestDifficulty -Items (Build-QuestDifficultyItems)
  Set-ComboItems -Combo $comboLocationTribeLocation -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboLocationTribeKey -Items (Build-LocationTribeKeyItems)
  Set-ComboItems -Combo $comboClimateRuleLocation -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboLocationLinkFrom -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboLocationLinkTo -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboBattlegearSpawnCard -Items (Build-CardItems -Type "battlegear")
  Set-ComboItems -Combo $comboBattlegearSpawnLoc1 -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboBattlegearSpawnLoc2 -Items (Build-LocationItems)
  $checkedClimateKeys.Items.Clear()
  foreach ($item in (Build-LocationClimateItems)) {
    [void]$checkedClimateKeys.Items.Add($item)
  }
  $checkedClimateKeys.DisplayMember = "Label"
  $checkedClimateKeys.ValueMember = "Value"
  Set-ComboItems -Combo $comboScansType -Items (Build-ScansTypeItems)
  Set-ComboItems -Combo $comboGrantCardType -Items $typeItems
  Set-ComboItems -Combo $comboProfileDrome -Items (Build-DromeItems)
  Set-ComboItems -Combo $comboPerimCampLocation -Items (Build-LocationItems)
  Set-ComboItems -Combo $comboBanlistCard -Items (Build-CardItems -Type "")
  $comboBanlistAllowedCopies.Items.Clear()
  [void]$comboBanlistAllowedCopies.Items.Add("0")
  [void]$comboBanlistAllowedCopies.Items.Add("1")
  [void]$comboBanlistAllowedCopies.Items.Add("2")
  [void]$comboBanlistAllowedCopies.Items.Add("3")
  $comboBanlistAllowedCopies.SelectedIndex = 0
  $txtProfileSeason.Text = (Get-Date).ToUniversalTime().ToString("yyyy-MM")
  Refresh-TypeCardCombos
  Refresh-GrantCardCombo
  Reset-EventForm
  Reset-QuestForm

  Load-Users
  if ($userCombo.Items.Count -gt 0) {
    Load-UserPreview
    Load-Scans
    Load-ProfileRanked
    Load-PerimState
  }
  Load-Events
  Load-LocationTribes
  Load-LocationClimateRules
  Load-LocationLinks
  Load-BattlegearSpawnRules
  Load-Banlists
  Load-Quests
  Load-PerimConfig
  Load-Logs
  Set-Status "Painel admin pronto."
} catch {
  [System.Windows.Forms.MessageBox]::Show("Falha ao inicializar painel admin: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
  Set-Status "Falha na inicializacao."
}

[void]$form.ShowDialog()
