# Atualiza o Sistema Financeiro ORPM para a versao mais nova do GitHub (rode como Administrador).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\atualizar.ps1
# O banco de dados (pasta dados\) nao e tocado; antes de atualizar e feita uma copia dele.
# 'Continue' porque npm e git escrevem avisos no stderr, e o PowerShell 5.1 trataria isso como erro.
# Falhas de verdade sao conferidas pelo $LASTEXITCODE e com -ErrorAction Stop nos comandos do Windows.
$ErrorActionPreference = 'Continue'
$Tarefa = 'ORPM Financeiro'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo.' -ForegroundColor Red; exit 1 }

Push-Location $Raiz
try {
  Write-Host '1/4 Parando o sistema e copiando o banco...'
  & "$PSScriptRoot\parar.ps1"
  if ($LASTEXITCODE -ne 0) { throw 'Nao deu para parar o sistema. Nada foi alterado.' }
  $pasta = Join-Path $Raiz 'dados\backups'
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  $banco = Join-Path $Raiz 'dados\financeiro.db'
  if (Test-Path $banco) { Copy-Item $banco (Join-Path $pasta ("antes-da-atualizacao-" + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.db')) -ErrorAction Stop }

  Write-Host '2/4 Baixando a versao nova...'
  $lock = Join-Path $Raiz 'package-lock.json'
  $antes = (Get-FileHash $lock).Hash
  # safe.directory: a pasta pode ter sido baixada por outro usuario do Windows (git recusaria com 'dubious ownership')
  & git -c "safe.directory=$($Raiz -replace '\\','/')" pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull falhou. Tem alguma mudanca feita direto nesta pasta? Rode "git status" para ver.' }

  # So reinstala as dependencias se a lista delas mudou (ou se a pasta node_modules sumiu)
  if (((Get-FileHash $lock).Hash -ne $antes) -or -not (Test-Path (Join-Path $Raiz 'node_modules'))) {
    Write-Host '3/4 Instalando dependencias...'
    & npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou' }
  } else {
    Write-Host '3/4 Dependencias sem mudanca.'
  }

  Write-Host '4/4 Ligando o sistema...'
  Start-ScheduledTask -TaskName $Tarefa -ErrorAction Stop
  $porta = 3000
  $args0 = (Get-ScheduledTask -TaskName $Tarefa).Actions[0].Arguments
  if ($args0 -match '--porta=(\d+)') { $porta = [int]$Matches[1] }
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { Invoke-RestMethod "http://localhost:$porta/api/saude" -TimeoutSec 2 | Out-Null; $ok = $true } catch { }
  }
  if (-not $ok) { Write-Host 'O sistema nao respondeu depois da atualizacao. Veja o final de dados\servidor.log e me mande o texto.' -ForegroundColor Red; exit 1 }
  Write-Host 'Atualizado e no ar. Atualize a pagina no navegador (Ctrl+F5).' -ForegroundColor Green
  Write-Host 'Se algo estiver estranho, veja o final de dados\servidor.log'
} catch {
  Write-Host $_ -ForegroundColor Red
  Write-Host 'Ligando o sistema de novo...'
  Start-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  exit 1
} finally { Pop-Location }
