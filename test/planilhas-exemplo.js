// Gera planilhas .xlsx no mesmo formato das planilhas reais (para testes).
import ExcelJS from 'exceljs';

const VERDE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF069A2E' } };
const AMARELO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };

export async function planilhaPagar() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('novembro 2026');
  ws.getCell('H1').value = 'BOLETOS A PAGAR NOVEMBRO/26 - SEM NOTA';
  ws.addRow([]);
  ws.getRow(2).values = ['DATA COMPRA', 'NUMERO DO DOCUMENTO', 'FORNECEDOR', 'VALOR', 'VENCT', '', '', 'DATA COMPRA', 'NUMERO DO DOCUMENTO', 'FORNECEDOR', 'VALOR', 'VENCT'];
  ws.getRow(3).values = ['21/out.', '', 'PACAEMBU', 'R$ 540,20', '2/11/2026', '', '', '1/out.', '', 'POSTO SEM NOTA', 'R$ 100,00', '5/11/2026'];
  ws.getRow(4).values = ['9/out.', '60A-000216021-001', 'DJKR COBRANÇAS', 'R$ 758,50', '2/11/2026'];
  ws.getRow(5).values = ['11/ago.', '7670', 'MEGATRUK DISTRIBUIDORA', 'R$ 1.033,00', '2/11/2026'];
  ws.getRow(6).values = ['11/ago.', '7671', 'VALOR RUIM', 'R$ ???', '3/11/2026'];
  ws.getRow(7).values = ['11/ago.', '7672', 'DATA LONGE', 'R$ 10,00', '3/11/2025'];
  ws.getCell('C3').fill = VERDE;
  ws.getCell('C4').fill = AMARELO;
  const ws2 = wb.addWorksheet('Resumo');
  ws2.getCell('A1').value = 'nada aqui';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function planilhaReceber() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Novembro');
  ws.getRow(1).values = ['BOLETOS A PAGAR NOVEMBRO/26'];
  ws.getRow(2).values = ['DATA COMPRA', 'NF-S', 'NF-P', 'FORNECEDOR', 'VALOR', 'VENCT', 'OS', 'BANCO', '', '', 'Pago'];
  ws.getRow(3).values = ['08/outubro', '2908', '204', 'IGM-INTERNACIONAL GRANITO', 'R$ 1385,00', '01/11/26', '55', 'Banestes'];
  ws.getRow(4).values = ['01/setembro', '2863', '169', 'CAMPEÃO TRANSPORTES', 'R$ 897,50', '01/11/26', '', '', '', '', 'Pago'];
  ws.getRow(5).values = ['03/setembro', '2865', '171', 'CLIENTE CANCELADO', 'R$ 955,00', '02/11/26', '', '', '', '', 'cancelado'];
  ws.getRow(6).values = ['03/setembro', '2867', '174', 'JM BERGAMINI', 1226.25, new Date(Date.UTC(2026, 10, 2))];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
