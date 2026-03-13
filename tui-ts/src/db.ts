import { Database } from "bun:sqlite";
import { homedir } from "os";
import { basename, join } from "path";
import { existsSync, readFileSync } from "fs";

const DEFAULT_DB_PATH = join(homedir(), ".local/share/opencode-pulse/status.db");

export interface Session {
  pid: number;
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
    pid,
    COALESCE(session_id, '') as session_id,
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

let _db: Database | null = null;

function getDb(): Database | null {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    _db = null;
    return null;
  }
  if (_db) return _db;
  try {
    _db = new Database(dbPath, { readonly: true });
    return _db;
  } catch {
    _db = null;
    return null;
  }
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

let _lastDataVersion: number | null = null;

export function hasDbChanged(): boolean {
  const db = getDb();
  if (!db) {
    _lastDataVersion = null;
    return false;
  }
  try {
    const row = db.query("PRAGMA data_version").get() as { data_version: number } | null;
    const current = row?.data_version ?? 0;
    if (_lastDataVersion === null) {
      _lastDataVersion = current;
      return true;
    }
    if (current !== _lastDataVersion) {
      _lastDataVersion = current;
      return true;
    }
    return false;
  } catch {
    _db?.close();
    _db = null;
    _lastDataVersion = null;
    return false;
  }
}
export function querySessions(): Session[] {
  const db = getDb();
  if (!db) return [];
  try {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    const stmt = db.prepare(SESSIONS_QUERY);
    return stmt.all(cutoff) as Session[];
  } catch {
    _db?.close();
    _db = null;
    return [];
  }
}


const DEAD_THRESHOLD_MS = 120_000;

function isPidAlive(pid: number): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    const exe = cmdline.split("\0")[0];
    return basename(exe) === "opencode";
  } catch {
    return false;
  }
}

export function cleanupStaleSessions(): void {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    return;
  }

  let db: Database | null = null;
  try {
    db = new Database(dbPath);

    const rows = db.query("SELECT pid FROM sessions").all() as { pid: number }[];
    for (const row of rows) {
      if (!isPidAlive(row.pid)) {
        db.query("DELETE FROM sessions WHERE pid = ?").run(row.pid);
      }
    }

    const cutoff = Date.now() - DEAD_THRESHOLD_MS;
    db.query("DELETE FROM sessions WHERE heartbeat_at < ?").run(cutoff);
  } catch {
    // ignore — DB may be locked by plugin
  } finally {
    db?.close();
  }
}
