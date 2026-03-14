import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export const DEFAULT_DB_PATH = join(homedir(), ".local/share/opencode-pulse/status.db");

let _dbPath: string = DEFAULT_DB_PATH;

export function setDbPath(path: string): void {
  _dbPath = path;
  _sessionsStmt = null;
  _lastDataVersion = null;
  _db?.close();
  _db = null;
}

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
  opencode_version: string;
  todo_total: number;
  todo_done: number;
  subagent_count: number;
  session_started_at: number;
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

export function getDbPath(): string {
  return _dbPath;
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
    COALESCE(opencode_version, '') as opencode_version,
    todo_total,
    todo_done,
    COALESCE(subagent_count, 0) as subagent_count,
    COALESCE(session_started_at, created_at) as session_started_at,
    heartbeat_at,
    created_at,
    updated_at
  FROM sessions
  WHERE heartbeat_at > ?
  ORDER BY
    CASE status
      WHEN 'permission_pending' THEN 0
      WHEN 'question_pending' THEN 1
      WHEN 'error' THEN 2
      WHEN 'retry' THEN 3
      WHEN 'idle' THEN 4
      WHEN 'busy' THEN 5
    END,
    updated_at DESC
`;

let _db: Database | null = null;
let _sessionsStmt: ReturnType<Database["prepare"]> | null = null;

function getDb(): Database | null {
  const dbPath = getDbPath();
  if (!existsSync(dbPath)) {
    _db?.close();
    _db = null;
    _sessionsStmt = null;
    return null;
  }
  if (_db) return _db;
  try {
    _db = new Database(dbPath, { readonly: true });
    return _db;
  } catch {
    _db = null;
    _sessionsStmt = null;
    return null;
  }
}

export function closeDb(): void {
  _sessionsStmt = null;
  _db?.close();
  _db = null;
}

export function warmDb(): void {
  getDb();
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
    if (!_sessionsStmt) {
      _sessionsStmt = db.prepare(SESSIONS_QUERY);
    }
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    return _sessionsStmt.all(cutoff) as Session[];
  } catch {
    _sessionsStmt = null;
    _db?.close();
    _db = null;
    return [];
  }
}


const DEAD_THRESHOLD_MS = 120_000;

function isPidAlive(pid: number): boolean {
  // Linux: /proc verifies the process is actually opencode
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
    const exe = cmdline.split("\0")[0];
    return basename(exe) === "opencode";
  } catch {
    // /proc unavailable (macOS) or PID gone — fall back to kill -0
    try {
      process.kill(pid, 0);
      return true; // process exists (can't verify name without /proc)
    } catch (e: unknown) {
      return (e as NodeJS.ErrnoException).code !== "ESRCH"; // ESRCH = dead; EPERM = alive, no permission
    }
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
