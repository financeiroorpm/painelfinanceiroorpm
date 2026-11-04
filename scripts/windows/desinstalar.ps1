# Remove a tarefa e a regra de firewall (rode como Administrador). NAO apaga o banco (pasta dados\).
$Tarefa = 'ORPM Financeiro'
& "$PSScriptRoot\parar.ps1"
Unregister-ScheduledTask -TaskName $Tarefa -Confirm:$false -ErrorAction SilentlyContinue
Get-NetFirewallRule -DisplayName $Tarefa -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Write-Host 'Servico removido. O banco continua em dados\financeiro.db'
