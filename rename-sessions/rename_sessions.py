#!/usr/bin/env python3
"""Bulk rename Claude Code sessions by generating titles from first user message."""

import json
import os
import re
import glob

PROJECTS_DIR = os.path.expanduser("~/.claude/projects")
MAX_TITLE_LEN = 60


def clean_text(text):
    """Strip HTML/XML tags and clean up text."""
    # Remove XML/HTML tags
    text = re.sub(r'<[^>]+>', ' ', text)
    # Remove markdown artifacts
    text = re.sub(r'```[\s\S]*?```', ' ', text)
    text = re.sub(r'`[^`]+`', ' ', text)
    # Remove URLs
    text = re.sub(r'https?://\S+', '', text)
    # Remove file paths that are very long
    text = re.sub(r'/[\w/\-\.]{40,}', '', text)
    # Collapse whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def generate_title(content):
    """Generate a concise title from user message content."""
    text = clean_text(content)
    if len(text) < 5:
        return None

    # Take first sentence or first ~100 chars
    # Split on sentence boundaries
    sentences = re.split(r'[.!?\n]', text)
    first_sentence = ""
    for s in sentences:
        s = s.strip()
        if len(s) >= 10:
            first_sentence = s
            break

    if not first_sentence:
        first_sentence = text[:100]

    # Truncate to max length
    title = first_sentence[:MAX_TITLE_LEN]

    # If we truncated mid-word, cut to last space
    if len(first_sentence) > MAX_TITLE_LEN and ' ' in title:
        title = title[:title.rfind(' ')]

    # Clean up trailing punctuation/spaces
    title = title.strip(' ,-:;')

    # Capitalize first letter
    if title:
        title = title[0].upper() + title[1:]

    return title if len(title) >= 5 else None


def has_custom_title(filepath):
    """Check if session already has a custom-title entry."""
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if '"custom-title"' in line:
                return True
    return False


def find_first_user_message(filepath):
    """Find the first meaningful user message in a session."""
    with open(filepath, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            if obj.get('type') != 'user':
                continue

            msg = obj.get('message', {})
            if msg.get('role') != 'user':
                continue

            content = msg.get('content', '')
            if isinstance(content, list):
                # Handle structured content (text blocks)
                parts = []
                for block in content:
                    if isinstance(block, dict) and block.get('type') == 'text':
                        parts.append(block.get('text', ''))
                    elif isinstance(block, str):
                        parts.append(block)
                content = ' '.join(parts)

            if not isinstance(content, str):
                continue

            # Skip meta messages, commands, and short content
            if '<local-command' in content:
                continue
            if '<command-name>' in content:
                continue
            if obj.get('isMeta'):
                continue
            if len(content.strip()) < 10:
                continue

            return content

    return None


def get_session_id(filepath):
    """Extract session ID from filename."""
    return os.path.splitext(os.path.basename(filepath))[0]


def main():
    renamed = 0
    skipped_has_title = 0
    skipped_no_content = 0
    skipped_no_title = 0

    # Find all session JSONL files (not in subagents directories)
    pattern = os.path.join(PROJECTS_DIR, "*", "*.jsonl")
    session_files = sorted(glob.glob(pattern))

    print(f"Found {len(session_files)} session files across all projects\n")

    for filepath in session_files:
        # Skip subagent files (shouldn't match but be safe)
        if '/subagents/' in filepath:
            continue

        session_id = get_session_id(filepath)
        project = os.path.basename(os.path.dirname(filepath))

        # Check for existing custom title
        if has_custom_title(filepath):
            skipped_has_title += 1
            continue

        # Find first meaningful user message
        content = find_first_user_message(filepath)
        if not content:
            skipped_no_content += 1
            continue

        # Generate title
        title = generate_title(content)
        if not title:
            skipped_no_title += 1
            continue

        # Append custom-title entry
        entry = json.dumps({
            "type": "custom-title",
            "customTitle": title,
            "sessionId": session_id
        })

        with open(filepath, 'a') as f:
            f.write('\n' + entry)

        short_project = project.replace('-Users-billy-GitHub-', '')
        print(f"  [{short_project}] {session_id[:8]}... -> \"{title}\"")
        renamed += 1

    print(f"\n--- Summary ---")
    print(f"Renamed:              {renamed}")
    print(f"Already had title:    {skipped_has_title}")
    print(f"No user content:      {skipped_no_content}")
    print(f"Could not gen title:  {skipped_no_title}")


if __name__ == "__main__":
    main()
