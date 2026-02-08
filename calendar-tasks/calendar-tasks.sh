#!/bin/bash
# calendar-tasks: Poll Google Calendar for events and trigger task execution
# Requires: gog (Google OAuth CLI), jq

set -e

STATE_FILE="${CALENDAR_TASKS_STATE:-$HOME/.openclaw/workspace/memory/calendar-tasks-state.json}"
STATE_DIR=$(dirname "$STATE_FILE")
CONFIG_FILE="${CALENDAR_TASKS_CONFIG:-$HOME/.openclaw/workspace/skills/calendar-tasks/config.json}"
LOG_FILE="${CALENDAR_TASKS_LOG:-$HOME/.openclaw/workspace/memory/calendar-tasks.log}"

DEFAULT_CONFIG='{
  "account": "gigi@trifle.life",
  "calendarId": "primary",
  "lookAheadMinutes": 2,
  "lookBehindMinutes": 2,
  "prefix": "[gigi]",
  "deliverChannel": "telegram",
  "deliverTo": "329294873"
}'

mkdir -p "$STATE_DIR"
mkdir -p "$(dirname "$CONFIG_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG_FILE"
  echo "$*"
}

init_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
    log "Initialized config at $CONFIG_FILE"
  fi
}

get_config() {
  local key="$1"
  local default="$2"
  init_config
  local val=$(jq -r "if $key == null then \"\" else $key | tostring end" "$CONFIG_FILE" 2>/dev/null)
  echo "${val:-$default}"
}

init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    cat > "$STATE_FILE" << 'EOF'
{
  "lastChecked": null,
  "processedEvents": {},
  "stats": {
    "totalTriggered": 0,
    "totalSkipped": 0
  }
}
EOF
    log "Initialized state file at $STATE_FILE"
  fi
}

update_state() {
  local tmp=$(mktemp)
  jq "$1" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Check for events happening now (within the look window)
cmd_check() {
  init_state
  init_config

  local account=$(get_config '.account' 'gigi@trifle.life')
  local calendar_id=$(get_config '.calendarId' 'primary')
  local look_ahead=$(get_config '.lookAheadMinutes' '2')
  local look_behind=$(get_config '.lookBehindMinutes' '2')
  local prefix=$(get_config '.prefix' '[gigi]')
  local now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Calculate time window
  local from_time=$(date -u -d "-${look_behind} minutes" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-${look_behind}M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)
  local to_time=$(date -u -d "+${look_ahead} minutes" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v+${look_ahead}M +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)

  log "Checking calendar ($calendar_id) for events between $from_time and $to_time"

  # Query calendar events in the window
  local raw=$(gog calendar events "$calendar_id" \
    --account="$account" \
    --from="$from_time" \
    --to="$to_time" \
    --json 2>/dev/null || echo '{"events":[]}')

  # gog wraps events in {"events": [...]}
  local events=$(echo "$raw" | jq -c '.events // []')

  if [[ "$events" == "[]" || -z "$events" || "$events" == "null" ]]; then
    log "No events in window."
    update_state ".lastChecked = \"$now\""
    return
  fi

  local count=$(echo "$events" | jq 'length')
  log "Found $count event(s) in window"

  echo "$events" | jq -c '.[]' 2>/dev/null | while read -r event; do
    local event_id=$(echo "$event" | jq -r '.id // empty')
    local summary=$(echo "$event" | jq -r '.summary // "(no title)"')
    local description=$(echo "$event" | jq -r '.description // ""')
    local start=$(echo "$event" | jq -r '.start.dateTime // .start.date // ""')
    local end_time=$(echo "$event" | jq -r '.end.dateTime // .end.date // ""')

    if [[ -z "$event_id" ]]; then
      continue
    fi

    # Filter: only process events with the prefix
    if [[ -n "$prefix" ]] && [[ "$summary" != "$prefix"* ]]; then
      log "  Skipping '$summary' (no prefix '$prefix')"
      update_state ".stats.totalSkipped += 1"
      continue
    fi

    # Check if already processed
    local existing=$(jq -r ".processedEvents[\"$event_id\"] // empty" "$STATE_FILE")
    if [[ -n "$existing" ]]; then
      log "  Already processed: $summary"
      continue
    fi

    log "  TRIGGERING: $summary"

    # Strip prefix from summary for the task description
    local task_desc="$summary"
    if [[ -n "$prefix" ]]; then
      # Use sed to strip prefix (bash # expansion treats [ as glob)
      task_desc=$(echo "$summary" | sed "s|^$(echo "$prefix" | sed 's/[][\\.^$*+?{}()|/]/\\&/g') *||")
    fi

    # The task content is: description if present, otherwise the summary (minus prefix)
    local task_content="$task_desc"
    if [[ -n "$description" ]]; then
      task_content="$task_desc: $description"
    fi

    # Record as processed
    update_state ".processedEvents[\"$event_id\"] = {
      \"summary\": $(echo "$summary" | jq -R .),
      \"description\": $(echo "$description" | jq -R .),
      \"start\": \"$start\",
      \"end\": \"$end_time\",
      \"triggeredAt\": \"$now\",
      \"taskContent\": $(echo "$task_content" | jq -R .)
    }"

    update_state ".stats.totalTriggered += 1"

    # Output the task for the agent to pick up
    echo "---"
    echo "CALENDAR TASK TRIGGERED"
    echo "  Event: $summary"
    echo "  Start: $start"
    echo "  Task: $task_content"
    echo "---"

  done

  update_state ".lastChecked = \"$now\""
  log "Check complete."
}

# Create a task event on the calendar
cmd_create() {
  init_config

  local account=$(get_config '.account' 'gigi@trifle.life')
  local calendar_id=$(get_config '.calendarId' 'primary')
  local prefix=$(get_config '.prefix' '[gigi]')

  local summary=""
  local description=""
  local from_time=""
  local to_time=""
  local rrule=""
  local reminder="popup:0m"

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --summary) summary="$2"; shift 2 ;;
      --description) description="$2"; shift 2 ;;
      --from) from_time="$2"; shift 2 ;;
      --to) to_time="$2"; shift 2 ;;
      --rrule) rrule="$2"; shift 2 ;;
      --reminder) reminder="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  if [[ -z "$summary" || -z "$from_time" ]]; then
    echo "Usage: calendar-tasks create --summary <text> --from <time> [--to <time>] [--description <text>] [--rrule <rule>]"
    echo ""
    echo "Time formats: RFC3339 (2026-02-06T14:00:00+01:00) or relative (+2h, +30m, tomorrow 3pm)"
    echo "RRULE examples: FREQ=DAILY, FREQ=WEEKLY;BYDAY=MO,WE,FR, FREQ=MONTHLY;BYMONTHDAY=1"
    exit 1
  fi

  # Prepend prefix to summary
  local full_summary="${prefix} ${summary}"

  # Build gog command
  local cmd="gog calendar create $calendar_id --account=$account"
  cmd="$cmd --summary $(printf '%q' "$full_summary")"
  cmd="$cmd --from $(printf '%q' "$from_time")"

  if [[ -n "$to_time" ]]; then
    cmd="$cmd --to $(printf '%q' "$to_time")"
  else
    # Default to 15 min duration
    cmd="$cmd --to $(printf '%q' "+15m")"
  fi

  if [[ -n "$description" ]]; then
    cmd="$cmd --description $(printf '%q' "$description")"
  fi

  if [[ -n "$rrule" ]]; then
    cmd="$cmd --rrule $(printf '%q' "$rrule")"
  fi

  if [[ -n "$reminder" ]]; then
    cmd="$cmd --reminder $(printf '%q' "$reminder")"
  fi

  cmd="$cmd --json"

  log "Creating calendar event: $full_summary at $from_time"
  local result=$(eval "$cmd" 2>&1)

  if [[ $? -eq 0 ]]; then
    echo "$result"
    log "Event created successfully"
  else
    echo "Error creating event: $result" >&2
    exit 1
  fi
}

# List upcoming task events
cmd_upcoming() {
  init_config

  local account=$(get_config '.account' 'gigi@trifle.life')
  local calendar_id=$(get_config '.calendarId' 'primary')
  local prefix=$(get_config '.prefix' '[gigi]')
  local days="${1:-7}"

  local raw=$(gog calendar events "$calendar_id" \
    --account="$account" \
    --days="$days" \
    --json 2>/dev/null || echo '{"events":[]}')

  local events=$(echo "$raw" | jq -c '.events // []')

  if [[ "$events" == "[]" || -z "$events" ]]; then
    echo "No upcoming events in next $days days."
    return
  fi

  echo "Upcoming task events (next $days days):"
  echo ""

  echo "$events" | jq -r --arg prefix "$prefix" '
    .[] | select(.summary | startswith($prefix)) |
    "  \(.start.dateTime // .start.date)  \(.summary)"
  ' 2>/dev/null || echo "No task events found."
}

# Show processing history
cmd_history() {
  init_state

  echo "Processed events:"
  echo ""
  jq -r '.processedEvents | to_entries[] | "  [\(.value.triggeredAt)] \(.value.summary) -> \(.value.taskContent)"' "$STATE_FILE" 2>/dev/null || echo "No events processed yet."
}

# Show summary stats
cmd_summary() {
  init_state

  local total=$(jq '.stats.totalTriggered' "$STATE_FILE")
  local skipped=$(jq '.stats.totalSkipped' "$STATE_FILE")
  local last=$(jq -r '.lastChecked // "never"' "$STATE_FILE")

  echo "Calendar Tasks Summary:"
  echo "  Last checked: $last"
  echo "  Total triggered: $total"
  echo "  Total skipped (no prefix): $skipped"
  echo "  Processed events: $(jq '.processedEvents | length' "$STATE_FILE")"
}

# Show/set config
cmd_config() {
  init_config

  if [[ -z "$1" ]]; then
    echo "Current configuration:"
    jq '.' "$CONFIG_FILE"
    echo ""
    echo "Usage:"
    echo "  calendar-tasks config                          Show current config"
    echo "  calendar-tasks config prefix '[gigi]'          Set event prefix filter"
    echo "  calendar-tasks config calendarId <id>          Set calendar ID"
    echo "  calendar-tasks config lookAheadMinutes <n>     Set look-ahead window"
    echo "  calendar-tasks config lookBehindMinutes <n>    Set look-behind window"
    return
  fi

  local key="$1"
  local value="$2"

  if [[ -z "$value" ]]; then
    get_config ".$key"
  else
    local tmp=$(mktemp)
    if [[ "$value" =~ ^[0-9]+$ ]]; then
      jq ".$key = $value" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
    else
      jq ".$key = \"$value\"" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
    fi
    echo "Set $key = $value"
  fi
}

# Reset state
cmd_reset() {
  cat > "$STATE_FILE" << 'EOF'
{
  "lastChecked": null,
  "processedEvents": {},
  "stats": {
    "totalTriggered": 0,
    "totalSkipped": 0
  }
}
EOF
  log "State reset. All processed events cleared."
}

# Prune old processed events (older than N days)
cmd_prune() {
  init_state
  local days="${1:-30}"
  local cutoff=$(date -u -d "-${days} days" +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -v-${days}d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null)

  local before=$(jq '.processedEvents | length' "$STATE_FILE")
  local tmp=$(mktemp)
  jq --arg cutoff "$cutoff" '
    .processedEvents |= with_entries(select(.value.triggeredAt > $cutoff))
  ' "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
  local after=$(jq '.processedEvents | length' "$STATE_FILE")

  log "Pruned $((before - after)) events older than $days days ($before -> $after)"
}

# Main command dispatcher
case "${1:-}" in
  check)
    cmd_check
    ;;
  create)
    shift
    cmd_create "$@"
    ;;
  upcoming)
    cmd_upcoming "$2"
    ;;
  history)
    cmd_history
    ;;
  summary)
    cmd_summary
    ;;
  config)
    cmd_config "$2" "$3"
    ;;
  reset)
    cmd_reset
    ;;
  prune)
    cmd_prune "$2"
    ;;
  *)
    echo "calendar-tasks: Schedule and trigger tasks via Google Calendar"
    echo ""
    echo "Commands:"
    echo "  check                      Check for events happening now and trigger tasks"
    echo "  create --summary <text> --from <time> [opts]"
    echo "                             Create a task event on the calendar"
    echo "  upcoming [days]            List upcoming task events (default: 7 days)"
    echo "  history                    Show triggered event history"
    echo "  summary                    Show stats"
    echo "  config [key] [val]         Show/set configuration"
    echo "  reset                      Clear processed event history"
    echo "  prune [days]               Remove events older than N days (default: 30)"
    echo ""
    echo "How it works:"
    echo "  - Events with the prefix '$(get_config '.prefix' '[gigi]')' are treated as tasks"
    echo "  - The 'check' command finds events starting within the time window"
    echo "  - Each event is triggered exactly once (tracked by event ID)"
    echo "  - Event description contains the task instructions"
    echo ""
    echo "Examples:"
    echo "  calendar-tasks create --summary 'Review PR #42' --from '2026-02-06T14:00:00+01:00'"
    echo "  calendar-tasks create --summary 'Weekly report' --from 'next friday 9am' --rrule 'FREQ=WEEKLY;BYDAY=FR'"
    echo "  calendar-tasks create --summary 'Remind Billy about deployment' --from '+2h'"
    echo ""
    echo "Cron setup:"
    echo "  */2 * * * * $0 check >> $LOG_FILE 2>&1"
    ;;
esac
