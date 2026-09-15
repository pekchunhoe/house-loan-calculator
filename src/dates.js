export const DAY = 86400000;
export const iso = date => new Date(date).toISOString().slice(0, 10);
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && iso(time) === value ? time : NaN;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function paymentDate(year, month, day) {
  return Date.UTC(year, month, Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate()));
}
export function firstPayment(start, day) {
  const d = new Date(start);
  let due = paymentDate(d.getUTCFullYear(), d.getUTCMonth(), day);
  if (due <= start) due = paymentDate(d.getUTCFullYear(), d.getUTCMonth() + 1, day);
  return due;
}
export function nextPayment(date, day) {
  const d = new Date(date);
  return paymentDate(d.getUTCFullYear(), d.getUTCMonth() + 1, day);
}
export function previousPayment(date, day) {
  const d = new Date(date);
  return paymentDate(d.getUTCFullYear(), d.getUTCMonth() - 1, day);
}
export function monthsBetween(start, end) {
  if (end <= start) return 0;
  const a = new Date(start), b = new Date(end);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  return Math.max(1, months + (b.getUTCDate() > a.getUTCDate() ? 1 : 0));
}
