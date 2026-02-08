---
name: snake-game
description: Play the Trifle Snake game via API. Analyze game state, submit votes, and use strategic analysis to choose optimal moves on the hexagonal grid.
version: 1.0.0
metadata:
  clawdhub:
    emoji: "🐍"
    requires:
      bins: ["node"]
    platforms: ["api"]
    depends: ["trifle-auth"]
---

# Snake Game Skill

Play the Trifle Snake game through the API. The snake game is a multiplayer hexagonal grid game where teams compete to collect fruits by voting on the snake's direction.

## Prerequisites

- Must be authenticated via `trifle-auth` skill first
- Must have balls (earned from GM game, auth bonuses, etc.)

## Commands

```bash
# Get current game state
node snake-game.mjs state

# Submit a vote
node snake-game.mjs vote <direction> <team> [amount]

# Analyze game and get move recommendation
node snake-game.mjs strategy

# Check ball balance
node snake-game.mjs balance

# Show rodeo configurations
node snake-game.mjs rodeos

# Watch live game events (SSE)
node snake-game.mjs watch [seconds]
```

## Game Rules

### Hexagonal Grid
- Flat-top hexagonal grid with configurable radius (2-4)
- 6 directions: `n`, `ne`, `se`, `s`, `sw`, `nw`
- Snake starts at center (0, 0)

### Teams
- 2-6 teams depending on rodeo cycle
- Teams: Blue (A), Red (B), Yellow (C), Green (D), Purple (E), Orange (F)
- Each team has colored fruits on the board

### Voting (Auction System)
- Players vote for a direction by spending balls
- Each vote specifies: direction, team, and amount
- Snake moves in the winning direction each round
- All votes are "all-pay" (everyone pays, not just the winner)

### Rounds
- Base: 10 seconds per round
- Extension: If a vote arrives in the last 5 seconds, round extends by 5s
- Minimum bid starts at 1, doubles on extension

### Winning
- First team to collect `fruitsToWin` fruits wins
- Prize pool (starting balance + all bets) distributed to winning team voters
- Distribution based on vote COUNT (not amount)

### Rodeo Cycles
Games cycle through 3 configurations:
1. **Small**: 2 teams, radius 2, 1 fruit/team, 3 to win, 10 pool
2. **Medium**: 3 teams, radius 3, 2 fruits/team, 3 to win, 20 pool
3. **Large**: 4 teams, radius 4, 5 fruits/team, 3 to win, 30 pool

## Strategy Heuristics (Automated)

The skill uses advanced heuristics to compute optimal votes:

### Team Selection (scored and ranked)
1. **Fruit score priority**: Heavily weight teams closer to winning
2. **Win proximity bonus**: +200 points for teams 1 fruit away from winning
3. **Pool size penalty**: Prefer teams with smaller pools (less competition)
4. **Fruit distance bonus**: Bonus for having fruits close to snake head
5. **Immediate capture bonus**: +150 for fruits 1 move away

### Direction Selection (scored and ranked)
1. **Safety analysis**: Count exit routes from each position
2. **Dead-end avoidance**: Penalize positions with only 1-2 exits
3. **Target proximity**: Prefer directions that move toward target fruit
4. **Center preference**: Slight bonus for staying near grid center

### Bid Strategy
1. **Minimum bids**: Default to minimum bid to conserve balls
2. **Outbid logic**: Only outbid if team is strongly favored and affordable
3. **Early voting**: Vote early to avoid bid doubling on extensions

## Autoplay Mode

Continuously monitor and vote automatically:

```bash
# Play 10 rounds (default)
node snake-game.mjs autoplay

# Play 50 rounds
node snake-game.mjs autoplay 50

# Play forever (continuous mode)
node snake-game.mjs autoplay --forever

# Custom settings
node snake-game.mjs autoplay -r 20 -i 5000 -m 10

# Options:
#   -r, --rounds N       Number of rounds (default: 10)
#   -f, --forever        Play indefinitely (polls every 1s)
#   -i, --interval MS    Check interval in ms (default: 3000, 1000 in forever mode)
#   -m, --min-balance N  Min balance to vote (default: 5)
#   -q, --quiet          Less verbose output
```

### Forever Mode Smart Features

When running with `--forever`, the bot uses intelligent game analysis:

1. **Continuous polling**: Polls every 1 second instead of 3
2. **Team switching**: Automatically switches teams if:
   - Current team falls too far behind
   - Another team is about to win
   - Better opportunities arise
3. **Playability analysis**: Skips rounds when no good options exist
4. **Winner detection**: Celebrates when we back the winning team

## Manual Strategy Tips

1. **Minimum bids**: Use minimum bid unless outbidding is critical
2. **Pick the leading team**: Back the team closest to winning
3. **Closest fruit**: When no team is leading, guide snake toward nearest fruit
4. **Avoid extensions**: Voting early avoids bid doubling
5. **Watch for refunds**: If winning team has no voters, all bets refund

## Gateway Cron Job Setup

A cron job is configured in `~/.openclaw/cron/jobs.json` to play automatically every 5 minutes:

**Job ID**: `d4c7f8e1-a2b3-4c5d-e6f7-890123456789`
**Name**: Trifle Snake Game - Auto Play
**Schedule**: Every 5 minutes
**Action**: Runs `autoplay 5 --min-balance 1` to play 5 rounds

The job:
1. Runs the autoplay command with advanced heuristics
2. Automatically votes for 5 rounds each execution
3. Conserves balls by using minimum bids
4. Only reports errors or unusual events

To disable:
```bash
# Edit ~/.openclaw/cron/jobs.json and set "enabled": false
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/snake/state` | GET | Yes | Current game state + user balance |
| `/snake/vote` | POST | Yes | Submit a vote |
| `/snake/events` | GET | No | SSE stream for real-time updates |
| `/snake/rodeos` | GET | No | Rodeo cycle configurations |
