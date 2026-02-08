---
name: calendar-tasks
description: Schedule and trigger tasks via Google Calendar. Poll for events with a configurable prefix, trigger each exactly once, and support one-off or recurring tasks. Create events from CLI or any Calendar client.
metadata: {"clawdbot":{"emoji":"📅","always":false,"requires":{"bins":["gog","jq"]}}}
---

# Calendar Tasks

Schedule and trigger tasks via Google Calendar. Events with the `[gigi]` prefix are treated as tasks and triggered when their start time falls within the polling window.

## How It Works

1. Create a calendar event with the prefix `[gigi]` in the title
2. The `check` command polls every 2 minutes via cron
3. When an event's start time falls within the window, it triggers
4. Each event triggers exactly once (tracked by event ID)
5. Event description carries the task instructions

You can create events from:
- This CLI (`calendar-tasks create`)
- Google Calendar web/app (just add the `[gigi]` prefix)
- Any Calendar client synced to the account
- Your phone

## Commands

```bash
# Check for events happening now
calendar-tasks check

# Create a one-off task
calendar-tasks create --summary "Review PR #42" --from "2026-02-06T14:00:00+01:00"
calendar-tasks create --summary "Remind Billy about deploy" --from "+2h"

# Create a recurring task
calendar-tasks create --summary "Weekly standup notes" \
  --from "next monday 9am" \
  --rrule "FREQ=WEEKLY;BYDAY=MO"

calendar-tasks create --summary "Monthly invoice check" \
  --from "2026-03-01T10:00:00+01:00" \
  --rrule "FREQ=MONTHLY;BYMONTHDAY=1"

# List upcoming task events
calendar-tasks upcoming          # Next 7 days
calendar-tasks upcoming 30       # Next 30 days

# View triggered history
calendar-tasks history

# Stats
calendar-tasks summary

# Configuration
calendar-tasks config                          # Show config
calendar-tasks config prefix "[gigi]"          # Change prefix
calendar-tasks config lookAheadMinutes 5       # Widen window

# Maintenance
calendar-tasks reset                           # Clear history
calendar-tasks prune 30                        # Remove events older than 30 days
```

## Configuration

Located at `~/.openclaw/workspace/skills/calendar-tasks/config.json`:

```json
{
  "account": "gigi@trifle.life",
  "calendarId": "primary",
  "lookAheadMinutes": 2,
  "lookBehindMinutes": 2,
  "prefix": "[gigi]",
  "deliverChannel": "telegram",
  "deliverTo": "329294873"
}
```

| Key | Description | Default |
|-----|-------------|---------|
| `account` | Google account for gog | gigi@trifle.life |
| `calendarId` | Calendar to poll | primary |
| `lookAheadMinutes` | Window ahead of now | 2 |
| `lookBehindMinutes` | Window behind now | 2 |
| `prefix` | Event title prefix filter | [gigi] |

## Cron Setup

Add as an OpenClaw gateway cron job for automatic processing. From the gateway UI (Cron tab), create a new job:

- **Name:** Calendar Tasks Check
- **Schedule:** `*/2 * * * *` (every 2 minutes)
- **Session:** isolated
- **Wake mode:** next-heartbeat
- **Payload (agentTurn):**
  ```
  Run the calendar tasks check and process any triggered events:
  1. Run: bash ~/.openclaw/workspace/skills/calendar-tasks/calendar-tasks.sh check
  2. If a task was triggered, execute the task described in the event
  3. Report the task and its outcome via Telegram
  4. If no events triggered, do nothing
  ```

This ensures the agent executes triggered tasks automatically, rather than just logging them.

## Use Cases

**Ad-hoc reminder:**
> "Remind me to check the deployment at 3pm"
```bash
calendar-tasks create --summary "Check the deployment" --from "today 3pm"
```

**Recurring task:**
> "Every Friday, summarize the week's PRs"
```bash
calendar-tasks create --summary "Summarize weekly PRs" \
  --from "next friday 5pm" \
  --rrule "FREQ=WEEKLY;BYDAY=FR" \
  --description "Check github PRs merged this week and send summary to Billy"
```

**Scheduled from phone:**
Just create a Google Calendar event titled `[gigi] Do the thing` at the desired time. The description becomes the task instructions.

## Files

| File | Purpose |
|------|---------|
| `calendar-tasks.sh` | Main script |
| `config.json` | Configuration |
| `~/.openclaw/workspace/memory/calendar-tasks-state.json` | State tracking |
| `~/.openclaw/workspace/memory/calendar-tasks.log` | Activity log |

## Dependencies

- `gog` - Google OAuth CLI (for Calendar access)
- `jq` - JSON processing

## Prerequisites

Google Calendar API must be enabled for the project:
1. Visit https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview
2. Enable the Calendar API for the gigi-workspace project

## Installation

**Via ClawdHub:**
```bash
clawdhub install calendar-tasks
```

**Via Git (for development):**
```bash
git clone https://github.com/trifle-labs/skills.git ~/repos/trifle-skills
ln -s ~/repos/trifle-skills/calendar-tasks ~/.openclaw/workspace/skills/calendar-tasks
```

**Manual:**
Copy the `calendar-tasks` folder to `~/.openclaw/workspace/skills/`
