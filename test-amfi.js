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
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const dateStr = `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
    
  console.log(`Fetching categories... Date: ${dateStr}`);
  
  // Category 2 is Debt
  const subCats = await postJSON('https://www.amfiindia.com/gateway/pollingsebi/api/amfi/getsubcategory', { category: 2 });
  console.log('Debt subcategories:', subCats.data.length);
  
  if(subCats.data.length > 0) {
    const p = {
      maturityType: 1,
      category: 2,
      subCategory: subCats.data[0].id,
      mfid: 0,
      reportDate: dateStr
    };
    console.log('Fetching funds for subCat', subCats.data[0].name, 'with payload:', p);
    
    const funds = await postJSON('https://www.amfiindia.com/gateway/pollingsebi/api/amfi/fundperformance', p);
    if(funds && funds.data && funds.data.length > 0) {
      console.log('Got', funds.data.length, 'funds.');
      console.log('Sample fund keys:', Object.keys(funds.data[0]));
      console.log('Sample fund:', funds.data[0]);
    } else {
      console.log('No data returned.', funds);
    }
  }
}
testFetch().catch(console.error);
