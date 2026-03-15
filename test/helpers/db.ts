import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SessionRow {
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
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

export interface TestDbHandle {
  dbPath: string;
  cleanup: () => void;
}

export function createTestDb(): TestDbHandle {
  const tempDir = mkdtempSync(join(tmpdir(), "pulse-test-"));
  const dbPath = join(tempDir, "test.db");

  const db = new Database(dbPath);
  const schema = readFileSync(join(import.meta.dir, "../../schema.sql"), "utf-8");
  db.exec(schema);
  db.exec("PRAGMA journal_mode = WAL");
  db.close();

  return {
    dbPath,
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    },
  };
}

export function queryTestDb(dbPath: string): SessionRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const query = `
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
        heartbeat_at,
        created_at,
        updated_at
      FROM sessions
      WHERE heartbeat_at > 0
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
    return db.query(query).all() as SessionRow[];
  } finally {
    db.close();
  }
}

export async function waitForDbRow(
  dbPath: string,
  predicate: (row: SessionRow) => boolean,
  timeoutMs: number = 5000,
): Promise<SessionRow> {
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < timeoutMs) {
    const rows = queryTestDb(dbPath);
    const match = rows.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error("Timeout waiting for DB row");
}

export function assertDbState(dbPath: string, expected: Partial<SessionRow>): void {
  const rows = queryTestDb(dbPath);
  if (rows.length === 0) {
    throw new Error("Expected at least one row in DB, but found none");
  }

  const row = rows[0];
  for (const [key, value] of Object.entries(expected)) {
    const actual = row[key as keyof SessionRow];
    if (actual !== value) {
      throw new Error(
        `Expected ${key} to be ${JSON.stringify(value)}, but got ${JSON.stringify(actual)}`,
      );
    }
  }
}
