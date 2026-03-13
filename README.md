# pulse

Check the pulse of your OpenCode sessions. A one-shot TUI that shows which sessions need your input, sorted by urgency — permission requests, questions, errors, retries — so you can jump straight to what matters.

Select a session and pulse attaches you to it, then exits.

## Install

> **Requires [Bun](https://bun.sh)**

### 1. Enable the plugin

Add `opencode-pulse` to your OpenCode config (`~/.config/opencode/opencode.json`):

```jsonc
{
  "plugin": ["opencode-pulse"]
}
```

Restart OpenCode. The plugin is installed automatically and begins tracking sessions.

### 2. Run the TUI

```bash
bunx --bun opencode-pulse
```

Or install globally for a persistent `pulse` command:

```bash
bun add -g opencode-pulse
pulse
```

<details>
<summary>npx</summary>

```bash
npx opencode-pulse
```

Bun must be installed — pulse uses `bun:sqlite` for database access.
</details>

### From source

```bash
git clone https://github.com/fetep/opencode-pulse
cd opencode-pulse

# Build the plugin
cd plugin && bun install && bun run build

# Register the local plugin in ~/.config/opencode/opencode.json:
#   { "plugin": ["/path/to/opencode-pulse/plugin"] }
# Restart OpenCode.

# Run the TUI
cd ../tui-ts && bun install && bun run start

# Or link globally
cd ../tui-ts && bun link
pulse
```

## Usage

```
pulse [options]

Options:
  -c, --columns <cols>  Comma-separated columns (default: status,tmux,todo,updated,age,title)
  -h, --help            Show help
```

### Columns

Choose which columns to display with `--columns`. The default set balances information density with readability.

| Column    | Description                                    |
|-----------|------------------------------------------------|
| `status`  | Session status with icon (▲ Permission, ? Question, ✗ Error, ↻ Retry, ● Idle, ◦ Busy) |
| `project` | Project directory name                         |
| `title`   | Session title or task description               |
| `todo`    | Todo progress bar with done/total count        |
| `updated` | Time since last update                         |
| `age`     | Time since session was created                 |
| `pid`     | OpenCode process ID                            |
| `session` | Session ID                                     |
| `version` | OpenCode version                               |
| `tmux`    | Tmux target pane                               |
| `message` | Error or retry message (contextual)            |

Default: `status,tmux,todo,updated,age,title`

Examples:

```bash
pulse                                           # default columns
pulse --columns status,project,title,updated    # skip progress bar
pulse -c status,project,todo,message            # show error/retry messages
pulse -c status,project,pid,version,tmux        # debugging view
```

## Keybinds

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | Attach to selected session's tmux pane and exit |
| `q` / `Ctrl+C` | Quit |

## Themes

Pulse auto-detects your OpenCode theme and matches its colors. Override with `PULSE_THEME`:

```bash
PULSE_THEME=catppuccin pulse
```

## How It Works

Two components connected by SQLite:

- **Plugin** (`plugin/`) — OpenCode plugin that listens for session events and writes status to SQLite
- **TUI** (`tui-ts/`) — Reads SQLite, displays sessions sorted by attention priority

Sessions are sorted: ▲ permission pending → ? question → ✗ error → ↻ retry → ● idle → ◦ busy

## Troubleshooting

**DB location:** `~/.local/share/opencode-pulse/status.db` (override with `PULSE_DB_PATH`)

**Plugin not loading?** Check `~/.local/share/opencode/log/` for errors.

**No sessions?** Ensure plugin is in your `opencode.json` and OpenCode was restarted.
