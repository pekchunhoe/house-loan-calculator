import { lineChart } from './charts.js';
import { activeLoans } from './storage.js';
export function portfolioChart(el, p, result, hidden = new Set()) {
  const series = [{ points: result.points.map(v => [Date.parse(v.date), v.total]), color: '#203c35', step: true }];
  for (const [index, loan] of activeLoans(p).entries()) if (!hidden.has(loan.id)) series.push({ points: result.points.map(v => [Date.parse(v.date), v.balances[loan.id] ?? 0]), color: loan.color, dashed: index % 2 === 1, step: true });
  lineChart(el, series, 'Total mortgage balance and individual loan balances on each event date');
}
