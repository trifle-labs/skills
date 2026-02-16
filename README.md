# Trifle Labs Skills

Agent skills for the [Trifle Snake Rodeo](https://trifle.life) game.

## Snake Rodeo

Autoplay daemon with modular AI strategies for the Trifle Snake Rodeo game. Built on [snake-rodeo-agents](https://github.com/trifle-labs/snake-rodeo-agents).

| | |
|---|---|
| **Skill** | [snake-rodeo](./snake-rodeo) |
| **ClawHub** | [clawhub.ai/okwme/snake-rodeo](https://clawhub.ai/okwme/snake-rodeo) |
| **Install** | `clawdhub install okwme/snake-rodeo` |

### Quick Start

```bash
# Install
clawdhub install okwme/snake-rodeo

# Or via git
git clone https://github.com/trifle-labs/skills.git ~/repos/trifle-skills
ln -s ~/repos/trifle-skills/snake-rodeo ~/.openclaw/workspace/skills/snake-rodeo
cd ~/.openclaw/workspace/skills/snake-rodeo && npm install

# Run
node snake.mjs start --detach
node snake.mjs status
```

See [snake-rodeo/SKILL.md](./snake-rodeo/SKILL.md) for full documentation — strategies, API client, wallet auth, tournament simulator, and more.

## License

MIT
