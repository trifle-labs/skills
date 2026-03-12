#!/usr/bin/env python3
"""Bulk rename Claude Code sessions with semantic titles.

Uses a tiered approach:
1. Compact summaries (from auto-compaction) - best signal, already a rich summary
2. Git branch name + first user messages - combined context
3. First user message only - fallback

For tiers that need summarization, shells out to `claude -p` with haiku
to generate a concise title. Uses concurrent workers for speed.

Usage:
    python3 rename_sessions.py              # rename all untitled sessions
    python3 rename_sessions.py --dry-run    # preview without writing
    python3 rename_sessions.py --limit 5    # only process first 5 untitled sessions
    python3 rename_sessions.py --workers 8  # use 8 concurrent claude calls (default: 5)
    python3 rename_sessions.py --heuristic-only  # never call claude -p; use heuristic titles only
"""

import argparse
import json
import os
import re
import glob
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
MAX_TITLE_LEN = 60

# Build a clean env for subprocess calls (remove Claude nesting guards)
CLEAN_ENV = {k: v for k, v in os.environ.items()
             if k not in ('CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT')}

# Resolve claude CLI path
CLAUDE_BIN = None
for candidate in [
    os.path.expanduser("~/.claude/local/claude"),
    "/usr/local/bin/claude",
]:
    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        CLAUDE_BIN = candidate
        break
if not CLAUDE_BIN:
    CLAUDE_BIN = shutil.which('claude')


def extract_message_content(obj):
    """Extract text content from a user or assistant message entry."""
    msg = obj.get('message', {})
    content = msg.get('content', '')
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get('type') == 'text':
                parts.append(block.get('text', ''))
            elif isinstance(block, str):
                parts.append(block)
        content = ' '.join(parts)
    return content if isinstance(content, str) else ''


def is_skip_message(obj, content):
    """Check if a message should be skipped (meta, commands, short)."""
    if obj.get('isMeta'):
        return True
    if obj.get('isCompactSummary'):
        return True
    if '<local-command' in content or '<command-name>' in content:
        return True
    if len(content.strip()) < 10:
        return True
    if content.strip().startswith('[Request interrupted'):
        return True
    return False


def clean_for_prompt(text, max_chars=2000):
    """Clean text for use in a claude prompt."""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'```[\s\S]*?```', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:max_chars]


def parse_session(filepath):
    """Parse a session file and extract all useful signals."""
    compact_summary = None
    git_branch = None
    user_messages = []
    assistant_messages = []
    has_title = False

    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = obj.get('type', '')

                if entry_type == 'custom-title':
                    has_title = True
                    break

                if not git_branch and obj.get('gitBranch'):
                    git_branch = obj['gitBranch']

                if obj.get('isCompactSummary'):
                    compact_summary = extract_message_content(obj)
                    continue

                if entry_type == 'user':
                    msg = obj.get('message', {})
                    if msg.get('role') == 'user':
                        content = extract_message_content(obj)
                        if not is_skip_message(obj, content):
                            user_messages.append(content)

                if entry_type == 'assistant' and len(assistant_messages) < 2:
                    content = extract_message_content(obj)
                    if content.strip() and len(content.strip()) > 20:
                        assistant_messages.append(content)
    except (OSError, UnicodeDecodeError) as e:
        print(f"Warning: failed to read session file {filepath}: {e}", file=sys.stderr)
        return {
            'compact_summary': None,
            'git_branch': None,
            'user_messages': [],
            'assistant_messages': [],
            'has_title': False,
        }

    return {
        'has_title': has_title,
        'compact_summary': compact_summary,
        'git_branch': git_branch,
        'user_messages': user_messages[:5],
        'assistant_messages': assistant_messages,
    }


def generate_title_via_claude(context_text):
    """Use claude CLI to generate a concise session title."""
    if not CLAUDE_BIN:
        return None

    prompt = (
        "Generate a concise title (under 50 characters) for this Claude Code "
        "session based on the context below. The title should capture the main "
        "topic or task. Output ONLY the title, nothing else.\n\n"
        f"Context:\n{context_text}"
    )

    try:
        result = subprocess.run(
            [CLAUDE_BIN, '-p', '--model', 'haiku', '--no-session-persistence'],
            input=prompt,
            capture_output=True,
            text=True,
            timeout=30,
            env=CLEAN_ENV,
        )
        if result.returncode == 0:
            title = result.stdout.strip().strip('"\'')
            if '\n' in title:
                title = title.split('\n')[0].strip()
            if 5 <= len(title) <= MAX_TITLE_LEN:
                return title
            elif len(title) > MAX_TITLE_LEN:
                title = title[:MAX_TITLE_LEN]
                if ' ' in title:
                    title = title[:title.rfind(' ')]
                return title
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"    Warning: claude CLI failed: {e}", file=sys.stderr)
    return None


def build_context(parsed):
    """Build context string from parsed session data for title generation."""
    parts = []

    if parsed['compact_summary']:
        parts.append(f"Session summary:\n{clean_for_prompt(parsed['compact_summary'], 1500)}")
    else:
        for i, msg in enumerate(parsed['user_messages'][:3]):
            parts.append(f"User message {i+1}:\n{clean_for_prompt(msg, 500)}")
        for i, msg in enumerate(parsed['assistant_messages'][:1]):
            parts.append(f"Assistant response:\n{clean_for_prompt(msg, 500)}")

    if parsed['git_branch'] and parsed['git_branch'] not in ('main', 'master'):
        parts.append(f"Git branch: {parsed['git_branch']}")

    return '\n\n'.join(parts)


def fallback_title(content):
    """Simple heuristic title as last resort (no LLM)."""
    text = clean_for_prompt(content, 200)
    if len(text) < 5:
        return None

    sentences = re.split(r'[.!?\n]', text)
    for s in sentences:
        s = s.strip()
        if len(s) >= 10:
            title = s[:MAX_TITLE_LEN]
            if len(s) > MAX_TITLE_LEN and ' ' in title:
                title = title[:title.rfind(' ')]
            title = title.strip(' ,-:;')
            if title:
                title = title[0].upper() + title[1:]
                return title
    return None


def get_session_id(filepath):
    """Extract session ID from filename."""
    return os.path.splitext(os.path.basename(filepath))[0]


def process_session(filepath, dry_run=False, heuristic_only=False, parsed=None):
    """Process a single session file. Returns (short_project, session_id, title, source) or None."""
    session_id = get_session_id(filepath)
    project = os.path.basename(os.path.dirname(filepath))
    short_project = re.sub(r'^-Users-\w+-GitHub-', '', project)
    short_project = re.sub(r'^-Users-\w+-', '~/', short_project)

    if parsed is None:
        parsed = parse_session(filepath)

    if parsed['has_title']:
        return ('skip_title', short_project, session_id, None, None)

    if not parsed['user_messages'] and not parsed['compact_summary']:
        return ('skip_empty', short_project, session_id, None, None)

    # Try LLM title generation
    context = build_context(parsed)
    title = None
    source = None

    if context and not heuristic_only:
        title = generate_title_via_claude(context)
        if title:
            source = "compact" if parsed['compact_summary'] else "llm"

    # Fallback to heuristic
    if not title and parsed['user_messages']:
        title = fallback_title(parsed['user_messages'][0])
        if title:
            source = "heuristic"

    if not title:
        return ('failed', short_project, session_id, None, None)

    # Write the title
    if not dry_run:
        entry = json.dumps({
            "type": "custom-title",
            "customTitle": title,
            "sessionId": session_id
        })
        with open(filepath, 'a') as f:
            f.write('\n' + entry)

    return ('renamed', short_project, session_id, title, source)


def positive_int(value):
    """Validate that value is a positive integer."""
    try:
        ivalue = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError(f"{value!r} is not an integer")
    if ivalue <= 0:
        raise argparse.ArgumentTypeError(f"{value} must be a positive integer")
    return ivalue


def parse_args():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Bulk rename Claude Code sessions with semantic titles."
    )
    parser.add_argument('--dry-run', action='store_true',
                        help="Preview renames without writing any files")
    parser.add_argument('--workers', type=positive_int, default=5, metavar='N',
                        help="Number of concurrent claude calls (default: 5)")
    parser.add_argument('--limit', type=positive_int, default=None, metavar='N',
                        help="Only process the first N untitled sessions")
    parser.add_argument('--heuristic-only', action='store_true',
                        help="Never call 'claude -p'; use heuristic titles only")
    args = parser.parse_args()
    return args.dry_run, args.workers, args.limit, args.heuristic_only


def main():
    dry_run, workers, limit, heuristic_only = parse_args()

    if dry_run:
        print("=== DRY RUN (no files will be modified) ===\n")

    if heuristic_only:
        print("Heuristic-only mode: claude -p will not be called")
    elif CLAUDE_BIN:
        print(f"Using claude CLI: {CLAUDE_BIN}")
        print(f"Concurrent workers: {workers}")
    else:
        print("Claude CLI not found - using heuristic titles only")
    print()

    pattern = os.path.join(PROJECTS_DIR, "*", "*.jsonl")
    session_files = sorted(glob.glob(pattern))
    session_files = [f for f in session_files if '/subagents/' not in f]

    print(f"Found {len(session_files)} session files across all projects\n")

    # Pre-filter to find sessions that need renaming (fast, no LLM calls).
    # Cache parsed results to avoid re-reading files in worker threads.
    to_process = []
    parsed_cache = {}
    skipped_has_title = 0
    skipped_no_content = 0

    for filepath in session_files:
        parsed = parse_session(filepath)
        if parsed['has_title']:
            skipped_has_title += 1
        elif not parsed['user_messages'] and not parsed['compact_summary']:
            skipped_no_content += 1
        else:
            to_process.append(filepath)
            parsed_cache[filepath] = parsed

    if limit:
        to_process = to_process[:limit]

    print(f"Sessions to rename: {len(to_process)}")
    print(f"Already titled: {skipped_has_title}")
    print(f"No content: {skipped_no_content}")
    print()

    if not to_process:
        print("Nothing to do!")
        return

    # Process sessions concurrently
    renamed_llm = 0
    renamed_fallback = 0
    failed = 0

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(process_session, fp, dry_run, heuristic_only, parsed_cache.get(fp)): fp
            for fp in to_process
        }

        for future in as_completed(futures):
            result = future.result()
            status, short_project, session_id, title, source = result

            if status == 'renamed':
                if source == 'heuristic':
                    renamed_fallback += 1
                else:
                    renamed_llm += 1
                print(f"  [{short_project}] {session_id[:8]}... -> \"{title}\" ({source})")
            elif status == 'failed':
                failed += 1
                print(f"  [{short_project}] {session_id[:8]}... -> FAILED")

    print(f"\n--- Summary ---")
    print(f"Renamed (LLM):        {renamed_llm}")
    print(f"Renamed (heuristic):  {renamed_fallback}")
    print(f"Already had title:    {skipped_has_title}")
    print(f"No user content:      {skipped_no_content}")
    print(f"Failed:               {failed}")


if __name__ == "__main__":
    main()
