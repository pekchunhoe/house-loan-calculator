export const money = n => Number.isFinite(n) ? `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
export const compact = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;
export const monthDate = date => date ? new Date(date + 'T00:00:00Z').toLocaleDateString('en-MY', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Not repaid';
export const fullDate = date => date ? new Date(date + 'T00:00:00Z').toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
export function duration(months) {
  if (months === null || months === undefined) return 'No payoff estimate';
  const years = Math.floor(months / 12), rest = months % 12;
  return [years ? `${years} year${years === 1 ? '' : 's'}` : '', rest ? `${rest} month${rest === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ') || '0 months';
}
export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
