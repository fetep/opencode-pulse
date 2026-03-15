import { execSync } from "node:child_process";

export interface TmuxTestServer {
  socket: string;
  cleanup: () => void;
}

export interface FakeOCSession {
  sessionName: string;
  paneId: string;
}

/**
 * Create an isolated tmux server using a dedicated socket.
 * Starts a dummy `__init` session to keep the server alive
 * (tmux exits when it has no sessions). The dummy persists
 * until `cleanup()` kills the entire server.
 */
export function createTmuxTestServer(socketName: string): TmuxTestServer {
  // start-server alone doesn't persist — create a throwaway session
  execSync(`tmux -L ${socketName} new-session -d -s __init -x 80 -y 24`, {
    stdio: "ignore",
  });

  return {
    socket: socketName,
    cleanup: () => {
      try {
        execSync(`tmux -L ${socketName} kill-server`, { stdio: "ignore" });
      } catch {
        // server may already be dead
      }
    },
  };
}

/**
 * Create a fake "OpenCode" tmux session (just a shell) on an
 * isolated tmux server.
 *
 * Returns the session name and full pane ID suitable for use as
 * `tmux_target` and `tmux_pane` in DB rows.
 */
export function createFakeOpenCodeSession(
  socket: string,
  name: string,
  paneContent?: string,
): FakeOCSession {
  execSync(`tmux -L ${socket} new-session -d -s ${name} -x 220 -y 50`, {
    stdio: "ignore",
  });

  if (paneContent) {
    execSync(
      `tmux -L ${socket} send-keys -t ${name} "echo '${paneContent}'" Enter`,
      { stdio: "ignore" },
    );
  }

  const paneId = execSync(
    `tmux -L ${socket} list-panes -t ${name} -F '#{session_name}:#{window_index}.#{pane_index}'`,
    { encoding: "utf-8" },
  ).trim().split("\n")[0] || `${name}:0.0`;

  return {
    sessionName: name,
    paneId,
  };
}

/**
 * Get the name of a specific tmux session (verifying it exists).
 * Uses `-t` to target a session rather than requiring an attached
 * client.
 */
export function getCurrentTmuxSession(socket: string): string {
  const result = execSync(
    `tmux -L ${socket} display-message -p '#{client_session}'`,
    { encoding: "utf-8" },
  ).trim();

  // If no client is attached, fall back to listing sessions
  if (!result) {
    const sessions = execSync(
      `tmux -L ${socket} list-sessions -F '#{session_name}'`,
      { encoding: "utf-8" },
    ).trim();
    const lines = sessions.split("\n").filter(Boolean);
    return lines[0] || "";
  }

  return result;
}

/**
 * Poll until the active tmux session matches the expected name.
 * Returns `true` if matched within timeout, `false` otherwise
 * (does not throw).
 */
export async function verifySessionSwitch(
  socket: string,
  expectedSession: string,
  timeoutMs = 3000,
): Promise<boolean> {
  const pollInterval = 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const current = getCurrentTmuxSession(socket);
      if (current === expectedSession) {
        return true;
      }
    } catch {
      // tmux command failed — server may be starting up
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}
