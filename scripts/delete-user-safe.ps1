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

if (!(Test-Path $dbPath)) {
  throw "Banco SQLite nao encontrado em: $dbPath"
}
if (!(Test-Path $enginePath)) {
  throw "Script de delecao nao encontrado em: $enginePath"
}
if (!(Test-Path $backupScript)) {
  throw "Script de backup nao encontrado em: $backupScript"
}

function ConvertFrom-JsonCompat {
  param(
    [Parameter(Mandatory = $true)][string]$Text
  )

  $cmd = Get-Command ConvertFrom-Json
  if ($cmd -and $cmd.Parameters -and $cmd.Parameters.ContainsKey("Depth")) {
    return ($Text | ConvertFrom-Json -Depth 100)
  }
  return ($Text | ConvertFrom-Json)
}

function Invoke-DeleteEngine {
  param(
    [Parameter(Mandatory = $true)][string]$Action,
    [string]$Username
  )

  $oldWarnings = $env:NODE_NO_WARNINGS
  $env:NODE_NO_WARNINGS = "1"
  try {
    $args = @(
      $enginePath,
      "--action",
      $Action,
      "--db",
      $dbPath
    )
    if ($Username) {
      $args += @("--username", $Username)
    }

    $output = & node @args 2>&1
    $exitCode = $LASTEXITCODE
    $raw = ($output | Out-String).Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) {
      throw "Resposta vazia do motor de delecao."
    }

    $payload = $null
    try {
      $lines = @($output | ForEach-Object { [string]$_ })
      $markerLine = $lines | Where-Object { $_ -like "__DELETE_USER_SAFE_JSON_B64__:*" } | Select-Object -Last 1
      if ($markerLine) {
        $b64 = $markerLine.Substring("__DELETE_USER_SAFE_JSON_B64__:".Length)
        $jsonText = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
        $payload = ConvertFrom-JsonCompat -Text $jsonText
      } else {
        $payload = ConvertFrom-JsonCompat -Text $raw
      }
    } catch {
      throw "Falha ao interpretar retorno do motor: $raw"
    }

    if ($exitCode -ne 0 -or -not $payload.ok) {
      $err = if ($payload.error) { [string]$payload.error } else { "erro_desconhecido" }
      throw "Motor de delecao retornou erro: $err"
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
  if ($text -match "Backup gerado:\s*(.+)$") {
    return $matches[1].Trim()
  }
  return "(caminho nao identificado)"
}

function Show-TextPrompt {
  param(
    [string]$Title,
    [string]$Message
  )

  $promptForm = New-Object System.Windows.Forms.Form
  $promptForm.Text = $Title
  $promptForm.StartPosition = "CenterParent"
  $promptForm.Size = New-Object System.Drawing.Size(420, 170)
  $promptForm.FormBorderStyle = "FixedDialog"
  $promptForm.MaximizeBox = $false
  $promptForm.MinimizeBox = $false

  $label = New-Object System.Windows.Forms.Label
  $label.Text = $Message
  $label.AutoSize = $false
  $label.Size = New-Object System.Drawing.Size(380, 40)
  $label.Location = New-Object System.Drawing.Point(15, 10)
  $promptForm.Controls.Add($label)

  $textbox = New-Object System.Windows.Forms.TextBox
  $textbox.Size = New-Object System.Drawing.Size(380, 24)
  $textbox.Location = New-Object System.Drawing.Point(15, 55)
  $promptForm.Controls.Add($textbox)

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = "Confirmar"
  $ok.Location = New-Object System.Drawing.Point(230, 90)
  $ok.Size = New-Object System.Drawing.Size(80, 28)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $promptForm.Controls.Add($ok)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = "Cancelar"
  $cancel.Location = New-Object System.Drawing.Point(315, 90)
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

function Ensure-LogsDir {
  if (!(Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
  }
}

function Append-OperationLog {
  param(
    [string]$Username,
    [string]$BackupPath,
    [int]$TotalRemoved
  )

  Ensure-LogsDir
  $logPath = Join-Path $logsDir "user-delete-operations.log"
  $line = "{0} | operator=local-admin | username={1} | backup={2} | totalRemoved={3}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Username, $BackupPath, $TotalRemoved
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  return $logPath
}

$form = New-Object System.Windows.Forms.Form
$form.Text = "Excluir Usuario (SQLite) - Operacao Segura"
$form.Size = New-Object System.Drawing.Size(930, 700)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

$title = New-Object System.Windows.Forms.Label
$title.Text = "Selecione o usuario para exclusao permanente (com backup automatico)."
$title.Location = New-Object System.Drawing.Point(15, 15)
$title.Size = New-Object System.Drawing.Size(880, 22)
$form.Controls.Add($title)

$userLabel = New-Object System.Windows.Forms.Label
$userLabel.Text = "Usuario:"
$userLabel.Location = New-Object System.Drawing.Point(15, 50)
$userLabel.Size = New-Object System.Drawing.Size(60, 22)
$form.Controls.Add($userLabel)

$userCombo = New-Object System.Windows.Forms.ComboBox
$userCombo.DropDownStyle = "DropDownList"
$userCombo.Location = New-Object System.Drawing.Point(80, 48)
$userCombo.Size = New-Object System.Drawing.Size(280, 28)
$form.Controls.Add($userCombo)

$refreshButton = New-Object System.Windows.Forms.Button
$refreshButton.Text = "Atualizar lista"
$refreshButton.Location = New-Object System.Drawing.Point(370, 47)
$refreshButton.Size = New-Object System.Drawing.Size(110, 30)
$form.Controls.Add($refreshButton)

$deleteButton = New-Object System.Windows.Forms.Button
$deleteButton.Text = "Excluir usuario"
$deleteButton.Location = New-Object System.Drawing.Point(490, 47)
$deleteButton.Size = New-Object System.Drawing.Size(140, 30)
$form.Controls.Add($deleteButton)

$previewLabel = New-Object System.Windows.Forms.Label
$previewLabel.Text = "Preview de impacto por tabela:"
$previewLabel.Location = New-Object System.Drawing.Point(15, 88)
$previewLabel.Size = New-Object System.Drawing.Size(350, 22)
$form.Controls.Add($previewLabel)

$grid = New-Object System.Windows.Forms.DataGridView
$grid.Location = New-Object System.Drawing.Point(15, 112)
$grid.Size = New-Object System.Drawing.Size(890, 430)
$grid.ReadOnly = $true
$grid.AllowUserToAddRows = $false
$grid.AllowUserToDeleteRows = $false
$grid.RowHeadersVisible = $false
$grid.SelectionMode = "FullRowSelect"
$grid.AutoSizeColumnsMode = "Fill"
$grid.ColumnCount = 3
$grid.Columns[0].Name = "Tabela"
$grid.Columns[1].Name = "Registros"
$grid.Columns[2].Name = "Detalhe"
$grid.Columns[0].FillWeight = 36
$grid.Columns[1].FillWeight = 14
$grid.Columns[2].FillWeight = 50
$form.Controls.Add($grid)

$summaryBox = New-Object System.Windows.Forms.TextBox
$summaryBox.Multiline = $true
$summaryBox.ReadOnly = $true
$summaryBox.ScrollBars = "Vertical"
$summaryBox.Location = New-Object System.Drawing.Point(15, 550)
$summaryBox.Size = New-Object System.Drawing.Size(890, 74)
$form.Controls.Add($summaryBox)

$status = New-Object System.Windows.Forms.Label
$status.Text = "Pronto."
$status.Location = New-Object System.Drawing.Point(15, 632)
$status.Size = New-Object System.Drawing.Size(890, 24)
$form.Controls.Add($status)

function Set-Status {
  param([string]$Text)
  $status.Text = $Text
  $status.Refresh()
}

function Load-Users {
  Set-Status "Carregando usuarios..."
  $payload = Invoke-DeleteEngine -Action "list-users"
  $current = if ($userCombo.SelectedItem) { [string]$userCombo.SelectedItem } else { "" }
  $userCombo.Items.Clear()
  foreach ($u in $payload.users) {
    [void]$userCombo.Items.Add([string]$u)
  }
  if ($userCombo.Items.Count -eq 0) {
    $summaryBox.Text = "Nenhum usuario encontrado na tabela users."
    $grid.Rows.Clear()
  } elseif ($current -and $userCombo.Items.Contains($current)) {
    $userCombo.SelectedItem = $current
  } else {
    $userCombo.SelectedIndex = 0
  }
  Set-Status "Usuarios carregados."
}

function Load-Preview {
  if (-not $userCombo.SelectedItem) {
    $grid.Rows.Clear()
    $summaryBox.Text = "Selecione um usuario."
    return
  }
  $username = [string]$userCombo.SelectedItem
  Set-Status "Gerando preview de impacto para '$username'..."
  $payload = Invoke-DeleteEngine -Action "preview" -Username $username
  $grid.Rows.Clear()
  $ordered = $payload.impact | Sort-Object -Property @{Expression = { [int]$_.count }; Descending = $true }, @{Expression = { [string]$_.table }; Descending = $false}
  foreach ($line in $ordered) {
    [void]$grid.Rows.Add([string]$line.table, [string]$line.count, [string]$line.label)
  }
  $missingCount = ($payload.coverage | Where-Object { $_.status -eq "missing_table" }).Count
  $summaryBox.Text = "Usuario: $($payload.username)`r`nowner_key: $($payload.ownerKey)`r`nTotal de linhas que serao removidas: $($payload.totalMatchedRows)`r`nTabelas esperadas ausentes no schema atual: $missingCount"
  Set-Status "Preview pronto para '$username'."
}

$refreshButton.Add_Click({
  try {
    Load-Users
    Load-Preview
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro ao atualizar: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    Set-Status "Falha ao atualizar."
  }
})

$userCombo.Add_SelectedIndexChanged({
  try {
    Load-Preview
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Erro no preview: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    Set-Status "Falha no preview."
  }
})

$deleteButton.Add_Click({
  try {
    if (-not $userCombo.SelectedItem) {
      [System.Windows.Forms.MessageBox]::Show("Selecione um usuario primeiro.", "Aviso", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning) | Out-Null
      return
    }

    $username = [string]$userCombo.SelectedItem
    $confirm = [System.Windows.Forms.MessageBox]::Show(
      "Tem certeza que deseja EXCLUIR permanentemente o usuario '$username' e todos os dados relacionados?",
      "Confirmar exclusao",
      [System.Windows.Forms.MessageBoxButtons]::YesNo,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    )
    if ($confirm -ne [System.Windows.Forms.DialogResult]::Yes) {
      Set-Status "Exclusao cancelada."
      return
    }

    if ($username.Trim().ToLower() -eq "admin") {
      $confirmAdmin = [System.Windows.Forms.MessageBox]::Show(
        "ATENCAO: voce esta tentando excluir o usuario ADMIN. Deseja continuar para a confirmacao final?",
        "Confirmacao extra (admin)",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning
      )
      if ($confirmAdmin -ne [System.Windows.Forms.DialogResult]::Yes) {
        Set-Status "Exclusao do admin cancelada."
        return
      }
      $typed = Show-TextPrompt -Title "Confirmacao final (admin)" -Message "Digite ADMIN para confirmar:"
      if ([string]::IsNullOrWhiteSpace($typed) -or $typed.Trim() -cne "ADMIN") {
        [System.Windows.Forms.MessageBox]::Show("Confirmacao final invalida. Nenhuma alteracao foi feita.", "Cancelado", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        Set-Status "Exclusao do admin cancelada pela confirmacao final."
        return
      }
    }

    Set-Status "Criando backup obrigatorio..."
    $backupPath = Run-Backup

    Set-Status "Executando exclusao transacional..."
    $result = Invoke-DeleteEngine -Action "delete" -Username $username
    $logPath = Append-OperationLog -Username $username -BackupPath $backupPath -TotalRemoved ([int]$result.totalRemoved)

    [System.Windows.Forms.MessageBox]::Show(
      "Usuario '$username' removido com sucesso.`r`n`r`nTotal removido: $($result.totalRemoved)`r`nBackup: $backupPath`r`nLog: $logPath`r`n`r`nSugestao: reinicie o servidor para recarregar estado em memoria.",
      "Sucesso",
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null

    Load-Users
    Load-Preview
    Set-Status "Exclusao concluida para '$username'."
  } catch {
    [System.Windows.Forms.MessageBox]::Show("Falha na exclusao: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    Set-Status "Erro durante exclusao."
  }
})

try {
  Load-Users
  if ($userCombo.Items.Count -gt 0) {
    Load-Preview
  }
} catch {
  [System.Windows.Forms.MessageBox]::Show("Falha ao inicializar utilitario: $($_.Exception.Message)", "Erro", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
}

[void]$form.ShowDialog()
