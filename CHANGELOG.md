## v0.2.0 (2026-03-18)

- ci: replace npm pack check with npm pkg fix idempotency check
- chore: add fetch + rebase step to /pr command
- fix(ci): narrow npm pack check to publish warnings only
- docs: add retroactive changelog for v0.1.0
- ci: add release workflow with npm trusted publishing and changelog generation
- ci: add npm pack validation and OIDC release workflow
- ci: rename job from 'ci' to 'lint-and-test'
- feat(plugin): replace ad-hoc schema checks with versioned migration system
- fix: address PR review comments on schema, docs, and stale anti-pattern
- feat(tui): add agents column and metadata pipeline convention
- feat: track subagents separately from main session
- test: add integration test infrastructure and end-to-end suites
- fix(tui): support JSONC trailing commas and report parse errors
- refactor(tui): remove unused code and hoist constants
- docs: update README install steps and AGENTS.md conventions
- perf(tui): defer cleanup, cache theme resolution and prepared statements
- fix(tui): allow trailing commas in JSONC config files
- chore(deps): bump actions/checkout from 4 to 6
- fix(plugin): harden permissions for custom DB paths and WAL files
- fix(test): restore mutated env vars in test teardown
- fix(tui): report JSONC parse errors in config loading
- fix(tui): reset cached state in setDbPath and close handle in getDb
- perf(tui): hoist hostname() to module-level constant
- refactor(tui): remove unused _buildRowText function
- docs: hardcode main as base branch, move bash constraints to YAML, add /pr rule to AGENTS.md and contributing section to README
- feat: add /pr slash command for creating and updating pull requests
- ci: add Biome linting, dependency auditing, Dependabot, and workflow hardening
- fix: make config parse errors fatal instead of silent fallback
- chore: pin opentui dependencies to ^0.1.87
- fix(tui): validate tmux target format before executing attach
- fix(plugin): restrict file permissions on data directory, database, and debug log
- fix(tui): sanitize terminal output to prevent escape sequence injection
- fix(plugin): add column whitelist and input truncation to prevent injection
- perf(tui): cache theme resolution and warm DB before renderer
- perf(tui): defer cleanup and cache prepared statement for faster startup
- feat(tui): add Escape key as primary quit binding
- fix(tui): remove unnecessary "(not in tmux)" header warning
- feat: add config file, CLI flags, and env var support via citty
- test: add unit tests for plugin and TUI
- chore: could be opencode.jsonc
- chore: recommend opencode-pulse@latest
- docs: add tmux popup keybind tip to README

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
