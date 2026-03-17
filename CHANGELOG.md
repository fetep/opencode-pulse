# Changelog

## v0.1.0 (2026-03-13)

Initial release.

- feat: opencode-pulse session monitor
- feat: add theme system synced with opencode palettes
- feat(plugin): add debug logging and fix upsert parameter order
- feat: track by pid instead of session_id
- feat: track opencode version per process (schema v3)
- feat(plugin): adopt active session on startup via SDK
- feat(plugin): adopt session from /proc/self/cmdline when launched with -s
- feat(tui): migrate from React/Ink to OpenTUI
- feat: track question_pending status from question.asked/replied events
- feat(tui): add fitContent column sizing for tmux column
- feat(tui): show opencode branding and hostname in header
- feat(tui): change default columns to status,tmux,todo,updated,age,title
- feat(plugin): handle opencode -c (continue) flag for session adoption
- feat: add root package.json for npm publishing
- fix(tui): run cleanup before first display to avoid stale flash
- fix(tui): use "return" key name for Enter in OpenTUI
- fix(plugin): refresh tmux_target on heartbeat to track pane renumbering
- fix(plugin): handle permission.asked event and requestID property
- fix(tui): rename Pending status label to Permission for clarity
- fix(tui): support macOS by falling back to kill -0 for PID liveness
- perf(tui): use PRAGMA data_version for reactive polling
