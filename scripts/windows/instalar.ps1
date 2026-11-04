# Instala o Sistema Financeiro ORPM como servico do Windows (tarefa que liga junto com o computador).
# Rode no PowerShell COMO ADMINISTRADOR, dentro da pasta do projeto:
#   powershell -ExecutionPolicy Bypass -File scripts\windows\instalar.ps1
# Para outra porta:  ... -File scripts\windows\instalar.ps1 -Porta 8080
param([int]$Porta = 3000)
# 'Continue' porque npm e git escrevem avisos no stderr, e o PowerShell 5.1 trataria isso como erro.
# Falhas de verdade sao conferidas pelo $LASTEXITCODE e com -ErrorAction Stop nos comandos do Windows.
$ErrorActionPreference = 'Continue'
$Tarefa = 'ORPM Financeiro'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo.' -ForegroundColor Red; exit 1 }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host 'Node.js nao encontrado. Instale a versao LTS em https://nodejs.org e rode de novo.' -ForegroundColor Red; exit 1 }
$versao = [int]((& node -v).TrimStart('v').Split('.')[0])
if ($versao -lt 22) { Write-Host "Node.js $versao e antigo demais. Instale a versao LTS (22 ou mais nova) em https://nodejs.org" -ForegroundColor Red; exit 1 }

Write-Host '1/4 Instalando dependencias...'
Push-Location $Raiz
& npm ci --omit=dev
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci falhou' }
Pop-Location
New-Item -ItemType Directory -Force -Path (Join-Path $Raiz 'dados') | Out-Null

Write-Host '2/4 Criando a tarefa que liga o sistema junto com o Windows...'
$nodeExe = $node.Source
$cmdArgs = "/c `"`"$nodeExe`" src\server.js --porta=$Porta >> dados\servidor.log 2>&1`""
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $Raiz
$gatilho = New-ScheduledTaskTrigger -AtStartup
$conta = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$config = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
if (Get-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue) { & "$PSScriptRoot\parar.ps1"; Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false }
Register-ScheduledTask -TaskName $Tarefa -Action $acao -Trigger $gatilho -Principal $conta -Settings $config -Description 'Sistema Financeiro ORPM' -ErrorAction Stop | Out-Null

Write-Host "3/4 Liberando a porta $Porta no firewall (rede privada/dominio)..."
Get-NetFirewallRule -DisplayName $Tarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $Tarefa -Direction Inbound -Protocol TCP -LocalPort $Porta -Action Allow -Profile Private,Domain -ErrorAction Stop | Out-Null

Write-Host '4/4 Ligando o sistema...'
Start-ScheduledTask -TaskName $Tarefa -ErrorAction Stop
Start-Sleep -Seconds 6
try {
  Invoke-RestMethod "http://localhost:$Porta/api/saude" | Out-Null
  Write-Host ''
  Write-Host 'Pronto! O sistema esta no ar.' -ForegroundColor Green
  Write-Host "  Neste computador: http://localhost:$Porta"
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { Write-Host "  Na rede:          http://$($_.IPAddress):$Porta" }
  $atalho = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'Financeiro ORPM.url'
  Set-Content -Path $atalho -Value "[InternetShortcut]`r`nURL=http://localhost:$Porta/" -Encoding ASCII
  Write-Host 'Atalho "Financeiro ORPM" criado na area de trabalho.'
  Write-Host 'No primeiro acesso, crie o usuario administrador.'
} catch {
  Write-Host "O sistema nao respondeu. Veja o arquivo dados\servidor.log" -ForegroundColor Red
}
