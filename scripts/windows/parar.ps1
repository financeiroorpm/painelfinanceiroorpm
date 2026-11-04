# Para o Sistema Financeiro ORPM (rode como Administrador).
$Tarefa = 'ORPM Financeiro'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Stop-ScheduledTask -TaskName $Tarefa -ErrorAction SilentlyContinue
# Garante que o node que a tarefa abriu tambem foi encerrado
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*src\server.js*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
Write-Host 'Sistema parado.'
