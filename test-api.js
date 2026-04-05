const http = require('http');

http.get('http://localhost:3000/api/funds?limit=20&page=40', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const countWithStats = json.funds.filter(f => f.cagr1y !== null || f.standardDeviation !== null).length;
    console.log(`Page 40 has ${json.funds.length} items. Evaluated metrics: ${countWithStats}`);
    if (countWithStats > 0) {
        console.log("Sample Beta evaluated:", json.funds.map(f => f.beta).find(b => b && b !== 'Insufficient Data'));
    }
  });
}).on('error', err => console.log('Error:', err.message));
