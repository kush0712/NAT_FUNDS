const axios = require('axios');
const ExcelJS = require('exceljs');

async function debug() {
  const url = 'https://www.amfiindia.com/api/populate-te-rdata-revised?MF_ID=All&Month=03-2026&strCat=-1&strType=-1&excel=true';
  const resp = await axios.get(url, { responseType: 'arraybuffer' });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(resp.data);
  const sheet = workbook.worksheets[0];
  console.log("Headers (Row 1):", JSON.stringify(sheet.getRow(1).values));
  console.log("Data (Row 2):", JSON.stringify(sheet.getRow(2).values));
  console.log("Data (Row 3):", JSON.stringify(sheet.getRow(3).values));
}

debug().catch(console.error);
