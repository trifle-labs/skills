/**
 * Process Management
 *
 * Handles PID files, locking, and daemon control.
 * Cross-platform support for Linux (systemd) and macOS (launchd).
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync, appendFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { PATHS, loadSettings, loadDaemonState, saveDaemonState } from './config.mjs';

const PLATFORM = process.platform;

/**
 * Check if daemon is running
 */
export function isDaemonRunning() {
  if (!existsSync(PATHS.pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(readFileSync(PATHS.pidFile, 'utf8').trim());
    // Check if process is running
    process.kill(pid, 0);
    return { running: true, pid };
  } catch (e) {
    // Process not running, clean up stale PID file
    try {
      unlinkSync(PATHS.pidFile);
    } catch {}
    return false;
  }
}

/**
 * Write PID file
 */
export function writePidFile() {
  writeFileSync(PATHS.pidFile, process.pid.toString());
}

/**
 * Remove PID file
 */
export function removePidFile() {
  try {
    unlinkSync(PATHS.pidFile);
  } catch {}
}

/**
 * Acquire exclusive lock (prevent multiple instances)
 */
export function acquireLock() {
  const status = isDaemonRunning();
  if (status?.running) {
    throw new Error(`Daemon already running (PID: ${status.pid})`);
  }
  writePidFile();
}

/**
 * Release lock
 */
export function releaseLock() {
  removePidFile();
}

/**
 * Log to daemon log file
 */
export function logToFile(message) {
  const settings = loadSettings();
  if (!settings.logToFile) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  appendFileSync(PATHS.logFile, line);
}

/**
 * Stop the running daemon
 */
export function stopDaemon() {
  const status = isDaemonRunning();
  if (!status?.running) {
    return { success: false, message: 'Daemon is not running' };
  }

  try {
    process.kill(status.pid, 'SIGTERM');
    // Wait a bit then check
    let retries = 10;
    while (retries > 0 && isDaemonRunning()) {
      execSync('sleep 0.5');
      retries--;
    }
    return { success: true, message: `Stopped daemon (PID: ${status.pid})` };
  } catch (e) {
    return { success: false, message: `Failed to stop: ${e.message}` };
  }
}

/**
 * Pause voting (daemon keeps running but doesn't vote)
 */
export function pauseDaemon() {
  const state = loadDaemonState();
  state.paused = true;
  saveDaemonState(state);
  return { success: true, message: 'Daemon paused' };
}

/**
 * Resume voting
 */
export function resumeDaemon() {
  const state = loadDaemonState();
  state.paused = false;
  saveDaemonState(state);
  return { success: true, message: 'Daemon resumed' };
}

/**
 * Get daemon status
 */
export function getDaemonStatus() {
  const running = isDaemonRunning();
  const state = loadDaemonState();
  const settings = loadSettings();

  return {
    running: running?.running || false,
    pid: running?.pid || null,
    paused: state.paused,
    currentTeam: state.currentTeam,
    gamesPlayed: state.gamesPlayed,
    votesPlaced: state.votesPlaced,
    wins: state.wins,
    startedAt: state.startedAt,
    strategy: settings.strategy,
    server: settings.server,
    telegramChatId: settings.telegramChatId,
  };
}

/**
 * Start daemon in background
 */
export function startDaemonBackground() {
  const status = isDaemonRunning();
  if (status?.running) {
    return { success: false, message: `Already running (PID: ${status.pid})` };
  }

  // Path to the snake CLI
  const snakePath = new URL('../snake.mjs', import.meta.url).pathname;

  const child = spawn('node', [snakePath, 'daemon'], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  child.unref();

  return { success: true, message: `Started daemon (PID: ${child.pid})`, pid: child.pid };
}

/**
 * Tail the log file
 */
export function tailLogs(lines = 50, follow = false) {
  if (!existsSync(PATHS.logFile)) {
    console.log('No log file yet.');
    return;
  }

  if (follow) {
    const tail = spawn('tail', ['-f', '-n', lines.toString(), PATHS.logFile], {
      stdio: 'inherit',
    });
    tail.on('error', () => {
      // Fallback for systems without tail
      console.log(readFileSync(PATHS.logFile, 'utf8'));
    });
    return tail;
  } else {
    try {
      const output = execSync(`tail -n ${lines} "${PATHS.logFile}"`, { encoding: 'utf8' });
      console.log(output);
    } catch {
      // Fallback
      const content = readFileSync(PATHS.logFile, 'utf8');
      const lineArray = content.split('\n');
      console.log(lineArray.slice(-lines).join('\n'));
    }
  }
}

/**
 * Check if systemd is available (Linux)
 */
export function hasSystemd() {
  if (PLATFORM !== 'linux') return false;
  try {
    execSync('systemctl --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if launchd is available (macOS)
 */
export function hasLaunchd() {
  return PLATFORM === 'darwin';
}

/**
 * Generate systemd service file content
 */
export function generateSystemdService() {
  const home = process.env.HOME;
  const snakePath = `${home}/.openclaw/workspace/skills/snake-game/snake.mjs`;

  return `[Unit]
Description=Snake Game Autoplay Daemon
After=network.target

[Service]
Type=simple
User=${process.env.USER}
WorkingDirectory=${home}/.openclaw/workspace/skills/snake-game
ExecStart=/usr/bin/node ${snakePath} daemon
Restart=on-failure
RestartSec=10
Environment=HOME=${home}

[Install]
WantedBy=default.target
`;
}

/**
 * Generate launchd plist content
 */
export function generateLaunchdPlist() {
  const home = process.env.HOME;
  const snakePath = `${home}/.openclaw/workspace/skills/snake-game/snake.mjs`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.snake-daemon</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${snakePath}</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${home}/.openclaw/workspace/skills/snake-game</string>
    <key>StandardOutPath</key>
    <string>${home}/.openclaw/workspace/skills/snake-game/.snake-daemon-stdout.log</string>
    <key>StandardErrorPath</key>
    <string>${home}/.openclaw/workspace/skills/snake-game/.snake-daemon-stderr.log</string>
</dict>
</plist>
`;
}

/**
 * Install service for auto-start
 */
export function installService() {
  if (hasSystemd()) {
    return installSystemdService();
  } else if (hasLaunchd()) {
    return installLaunchdService();
  } else {
    return { success: false, message: 'No supported service manager found (systemd or launchd)' };
  }
}

function installSystemdService() {
  const servicePath = `${process.env.HOME}/.config/systemd/user/snake-daemon.service`;
  const content = generateSystemdService();

  try {
    // Ensure directory exists
    execSync(`mkdir -p ${process.env.HOME}/.config/systemd/user`);
    writeFileSync(servicePath, content);
    execSync('systemctl --user daemon-reload');
    return {
      success: true,
      message: `Service installed at ${servicePath}\n\nTo enable: systemctl --user enable snake-daemon\nTo start: systemctl --user start snake-daemon`,
    };
  } catch (e) {
    return { success: false, message: `Failed to install: ${e.message}` };
  }
}

function installLaunchdService() {
  const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.openclaw.snake-daemon.plist`;
  const content = generateLaunchdPlist();

  try {
    writeFileSync(plistPath, content);
    return {
      success: true,
      message: `Service installed at ${plistPath}\n\nTo load: launchctl load ${plistPath}\nTo unload: launchctl unload ${plistPath}`,
    };
  } catch (e) {
    return { success: false, message: `Failed to install: ${e.message}` };
  }
}

/**
 * Uninstall service
 */
export function uninstallService() {
  if (hasSystemd()) {
    const servicePath = `${process.env.HOME}/.config/systemd/user/snake-daemon.service`;
    try {
      execSync('systemctl --user stop snake-daemon', { stdio: 'ignore' });
      execSync('systemctl --user disable snake-daemon', { stdio: 'ignore' });
      unlinkSync(servicePath);
      execSync('systemctl --user daemon-reload');
      return { success: true, message: 'Systemd service uninstalled' };
    } catch (e) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  } else if (hasLaunchd()) {
    const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.openclaw.snake-daemon.plist`;
    try {
      execSync(`launchctl unload "${plistPath}"`, { stdio: 'ignore' });
      unlinkSync(plistPath);
      return { success: true, message: 'Launchd service uninstalled' };
    } catch (e) {
      return { success: false, message: `Failed: ${e.message}` };
    }
  }
  return { success: false, message: 'No service manager found' };
}
