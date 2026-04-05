const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; NatFunds/2.0)',
  'Referer':      'https://www.amfiindia.com/polling/amfi/fund-performance',
  'Origin':       'https://www.amfiindia.com',
};

async function postJSON(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: COMMON_HEADERS,
    body: JSON.stringify(body)
  });
  return resp.json();
}

async function testFetch() {
  const subCats = await postJSON('https://www.amfiindia.com/gateway/pollingsebi/api/amfi/getsubcategory', { category: 1 });
  
  for (let daysBack = 0; daysBack <= 5; daysBack++) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dd = String(d.getDate()).padStart(2, '0');
    const dateStr = `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
    
    const p = {
      maturityType: 1,
      category: 1,
      subCategory: subCats.data[0].id,
      mfid: 0,
      reportDate: dateStr
    };
    
    const funds = await postJSON('https://www.amfiindia.com/gateway/pollingsebi/api/amfi/fundperformance', p);
    if(funds && funds.data && funds.data.length > 0) {
      console.log('Date:', dateStr, '- Got', funds.data.length, 'Equity funds (subCat 1).');
    } else {
      console.log('Date:', dateStr, '- No data for Equity.');
    }
  }
}
testFetch().catch(console.error);
