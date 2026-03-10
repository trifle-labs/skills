---
name: rename-sessions
description: Bulk rename Claude Code sessions with descriptive titles by reading session JSONL files and appending custom-title entries. Scans ALL project directories. Use when you want to organize and label past conversations.
version: 1.1.0
metadata:
  clawdhub:
    emoji: "🏷️"
---

# Rename Claude Code Sessions

Bulk rename Claude Code sessions with descriptive titles derived from conversation content. Scans all project directories in `~/.claude/projects/`.

## How It Works

Claude Code stores sessions as JSONL files in the project directory:

```
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
```

Each JSONL file contains message entries with types like `user`, `assistant`, `system`, `progress`, etc. Session names are stored as entries with `type: "custom-title"`:

```json
{"type": "custom-title", "customTitle": "My descriptive name", "sessionId": "<uuid>"}
```

Appending a `custom-title` entry to a session's JSONL file is equivalent to using `/rename` interactively.

## Steps

### 1. Run the Rename Script

Run `rename_sessions.py` to scan all project directories and rename untitled sessions:

```bash
python3 rename_sessions.py
```

The script automatically:
- Scans ALL project directories in `~/.claude/projects/`
- Skips sessions that already have a custom title
- Skips sessions with no meaningful user content (e.g., just `/clear` or meta commands)
- Extracts the first meaningful user message from each session
- Generates a concise title (under 60 chars) by cleaning and truncating the first sentence
- Appends a `custom-title` entry to the session's JSONL file
- Reports what was renamed and what was skipped

### 2. Verify

Run `/resume` in Claude Code to see the updated session names in the picker.

## How Title Generation Works

The script extracts the first real user message (skipping commands, meta/XML wrappers, and short content), then:

1. Strips HTML/XML tags, markdown code blocks, URLs, and long file paths
2. Splits on sentence boundaries and takes the first sentence ≥ 10 chars
3. Truncates to 60 chars at a word boundary
4. Capitalizes the first letter

Examples:
| Content | Generated Title |
|---|---|
| "fix the leaderboard query, it's too slow" | Fix the leaderboard query, it's too slow |
| "add solana wallet authentication" | Add solana wallet authentication |
| "figure out why this snake game error happened" | Figure out why this snake game error happened |
| "review PR #291 comments" | Review PR #291 comments |

## Manual Renaming

To rename a single session manually, append a `custom-title` entry:

```python
import json

def rename_session(jsonl_path, session_id, title):
    entry = json.dumps({
        "type": "custom-title",
        "customTitle": title,
        "sessionId": session_id
    })
    with open(jsonl_path, "a") as fh:
        fh.write("\n" + entry)
```

## JSONL Entry Types Reference

| Type | Purpose | Key Fields |
|---|---|---|
| `user` | User message | `message.role`, `message.content` |
| `assistant` | Assistant response | `message.role`, `message.content` |
| `system` | System message | `slug`, `subtype` |
| `custom-title` | Session name (via `/rename`) | `customTitle`, `sessionId` |
| `last-prompt` | Last user prompt | `lastPrompt`, `sessionId` |
| `tag` | Session tag | `tag`, `sessionId` |
| `pr-link` | Linked PR | `prNumber`, `prUrl`, `prRepository` |
| `progress` | Tool progress | `data`, `toolUseID` |
| `file-history-snapshot` | File state snapshot | `snapshot` |

## Notes

- The encoded project path replaces `/` with `-` (e.g., `/Users/billy/GitHub/my-project` becomes `-Users-billy-GitHub-my-project`)
- Session directories (same UUID, no `.jsonl` extension) contain `subagents/` and `tool-results/` subdirectories — these are not the session transcript
- Multiple `custom-title` entries can exist; the last one wins
- Empty or minimal sessions (just `/clear` with no real content) are automatically skipped
