# Para o Sistema Financeiro ORPM (rode como Administrador).
$Tarefa = 'ORPM Financeiro'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Abra o PowerShell como Administrador (botao direito > Executar como administrador) e rode de novo.' -ForegroundColor Red; exit 1 }
Stop-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
# A tarefa abre o node por dentro do cmd; garante que o node tambem foi encerrado
function Get-Servidor { Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' } }
Get-Servidor | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
for ($i = 0; $i -lt 20 -and (Get-Servidor); $i++) { Start-Sleep -Milliseconds 500 }
if (Get-Servidor) { Write-Host 'Nao consegui parar o sistema (o node continua rodando).' -ForegroundColor Red; exit 1 }
Write-Host 'Sistema parado.'
exit 0
