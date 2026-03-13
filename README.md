# pulse

Check the pulse of your OpenCode sessions. A terminal UI that shows which sessions need your input, sorted by urgency — permission requests, questions, errors, retries — so you can jump straight to what matters.

Select a session and pulse attaches you to its tmux pane, then exits.

## Install

> **Requires [Bun](https://bun.sh)**

### 1. Enable the plugin

Add `opencode-pulse` to your OpenCode config (`~/.config/opencode/opencode.json` or `~/.config/opencode/opencode.jsonc`):

```jsonc
{
  "plugin": ["opencode-pulse@latest"]
}
```

Restart OpenCode. The plugin installs automatically and begins tracking sessions.

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

## Usage

```
pulse [options]

Options:
  -c, --columns <cols>  Comma-separated columns (default: status,tmux,todo,updated,age,title)
  -h, --help            Show help
```

### Keybinds

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | Attach to selected session's tmux pane and exit |
| `q` / `Ctrl+C` | Quit |

Navigation wraps — pressing up on the first item selects the last.

### Tmux Popup

Add this to your `~/.tmux.conf` to pop up pulse with `prefix + P`:

```tmux
bind-key P display-popup -E -w 90% -h 50% 'bunx --bun opencode-pulse'
```

Select a session and pulse switches you there, closing the popup automatically.

### Status Priority

Sessions are sorted by what needs attention most:

| Icon | Status | Meaning |
|------|--------|---------|
| ▲ | Permission | Waiting for permission approval |
| ? | Question | Waiting for your answer |
| ✗ | Error | Session hit an error |
| ↻ | Retry | Retrying after a failure |
| ● | Idle | Ready for input |
| ◦ | Busy | Working |

### Columns

Choose which columns to display with `--columns`. The default set balances information density with readability.

| Column    | Description                                    |
|-----------|------------------------------------------------|
| `status`  | Status icon and label                          |
| `project` | Project directory name                         |
| `title`   | Session title or task description               |
| `todo`    | Todo progress bar with done/total count        |
| `updated` | Time since last update                         |
| `age`     | Time since session was created                 |
| `pid`     | OpenCode process ID                            |
| `session` | Session ID                                     |
| `version` | OpenCode version                               |
| `tmux`    | Tmux session name                              |
| `message` | Error or retry message (contextual)            |

Default: `status,tmux,todo,updated,age,title`

```bash
pulse                                           # default columns
pulse --columns status,project,title,updated    # compact view
pulse -c status,project,todo,message            # show error/retry messages
pulse -c status,project,pid,version,tmux        # debugging view
```

### Themes

Pulse auto-detects your OpenCode theme and matches its colors. Override with `PULSE_THEME`:

```bash
PULSE_THEME=catppuccin pulse
```

Available themes: `aura`, `ayu`, `carbonfox`, `catppuccin`, `catppuccin-frappe`, `catppuccin-macchiato`, `cobalt2`, `cursor`, `dracula`, `everforest`, `flexoki`, `github`, `gruvbox`, `kanagawa`, `lucent-orng`, `material`, `matrix`, `mercury`, `monokai`, `nightowl`, `nord`, `one-dark`, `opencode` *(default)*, `orng`, `osaka-jade`, `palenight`, `rosepine`, `solarized`, `synthwave84`, `tokyonight`, `vercel`, `vesper`, `zenburn`

## Troubleshooting

**DB location:** `~/.local/share/opencode-pulse/status.db` (override with `PULSE_DB_PATH`)

**Plugin not loading?** Check `~/.local/share/opencode/log/` for errors.

**No sessions?** Ensure plugin is in your `opencode.json` and OpenCode was restarted.

**Stale sessions showing?** Pulse automatically cleans up sessions whose OpenCode process has exited. Dead processes are removed on startup and every 60 seconds.

**Debug log:** The plugin logs all received events to `~/.local/share/opencode-pulse/debug.log`. Check this to verify the plugin is receiving events from OpenCode.

## How It Works

Two components connected by SQLite:

- **Plugin** (`plugin/`) — OpenCode plugin that listens for session events (status changes, permissions, questions, errors, todos) and writes to SQLite
- **TUI** (`tui-ts/`) — Reads SQLite, displays sessions sorted by attention priority

The plugin tracks each OpenCode process by PID with a 10-second heartbeat. The TUI polls for changes every 500ms, using SQLite's `PRAGMA data_version` to skip unnecessary re-renders.

Tmux integration detects whether you're inside a tmux session. If so, pulse uses `switch-client` to jump to the target pane. Outside tmux, it uses `attach-session`. A warning is shown if tmux is not detected.

## Building from Source

```bash
git clone https://github.com/fetep/opencode-pulse
cd opencode-pulse
bun install
bun run build

# Register the local plugin in ~/.config/opencode/opencode.json:
#   { "plugin": ["/path/to/opencode-pulse"] }
# Restart OpenCode.

# Run the TUI
./tui-ts/src/cli.tsx

# Or link globally
bun link
pulse
```
