#!/usr/bin/env node
/**
 * GM Game - Web API Player
 *
 * Plays the Trifle Good Morning game via the web API.
 * Supports multiple players (GiGi, Tilt) running concurrently.
 *
 * Usage:
 *   gm play [--player NAME]       Post one GM
 *   gm react [--player NAME]      React to recent GMs
 *   gm status [--player NAME]     Show status
 *   gm balance [--player NAME]    Check ball balance
 *   gm daemon                     Run all players in a loop
 *   gm help                       Show help
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync } from 'fs';
import { join } from 'path';

// === Configuration ===

const HOME = process.env.HOME;
const BACKEND_URL = process.env.TRIFLE_BACKEND_URL || 'https://bot.trifle.life';
const MEMORY_DIR = join(HOME, '.openclaw/workspace/memory');
const SKILL_DIR = join(HOME, '.openclaw/workspace/skills/good-morning-web');
const LOG_FILE = join(SKILL_DIR, '.gm-daemon.log');
const PID_FILE = join(SKILL_DIR, '.gm-daemon.pid');
const OPENCLAW_CONFIG = join(HOME, '.openclaw/openclaw.json');

const PLAYERS = {
  gigi: {
    name: 'GiGi',
    authState: join(MEMORY_DIR, 'trifle-auth-state.json'),
    stateFile: join(MEMORY_DIR, 'gm-web-state-gigi.json'),
  },
  tilt: {
    name: 'Tilt',
    authState: join(MEMORY_DIR, 'trifle-auth-state-tilt.json'),
    stateFile: join(MEMORY_DIR, 'gm-web-state-tilt.json'),
  },
};

// Intervals
const POST_INTERVAL_MS = 65 * 60 * 1000;     // 65 minutes (safe under 3/3h limit)
const RAMP_INTERVAL_MS = 3 * 60 * 1000;      // 3 minutes for new players (<10 GMs)
const REACT_INTERVAL_MS = 5 * 60 * 60 * 1000; // 5 hours between react rounds
const RAMP_THRESHOLD = 10;                     // GMs before rate limiting kicks in

// Telegram
const TELEGRAM_CHAT_ID = '-5040242854';

// === Word Banks ===
// Carefully curated to be in WordNet / standard dictionaries

const G_WORDS = [
  // Science & Tech
  'genomic', 'genetic', 'germinal', 'gastric', 'glial', 'glycemic', 'galvanic',
  'gaseous', 'geothermal', 'gravitational', 'gyroscopic', 'glacial', 'granitic',
  'geomorphic', 'granular', 'glomerular', 'gestalt', 'gerundive', 'gaussian',
  'galactic', 'geometric', 'geologic', 'geophysical', 'geochemical',
  // Nature
  'green', 'gray', 'golden', 'grassy', 'gleaming', 'glistening', 'gusty',
  'glaciated', 'gnarled', 'granite', 'garden', 'grove',
  // Adjectives
  'gentle', 'generous', 'genuine', 'giant', 'global', 'gorgeous', 'graceful',
  'grateful', 'grand', 'great', 'glossy', 'glorious', 'gloomy', 'grim',
  'giddy', 'glamorous', 'ghastly', 'ghostly', 'graphic', 'grave', 'greedy',
  'grimy', 'grumpy', 'guileless', 'gullible', 'gutsy', 'gaudy', 'gaunt',
  'gilt', 'glib', 'grizzled', 'groomed', 'guileful', 'guarded',
  // Nouns (used as modifiers)
  'garlic', 'ginger', 'glacier', 'gladiator', 'goblet', 'garnet', 'gazelle',
  'gecko', 'geranium', 'gondola', 'gorilla', 'gourd', 'griffin', 'grotto',
  'guru', 'geyser', 'galleon', 'gazebo', 'goblin', 'gargoyle',
  // Verbs / Participles
  'growing', 'gathering', 'guiding', 'grinding', 'grasping', 'gliding',
  'generating', 'governing', 'grafting', 'greeting', 'galloping', 'gamboling',
  'garnishing', 'gazing', 'gleaning', 'glimmering', 'glinting', 'gloating',
  'glorifying', 'glowing', 'gnawing', 'grading', 'grappling', 'grazing',
  'grilling', 'grinning', 'groaning', 'grooming', 'groping', 'grounding',
  'growling', 'grumbling', 'guaranteeing', 'guessing', 'gulping', 'gurgling',
  'gushing', 'gyrating',
  // Food & Drink
  'grilled', 'glazed', 'grated', 'ground', 'garnished',
  // Geography
  'gothic', 'grecian', 'gallic', 'georgian', 'germanic', 'gaelic',
  // More uncommon
  'gossamer', 'guilded', 'grandiose', 'gregarious', 'grotesque', 'gnomish',
  'garrulous', 'germane', 'glaciate', 'gossamer', 'gravelly', 'gubernatorial',
];

const M_WORDS = [
  // Science & Tech
  'membrane', 'metabolism', 'mitosis', 'meiosis', 'morphology', 'mutation',
  'microbe', 'molecule', 'mycelium', 'moraine', 'magma', 'mantle', 'meridian',
  'matrix', 'modulation', 'metallurgy', 'methodology', 'morpheme', 'manuscript',
  'magnetism', 'momentum', 'monograph', 'microscopy', 'mitochondria',
  // Nature
  'meadow', 'mountain', 'marsh', 'mist', 'moss', 'maple', 'magnolia',
  'marigold', 'mushroom', 'moonlight', 'monsoon', 'mesa', 'moorland',
  // Food & Drink
  'mackerel', 'marinade', 'muffin', 'melon', 'mustard', 'marzipan',
  'marmalade', 'mango', 'mint', 'mocha', 'mulberry', 'muesli',
  // Music & Arts
  'melody', 'minuet', 'mandolin', 'minstrel', 'mosaic', 'monument',
  'masterpiece', 'motif', 'madrigal', 'mural', 'mazurka', 'memoir',
  // Abstract
  'mystery', 'majesty', 'miracle', 'memory', 'moment', 'meaning',
  'measure', 'method', 'motion', 'mercy', 'merit', 'mischief', 'morale',
  'mythos', 'malice', 'mirth', 'maxim', 'mystique',
  // Objects / Places
  'machine', 'mansion', 'manor', 'monastery', 'monument', 'mirror',
  'mask', 'marble', 'medallion', 'monolith', 'maze', 'mill',
  'minaret', 'marquee', 'mausoleum',
  // Animals
  'mongoose', 'moth', 'mockingbird', 'macaw', 'marmot', 'mammoth',
  'mantis', 'manatee', 'mustang', 'moose',
  // Adjective-like
  'musical', 'magnetic', 'magnificent', 'majestic', 'mechanical',
  'medical', 'medieval', 'metallic', 'metaphysical', 'meticulous',
  'microscopic', 'militant', 'mineral', 'minimal', 'mobile',
  'modern', 'molecular', 'momentous', 'monastic', 'mundane',
  'municipal', 'mystical', 'mythical',
  // More uncommon
  'miasma', 'mendicant', 'menagerie', 'milieu', 'miscellany',
  'moniker', 'moratorium', 'motley', 'munitions', 'machination',
  'manifold', 'marauder', 'mercurial', 'metamorphosis', 'meander',
];

// === API Client ===

function loadToken(authStatePath) {
  try {
    if (existsSync(authStatePath)) {
      const state = JSON.parse(readFileSync(authStatePath, 'utf8'));
      return state?.token || null;
    }
  } catch {}
  return null;
}

async function apiRequest(path, options = {}) {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://trifle.life',
      'Referer': 'https://trifle.life/',
      ...options.headers,
    },
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }

  return { status: res.status, ok: res.ok, body: json, text };
}

async function authRequest(token, path, options = {}) {
  return apiRequest(path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    },
  });
}

// === State Management ===

function loadState(stateFile) {
  try {
    if (existsSync(stateFile)) {
      return JSON.parse(readFileSync(stateFile, 'utf8'));
    }
  } catch {}
  return {
    totalGMs: 0,
    totalReacts: 0,
    lastPostAt: null,
    lastReactAt: null,
    usedPhrases: [],
    duplicates: [],
    rejectedWords: [],
    errors: 0,
    startedAt: null,
  };
}

function saveState(stateFile, state) {
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// === Logging ===

function getTelegramToken() {
  try {
    const config = JSON.parse(readFileSync(OPENCLAW_CONFIG, 'utf8'));
    return config?.channels?.telegram?.botToken || null;
  } catch {
    return null;
  }
}

let _telegramToken = null;

async function sendTelegram(text) {
  if (!_telegramToken) {
    _telegramToken = process.env.TELEGRAM_BOT_TOKEN || getTelegramToken();
  }
  if (!_telegramToken) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${_telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function logMsg(message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

async function log(message) {
  logMsg(message);
  await sendTelegram(message);
}

// === Phrase Generation ===

function generatePhrase(state) {
  const used = new Set([...state.usedPhrases, ...state.duplicates].map(s => s.toLowerCase()));
  const rejected = new Set(state.rejectedWords.map(s => s.toLowerCase()));

  // Shuffle word banks for variety
  const gWords = [...G_WORDS].sort(() => Math.random() - 0.5);
  const mWords = [...M_WORDS].sort(() => Math.random() - 0.5);

  for (const g of gWords) {
    if (rejected.has(g.toLowerCase())) continue;
    for (const m of mWords) {
      if (rejected.has(m.toLowerCase())) continue;
      const phrase = `${g} ${m}`;
      if (!used.has(phrase.toLowerCase())) {
        return phrase;
      }
    }
  }
  return null;
}

// === Commands ===

async function cmdPlay(playerKey) {
  const player = PLAYERS[playerKey];
  if (!player) {
    console.error(`Unknown player: ${playerKey}`);
    return { success: false };
  }

  const token = loadToken(player.authState);
  if (!token) {
    console.error(`[${player.name}] Not authenticated`);
    return { success: false };
  }

  const state = loadState(player.stateFile);

  // Try up to 5 phrases
  for (let attempt = 0; attempt < 5; attempt++) {
    const phrase = generatePhrase(state);
    if (!phrase) {
      await log(`[${player.name}] 🌅 No more unique phrases available!`);
      return { success: false };
    }

    logMsg(`[${player.name}] Trying: "${phrase}" (attempt ${attempt + 1})`);

    const res = await authRequest(token, '/balls/create', {
      method: 'POST',
      body: JSON.stringify({ name: 'gm', extra: phrase }),
    });

    if (res.ok) {
      state.totalGMs++;
      state.lastPostAt = new Date().toISOString();
      state.usedPhrases.push(phrase.toLowerCase());
      saveState(player.stateFile, state);

      const bal = await getBalance(token);
      await log(`[${player.name}] 🌅 GM #${state.totalGMs}: "${phrase}" | bal: ${bal}`);
      return { success: true, phrase };
    }

    if (res.status === 409) {
      // Duplicate - mark it and try another
      state.duplicates.push(phrase.toLowerCase());
      saveState(player.stateFile, state);
      logMsg(`[${player.name}] Duplicate: "${phrase}"`);
      continue;
    }

    if (res.status === 429) {
      // Rate limited
      const nextTime = res.body?.nextAllowedTime;
      const msg = nextTime
        ? `Rate limited until ${nextTime}`
        : `Rate limited`;
      logMsg(`[${player.name}] ${msg}`);
      return { success: false, rateLimited: true, nextAllowedTime: nextTime };
    }

    if (res.status === 400) {
      // Word validation failure or format error
      const error = res.body?.error || res.text;
      logMsg(`[${player.name}] Rejected: "${phrase}" - ${error}`);
      // Extract which word failed if possible and add to rejected list
      const words = phrase.split(' ');
      // Don't add common words to rejected list - just this phrase
      state.duplicates.push(phrase.toLowerCase());
      saveState(player.stateFile, state);
      continue;
    }

    // Other error
    logMsg(`[${player.name}] Error ${res.status}: ${res.text}`);
    state.errors++;
    saveState(player.stateFile, state);
    return { success: false };
  }

  logMsg(`[${player.name}] Failed after 5 attempts`);
  return { success: false };
}

async function cmdReact(playerKey) {
  const player = PLAYERS[playerKey];
  if (!player) {
    console.error(`Unknown player: ${playerKey}`);
    return;
  }

  const token = loadToken(player.authState);
  if (!token) {
    console.error(`[${player.name}] Not authenticated`);
    return;
  }

  const state = loadState(player.stateFile);

  // Fetch recent GMs
  const gmsRes = await apiRequest('/balls/gms?limit=20');
  if (!gmsRes.ok || !gmsRes.body?.data) {
    logMsg(`[${player.name}] Failed to fetch GMs`);
    return;
  }

  // Get our user ID from auth state
  let userId;
  try {
    const authState = JSON.parse(readFileSync(player.authState, 'utf8'));
    userId = authState.userId;
  } catch {
    logMsg(`[${player.name}] Can't read user ID`);
    return;
  }

  let reacted = 0;
  const maxReacts = 5; // Daily cap is 5

  for (const gm of gmsRes.body.data) {
    if (reacted >= maxReacts) break;

    // Skip our own GMs
    if (gm.UserId === userId) continue;

    // Skip if we already reacted
    const alreadyReacted = gm.reactors?.some(r => r.userId === userId);
    if (alreadyReacted) continue;

    const res = await authRequest(token, '/balls/react', {
      method: 'POST',
      body: JSON.stringify({ ballId: gm.id }),
    });

    if (res.ok) {
      reacted++;
      logMsg(`[${player.name}] Liked GM #${gm.id}: "${gm.extra}" by ${gm.User?.username}`);
    } else if (res.status === 400) {
      // Already reacted or other issue
      continue;
    } else {
      logMsg(`[${player.name}] React error ${res.status}: ${res.text}`);
    }
  }

  if (reacted > 0) {
    state.totalReacts += reacted;
    state.lastReactAt = new Date().toISOString();
    saveState(player.stateFile, state);
    logMsg(`[${player.name}] Reacted to ${reacted} GMs`);
  }
}

async function getBalance(token) {
  try {
    const res = await authRequest(token, '/balls');
    if (res.ok) {
      return res.body?.balls ?? res.body?.totalBalls ?? 0;
    }
  } catch {}
  return 0;
}

async function cmdStatus(playerKey) {
  const player = PLAYERS[playerKey];
  if (!player) {
    console.error(`Unknown player: ${playerKey}`);
    return;
  }

  const state = loadState(player.stateFile);
  const token = loadToken(player.authState);
  const bal = token ? await getBalance(token) : 'N/A';

  console.log(`=== ${player.name} GM Status ===`);
  console.log(`Balance: ${bal} balls`);
  console.log(`Total GMs posted: ${state.totalGMs}`);
  console.log(`Total reacts given: ${state.totalReacts}`);
  console.log(`Last post: ${state.lastPostAt || 'never'}`);
  console.log(`Last react: ${state.lastReactAt || 'never'}`);
  console.log(`Phrases used: ${state.usedPhrases.length}`);
  console.log(`Known duplicates: ${state.duplicates.length}`);
  console.log(`Errors: ${state.errors}`);
  if (state.startedAt) {
    const uptime = Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    console.log(`Daemon uptime: ${hours}h ${mins}m`);
  }
}

async function cmdBalance(playerKey) {
  const player = PLAYERS[playerKey];
  if (!player) {
    console.error(`Unknown player: ${playerKey}`);
    return;
  }

  const token = loadToken(player.authState);
  if (!token) {
    console.error(`[${player.name}] Not authenticated`);
    return;
  }

  const bal = await getBalance(token);
  console.log(`[${player.name}] Balance: ${bal} balls`);
}

// === Daemon ===

async function cmdDaemon() {
  // Write PID file
  writeFileSync(PID_FILE, process.pid.toString());
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  await log('🌅 GM Daemon started (GiGi + Tilt)');

  // Track next action times per player
  const nextPost = {};
  const nextReact = {};

  for (const [key, player] of Object.entries(PLAYERS)) {
    const state = loadState(player.stateFile);
    state.startedAt = new Date().toISOString();
    saveState(player.stateFile, state);
    nextPost[key] = 0; // Post immediately on start
    nextReact[key] = Date.now() + 10 * 60 * 1000; // React after 10 minutes
  }

  while (true) {
    const now = Date.now();

    for (const [key, player] of Object.entries(PLAYERS)) {
      const token = loadToken(player.authState);
      if (!token) {
        logMsg(`[${player.name}] Not authenticated, skipping`);
        continue;
      }

      const state = loadState(player.stateFile);

      // Post a GM if it's time
      if (now >= nextPost[key]) {
        const result = await cmdPlay(key);

        if (result.rateLimited && result.nextAllowedTime) {
          const waitUntil = new Date(result.nextAllowedTime).getTime();
          nextPost[key] = waitUntil + 5000; // 5s after rate limit clears
        } else {
          // Determine interval based on total GMs
          const interval = state.totalGMs < RAMP_THRESHOLD
            ? RAMP_INTERVAL_MS
            : POST_INTERVAL_MS;
          nextPost[key] = now + interval;
        }
      }

      // React to GMs if it's time
      if (now >= nextReact[key]) {
        await cmdReact(key);
        nextReact[key] = now + REACT_INTERVAL_MS;
      }
    }

    // Sleep 30 seconds between checks
    await sleep(30000);
  }
}

function cleanup() {
  try { unlinkSync(PID_FILE); } catch {}
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// === CLI ===

function parsePlayerArg(args) {
  const idx = args.findIndex(a => a === '--player' || a === '-p');
  if (idx >= 0 && args[idx + 1]) {
    return args[idx + 1].toLowerCase();
  }
  return 'tilt'; // Default to tilt since that's the primary use case
}

function showHelp() {
  console.log(`
🌅 GM Game - Web API Player

Post creative G+M word pairs to earn balls on Trifle.

USAGE:
  gm <command> [--player NAME]

COMMANDS:
  play       Post one GM (default player: tilt)
  react      React to recent GMs
  status     Show player status and stats
  balance    Check ball balance
  daemon     Run all players in a loop
  help       Show this help

OPTIONS:
  --player, -p NAME    Player to use (gigi, tilt). Default: tilt

DAEMON:
  Runs both GiGi and Tilt, posting GMs every ~65 minutes per player.
  New players (<10 GMs) post every 3 minutes to ramp up quickly.

EXAMPLES:
  node gm.mjs play --player tilt
  node gm.mjs status --player gigi
  node gm.mjs daemon
`);
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'play':
      await cmdPlay(parsePlayerArg(args));
      break;
    case 'react':
      await cmdReact(parsePlayerArg(args));
      break;
    case 'status':
      await cmdStatus(parsePlayerArg(args));
      break;
    case 'balance':
      await cmdBalance(parsePlayerArg(args));
      break;
    case 'daemon':
      await cmdDaemon();
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      showHelp();
      break;
  }
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
