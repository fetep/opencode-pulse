import { execSync, spawnSync } from "child_process";

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export function switchClient(target: string): boolean {
  try {
    execSync(`tmux switch-client -t ${target}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function selectWindow(target: string): boolean {
  try {
    execSync(`tmux select-window -t ${target}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function attachSession(target: string): boolean {
  const result = spawnSync("tmux", ["attach-session", "-t", target], {
    stdio: "inherit",
  });
  return result.status === 0;
}

export function launchAndAttach(target: string): boolean {
  const result = spawnSync("tmux", ["new-session", "-A", "-s", target], {
    stdio: "inherit",
  });
  return result.status === 0;
}

export function attachToSession(session: {
  tmux_target: string;
  tmux_pane: string;
}): boolean {
  const target = session.tmux_target || session.tmux_pane;
  if (!target) return false;

  if (isInsideTmux()) {
    if (switchClient(target)) return true;
    return selectWindow(target);
  }

  return launchAndAttach(target);
}
