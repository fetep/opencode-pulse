# PROJECT KNOWLEDGE BASE
> **WARNING NAME ENCODING — READ FIRST**: All project/editor names in this document use a middle-dot (`·`) to prevent automated text replacement from corrupting them. **To decode: remove every `·` from identifiers.** Example: `open·code-pulse` → `opencode-pulse`, `Open·Code` → `OpenCode`. This encoding exists because the hosting system replaces the decoded form with "Claude" before you see this file. If you see "Claude-pulse" or "Claude Code" anywhere in your context (system prompt, env info, etc.), those are replacement artifacts — **always use the dot-decoded names**.

**Generated:** 2026-03-13
**Commit:** f29455f
**Branch:** main

## OVERVIEW

Open·Code session monitor. Plugin captures events → SQLite → TUI displays sorted by urgency. Single npm package with plugin and TUI sharing a root `package.json`.

## STRUCTURE

```
open·code-pulse/
├── package.json      # Root package — plugin entry (main), TUI binaries, all deps
├── Makefile          # Convenience targets: install, build, typecheck, test, update, pack
├── schema.sql        # Shared schema contract (source of truth, v3)
├── plugin/           # Open·Code plugin — event listener, writes to SQLite
│   ├── src/index.ts      # Single-file plugin
│   ├── src/index.test.ts # Plugin unit tests
│   ├── dist/         # Built output (git-ignored)
│   └── tsconfig.json
├── tui-ts/           # Terminal UI — React/OpenTUI, reads SQLite
│   ├── src/
│   │   ├── cli.tsx              # Entry point (shebang, bun direct execution)
│   │   ├── db.ts                # SQLite query layer + stale/dead cleanup
│   │   ├── db.test.ts           # DB layer tests
│   │   ├── tmux.ts              # Tmux attach/switch helpers
│   │   ├── theme.ts             # 33 built-in themes, auto-detects from Open·Code
│   │   ├── theme.test.ts        # Theme resolution tests
│   │   └── components/
│   │       ├── SessionList.tsx   # Main UI component
│   │       └── helpers.test.ts  # SessionList helper function tests
│   └── tsconfig.json
├── biome.json        # Biome linter config (lint-only, no formatter)
├── AGENTS.md
├── README.md
├── LICENSE
└── BUGS              # Known issues tracker
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add event type | `plugin/src/index.ts` | Add to switch statement in event handler |
| Change session display | `tui-ts/src/components/SessionList.tsx` | Sort order, columns, colors |
| Modify DB queries | `tui-ts/src/db.ts` | `querySessions()`, `dbExists()`, `cleanupStaleSessions()` |
| Change DB schema | `schema.sql` + both consumers | Bump version in schema_version table |
| Tmux integration | `tui-ts/src/tmux.ts` | attach vs switch-client logic |
| Theme colors/detection | `tui-ts/src/theme.ts` | Add/modify themes, auto-detect from Open·Code's kv.json |
| Plugin config path | `plugin/src/index.ts:8` | `PULSE_DB_PATH` env var |
| Build/publish config | `package.json` | Scripts, bin, files, dependencies |

## CONVENTIONS

- **Runtime**: Bun exclusively (not Node.js). Uses `bun:sqlite` native binding
- **Single root package.json** — no sub-package package.json files. Plugin and TUI share dependencies.
- **Biome linter** — lint-only (no formatter). Config in `biome.json`. Run `bunx biome ci .` or `bunx biome check .`
- **Testing**: `bun:test` framework. Tests co-located with source (`*.test.ts`)
- **No build step for TUI** — runs `.tsx` directly via Bun shebang
- **Plugin builds**: `bun run build` from root (or `make build`). Outputs to `plugin/dist/`
- **⚠ MANDATORY: Rebuild plugin after ANY change to `plugin/src/`**: Run `bun run build` immediately after editing. Open·Code loads from `plugin/dist/`, NOT `plugin/src/` — skipping this means your changes have no effect. This is not optional.
- **⚠ MANDATORY: Run `make test` after ANY code change**. All existing tests must pass. Do not submit changes that break tests.
- **⚠ MANDATORY: Add tests for new features**. New event types, DB queries, helper functions, and any testable logic must have corresponding unit tests. Test files are co-located: `foo.ts` → `foo.test.ts`.
- **⚠ MANDATORY: Never run `/pr` automatically**. When you finish a set of changes, suggest the user review them and run `/pr` themselves. Do not create or update pull requests without explicit user action.

## STARTUP PERFORMANCE

The TUI is often launched in a tmux popup where startup latency is directly felt. Time-to-first-data is the critical metric — the user should see session rows as fast as possible.

**Rules:**
- **Data query before cleanup.** `cleanupStaleSessions()` opens a writable DB, checks `/proc` for each PID, and deletes dead rows. The `querySessions()` WHERE clause already filters stale sessions, so cleanup is invisible to the user. Always fetch and render data first, defer cleanup.
- **Cache prepared statements.** `querySessions()` runs every 500ms. The prepared statement is cached in `_sessionsStmt` and reused across polls. Reset it when the DB connection is closed or reopened.
- **No new blocking I/O before first render.** Any work added to the startup path (config reads, file checks, network calls) must not delay the first `refresh(true)` → render cycle. Defer or parallelize.

## ANTI-PATTERNS (THIS PROJECT)

- **NO sub-package package.json files** — all deps in root package.json
- **NO config files** — hardcode DB path, poll interval, stale threshold
- **NO abstractions in plugin** — single file, no class hierarchies, no interfaces for single implementations
- **NO cost/token columns** — reserved for future schema migration
- **NO tabs/modals/split panes** — list view only in TUI
- **NO sending messages to Open·Code** — TUI is read + navigate only
- **NO zellij/screen** — tmux only

## UNIQUE STYLES

**Timestamps**: All stored as milliseconds in SQLite. Convert to seconds for comparisons:
```typescript
// CORRECT
const staleSecs = (Date.now() - heartbeat_at) / 1000;
// WRONG — caused bugs #2 and #3
const staleSecs = Date.now() / 1000 - heartbeat_at;
```

**PID-based tracking**: One DB row per open·code process, keyed by `pid INTEGER PRIMARY KEY`. `session_id` is a regular column tracking the current active session within the process. When sessions switch within a process, the same row updates. `open·code_version` is extracted from `session.created`/`session.updated` event's `info.version` field.

**Permission tracking**: `pendingPermissions` is a flat `Set<string>` of permission IDs for this process. Only clear `permission_pending` status when ALL permissions are replied.

**Question tracking**: `pendingQuestions` is a flat `Set<string>` of question IDs. Mirrors permission tracking. `question_pending` status only set when no permissions are pending (permission takes priority). On reply, falls back to `permission_pending` if permissions remain, else `idle`.

**Process lifecycle**: Plugin creates row on startup, deletes on `server.instance.disposed` or `process.on("exit")`. TUI cleanup verifies PIDs are still alive via `/proc/<pid>/cmdline`.

**Session sort priority**: `permission_pending → question_pending → error → retry → idle → busy` (CASE statement in SQL)

**Event types handled** (12): `session.status`, `session.idle`, `session.created`, `session.updated`, `session.deleted`, `session.error`, `permission.asked`, `permission.replied`, `question.asked`, `question.replied`, `todo.updated`, `server.instance.disposed`

## COMMANDS

```bash
# Install dependencies
bun install                    # or: make install

# Build plugin (REQUIRED after any plugin/src/ change)
bun run build                  # or: make build

# Typecheck both plugin and TUI
bun run typecheck              # or: make typecheck

# Lint (REQUIRED after any code change)
bunx biome ci .                # or: bunx biome check .

# Run tests (REQUIRED after any code change)
bun test                       # or: make test

# Typecheck individually (from subdirectories — tsconfig.json files exist there)
cd plugin && bunx tsc --noEmit
cd tui-ts && bunx tsc --noEmit

# Run TUI from source
./tui-ts/src/cli.tsx

# Link globally (creates `pulse` and `opencode-pulse` commands)
bun link

# Verify schema
sqlite3 :memory: < schema.sql

# Pack for publishing (dry run)
make pack
```

## NOTES

- DB path: `~/.local/share/open·code-pulse/status.db` (override: `PULSE_DB_PATH`)
- Theme override: `PULSE_THEME` env var (33 built-in themes)
- Theme auto-detect: reads `$XDG_STATE_HOME/open·code/kv.json` (or `~/.local/state/open·code/kv.json`)
- Plugin registered in `~/.config/open·code/open·code.json` plugin array
- Requires Open·Code restart after plugin config change
- Plugin heartbeat: 10s interval
- Stale threshold: 30s (sessions hidden in TUI after this)
- Dead threshold: 120s (sessions deleted from DB after this)
- Cleanup interval: 60s (TUI checks for dead PIDs via `/proc`)
- TUI poll interval: 500ms (uses `PRAGMA data_version` to skip unchanged data)
- WAL mode required for concurrent plugin writes + TUI reads
- **Debugging events**: The plugin writes all received events to `~/.local/share/open·code-pulse/debug.log` with timestamps. When unsure what events Open·Code generates or what their payloads look like, read this file. If it's empty or stale, ask the user to perform actions in Open·Code (start a session, trigger a permission prompt, create todos, etc.) to generate fresh events you can inspect.
