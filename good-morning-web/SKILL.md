---
name: good-morning-web
description: Play the Trifle GM game via the web API. Posts creative G+M word pairs to earn balls. Supports multiple players (GiGi, Tilt) running concurrently as a daemon.
version: 1.0.0
metadata:
  clawdhub:
    emoji: "🌅"
    requires:
      bins: ["node"]
    dependencies: ["trifle-auth"]
---

# Good Morning Web - GM Game Skill

Plays the Trifle Good Morning game automatically via the web API (`POST /balls/create`).
Supports multiple players running concurrently, each with their own auth token and state.

## How It Works

- Posts creative two-word greetings where first word starts with G, second with M
- Each unique phrase earns 1 ball
- Rate limit: 3 GMs per 3 hours (after 10 total GMs)
- Built-in word bank with ~22,000+ phrase combinations
- Automatic duplicate detection and retry
- Telegram logging to track progress

## Commands

```bash
# Post one GM as Tilt
node gm.mjs play --player tilt

# React to recent GMs
node gm.mjs react --player tilt

# Check status
node gm.mjs status --player tilt

# Check balance
node gm.mjs balance --player tilt

# Run daemon (both players, auto-posting)
node gm.mjs daemon
```

## Daemon Mode

Runs both GiGi and Tilt concurrently:
- New players (<10 GMs): posts every 3 minutes (no rate limit yet)
- Established players (>10 GMs): posts every 65 minutes (safe under 3/3h limit)
- Reacts to others' GMs every 5 hours (5/day cap)
- Logs to Telegram and local log file

Start: `node gm.mjs daemon`

## State Files

- GiGi: `~/.openclaw/workspace/memory/gm-web-state-gigi.json`
- Tilt: `~/.openclaw/workspace/memory/gm-web-state-tilt.json`

## Expected Earnings

- ~22 GMs/day per player = ~22 balls/day
- Plus reactions from other players on creative GMs
- Two players combined: ~44+ balls/day
