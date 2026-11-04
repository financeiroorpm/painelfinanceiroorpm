# Sistema Financeiro ORPM

Controle de boletos a pagar e a receber, com banco de dados próprio, login por pessoa e histórico de tudo o que acontece com cada boleto. Roda num computador ou servidor Windows do escritório, e todo mundo da rede acessa pelo navegador.

## O que ele faz

- **Painel**: atrasados, totais do mês ou do ano, próximos 7 dias, gráfico do fluxo de caixa, maiores clientes e fornecedores.
- **Boletos**: lançar (com parcelas), editar, marcar como pago, reabrir e cancelar. O sistema avisa quando o boleto parece duplicado.
- **Histórico**: cada boleto guarda quem lançou, quem editou (e o que mudou) e quem deu baixa, com data e hora.
- **Usuários** com três papéis: administrador (faz tudo), financeiro (lança e dá baixa) e só leitura.
- **Importação das planilhas antigas** do Google Planilhas (.xlsx). A cor verde vira "pago". Linhas com problema aparecem em "Para conferir".
- **Exportar CSV** para abrir no Excel.
- **Backup automático** do banco quando liga e a cada 6 horas, em `dados\backups\`. Ficam os 30 mais recentes.

## Instalar no Windows (uma vez só)

1. Instale o **Node.js LTS** (versão 22 ou mais nova): https://nodejs.org
2. Instale o **Git**: https://git-scm.com/download/win
3. Abra o **PowerShell como Administrador** e baixe o projeto. Por exemplo, em `C:\orpm`:
   ```powershell
   git clone https://github.com/financeiroorpm/painelfinanceiroorpm.git C:\orpm
   cd C:\orpm
   ```
4. Rode o instalador:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows\instalar.ps1
   ```
   Ele instala as dependências, cria uma tarefa que liga o sistema junto com o Windows (mesmo sem ninguém logado), libera a porta 3000 no firewall e mostra os endereços de acesso.
5. Abra `http://localhost:3000` e **crie o usuário administrador**.
6. Em **Administração**: cadastre as pessoas e importe as planilhas antigas.

As outras pessoas acessam por `http://IP-DO-SERVIDOR:3000`, por exemplo `http://192.168.0.10:3000`. Vale fixar o IP do servidor no roteador para o endereço não mudar.

### Importar as planilhas antigas

1. No Google Planilhas, abra a planilha de boletos a pagar e vá em **Arquivo → Fazer download → Microsoft Excel (.xlsx)**. Repita com a de boletos a receber.
2. No sistema, vá em **Administração → Importar planilhas antigas**, escolha os dois arquivos e clique em **Conferir**. Nada é gravado nessa etapa: aparece o resumo por aba, com quantos boletos e quantos pagos.
3. Se estiver certo, clique em **Importar para o sistema**. Importar de novo o mesmo arquivo não duplica nada.
4. No painel, resolva o que aparecer em **Para conferir**.

## Atualizar (quando sair uma versão nova)

No PowerShell como Administrador, dentro da pasta do sistema:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\atualizar.ps1
```
O script copia o banco antes, baixa a versão nova, instala o que precisar e liga de novo. Os dados ficam em `dados\` e não são tocados pela atualização.

## Outros comandos

| O que | Comando (PowerShell como Administrador, na pasta do sistema) |
|---|---|
| Parar | `powershell -ExecutionPolicy Bypass -File scripts\windows\parar.ps1` |
| Ligar | `Start-ScheduledTask -TaskName "ORPM Financeiro"` |
| Ver o log | `Get-Content dados\servidor.log -Tail 50` |
| Desinstalar (mantém o banco) | `powershell -ExecutionPolicy Bypass -File scripts\windows\desinstalar.ps1` |

## Backup e segurança dos dados

- Todo o banco é um arquivo só: `dados\financeiro.db`. As cópias automáticas ficam em `dados\backups\`.
- **Copie a pasta `dados\backups\` para fora do servidor** (pen drive, outro disco, OneDrive ou Google Drive) com frequência. Se o disco do servidor quebrar, a cópia de fora é o que salva.
- Para restaurar um backup: pare o sistema, troque `dados\financeiro.db` pela cópia (e apague `financeiro.db-wal` e `financeiro.db-shm`, se existirem) e ligue de novo.
- O sistema foi feito para a rede interna. Para acessar de fora do escritório, use uma VPN (por exemplo Tailscale). Não abra a porta direto para a internet.

## Para quem vai mexer no código

```bash
npm install
npm run dev     # liga em http://localhost:3000 e reinicia sozinho a cada mudança
npm test        # roda os testes automáticos
```

Veja o `CLAUDE.md` para entender a organização do código.
