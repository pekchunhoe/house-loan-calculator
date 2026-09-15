import { compact, escapeHtml } from './format.js';
const colors = { green: '#39694d', gray: '#aab49f', orange: '#d7a575', grid: '#e9ede4', text: '#8b9784' };
function svg(width, height, title, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><title>${escapeHtml(title)}</title>${content}</svg>`;
}
function lineChart(el, series, title) {
  const width = Math.max(230, el.clientWidth), height = 208;
  const pad = { left: 47, right: 13, top: 20, bottom: 28 };
  const w = width - pad.left - pad.right, h = height - pad.top - pad.bottom;
  const all = series.flatMap(s => s.points);
  if (!all.length) { el.innerHTML = '<p class="quiet-note">Enter valid loan details to see the projection.</p>'; return; }
  const minX = Math.min(...all.map(p => p[0])), maxX = Math.max(minX + 86400000, ...all.map(p => p[0]));
  const maxY = Math.max(1, ...all.map(p => p[1])) * 1.04;
  const x = v => pad.left + (v - minX) / (maxX - minX) * w;
  const y = v => pad.top + (1 - v / maxY) * h;
  let content = `<text x="0" y="10" font-size="10" fill="${colors.text}" font-family="inherit">RM</text>`;
  for (let i = 0; i <= 4; i++) {
    const value = maxY * i / 4, at = y(value);
    content += `<line x1="${pad.left}" y1="${at}" x2="${width - pad.right}" y2="${at}" stroke="${colors.grid}" stroke-dasharray="3 4"/><text x="${pad.left - 8}" y="${at + 4}" text-anchor="end" font-size="10" fill="${colors.text}" font-family="inherit">${compact(value)}</text>`;
  }
  const ticks = width < 430 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const value = minX + (maxX - minX) * i / ticks;
    const date = new Date(value);
    const label = maxX - minX < 2 * 365 * 86400000 ? date.toLocaleDateString('en-MY', { month: 'short', year: '2-digit', timeZone: 'UTC' }) : String(date.getUTCFullYear());
    content += `<text x="${x(value)}" y="${height - 5}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}" font-size="10" fill="${colors.text}" font-family="inherit">${label}</text>`;
  }
  for (const s of series) {
    if (!s.points.length) continue;
    const stride = Math.max(1, Math.floor(s.points.length / 160));
    const points = s.points.filter((_, i) => i % stride === 0 || i === s.points.length - 1);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(' ');
    if (s.fill) content += `<path d="${path} L${x(points.at(-1)[0])},${y(0)} L${x(points[0][0])},${y(0)} Z" fill="${s.color}" opacity=".055"/>`;
    content += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.3" ${s.dashed ? 'stroke-dasharray="5 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
    const last = points.at(-1); content += `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="3.2" fill="${s.color}" stroke="#fff" stroke-width="1.5"/>`;
  }
  el.innerHTML = svg(width, height, title, content);
}
export function renderBalance(el, baseline, strategy) {
  const points = r => [[Date.parse(r.start), r.initialPrincipal], ...r.rows.map(row => [Date.parse(row.date), row.ending])];
  lineChart(el, [{ points: points(baseline), color: colors.gray, dashed: true }, { points: points(strategy), color: colors.green, fill: true }], 'Mortgage principal over time: normal payments and your current strategy');
}
export function renderComposition(el, strategy) {
  let interest = 0, principal = 0;
  const start = Date.parse(strategy.start), principalPoints = [[start, 0]], interestPoints = [[start, 0]];
  for (const row of strategy.rows) {
    interest += row.interest; principal += row.principalPaid;
    principalPoints.push([Date.parse(row.date), principal]); interestPoints.push([Date.parse(row.date), interest]);
  }
  lineChart(el, [{ points: principalPoints, color: colors.green, fill: true }, { points: interestPoints, color: colors.orange }], 'Cumulative principal paid and interest paid over time');
}
export function renderSavings(el, scenarios) {
  const base = scenarios.find(s => s.extra === 0)?.result;
  if (base?.status !== 'paid') { el.innerHTML = '<p class="quiet-note">Interest savings cannot be compared until the RM 0 extra scenario fully repays the loan.</p>'; return; }
  const width = Math.max(230, el.clientWidth), left = width < 400 ? 80 : 105, right = width < 400 ? 60 : 82;
  const rows = scenarios.filter(s => s.extra > 0 && s.result.status === 'paid');
  const max = Math.max(1, ...rows.map(s => base.interestPaid - s.result.interestPaid));
  let content = `<text x="0" y="14" font-size="11" fill="${colors.text}" font-family="inherit">Interest saved by extra monthly payment</text>`;
  rows.forEach((s, i) => {
    const value = Math.max(0, base.interestPaid - s.result.interestPaid), y = 32 + i * 27;
    content += `<text x="0" y="${y + 12}" font-size="11" fill="${colors.text}" font-family="inherit">+ RM ${compact(s.extra)}</text><rect x="${left}" y="${y}" width="${width - left - right}" height="16" rx="3" fill="#f2f5ed"/><rect x="${left}" y="${y}" width="${value / max * (width - left - right)}" height="16" rx="3" fill="${colors.green}" opacity="${0.35 + i / Math.max(1, rows.length) * .65}"/><text x="${width - 1}" y="${y + 12}" text-anchor="end" font-size="11" fill="${colors.green}" font-family="inherit">RM ${compact(value)}</text>`;
  });
  el.innerHTML = svg(width, rows.length * 27 + 38, 'Interest saved by increasing your extra monthly payment; exact amounts are in the comparison table', content);
}
