/**
 * Autoplay Daemon Loop
 *
 * Core game loop that runs continuously.
 */

import { loadSettings, loadDaemonState, saveDaemonState } from '../lib/config.mjs';
import { getGameState, getBalance, submitVote, isAuthenticated } from '../lib/api.mjs';
import { parseGameState, getTeamById } from '../lib/game-state.mjs';
import { getStrategy } from '../lib/strategies/index.mjs';
import { sendTelegram, formatVote, formatGameEnd, formatTeamSwitch, formatError, formatWarning } from '../lib/telegram.mjs';
import { logToFile, isDaemonRunning } from '../lib/process.mjs';

/**
 * Log to all configured outputs
 */
async function log(message, settings) {
  if (settings.logToConsole) {
    console.log(message);
  }
  if (settings.logToTelegram && settings.telegramChatId) {
    await sendTelegram(message);
  }
  logToFile(message);
}

/**
 * Run the autoplay loop
 */
export async function runAutoplay(options = {}) {
  const settings = { ...loadSettings(), ...options };
  let state = loadDaemonState();

  // Initialize state
  state.startedAt = Date.now();
  saveDaemonState(state);

  const strategy = getStrategy(settings.strategy, settings.strategyOptions?.[settings.strategy]);

  console.log(`=== Snake Daemon Started ===`);
  console.log(`Strategy: ${strategy.name}`);
  console.log(`Server: ${settings.server}`);
  console.log(`Telegram: ${settings.telegramChatId || 'disabled'}`);
  console.log(`Poll interval: ${settings.pollIntervalMs}ms`);
  console.log(``);

  logToFile(`Daemon started: strategy=${strategy.name}, server=${settings.server}`);

  let lastRound = state.lastRound;
  let currentTeam = state.currentTeam;
  let inGame = false;

  // Main loop
  while (true) {
    try {
      // Check if we should stop
      if (!isDaemonRunning()?.running) {
        console.log('PID file removed, shutting down...');
        break;
      }

      // Reload state (for pause/resume)
      state = loadDaemonState();

      // Check if paused
      if (state.paused) {
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // Check authentication
      if (!isAuthenticated()) {
        logToFile('Not authenticated, waiting...');
        await sleep(5000);
        continue;
      }

      // Get game state
      const rawState = await getGameState();
      if (rawState.error) {
        if (rawState.error === 'AUTH_MISSING' || rawState.error === 'AUTH_EXPIRED') {
          logToFile(`Auth error: ${rawState.error}`);
          await sleep(5000);
          continue;
        }
      }

      const parsed = parseGameState(rawState);

      // No active game
      if (!parsed) {
        if (inGame) {
          logToFile('Game ended (no state)');
          inGame = false;
        }
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // Game just started
      if (!inGame && parsed.active) {
        inGame = true;
        currentTeam = null;
        lastRound = -1;
        strategy.onGameStart?.(parsed, state);
        logToFile('New game started');
      }

      // Game ended - only log once when transitioning from inGame to ended
      if (!parsed.active && parsed.winner && inGame) {
        const winnerTeam = getTeamById(parsed, parsed.winner);
        const didWin = currentTeam === parsed.winner;

        state.gamesPlayed++;
        if (didWin) state.wins++;
        saveDaemonState(state);

        await log(formatGameEnd(winnerTeam, didWin), settings);
        strategy.onGameEnd?.(parsed, state, didWin);

        inGame = false;
        currentTeam = null;
        lastRound = -1;
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // Game not active
      if (!parsed.active) {
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // Same round as before
      if (parsed.round === lastRound) {
        process.stdout.write('.');
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // New round - compute vote
      const balance = await getBalance();

      const vote = strategy.computeVote(parsed, balance, { ...state, currentTeam });

      if (!vote || vote.skip) {
        lastRound = parsed.round;
        if (vote?.reason) {
          logToFile(`Round ${parsed.round}: skipped (${vote.reason})`);
        }
        await sleep(settings.pollIntervalMs);
        continue;
      }

      // Check if team changed
      if (vote.team.id !== currentTeam) {
        const prevTeam = currentTeam;
        currentTeam = vote.team.id;
        await log(formatTeamSwitch(prevTeam, vote.team, vote.reason), settings);
      }

      // Submit vote
      try {
        await submitVote(vote.direction, vote.team.id, vote.amount);

        state.votesPlaced++;
        state.currentTeam = currentTeam;
        state.lastRound = parsed.round;
        saveDaemonState(state);

        const newBalance = balance - vote.amount;

        // Pass the full teams array for proper logging (only active teams)
        await log(formatVote(parsed.round, vote.direction, vote.team, vote.amount, newBalance, parsed.teams), settings);

      } catch (e) {
        const errorMsg = e.message || String(e);
        if (errorMsg.includes('already active')) {
          // Direction already voted, not a real error
          logToFile(`Round ${parsed.round}: direction already active`);
        } else {
          await log(formatError(`Vote failed: ${errorMsg}`), settings);
        }
      }

      lastRound = parsed.round;
      strategy.onRoundEnd?.(parsed, state);

    } catch (e) {
      logToFile(`Error: ${e.message}`);
      console.error(`Error: ${e.message}`);
    }

    await sleep(settings.pollIntervalMs);
  }

  logToFile('Daemon stopped');
  console.log('Daemon stopped');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
