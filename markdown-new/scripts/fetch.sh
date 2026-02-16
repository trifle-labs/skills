#!/bin/bash
# Fetch URL as markdown via markdown.new
# Usage: fetch.sh <url> [method] [retain_images]
#   method: auto (default), ai, browser
#   retain_images: false (default), true

set -e

URL="${1:?Usage: fetch.sh <url> [method] [retain_images]}"
METHOD="${2:-auto}"
RETAIN_IMAGES="${3:-false}"

# Build query string
QUERY=""
[[ "$METHOD" != "auto" ]] && QUERY="method=$METHOD"
[[ "$RETAIN_IMAGES" == "true" ]] && {
  [[ -n "$QUERY" ]] && QUERY="$QUERY&"
  QUERY="${QUERY}retain_images=true"
}

# Construct full URL
FULL_URL="https://markdown.new/$URL"
[[ -n "$QUERY" ]] && FULL_URL="$FULL_URL?$QUERY"

# Fetch and output
curl -sS "$FULL_URL"
