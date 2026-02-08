/**
 * Telegram logging integration
 */

import { getTelegramToken, loadSettings } from './config.mjs';

let cachedToken = null;

/**
 * Send a message to Telegram
 */
export async function sendTelegram(text, chatId = null) {
  const settings = loadSettings();
  chatId = chatId || settings.telegramChatId;

  if (!chatId) return false;
  if (!settings.logToTelegram) return false;

  if (!cachedToken) {
    cachedToken = process.env.TELEGRAM_BOT_TOKEN || getTelegramToken();
  }

  if (!cachedToken) {
    return false;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${cachedToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Format a game event for logging
 */
export function formatVote(round, direction, team, amount, balance, teams) {
  // teams is an array of team objects with id, emoji, score
  const scoreStr = teams
    .map(t => `${t.emoji || t.id}${t.score}`)
    .join(' ');
  return `🐍 R${round} ${direction.toUpperCase()} ${team.emoji}${team.id} x${amount} | bal:${balance.toFixed(1)} | ${scoreStr}`;
}

export function formatGameEnd(winner, didWin) {
  const emoji = didWin ? '🎉' : '🏁';
  const suffix = didWin ? ' (we won!)' : '';
  return `${emoji} Game ended! Winner: ${winner.emoji} ${winner.name}${suffix}`;
}

export function formatTeamSwitch(fromTeam, toTeam, reason) {
  if (!fromTeam) {
    return `🎯 Joining team: ${toTeam.emoji} ${toTeam.name}`;
  }
  return `🔄 Switching: ${fromTeam} → ${toTeam.emoji} ${toTeam.name} (${reason})`;
}

export function formatError(message) {
  return `❌ ${message}`;
}

export function formatWarning(message) {
  return `⚠️ ${message}`;
}

export function formatStatus(state, settings) {
  const lines = [
    `🐍 Snake Daemon Status`,
    `├─ Strategy: ${settings.strategy}`,
    `├─ Server: ${settings.server}`,
    `├─ Paused: ${state.paused ? 'Yes' : 'No'}`,
    `├─ Current Team: ${state.currentTeam || 'None'}`,
    `├─ Games: ${state.gamesPlayed} (${state.wins} wins)`,
    `├─ Votes: ${state.votesPlaced}`,
    `└─ Running since: ${state.startedAt ? new Date(state.startedAt).toLocaleString() : 'N/A'}`,
  ];
  return lines.join('\n');
}
