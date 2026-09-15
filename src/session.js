import { loadPortfolio, savePortfolio, clone } from './storage.js';
export const loadedPortfolio = loadPortfolio();
let portfolio = loadedPortfolio.portfolio;
const listeners = new Set();
export const getPortfolio = () => portfolio;
export const getSelectedLoan = () => portfolio.loans.find(l => l.id === portfolio.selectedLoanId) || portfolio.loans[0];
export function commit() {
  const saved = !loadedPortfolio.blocked && savePortfolio(portfolio);
  for (const listener of listeners) listener(portfolio, saved);
  return saved;
}
export function replacePortfolio(value) { portfolio = value; loadedPortfolio.blocked = false; commit(); }
export function subscribe(listener) { listeners.add(listener); }
export function saveSelected(state) {
  const loan = getSelectedLoan(); if (!loan) return false;
  if (state.principal !== '' && Number(state.principal) === 0 && loan.status !== 'settled') { loan.history.push({ recordedAt: new Date().toISOString(), config: clone(loan.config) }); loan.status = 'settled'; }
  else if (Number(state.principal) > 0 && loan.status === 'settled') loan.status = 'active';
  if (loan.status !== 'active') delete portfolio.settings.custom[loan.id];
  loan.config = clone(state); return commit();
}
