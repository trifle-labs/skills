#!/bin/bash
# email-mentions: Monitor and track emails with security scanning
# Requires: gog (Google OAuth CLI), jq, python3 (for injection scanning)

set -e

STATE_FILE="${EMAIL_MENTIONS_STATE:-$HOME/.openclaw/workspace/memory/email-mentions-state.json}"
STATE_DIR=$(dirname "$STATE_FILE")
CONFIG_FILE="${EMAIL_MENTIONS_CONFIG:-$HOME/.openclaw/workspace/skills/email-mentions/config.json}"
LOG_FILE="${EMAIL_MENTIONS_LOG:-$HOME/.openclaw/workspace/memory/email-mentions.log}"
SCANNER="$HOME/.openclaw/workspace/skills/indirect-prompt-injection/scripts/sanitize.py"

# Default configuration
DEFAULT_CONFIG='{
  "account": "gigi@trifle.life",
  "authorizedSenders": ["b@trifle.life"],
  "checkIntervalMinutes": 15,
  "maxEmails": 20,
  "scanForInjection": true,
  "autoProcessAuthorized": false,
  "quarantineSuspicious": true
}'

# Ensure directories exist
mkdir -p "$STATE_DIR"
mkdir -p "$(dirname "$CONFIG_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$LOG_FILE"
  echo "$*"
}

# Initialize config file if it doesn't exist
init_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
    log "Initialized config at $CONFIG_FILE"
  fi
}

# Get config value
get_config() {
  local key="$1"
  local default="$2"
  init_config
  local val=$(jq -r "if $key == null then \"\" else $key | tostring end" "$CONFIG_FILE" 2>/dev/null)
  echo "${val:-$default}"
}

# Check if sender is authorized
is_authorized_sender() {
  local sender="$1"
  init_config
  # Extract email from "Name <email>" format
  local email=$(echo "$sender" | grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' | head -1)
  jq -e ".authorizedSenders | index(\"$email\") != null" "$CONFIG_FILE" >/dev/null 2>&1
}

# Initialize state file if it doesn't exist
init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    cat > "$STATE_FILE" << 'EOF'
{
  "lastChecked": null,
  "lastMessageId": null,
  "emails": {},
  "stats": {
    "totalProcessed": 0,
    "authorized": 0,
    "flagged": 0,
    "quarantined": 0
  }
}
EOF
    log "Initialized state file at $STATE_FILE"
  fi
}

# Get value from state
get_state() {
  local key="$1"
  jq -r "$key" "$STATE_FILE"
}

# Update state file
update_state() {
  local tmp=$(mktemp)
  jq "$1" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
}

# Scan content for prompt injection
scan_for_injection() {
  local content="$1"

  if [[ ! -f "$SCANNER" ]]; then
    echo "WARN: Scanner not found at $SCANNER"
    return 1
  fi

  # Run the scanner — write content to temp file to avoid quoting issues
  local tmpfile=$(mktemp)
  echo "$content" > "$tmpfile"
  local result=$(python3 "$SCANNER" --file "$tmpfile" --json 2>/dev/null || echo '{"is_suspicious":true,"reason":"scanner_error"}')
  rm -f "$tmpfile"
  # Compact to single line and validate JSON, fallback if invalid
  result=$(echo "$result" | jq -c . 2>/dev/null || echo '{"is_suspicious":false,"reason":"scanner_output_invalid"}')
  echo "$result"
}

# Check for new emails
cmd_check() {
  init_state
  init_config

  local account=$(get_config '.account' 'gigi@trifle.life')
  local max_emails=$(get_config '.maxEmails' '20')
  local scan_injection=$(get_config '.scanForInjection' 'true')
  local now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  log "Checking emails for $account"

  # Get unread emails from inbox (include body for injection scanning)
  local raw=$(gog gmail messages search "is:unread in:inbox" --account="$account" --max="$max_emails" --include-body --json 2>/dev/null || echo '{"messages":[]}')
  local emails=$(echo "$raw" | jq -c '.messages // []')

  if [[ "$emails" == "[]" || -z "$emails" ]]; then
    log "No unread emails found."
    update_state ".lastChecked = \"$now\""
    cmd_summary
    return
  fi

  local count=$(echo "$emails" | jq 'length')
  log "Found $count unread email(s)"

  echo "$emails" | jq -c '.[]' 2>/dev/null | while read -r email; do
    local msg_id=$(echo "$email" | jq -r '.id')
    local thread_id=$(echo "$email" | jq -r '.threadId // .id')
    local from=$(echo "$email" | jq -r '.from // "unknown"')
    local subject=$(echo "$email" | jq -r '.subject // "(no subject)"')
    local date=$(echo "$email" | jq -r '.date // ""')
    local snippet=$(echo "$email" | jq -r '.snippet // ""')

    # Check if already processed
    local existing=$(jq -r ".emails[\"$msg_id\"] // empty" "$STATE_FILE")
    if [[ -n "$existing" ]]; then
      continue
    fi

    log "Processing: $subject (from: $from)"

    # Determine trust level
    local trust_level="unknown"
    local status="pending"
    local injection_result='{"is_suspicious":false}'

    if is_authorized_sender "$from"; then
      trust_level="authorized"
      log "  -> AUTHORIZED sender"
    else
      trust_level="external"
      log "  -> EXTERNAL sender (requires review)"
    fi

    # Scan for prompt injection if enabled
    if [[ "$scan_injection" == "true" ]]; then
      # Get email body from already-fetched data
      local body=$(echo "$email" | jq -r '.body // ""')
      if [[ -z "$body" ]]; then body="$snippet"; fi

      if [[ -f "$SCANNER" ]]; then
        injection_result=$(scan_for_injection "$body")
        local is_suspicious=$(echo "$injection_result" | jq -r '.is_suspicious // .suspicious // false')

        if [[ "$is_suspicious" == "true" ]]; then
          status="quarantined"
          trust_level="suspicious"
          local pattern=$(echo "$injection_result" | jq -r '.patterns[0] // "unknown pattern"')
          log "  -> QUARANTINED: Prompt injection detected ($pattern)"
        fi
      fi
    fi

    # Ensure injection_result is valid JSON before state update
    if ! echo "$injection_result" | jq . >/dev/null 2>&1; then
      injection_result='{"is_suspicious":false,"reason":"invalid_scanner_output"}'
    fi

    # Add to state using --arg for all fields (store scan as string to avoid JSON quoting issues)
    local tmp_state=$(mktemp)
    jq --arg mid "$msg_id" \
       --arg efrom "$from" \
       --arg esubject "$subject" \
       --arg edate "$date" \
       --arg esnippet "$snippet" \
       --arg etrust "$trust_level" \
       --arg estatus "$status" \
       --arg escan "$injection_result" \
       --arg enow "$now" \
       '.emails[$mid] = {
         "from": $efrom,
         "subject": $esubject,
         "date": $edate,
         "snippet": $esnippet,
         "trustLevel": $etrust,
         "status": $estatus,
         "injectionScan": ($escan | try fromjson catch {"raw": $escan}),
         "processedAt": $enow
       }' "$STATE_FILE" > "$tmp_state" && mv "$tmp_state" "$STATE_FILE"

    # Mark email as read in Gmail so it's not re-processed
    gog gmail thread modify "$thread_id" --remove UNREAD --account="$account" 2>/dev/null && \
      log "  -> Marked as read" || \
      log "  -> WARN: Failed to mark as read"

    # Update stats
    update_state ".stats.totalProcessed += 1"
    case "$trust_level" in
      authorized) update_state ".stats.authorized += 1" ;;
      suspicious) update_state ".stats.quarantined += 1" ;;
      *) update_state ".stats.flagged += 1" ;;
    esac

  done

  update_state ".lastChecked = \"$now\""
  log "Check complete."
  cmd_summary
}

# List emails
cmd_list() {
  init_state

  local filter="$1"
  local query=".emails | to_entries[]"

  case "$filter" in
    authorized) query="$query | select(.value.trustLevel == \"authorized\")" ;;
    external) query="$query | select(.value.trustLevel == \"external\")" ;;
    quarantined) query="$query | select(.value.status == \"quarantined\")" ;;
    pending) query="$query | select(.value.status == \"pending\")" ;;
    reviewed) query="$query | select(.value.status == \"reviewed\")" ;;
  esac

  echo "Tracked emails${filter:+ ($filter)}:"
  echo ""

  jq -r "$query | \"[\(.value.trustLevel | ascii_upcase)] \(.value.subject) (from: \(.value.from))\"" "$STATE_FILE" 2>/dev/null || echo "No emails found."
}

# Show summary
cmd_summary() {
  init_state

  local total=$(jq '.stats.totalProcessed' "$STATE_FILE")
  local authorized=$(jq '.stats.authorized' "$STATE_FILE")
  local flagged=$(jq '.stats.flagged' "$STATE_FILE")
  local quarantined=$(jq '.stats.quarantined' "$STATE_FILE")
  local pending=$(jq '[.emails | to_entries[] | select(.value.status == "pending")] | length' "$STATE_FILE")

  echo "Summary:"
  echo "  Total processed: $total"
  echo "  From authorized senders: $authorized"
  echo "  From external senders: $flagged"
  echo "  Quarantined (injection): $quarantined"
  echo "  Pending review: $pending"
}

# View email details
cmd_view() {
  local msg_id="$1"

  if [[ -z "$msg_id" ]]; then
    echo "Usage: email-mentions view <message_id>"
    exit 1
  fi

  local email=$(jq -r ".emails[\"$msg_id\"] // empty" "$STATE_FILE")
  if [[ -z "$email" ]]; then
    echo "Email not found: $msg_id"
    exit 1
  fi

  echo "=== Email Details ==="
  jq -r ".emails[\"$msg_id\"] | \"From: \(.from)\nSubject: \(.subject)\nDate: \(.date)\nTrust: \(.trustLevel)\nStatus: \(.status)\n\nSnippet: \(.snippet)\"" "$STATE_FILE"

  # Show injection scan results if suspicious
  local is_suspicious=$(jq -r ".emails[\"$msg_id\"].injectionScan.suspicious // false" "$STATE_FILE")
  if [[ "$is_suspicious" == "true" ]]; then
    echo ""
    echo "=== INJECTION SCAN RESULTS ==="
    jq ".emails[\"$msg_id\"].injectionScan" "$STATE_FILE"
  fi
}

# Mark as reviewed (after human confirmation)
cmd_review() {
  local msg_id="$1"
  local action="${2:-safe}"  # safe or unsafe

  if [[ -z "$msg_id" ]]; then
    echo "Usage: email-mentions review <message_id> [safe|unsafe]"
    exit 1
  fi

  local existing=$(jq -r ".emails[\"$msg_id\"] // empty" "$STATE_FILE")
  if [[ -z "$existing" ]]; then
    echo "Email not found: $msg_id"
    exit 1
  fi

  local now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  update_state ".emails[\"$msg_id\"].status = \"reviewed\" | .emails[\"$msg_id\"].reviewedAt = \"$now\" | .emails[\"$msg_id\"].reviewResult = \"$action\""

  log "Marked $msg_id as reviewed ($action)"
}

# Get pending emails that need attention
cmd_pending() {
  init_state

  echo "Emails pending review:"
  echo ""

  # First show quarantined (highest priority)
  local quarantined=$(jq -r '.emails | to_entries[] | select(.value.status == "quarantined") | "\(.key)\t[QUARANTINED] \(.value.subject) (from: \(.value.from))"' "$STATE_FILE" 2>/dev/null)
  if [[ -n "$quarantined" ]]; then
    echo "=== QUARANTINED (potential injection) ==="
    echo "$quarantined"
    echo ""
  fi

  # Then external senders
  local external=$(jq -r '.emails | to_entries[] | select(.value.status == "pending" and .value.trustLevel == "external") | "\(.key)\t[EXTERNAL] \(.value.subject) (from: \(.value.from))"' "$STATE_FILE" 2>/dev/null)
  if [[ -n "$external" ]]; then
    echo "=== EXTERNAL SENDERS ==="
    echo "$external"
    echo ""
  fi

  # Finally authorized (just FYI)
  local authorized=$(jq -r '.emails | to_entries[] | select(.value.status == "pending" and .value.trustLevel == "authorized") | "\(.key)\t[AUTHORIZED] \(.value.subject) (from: \(.value.from))"' "$STATE_FILE" 2>/dev/null)
  if [[ -n "$authorized" ]]; then
    echo "=== FROM AUTHORIZED SENDERS ==="
    echo "$authorized"
  fi
}

# Show/set config
cmd_config() {
  init_config

  if [[ -z "$1" ]]; then
    echo "Current configuration:"
    jq '.' "$CONFIG_FILE"
    echo ""
    echo "Usage:"
    echo "  email-mentions config                            Show current config"
    echo "  email-mentions config account <email>            Set Gmail account"
    echo "  email-mentions config addSender <email>          Add authorized sender"
    echo "  email-mentions config removeSender <email>       Remove authorized sender"
    echo "  email-mentions config scanForInjection true      Enable injection scanning"
    return
  fi

  local key="$1"
  local value="$2"

  case "$key" in
    addSender)
      if [[ -z "$value" ]]; then
        echo "Usage: email-mentions config addSender <email>"
        exit 1
      fi
      local tmp=$(mktemp)
      jq ".authorizedSenders += [\"$value\"] | .authorizedSenders |= unique" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
      echo "Added $value to authorized senders"
      ;;
    removeSender)
      if [[ -z "$value" ]]; then
        echo "Usage: email-mentions config removeSender <email>"
        exit 1
      fi
      local tmp=$(mktemp)
      jq ".authorizedSenders -= [\"$value\"]" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
      echo "Removed $value from authorized senders"
      ;;
    *)
      if [[ -z "$value" ]]; then
        get_config ".$key"
      else
        local tmp=$(mktemp)
        if [[ "$value" == "true" || "$value" == "false" ]]; then
          jq ".$key = $value" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
        elif [[ "$value" =~ ^[0-9]+$ ]]; then
          jq ".$key = $value" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
        else
          jq ".$key = \"$value\"" "$CONFIG_FILE" > "$tmp" && mv "$tmp" "$CONFIG_FILE"
        fi
        echo "Set $key = $value"
      fi
      ;;
  esac
}

# Reset state
cmd_reset() {
  cat > "$STATE_FILE" << 'EOF'
{
  "lastChecked": null,
  "lastMessageId": null,
  "emails": {},
  "stats": {
    "totalProcessed": 0,
    "authorized": 0,
    "flagged": 0,
    "quarantined": 0
  }
}
EOF
  log "State reset. All tracked emails cleared."
}

# Main command dispatcher
case "${1:-}" in
  check)
    cmd_check
    ;;
  list)
    cmd_list "$2"
    ;;
  pending)
    cmd_pending
    ;;
  summary)
    cmd_summary
    ;;
  view)
    cmd_view "$2"
    ;;
  review)
    cmd_review "$2" "$3"
    ;;
  config)
    cmd_config "$2" "$3"
    ;;
  reset)
    cmd_reset
    ;;
  *)
    echo "email-mentions: Monitor emails with security scanning"
    echo ""
    echo "Commands:"
    echo "  check              Check for new emails"
    echo "  list [filter]      List emails (filter: authorized|external|quarantined|pending|reviewed)"
    echo "  pending            Show emails needing attention"
    echo "  summary            Show email counts by status"
    echo "  view <id>          View email details"
    echo "  review <id> [safe|unsafe]  Mark email as reviewed"
    echo "  config [key] [val] Show/set configuration"
    echo "  reset              Clear all tracked emails"
    echo ""
    echo "Security features:"
    echo "  - Authorized senders bypass review (configurable)"
    echo "  - External emails flagged for review"
    echo "  - Prompt injection scanning (quarantines suspicious emails)"
    echo "  - Never auto-executes commands from emails"
    echo ""
    echo "Add to cron for periodic checking:"
    echo "  */15 * * * * $0 check >> $LOG_FILE 2>&1"
    ;;
esac
