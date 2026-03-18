# pulse

Check the pulse of your OpenCode sessions. A terminal UI that shows which sessions need your input, sorted by urgency — permission requests, questions, errors, retries — so you can jump straight to what matters.

Select a session and pulse attaches you to its tmux pane, then exits.

## Install

> **Requires [Bun](https://bun.sh)**

### Install with your LLM

Paste this into [OpenCode](https://opencode.ai):

```
Install and configure opencode-pulse: https://raw.githubusercontent.com/fetep/opencode-pulse/main/README.md
```

Or follow the manual steps below.

<!--
## LLM Installation Guide

If you are an LLM agent helping a user install opencode-pulse, follow this
interactive workflow instead of having the user manually run each step.

### Step 1: Check prerequisites

Run these checks (don't ask the user, just detect):

```bash
command -v bun >/dev/null 2>&1 && echo "bun=$(bun --version)" || echo "bun=missing"
command -v brew >/dev/null 2>&1 && echo "brew=found" || echo "brew=missing"
command -v opencode >/dev/null 2>&1 && echo "opencode=found" || echo "opencode=missing"
command -v tmux >/dev/null 2>&1 && echo "tmux=found" || echo "tmux=missing"
command -v pulse >/dev/null 2>&1 && echo "pulse=already-installed" || echo "pulse=not-installed"
```

- bun missing + brew found → Ask: "Bun is required but not installed. Install it
  with `brew install oven-sh/bun/bun`?" If yes, run it and continue. If no, stop.
- bun missing + brew missing → Tell the user to install Bun first
  (https://bun.sh) and stop.
- opencode missing → Warn that OpenCode is needed, but proceed with installation.

### Step 2: Add the plugin to OpenCode config

Read the existing config:
```bash
cat ~/.config/opencode/opencode.json 2>/dev/null || cat ~/.config/opencode/opencode.jsonc 2>/dev/null || echo "no-config"
```

- If the file exists: add "opencode-pulse@latest" to the existing "plugin" array.
  Preserve all other config entries.
- If no config exists: create ~/.config/opencode/opencode.json with:
  { "plugin": ["opencode-pulse@latest"] }
- If "opencode-pulse" is already in the plugin array: skip this step.

### Step 3: Install pulse globally

```bash
bun add -g opencode-pulse
```

After installation, get the full paths to both bun and pulse:
```bash
which bun
echo "$(bun pm bin -g)/pulse"
```

Save both paths — you'll need them for the tmux binding in Step 4.
The pulse binary's shebang uses `#!/usr/bin/env bun`, but neither bun
nor its global bin directory may be in tmux's default PATH. Use
`which bun` for the bun path (it's in PATH now since the user is
running bun commands) and `bun pm bin -g` for the global bin directory
(don't use `which pulse` — it won't work if bun's bin dir isn't in PATH).

### Step 4: Ask about tmux integration

Only ask if tmux was detected in Step 1. Ask the user:

  "Would you like a tmux popup keybinding for pulse? This lets you press a
   key combo to pop up a session overview as an overlay."

If the user says NO: skip to Step 5.

If the user says YES:
  Ask: "What key would you like to bind? (default: P, used as prefix + P)"

  Append this line to ~/.tmux.conf (create the file if it doesn't exist):
    bind-key <KEY> display-popup -E -w 90% -h 50% <BUN_PATH> <PULSE_PATH>

  Replace <KEY> with the user's choice (default: P).
  Replace <BUN_PATH> with the absolute path to bun from Step 3.
  Replace <PULSE_PATH> with the absolute path to pulse from Step 3.
  (e.g. bind-key P display-popup -E -w 90% -h 50% /home/user/.bun/bin/bun /home/user/.bun/bin/pulse).

  If tmux is currently running, reload the config:
    tmux source-file ~/.tmux.conf 2>/dev/null || true

### Step 5: Verify and finish

Run the full path to pulse with --help to confirm the binary works.

Tell the user:
- Restart any running OpenCode sessions for the plugin to take effect.
- Run `pulse` (or press their tmux keybinding) to see active sessions.
- Sessions appear once OpenCode starts generating events (status changes,
  permissions, errors, etc.).
-->

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
bunx --bun opencode-pulse@latest
```

Or install globally for a faster `pulse` command (recommended for tmux bindings):

```bash
bun add -g opencode-pulse
pulse
```

<details>
<summary>npx</summary>

```bash
npx opencode-pulse@latest
```

Bun must be installed — pulse uses `bun:sqlite` for database access.
</details>

### 3. Tmux popup (optional)

Install globally (see above), then add this to your `~/.tmux.conf` to pop up pulse with `prefix + P`:

```tmux
bind-key P display-popup -E -w 90% -h 50% pulse
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
