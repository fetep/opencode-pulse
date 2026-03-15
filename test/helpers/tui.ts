import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const TUI_ENTRY = resolve(import.meta.dir, "../../tui-ts/src/cli.tsx");

export interface TuiHandle {
  socket: string;
  pane: string;
  capture: () => string;
  sendKeys: (keys: string) => void;
  kill: () => void;
}

/**
 * Capture current screen content from a tmux pane.
 * Returns plain text (no ANSI escape codes with default flags).
 */
export function captureTuiScreen(socket: string, pane: string): string {
  const result = spawnSync("tmux", ["-L", socket, "capture-pane", "-t", pane, "-p"], {
    encoding: "utf-8",
    timeout: 5000,
  });
  if (result.error) {
    throw new Error(`tmux capture-pane failed to spawn: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`tmux capture-pane exited with status ${result.status}: ${result.stderr}`);
  }
  return (result.stdout ?? "").toString();
}

/**
 * Launch the TUI in an isolated tmux session.
 *
 * Creates a dedicated tmux server via `-L <socket>` so tests never
 * touch the user's default tmux server. Returns a handle with
 * capture/sendKeys/kill helpers.
 */
export async function launchTuiInTmux(options: {
  socket: string;
  sessionName: string;
  dbPath: string;
  columns?: string;
  theme?: string;
}): Promise<TuiHandle> {
  const { socket, sessionName, dbPath, columns, theme = "opencode" } = options;

  const create = spawnSync(
    "tmux",
    ["-L", socket, "new-session", "-d", "-s", sessionName, "-x", "220", "-y", "50"],
    { encoding: "utf-8", timeout: 5000 },
  );
  if (create.status !== 0) {
    throw new Error(`Failed to create tmux session: ${create.stderr}`);
  }

  // Discover actual pane target (base-index varies per tmux config)
  const paneList = spawnSync(
    "tmux",
    ["-L", socket, "list-panes", "-t", sessionName, "-F", "#{session_name}:#{window_index}.#{pane_index}"],
    { encoding: "utf-8", timeout: 5000 },
  );
  const pane = (paneList.stdout ?? "").toString().trim().split("\n")[0] || sessionName;

  const envParts = [`PULSE_DB_PATH=${dbPath}`, `PULSE_THEME=${theme}`];
  if (columns) {
    envParts.push(`PULSE_COLUMNS=${columns}`);
  }
  const launchCmd = `${envParts.join(" ")} ${TUI_ENTRY}`;

  spawnSync(
    "tmux",
    ["-L", socket, "send-keys", "-t", sessionName, launchCmd, "Enter"],
    { encoding: "utf-8", timeout: 5000 },
  );

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const screen = captureTuiScreen(socket, pane);
    if (screen.trim().length > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  return {
    socket,
    pane,
    capture: () => captureTuiScreen(socket, pane),
    sendKeys: (keys: string) => {
      const result = spawnSync("tmux", ["-L", socket, "send-keys", "-t", pane, keys], {
        encoding: "utf-8",
        timeout: 5000,
      });
      if (result.error) {
        throw new Error(`tmux send-keys failed to spawn: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(`tmux send-keys exited with status ${result.status}: ${result.stderr}`);
      }
    },
    kill: () => {
      const result = spawnSync("tmux", ["-L", socket, "kill-server"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      if (result.error) {
        throw new Error(`tmux kill-server failed to spawn: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(`tmux kill-server exited with status ${result.status}: ${result.stderr}`);
      }
    },
  };
}

/**
 * Poll the TUI screen until content matches, or reject on timeout.
 *
 * @param options.capture - Function returning current screen text
 * @param options.match - String or RegExp to match against screen content
 * @param options.timeoutMs - Maximum wait time (default 5000ms)
 * @returns The full screen text that matched
 */
export async function waitForTuiContent(options: {
  capture: () => string;
  match: string | RegExp;
  timeoutMs?: number;
}): Promise<string> {
  const { capture, match, timeoutMs = 5000 } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const screen = capture();
    if (typeof match === "string") {
      if (screen.includes(match)) return screen;
    } else {
      if (match.test(screen)) return screen;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const finalScreen = capture();
  throw new Error(
    `Timeout (${timeoutMs}ms) waiting for TUI content matching ${match}.\nLast screen:\n${finalScreen}`,
  );
}
