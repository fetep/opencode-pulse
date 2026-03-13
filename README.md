# pulse

Check the pulse of your OpenCode sessions. A TUI that shows which sessions need your input, sorted by urgency — permission requests, errors, retries — so you can jump straight to what matters.

## Quick Start

```bash
cd tui-ts && bun install && bun run src/cli.tsx
```

## Setup

### 1. Build the Plugin

```bash
cd plugin && bun install && bun build src/index.ts --outdir dist --target bun --format esm
```

### 2. Add Plugin to OpenCode

Edit `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "/path/to/opencode-whatsup/plugin"
  ]
}
```

### 3. Restart OpenCode

The plugin creates `~/.local/share/opencode-pulse/status.db` and starts tracking sessions automatically.

### 4. Run pulse

```bash
cd tui-ts && bun run src/cli.tsx

# Or install globally
cd tui-ts && bun link
pulse
```

## Keybinds

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | Attach to selected session's tmux pane |
| `q` / `Ctrl+C` | Quit |

## How It Works

Two components connected by SQLite:

- **Plugin** (`plugin/`) — OpenCode plugin that listens for session events and writes status to SQLite
- **TUI** (`tui-ts/`) — Reads SQLite every 2s, displays sessions sorted by attention priority

Sessions are sorted: ⏳ permission pending → ✗ error → ↻ retry → ● idle → ◦ busy

Stale sessions (no heartbeat >30s) are grayed out with a `?` icon.

## Troubleshooting

**DB location:** `~/.local/share/opencode-pulse/status.db` (override with `PULSE_DB_PATH`)

**Plugin not loading?** Check `~/.local/share/opencode/log/` for errors.

**No sessions?** Ensure plugin is in your `opencode.json` and OpenCode was restarted.
