---
name: markdown-new
description: Convert any URL to clean markdown using markdown.new (Cloudflare's text/markdown service). Use when fetching web content for AI processing, reducing tokens by ~80% vs raw HTML. Ideal for RAG pipelines, web summarization, content extraction, or any task needing clean text from URLs. Supports JS-heavy pages via browser rendering fallback.
---

# markdown.new - URL to Markdown Converter

Convert any URL to clean, AI-friendly markdown using Cloudflare's native `text/markdown` content type.

## Quick Usage

### Via web_fetch (simplest)
```bash
# Basic conversion
web_fetch("https://markdown.new/https://example.com")

# With options
web_fetch("https://markdown.new/https://example.com?method=browser&retain_images=true")
```

### Via curl/script
```bash
# GET request (prepend URL)
curl -s "https://markdown.new/https://example.com"

# POST request with options
curl -s 'https://markdown.new/' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "method": "browser", "retain_images": true}'
```

### Via included script
```bash
# Basic
./scripts/fetch.sh https://example.com

# With browser rendering (for JS-heavy sites)
./scripts/fetch.sh https://example.com browser

# Keep images
./scripts/fetch.sh https://example.com auto true
```

## Options

| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `method` | `auto`, `ai`, `browser` | `auto` | Conversion method |
| `retain_images` | `true`, `false` | `false` | Keep image references |

### Method Selection

- **auto**: Try native markdown first, fallback to AI, then browser
- **ai**: Force Workers AI conversion (good for most sites)
- **browser**: Force headless browser (required for JS-heavy SPAs)

## Response

Returns clean markdown with metadata header:

```
---
title: Page Title
---

# Content here...
```

Token count available in `x-markdown-tokens` response header.

## When to Use Browser Mode

Use `method=browser` for:
- Single-page applications (React, Vue, Angular)
- Sites with heavy JavaScript rendering
- Dynamic content loaded after page load
- Sites that block simple fetches

## Integration Tips

1. **For web_fetch**: Just prepend `https://markdown.new/` to target URL
2. **For agent-browser**: Use the script or curl for more control
3. **Token budget**: Check `x-markdown-tokens` header to estimate costs
4. **Images**: Only enable `retain_images` if you need image URLs in output
