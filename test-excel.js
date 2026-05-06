const XLSX = require('xlsx');

// Ler criaturas
const wb = XLSX.readFile('criaturas.xlsx');
console.log('Sheets disponíveis:', wb.SheetNames);

// Tentar ler cada sheet
for (const sheetName of wb.SheetNames) {
  const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
  console.log(`\n=== ${sheetName} - ${data.length} linhas ===`);
  if (data.length > 0) {
    console.log('Headers:', Object.keys(data[0]).slice(0, 15));
    console.log('Primeira linha:', JSON.stringify(data[0], null, 2).substring(0, 800));
  }
}

// Ler locais também
const wbLocais = XLSX.readFile('locais.xlsx');
console.log('\n\n=== LOCAIS ===');
console.log('Sheets:', wbLocais.SheetNames);
const locaisData = XLSX.utils.sheet_to_json(wbLocais.Sheets[wbLocais.SheetNames[0]], { defval: '' });
if (locaisData.length > 0) {
  console.log('Headers:', Object.keys(locaisData[0]));
  console.log('Primeira linha:', JSON.stringify(locaisData[0], null, 2));
}
