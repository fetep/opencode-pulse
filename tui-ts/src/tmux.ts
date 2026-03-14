import { spawnSync } from "node:child_process";

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

export const TMUX_TARGET_RE = /^[a-zA-Z0-9_.:%@-]+$/;

export function execAttach(session: {
  tmux_target: string;
  tmux_pane: string;
}): void {
  const target = session.tmux_pane || session.tmux_target;
  if (!target || !TMUX_TARGET_RE.test(target)) return;

  if (isInsideTmux()) {
    spawnSync("tmux", ["switch-client", "-t", target], { stdio: "inherit" });
  } else {
    spawnSync("tmux", ["attach-session", "-t", target], { stdio: "inherit" });
  }
  process.exit(0);
}
