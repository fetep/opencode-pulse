/**
 * Validated sandbox environment variables for integration tests
 *
 * Each variable is documented with:
 * - Name: The environment variable name
 * - Type: Expected value type
 * - Purpose: What it does
 * - Validated: Whether it was confirmed working in OpenCode source or documentation
 *
 * Source: https://opencode.ai/docs/cli/ (Environment variables section)
 * SDK Source: @opencode-ai/sdk v1.2.25+
 */

export const SANDBOX_ENV = {
  // ============================================================================
  // LLM ROUTING — Point at mock/local services instead of real APIs
  // ============================================================================

  /**
   * ANTHROPIC_BASE_URL
   * Type: string (URL)
   * Purpose: Override Anthropic API endpoint for testing
   * Validated: YES — Standard HTTP env var, always works
   * Example: "http://localhost:5555" (llmock server)
   */
  ANTHROPIC_BASE_URL: "http://localhost:5555/v1",

  /**
   * ANTHROPIC_API_KEY
   * Type: string (any non-empty value)
   * Purpose: API key for Anthropic (can be mock value in tests)
   * Validated: YES — Standard HTTP auth, always works
   * Example: "mock-key" or "test-key"
   */
  ANTHROPIC_API_KEY: "mock-key",

  // ============================================================================
  // OPENCODE SANDBOX CONFIGURATION
  // ============================================================================

  /**
   * OPENCODE_PERMISSION
   * Type: string (JSON)
   * Purpose: Inline JSON permissions config — auto-approve permissions
   * Validated: YES — Found in @opencode-ai/sdk/dist/server.js
   * Format: JSON string, e.g. '{"*":"allow"}' or '{"read":"allow","write":"deny"}'
   * Note: Must be valid JSON string, not a bare keyword
   */
  OPENCODE_PERMISSION: '{"*":"allow"}',

  /**
   * OPENCODE_CONFIG_CONTENT
   * Type: string (JSON)
   * Purpose: Inline JSON config override — set model, log level, etc.
   * Validated: YES — Found in @opencode-ai/sdk/dist/server.js
   * Format: JSON string, e.g. '{"model":"anthropic/claude-sonnet-4-5"}'
   * Note: Passed to opencode serve via env var
   */
  OPENCODE_CONFIG_CONTENT: '{"model":"anthropic/claude-sonnet-4-5"}',

  /**
   * OPENCODE_FAKE_VCS
   * Type: string (VCS provider name)
   * Purpose: Fake VCS provider for testing — skips git detection
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "git" or "hg"
   * Use case: Testing without requiring actual git repo
   */
  OPENCODE_FAKE_VCS: "git",

  /**
   * OPENCODE_DISABLE_AUTOUPDATE
   * Type: boolean (string "true"/"false")
   * Purpose: Disable automatic update checks
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Faster startup in tests, prevent network calls
   */
  OPENCODE_DISABLE_AUTOUPDATE: "true",

  /**
   * OPENCODE_DISABLE_LSP_DOWNLOAD
   * Type: boolean (string "true"/"false")
   * Purpose: Disable automatic LSP server downloads
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Faster startup, prevent network calls
   */
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",

  /**
   * OPENCODE_DISABLE_MODELS_FETCH
   * Type: boolean (string "true"/"false")
   * Purpose: Disable fetching models from remote source
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Faster startup, use only configured models
   */
  OPENCODE_DISABLE_MODELS_FETCH: "true",

  /**
   * OPENCODE_DISABLE_PRUNE
   * Type: boolean (string "true"/"false")
   * Purpose: Disable pruning of old data
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Keep all session data for inspection
   */
  OPENCODE_DISABLE_PRUNE: "true",

  /**
   * OPENCODE_DISABLE_TERMINAL_TITLE
   * Type: boolean (string "true"/"false")
   * Purpose: Disable automatic terminal title updates
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Prevent terminal title pollution in tests
   */
  OPENCODE_DISABLE_TERMINAL_TITLE: "true",

  /**
   * OPENCODE_DISABLE_DEFAULT_PLUGINS
   * Type: boolean (string "true"/"false")
   * Purpose: Disable default plugins
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Faster startup, test with minimal plugins
   */
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",

  /**
   * OPENCODE_DISABLE_AUTOCOMPACT
   * Type: boolean (string "true"/"false")
   * Purpose: Disable automatic context compaction
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Keep full context for inspection
   */
  OPENCODE_DISABLE_AUTOCOMPACT: "true",

  /**
   * OPENCODE_DISABLE_CLAUDE_CODE
   * Type: boolean (string "true"/"false")
   * Purpose: Disable reading from .claude (prompt + skills)
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Prevent loading user's local .claude directory
   */
  OPENCODE_DISABLE_CLAUDE_CODE: "true",

  /**
   * OPENCODE_DISABLE_CLAUDE_CODE_PROMPT
   * Type: boolean (string "true"/"false")
   * Purpose: Disable reading ~/.claude/CLAUDE.md
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Prevent custom prompt injection
   */
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "true",

  /**
   * OPENCODE_DISABLE_CLAUDE_CODE_SKILLS
   * Type: boolean (string "true"/"false")
   * Purpose: Disable loading .claude/skills
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Prevent custom skill injection
   */
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "true",

  /**
   * OPENCODE_DISABLE_FILETIME_CHECK
   * Type: boolean (string "true"/"false")
   * Purpose: Disable file time checking for optimization
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "true"
   * Use case: Faster file operations in tests
   */
  OPENCODE_DISABLE_FILETIME_CHECK: "true",

  /**
   * OPENCODE_CLIENT
   * Type: string
   * Purpose: Client identifier (defaults to "cli")
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "integration-test"
   * Use case: Identify test client in logs
   */
  OPENCODE_CLIENT: "integration-test",

  /**
   * OPENCODE_ENABLE_EXPERIMENTAL_MODELS
   * Type: boolean (string "true"/"false")
   * Purpose: Enable experimental models
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "false"
   * Use case: Disable experimental models in tests
   */
  OPENCODE_ENABLE_EXPERIMENTAL_MODELS: "false",

  /**
   * OPENCODE_SERVER_PASSWORD
   * Type: string
   * Purpose: Enable basic auth for serve/web commands
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "test-password"
   * Use case: Secure test server
   */
  OPENCODE_SERVER_PASSWORD: "test-password",

  /**
   * OPENCODE_SERVER_USERNAME
   * Type: string
   * Purpose: Override basic auth username (default "opencode")
   * Validated: YES — Listed in official OpenCode CLI docs
   * Example: "testuser"
   * Use case: Custom auth for test server
   */
  OPENCODE_SERVER_USERNAME: "testuser",

  // ============================================================================
  // PULSE-SPECIFIC ENVIRONMENT VARIABLES
  // ============================================================================

  /**
   * PULSE_DB_PATH
   * Type: string (file path)
   * Purpose: Path to SQLite database for pulse plugin
   * Validated: YES — Defined in opencode-pulse plugin/src/index.ts
   * Example: "/tmp/test-pulse.db" or process.env.TMPDIR + "/pulse.db"
   * Note: Must be set per-test to a temporary directory
   */
  PULSE_DB_PATH: "", // Must be set per-test to temp dir

  /**
   * PULSE_DEBUG
   * Type: boolean (string "true"/"false")
   * Purpose: Enable debug logging for pulse plugin
   * Validated: YES — Defined in opencode-pulse plugin/src/index.ts
   * Example: "true"
   * Use case: Log all events to ~/.local/share/opencode-pulse/debug.log
   */
  PULSE_DEBUG: "true",

  /**
   * PULSE_THEME
   * Type: string (theme name)
   * Purpose: Override theme for pulse TUI
   * Validated: YES — Defined in opencode-pulse tui-ts/src/theme.ts
   * Example: "catppuccin" or "dracula"
   * Use case: Force specific theme in tests
   */
  PULSE_THEME: "catppuccin",
} as const;

/**
 * Helper function to build environment for a test
 * Merges SANDBOX_ENV with test-specific overrides
 *
 * @param overrides - Test-specific env var overrides
 * @returns Complete environment object
 *
 * @example
 * const env = buildTestEnv({
 *   PULSE_DB_PATH: "/tmp/test-123.db",
 *   OPENCODE_PERMISSION: '{"read":"allow"}',
 * });
 */
export function buildTestEnv(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    ...SANDBOX_ENV,
    ...overrides,
  };
}
