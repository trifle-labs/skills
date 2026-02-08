/**
 * Strategy Registry
 *
 * Registers all available strategies and provides a factory method.
 */

import { ExpectedValueStrategy } from './expected-value.mjs';
import { AggressiveStrategy } from './aggressive.mjs';
import { UnderdogStrategy } from './underdog.mjs';
import { ConservativeStrategy } from './conservative.mjs';
import { RandomStrategy } from './random.mjs';

// Registry of all available strategies
const STRATEGIES = {
  'expected-value': ExpectedValueStrategy,
  'aggressive': AggressiveStrategy,
  'underdog': UnderdogStrategy,
  'conservative': ConservativeStrategy,
  'random': RandomStrategy,
};

// Aliases for convenience
const ALIASES = {
  'ev': 'expected-value',
  'agg': 'aggressive',
  'und': 'underdog',
  'con': 'conservative',
  'rand': 'random',
  'default': 'expected-value',
};

/**
 * Get a strategy instance by name
 */
export function getStrategy(name, options = {}) {
  // Resolve alias
  const resolvedName = ALIASES[name] || name;

  const StrategyClass = STRATEGIES[resolvedName];
  if (!StrategyClass) {
    throw new Error(`Unknown strategy: ${name}. Available: ${listStrategies().join(', ')}`);
  }

  return new StrategyClass(options);
}

/**
 * List all available strategy names
 */
export function listStrategies() {
  return Object.keys(STRATEGIES);
}

/**
 * Get strategy info (name, description, aliases)
 */
export function getStrategyInfo(name) {
  const resolvedName = ALIASES[name] || name;
  const StrategyClass = STRATEGIES[resolvedName];

  if (!StrategyClass) {
    return null;
  }

  // Create temp instance to get description
  const instance = new StrategyClass();

  // Find aliases for this strategy
  const aliases = Object.entries(ALIASES)
    .filter(([_, target]) => target === resolvedName)
    .map(([alias]) => alias);

  return {
    name: resolvedName,
    description: instance.description,
    aliases,
  };
}

/**
 * List all strategies with descriptions
 */
export function listStrategiesWithInfo() {
  return listStrategies().map(name => getStrategyInfo(name));
}

/**
 * Register a custom strategy
 */
export function registerStrategy(name, StrategyClass) {
  STRATEGIES[name] = StrategyClass;
}

export { BaseStrategy } from './base.mjs';
