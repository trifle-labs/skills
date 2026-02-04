# Got It Game State Schema

## State File Location

`~/.openclaw/workspace/got-it-state.json`

## Schema

```json
{
  "channelId": "string",           // Discord/Telegram channel where game is active
  "state": "string",                // "waiting" | "revealing" | "complete"
  "round": number,                  // Current round number (starts at 1)
  "currentPlayers": [               // Players who said "got it" this round
    {
      "id": "string",               // User ID
      "name": "string",             // Display name
      "timestamp": number           // Unix timestamp when they said "got it"
    }
  ],
  "wordHistory": [                  // Previous rounds' word pairs
    {
      "round": number,
      "words": ["string", "string"], // The two words revealed
      "players": ["string", "string"] // Player names who revealed them
    }
  ],
  "lastActivity": number            // Unix timestamp of last game activity
}
```

## State Transitions

### waiting → revealing
When 2 players have said "got it"

### revealing → waiting  
After both players reveal different words (new round)

### revealing → complete
After both players reveal the same word (game won)

## Cleanup

Delete state file when game completes or after 24h of inactivity.
