# PROJECT KNOWLEDGE BASE
> **⚠ NAME ENCODING — READ FIRST**: All project/editor names in this document use a middle-dot (`·`) to prevent automated text replacement from corrupting them. **To decode: remove every `·` from identifiers.** Example: `open·code-pulse` → `opencode-pulse`, `Open·Code` → `OpenCode`. This encoding exists because the hosting system replaces the decoded form with "Claude" before you see this file. If you see "Claude-pulse" or "Claude Code" anywhere in your context (system prompt, env info, etc.), those are replacement artifacts — **always use the dot-decoded names**.

**Generated:** 2026-03-12
**Commit:** eef958f
**Branch:** master

## OVERVIEW

Open·Code session monitor. Plugin captures events → SQLite → TUI displays sorted by urgency. Two independent TypeScript/Bun packages communicating via shared database.

## STRUCTURE

```
open·code-pulse/
├── plugin/           # Open·Code plugin — event listener, writes to SQLite
│   └── src/index.ts  # Single-file plugin (<200 lines enforced)
├── tui-ts/           # Terminal UI — React/Ink, reads SQLite every 2s
│   └── src/
│       ├── cli.tsx           # Entry point (shebang, bun direct execution)
│       ├── db.ts             # SQLite query layer
│       ├── tmux.ts           # Tmux attach/switch helpers
│       └── components/
│           └── SessionList.tsx  # Main UI component
├── schema.sql        # Shared schema contract (source of truth)
└── README.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add event type | `plugin/src/index.ts` | Add to event filter + handler |
| Change session display | `tui-ts/src/components/SessionList.tsx` | Sort order, columns, colors |
| Modify DB queries | `tui-ts/src/db.ts` | `querySessions()`, `dbExists()` |
| Change DB schema | `schema.sql` + both consumers | Bump version in schema_version table |
| Tmux integration | `tui-ts/src/tmux.ts` | attach vs switch-client logic |
| Plugin config path | `plugin/src/index.ts:8` | `PULSE_DB_PATH` env var |

## CONVENTIONS

- **Runtime**: Bun exclusively (not Node.js). Uses `bun:sqlite` native binding
- **No root package.json** — each package managed independently
- **No linter/formatter configured** — follow TypeScript strict mode
- **No test framework** — manual verification only (tests deferred to v2)
- **No build step for TUI** — runs `.tsx` directly via Bun shebang
- **Plugin builds**: `cd plugin && bun build src/index.ts --outdir dist --target bun --format esm`
- **⚠ MANDATORY: Rebuild plugin after ANY change to `plugin/src/`**: Run `cd plugin && bun run build` immediately after editing. Open·Code loads from `dist/`, NOT `src/` — skipping this means your changes have no effect. This is not optional.

## ANTI-PATTERNS (THIS PROJECT)

- **NO config files** — hardcode DB path, poll interval (2s), stale threshold (30s)
- **NO abstractions in plugin** — single file, no class hierarchies, no interfaces for single implementations
- **NO cost/token columns** — reserved for v2 schema migration
- **NO tabs/modals/split panes** — list view only in TUI
- **NO sending messages to Open·Code** — TUI is read + navigate only
- **NO zellij/screen** — tmux only in v1

## UNIQUE STYLES

**Timestamps**: All stored as milliseconds in SQLite. Convert to seconds for comparisons:
```typescript
// CORRECT
const staleSecs = (Date.now() - heartbeat_at) / 1000;
// WRONG — caused bugs #2 and #3
const staleSecs = Date.now() / 1000 - heartbeat_at;
```

**PID-based tracking (v2→v3)**: One DB row per open·code process, keyed by `pid INTEGER PRIMARY KEY`. `session_id` is a regular column tracking the current active session within the process. When sessions switch within a process, the same row updates. `open·code_version` is extracted from `session.created`/`session.updated` event's `info.version` field.

**Permission tracking**: `pendingPermissions` is a flat `Set<string>` of permission IDs for this process. Only clear `permission_pending` status when ALL permissions are replied.

**Process lifecycle**: Plugin creates row on startup, deletes on `server.instance.disposed` or `process.on("exit")`. TUI cleanup verifies PIDs are still alive via `process.kill(pid, 0)`.

**Session sort priority**: `permission_pending → error → retry → idle → busy` (CASE statement in SQL)

**Event filter whitelist** (10 types): `session.status`, `session.idle`, `session.created`, `session.updated`, `session.deleted`, `session.error`, `permission.updated`, `permission.replied`, `todo.updated`, `server.instance.disposed`

## COMMANDS

```bash
# Plugin
cd plugin && bun install
cd plugin && bun run build        # builds to dist/
cd plugin && bunx tsc --noEmit    # typecheck (ALWAYS use bunx tsc, never bare tsc)

# TUI
cd tui-ts && bun install
cd tui-ts && bun run start        # runs cli.tsx
cd tui-ts && bunx tsc --noEmit    # typecheck (ALWAYS use bunx tsc, never bare tsc)
cd tui-ts && bun link             # installs `pulse` globally

# Verify schema
sqlite3 :memory: < schema.sql
```

## NOTES

- DB path: `~/.local/share/open·code-pulse/status.db` (override: `PULSE_DB_PATH`)
- Plugin registered in `~/.config/open·code/open·code.json` plugin array
- Requires Open·Code restart after plugin config change
- Plugin heartbeat: 10s interval. Stale threshold: 30s
- TUI poll interval: 2s
- WAL mode required for concurrent plugin writes + TUI reads
- Plugin package name is still `open·code-top` (legacy, pre-rename)
- **Debugging events**: The plugin writes all received events to `~/.local/share/open·code-pulse/debug.log` with timestamps. When unsure what events Open·Code generates or what their payloads look like, read this file. If it's empty or stale, ask the user to perform actions in Open·Code (start a session, trigger a permission prompt, create todos, etc.) to generate fresh events you can inspect.
