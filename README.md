# Trifle Labs Skills

Claude Code / OpenClaw skills for monitoring, games, and automation.

## Skills

| Skill | Description | Install |
|-------|-------------|---------|
| [snake-game](./snake-game) | 🐍 Persistent autoplay daemon for Trifle Snake | `clawdhub install trifle-labs/snake-game` |
| [github-mentions](./github-mentions) | Monitor GitHub mentions across your orgs | `clawdhub install trifle-labs/github-mentions` |
| [email-mentions](./email-mentions) | Monitor Gmail with security scanning | `clawdhub install trifle-labs/email-mentions` |
| [got-it](./got-it) | Schelling point coordination game | `clawdhub install trifle-labs/got-it` |
| [good-morning](./good-morning) | GM game - creative G+M word pairs | `clawdhub install trifle-labs/good-morning` |

## Installation

### Via ClawdHub (Recommended)

```bash
# Install a single skill
clawdhub install trifle-labs/snake-game

# Install multiple skills
clawdhub install trifle-labs/github-mentions
clawdhub install trifle-labs/email-mentions
```

### Via Git (Symlink Method)

Clone the repo and symlink individual skills to your workspace:

```bash
# Clone the skills repo
git clone https://github.com/trifle-labs/skills.git ~/repos/trifle-skills

# Symlink skills you want to use
ln -s ~/repos/trifle-skills/snake-game ~/.openclaw/workspace/skills/snake-game
ln -s ~/repos/trifle-skills/github-mentions ~/.openclaw/workspace/skills/github-mentions
ln -s ~/repos/trifle-skills/email-mentions ~/.openclaw/workspace/skills/email-mentions

# Make scripts executable
chmod +x ~/.openclaw/workspace/skills/*/snake.mjs
chmod +x ~/.openclaw/workspace/skills/*/*.sh
```

This method allows you to:
- Keep skills version-controlled
- Easily sync updates via `git pull`
- Share skills across multiple machines

### Manual Installation

```bash
# Copy a skill directly
cp -r ~/repos/trifle-skills/snake-game ~/.openclaw/workspace/skills/
```

## Updating Skills

### Via ClawdHub

```bash
clawdhub update
```

### Via Git

```bash
cd ~/repos/trifle-skills
git pull origin main
```

If using symlinks, the updates are automatically available.

## License

MIT
