import { calculatePortfolio } from './portfolioEngine.js';
import { compareStrategies, lumpScenario, flexiScenario, rateScenario } from './strategyEngine.js';
import { solvePortfolioTarget } from './targetSolver.js';
self.onmessage = ({ data: { id, type, portfolio, options } }) => {
  try {
    const handlers = { overview: () => calculatePortfolio(portfolio), compare: () => compareStrategies(portfolio, options), target: () => solvePortfolioTarget(portfolio, options.date, options), lump: () => lumpScenario(portfolio, options), flexi: () => flexiScenario(portfolio, options), rate: () => rateScenario(portfolio, options) };
    if (!handlers[type]) throw new Error('Unknown simulation.');
    self.postMessage({ id, result: handlers[type]() });
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
