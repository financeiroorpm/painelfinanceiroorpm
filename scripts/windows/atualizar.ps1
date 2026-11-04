# Atualiza o Sistema Financeiro ORPM para a versao mais nova do GitHub (rode como Administrador).
#   powershell -ExecutionPolicy Bypass -File scripts\windows\atualizar.ps1
# O banco de dados (pasta dados\) nao e tocado; o sistema faz um backup sozinho toda vez que liga.
$ErrorActionPreference = 'Stop'
$Tarefa = 'ORPM Financeiro'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $Raiz
try {
  Write-Host '1/4 Copia de seguranca do banco...'
  $pasta = Join-Path $Raiz 'dados\backups'
  New-Item -ItemType Directory -Force -Path $pasta | Out-Null
  $banco = Join-Path $Raiz 'dados\financeiro.db'
  & "$PSScriptRoot\parar.ps1"
  if (Test-Path $banco) { Copy-Item $banco (Join-Path $pasta ("antes-da-atualizacao-" + (Get-Date -Format 'yyyy-MM-dd-HHmm') + '.db')) }

  Write-Host '2/4 Baixando a versao nova...'
  & git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull falhou. Tem alguma mudanca feita direto nesta pasta? Rode "git status" para ver.' }

  Write-Host '3/4 Instalando dependencias...'
  & npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw 'npm ci falhou' }

  Write-Host '4/4 Ligando o sistema...'
  Start-ScheduledTask -TaskName $Tarefa
  Start-Sleep -Seconds 4
  Write-Host 'Atualizado e no ar. Se algo der errado, veja dados\servidor.log' -ForegroundColor Green
} catch {
  Write-Host $_ -ForegroundColor Red
  Write-Host 'Tentando ligar o sistema de novo na versao que estava...'
  Start-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
  exit 1
} finally { Pop-Location }
