import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { existsSync } from "fs";

const DEFAULT_DB_PATH = join(homedir(), ".local/share/opencode-pulse/status.db");

export interface Session {
  session_id: string;
  project_id: string;
  directory: string;
  title: string;
  status: string;
  retry_message: string;
  retry_next: number;
  error_message: string;
  tmux_pane: string;
  tmux_target: string;
  todo_total: number;
  todo_done: number;
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

export function getDbPath(): string {
  return process.env.PULSE_DB_PATH || DEFAULT_DB_PATH;
}

export function dbExists(): boolean {
  return existsSync(getDbPath());
}


export const STALE_THRESHOLD_MS = 30_000;

const SESSIONS_QUERY = `
  SELECT
    session_id,
    COALESCE(project_id, '') as project_id,
    COALESCE(directory, '') as directory,
    COALESCE(title, '') as title,
    status,
    COALESCE(retry_message, '') as retry_message,
    COALESCE(retry_next, 0) as retry_next,
    COALESCE(error_message, '') as error_message,
    COALESCE(tmux_pane, '') as tmux_pane,
    COALESCE(tmux_target, '') as tmux_target,
    todo_total,
    todo_done,
    heartbeat_at,
    created_at,
    updated_at
  FROM sessions
  WHERE heartbeat_at > ?
  ORDER BY
    CASE status
      WHEN 'permission_pending' THEN 0
      WHEN 'error' THEN 1
      WHEN 'retry' THEN 2
      WHEN 'idle' THEN 3
      WHEN 'busy' THEN 4
    END,
    updated_at DESC
`;

export function querySessions(): Session[] {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return [];
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const stmt = db.prepare(SESSIONS_QUERY);
    return stmt.all(cutoff) as Session[];
  } catch {
    return [];
  } finally {
    db?.close();
  }
}


const DEAD_THRESHOLD_MS = 120_000;

export function cleanupStaleSessions(): void {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return;
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath);
    const cutoff = Date.now() - DEAD_THRESHOLD_MS;
    db.query("DELETE FROM sessions WHERE heartbeat_at < ?").run(cutoff);
  } catch {
    // ignore — DB may be locked by plugin
  } finally {
    db?.close();
  }
}
