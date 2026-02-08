/**
 * Configuration management for Snake Game
 *
 * Loads config from multiple sources with precedence:
 * 1. CLI arguments (highest)
 * 2. Environment variables
 * 3. Config file (~/.openclaw/workspace/memory/snake-game-settings.json)
 * 4. Defaults (lowest)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const HOME = process.env.HOME;
const SETTINGS_FILE = join(HOME, '.openclaw/workspace/memory/snake-game-settings.json');
const OPENCLAW_CONFIG = join(HOME, '.openclaw/openclaw.json');
const PID_FILE = join(HOME, '.openclaw/workspace/skills/snake-game/.snake-daemon.pid');
const LOG_FILE = join(HOME, '.openclaw/workspace/skills/snake-game/.snake-daemon.log');
const STATE_FILE = join(HOME, '.openclaw/workspace/skills/snake-game/.snake-daemon.state');

export const PATHS = {
  settings: SETTINGS_FILE,
  openclawConfig: OPENCLAW_CONFIG,
  pidFile: PID_FILE,
  logFile: LOG_FILE,
  stateFile: STATE_FILE,
  authState: join(HOME, '.openclaw/workspace/memory/trifle-auth-state.json'),
};

export const SERVERS = {
  live: 'https://bot.trifle.life',
  staging: 'https://bot-staging.trifle.life',
};

export const DEFAULTS = {
  server: 'live',
  strategy: 'expected-value',
  minBalance: 5,
  pollIntervalMs: 1000,
  telegramChatId: null,
  logToConsole: true,
  logToTelegram: true,
  logToFile: true,
  paused: false,
  // Strategy-specific defaults
  strategyOptions: {
    'expected-value': {
      minExpectedValue: 0.5,
      switchThreshold: 1.5, // Switch teams if EV is 50% better
    },
    'aggressive': {
      bidMultiplier: 2,
      alwaysOutbid: true,
    },
    'underdog': {
      maxPoolSize: 10,
      minPayoutMultiplier: 2.0,
    },
    'conservative': {
      maxBidAmount: 1,
      skipIfBehind: true,
    },
    'random': {
      // No options
    },
  },
};

/**
 * Load settings from file
 */
export function loadSettings() {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
      return { ...DEFAULTS, ...data };
    }
  } catch (e) {
    console.error(`Warning: Could not load settings: ${e.message}`);
  }
  return { ...DEFAULTS };
}

/**
 * Save settings to file
 */
export function saveSettings(settings) {
  // Only save non-default values
  const toSave = {};
  for (const [key, value] of Object.entries(settings)) {
    if (key !== 'strategyOptions' && value !== DEFAULTS[key]) {
      toSave[key] = value;
    }
  }
  // Always save strategyOptions if modified
  if (settings.strategyOptions) {
    toSave.strategyOptions = settings.strategyOptions;
  }
  writeFileSync(SETTINGS_FILE, JSON.stringify(toSave, null, 2));
}

/**
 * Get a specific config value
 */
export function getConfig(key) {
  const settings = loadSettings();
  return key.split('.').reduce((obj, k) => obj?.[k], settings);
}

/**
 * Set a specific config value
 */
export function setConfig(key, value) {
  const settings = loadSettings();
  const keys = key.split('.');
  let obj = settings;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }

  // Parse value types
  if (value === 'true') value = true;
  else if (value === 'false') value = false;
  else if (value === 'null') value = null;
  else if (!isNaN(value) && value !== '') value = Number(value);

  obj[keys[keys.length - 1]] = value;
  saveSettings(settings);
  return settings;
}

/**
 * Get Telegram bot token from openclaw config
 */
export function getTelegramToken() {
  try {
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return config?.channels?.telegram?.botToken || null;
  } catch {
    return null;
  }
}

/**
 * Get the backend URL based on server setting
 */
export function getBackendUrl(settings = null) {
  settings = settings || loadSettings();
  return process.env.TRIFLE_BACKEND_URL || SERVERS[settings.server] || SERVERS.live;
}

/**
 * Load daemon state (paused, current team, etc.)
 */
export function loadDaemonState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return {
    paused: false,
    currentTeam: null,
    lastRound: -1,
    gamesPlayed: 0,
    votesPlaced: 0,
    wins: 0,
    startedAt: null,
  };
}

/**
 * Save daemon state
 */
export function saveDaemonState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Merge CLI options with config
 */
export function mergeOptions(cliOptions) {
  const settings = loadSettings();
  return {
    ...settings,
    ...Object.fromEntries(
      Object.entries(cliOptions).filter(([_, v]) => v !== undefined)
    ),
  };
}
