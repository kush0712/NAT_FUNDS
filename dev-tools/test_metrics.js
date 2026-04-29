function getMonthlyReturns(parsed, yearsBack = 3) {
  const cutoffDate = new Date(parsed[parsed.length - 1].date);
  cutoffDate.setMonth(cutoffDate.getMonth() - Math.round(yearsBack * 12) - 1);

  const filtered = parsed.filter(p => p.date >= cutoffDate);

  const monthlyNavs = {};
  for (const p of filtered) {
    const key = `${p.date.getFullYear()}-${String(p.date.getMonth() + 1).padStart(2, '0')}`;
    monthlyNavs[key] = p.nav; 
  }

  const now = new Date('2026-04-03T00:00:00.000Z');
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const key of Object.keys(monthlyNavs)) {
    if (key >= currentMonthKey) {
      delete monthlyNavs[key];
    }
  }

  const months = Object.keys(monthlyNavs).sort();
  const returns = {};
  for (let i = 1; i < months.length; i++) {
    const prevNav = monthlyNavs[months[i - 1]];
    const currNav = monthlyNavs[months[i]];
    if (prevNav > 0) {
      returns[months[i]] = (currNav - prevNav) / prevNav;
    }
  }
  return returns;
}

// Generate daily NAV for 5 years
const parsed = [];
let initDate = new Date('2021-01-01');
const end = new Date('2026-04-02');
while (initDate <= end) {
  parsed.push({ date: new Date(initDate), nav: 100 });
  initDate.setDate(initDate.getDate() + 1);
}

const ret = Object.values(getMonthlyReturns(parsed, 3));
console.log("returns.length =", ret.length);
