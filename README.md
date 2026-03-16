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

### 3. Tmux popup (optional)

Add this to your `~/.tmux.conf` to pop up pulse with `prefix + P`:

```tmux
bind-key P display-popup -E -w 90% -h 50% 'bunx --bun opencode-pulse'
```

Select a session and pulse switches you there, closing the popup automatically.

## Usage

```
pulse [options]

Options:
  -c, --columns <cols>  Comma-separated columns
  -t, --theme <name>    Theme name
      --db-path <path>  Path to SQLite database
  -h, --help            Show help
```

### Keybinds

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `Enter` | Attach to selected session's tmux pane and exit |
| `Esc` / `q` / `Ctrl+C` | Quit |

Navigation wraps — pressing up on the first item selects the last.

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

## Configuration

Every option can be set three ways: **config file**, **CLI flag**, or **environment variable**. All three use the same set of options. When the same option is set in multiple places, the most specific source wins:

**CLI flag > environment variable > config file > default**

| Option  | Config key | CLI flag       | Env var          | Default |
|---------|------------|----------------|------------------|---------|
| Columns | `columns`  | `-c, --columns`| `PULSE_COLUMNS`  | `status,tmux,todo,updated,age,title` |
| Theme   | `theme`    | `-t, --theme`  | `PULSE_THEME`    | *auto-detected from OpenCode* |
| DB path | `dbPath`   | `--db-path`    | `PULSE_DB_PATH`  | `~/.local/share/opencode-pulse/status.db` |
| Debug   | `debug`    | `--debug`      | `PULSE_DEBUG`    | `false` |

### Config File

Create `~/.config/opencode/pulse.jsonc` (JSON with comments):

```jsonc
{
  // See available columns below
  "columns": "status,project,title,todo,updated",
  "theme": "catppuccin",
  "debug": true
}
```

Columns can also be an array:

```jsonc
{
  "columns": ["status", "project", "title", "todo", "updated"]
}
```

All keys are optional — only set what you want to override. Plain `pulse.json` is also supported.

### Columns

| Column    | Description                                    |
|-----------|------------------------------------------------|
| `status`  | Status icon and label                          |
| `project` | Project directory name                         |
| `title`   | Session title or task description               |
| `todo`    | Todo progress bar with done/total count        |
| `agents`  | Active subagent count                          |
| `updated` | Time since last update                         |
| `age`     | Time since session started (first activity)    |
| `pid`     | OpenCode process ID                            |
| `session` | Session ID                                     |
| `version` | OpenCode version                               |
| `tmux`    | Tmux session name                              |
| `message` | Error or retry message (contextual)            |

```bash
pulse                                           # default columns
pulse --columns status,project,title,updated    # compact view
pulse -c status,project,todo,message            # show error/retry messages
pulse -c status,project,pid,version,tmux        # debugging view
```

### Themes

Pulse auto-detects your OpenCode theme and matches its colors. To override, set `theme` in your config file or use any of the three methods:

```bash
pulse --theme catppuccin
```

Available themes: `aura`, `ayu`, `carbonfox`, `catppuccin`, `catppuccin-frappe`, `catppuccin-macchiato`, `cobalt2`, `cursor`, `dracula`, `everforest`, `flexoki`, `github`, `gruvbox`, `kanagawa`, `lucent-orng`, `material`, `matrix`, `mercury`, `monokai`, `nightowl`, `nord`, `one-dark`, `opencode` *(default)*, `orng`, `osaka-jade`, `palenight`, `rosepine`, `solarized`, `synthwave84`, `tokyonight`, `vercel`, `vesper`, `zenburn`

## Troubleshooting

**DB location:** `~/.local/share/opencode-pulse/status.db` (override with `dbPath` in config, `--db-path` flag, or `PULSE_DB_PATH` env var)

**Plugin not loading?** Check `~/.local/share/opencode/log/` for errors.

**No sessions?** Ensure plugin is in your `opencode.json` and OpenCode was restarted.

**Stale sessions showing?** Pulse automatically cleans up sessions whose OpenCode process has exited. Dead processes are removed on startup and every 60 seconds.

**Debug log:** Enable `debug` in your config to have the plugin log all received events to `~/.local/share/opencode-pulse/debug.log`. Useful for verifying the plugin is receiving events from OpenCode.

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

### Development

Enable debug logging during development to see every event the plugin receives from OpenCode:

```json
// ~/.config/opencode/pulse.json
{
  "debug": true
}
```

Events are written to `~/.local/share/opencode-pulse/debug.log` with timestamps and PIDs. Rebuild the plugin after any change to `plugin/src/`:

```bash
bun run build
```

## Contributing

```bash
bun install
bun run build
make test
```

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `refactor:`, etc.). Append `!` for breaking changes (e.g., `feat!:`).

When your changes are ready, run `/pr` in OpenCode to create or update a pull request.
