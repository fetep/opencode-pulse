import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const testDir = mkdtempSync(join(tmpdir(), "pulse-db-test-"));
const testDbPath = join(testDir, "test.db");
const schema = readFileSync(join(import.meta.dir, "../../schema.sql"), "utf-8");

const { querySessions, hasDbChanged, cleanupStaleSessions, closeDb, dbExists, getDbPath, setDbPath, STALE_THRESHOLD_MS } = await import("./db.ts");

setDbPath(testDbPath);

function createTestDb(): Database {
  const db = new Database(testDbPath);
  db.exec(schema);
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

function insertSession(db: Database, overrides: Record<string, any> = {}): void {
  const now = Date.now();
  const defaults = {
    pid: 99999,
    session_id: "ses_test",
    project_id: "proj_test",
    directory: "/tmp/test-project",
    title: "Test session",
    status: "idle",
    retry_message: null,
    retry_next: null,
    error_message: null,
    tmux_pane: null,
    tmux_target: null,
    opencode_version: "1.0.0",
    todo_total: 0,
    todo_done: 0,
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };

  db.query(`
    INSERT INTO sessions (
      pid, session_id, project_id, directory, title, status,
      retry_message, retry_next, error_message, tmux_pane, tmux_target,
      opencode_version, todo_total, todo_done, heartbeat_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaults.pid, defaults.session_id, defaults.project_id, defaults.directory,
    defaults.title, defaults.status, defaults.retry_message, defaults.retry_next,
    defaults.error_message, defaults.tmux_pane, defaults.tmux_target,
    defaults.opencode_version, defaults.todo_total, defaults.todo_done,
    defaults.heartbeat_at, defaults.created_at, defaults.updated_at,
  );
}

beforeEach(() => {
  closeDb();
  if (existsSync(testDbPath)) rmSync(testDbPath);
  if (existsSync(testDbPath + "-wal")) rmSync(testDbPath + "-wal");
  if (existsSync(testDbPath + "-shm")) rmSync(testDbPath + "-shm");
});

afterEach(() => {
  closeDb();
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("getDbPath", () => {
  test("returns path set via setDbPath", () => {
    expect(getDbPath()).toBe(testDbPath);
  });
});

describe("dbExists", () => {
  test("returns false when DB file missing", () => {
    expect(dbExists()).toBe(false);
  });

  test("returns true when DB file exists", () => {
    createTestDb().close();
    expect(dbExists()).toBe(true);
  });
});

describe("querySessions", () => {
  test("returns empty array when DB does not exist", () => {
    expect(querySessions()).toEqual([]);
  });

  test("returns empty array when no sessions", () => {
    createTestDb().close();
    expect(querySessions()).toEqual([]);
  });

  test("returns sessions with recent heartbeat", () => {
    const db = createTestDb();
    insertSession(db, { pid: 10001 });
    db.close();

    const sessions = querySessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pid).toBe(10001);
    expect(sessions[0].session_id).toBe("ses_test");
  });

  test("filters out stale sessions", () => {
    const db = createTestDb();
    insertSession(db, { pid: 10001, heartbeat_at: Date.now() });
    insertSession(db, {
      pid: 10002,
      session_id: "ses_stale",
      heartbeat_at: Date.now() - STALE_THRESHOLD_MS - 1000,
    });
    db.close();

    const sessions = querySessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].pid).toBe(10001);
  });

  test("sorts by status priority: permission > question > error > retry > idle > busy", () => {
    const db = createTestDb();
    const now = Date.now();
    insertSession(db, { pid: 10001, status: "busy", heartbeat_at: now });
    insertSession(db, { pid: 10002, status: "permission_pending", heartbeat_at: now });
    insertSession(db, { pid: 10003, status: "idle", heartbeat_at: now });
    insertSession(db, { pid: 10004, status: "error", heartbeat_at: now });
    insertSession(db, { pid: 10005, status: "question_pending", heartbeat_at: now });
    insertSession(db, { pid: 10006, status: "retry", heartbeat_at: now });
    db.close();

    const sessions = querySessions();
    expect(sessions).toHaveLength(6);
    expect(sessions[0].status).toBe("permission_pending");
    expect(sessions[1].status).toBe("question_pending");
    expect(sessions[2].status).toBe("error");
    expect(sessions[3].status).toBe("retry");
    expect(sessions[4].status).toBe("idle");
    expect(sessions[5].status).toBe("busy");
  });

  test("COALESCE handles null values", () => {
    const db = createTestDb();
    insertSession(db, {
      pid: 10001,
      session_id: null,
      project_id: null,
      directory: null,
      title: null,
      retry_message: null,
      error_message: null,
      tmux_pane: null,
      tmux_target: null,
      opencode_version: null,
    });
    db.close();

    const sessions = querySessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].session_id).toBe("");
    expect(sessions[0].project_id).toBe("");
    expect(sessions[0].directory).toBe("");
    expect(sessions[0].title).toBe("");
    expect(sessions[0].tmux_pane).toBe("");
    expect(sessions[0].tmux_target).toBe("");
    expect(sessions[0].opencode_version).toBe("");
    expect(sessions[0].retry_next).toBe(0);
  });

  test("same-status sessions sorted by updated_at DESC", () => {
    const db = createTestDb();
    const now = Date.now();
    insertSession(db, {
      pid: 10001,
      status: "idle",
      title: "older",
      heartbeat_at: now,
      updated_at: now - 5000,
    });
    insertSession(db, {
      pid: 10002,
      status: "idle",
      title: "newer",
      heartbeat_at: now,
      updated_at: now,
    });
    db.close();

    const sessions = querySessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe("newer");
    expect(sessions[1].title).toBe("older");
  });
});

describe("hasDbChanged", () => {
  test("returns false when DB does not exist", () => {
    expect(hasDbChanged()).toBe(false);
  });

  test("returns true on first check with existing DB", () => {
    createTestDb().close();
    expect(hasDbChanged()).toBe(true);
  });

  test("returns false on second check with no changes", () => {
    createTestDb().close();
    hasDbChanged();
    expect(hasDbChanged()).toBe(false);
  });

  test("returns true after external write", () => {
    const db = createTestDb();
    hasDbChanged();
    hasDbChanged();

    insertSession(db);
    db.close();

    expect(hasDbChanged()).toBe(true);
  });
});

describe("cleanupStaleSessions", () => {
  test("does nothing when DB does not exist", () => {
    cleanupStaleSessions();
  });

  test("does nothing when sessions table is empty", () => {
    createTestDb().close();
    cleanupStaleSessions();
  });

  test("deletes sessions past dead threshold (120s)", () => {
    const db = createTestDb();
    const now = Date.now();
    insertSession(db, { pid: 10001, heartbeat_at: now });
    insertSession(db, { pid: 10002, heartbeat_at: now - 121_000 });
    db.close();
    closeDb();

    cleanupStaleSessions();

    const verifyDb = new Database(testDbPath, { readonly: true });
    const pids = (verifyDb.query("SELECT pid FROM sessions").all() as { pid: number }[]).map((r) => r.pid);
    verifyDb.close();

    expect(pids).not.toContain(10002);
  });

  test("deletes sessions with non-existent PIDs", () => {
    const db = createTestDb();
    insertSession(db, { pid: 2147483647, heartbeat_at: Date.now() });
    db.close();
    closeDb();

    cleanupStaleSessions();

    const verifyDb = new Database(testDbPath, { readonly: true });
    const rows = verifyDb.query("SELECT pid FROM sessions").all();
    verifyDb.close();

    expect(rows).toHaveLength(0);
  });
});
