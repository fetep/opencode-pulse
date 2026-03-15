import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { assertDbState, createTestDb, queryTestDb, waitForDbRow } from "./db.ts";

describe("createTestDb", () => {
  let handle: ReturnType<typeof createTestDb>;

  afterEach(() => {
    if (handle) {
      handle.cleanup();
    }
  });

  test("creates temp DB with schema", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath, { readonly: true });
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    db.close();

    expect(tables.map((t) => t.name)).toContain("sessions");
    expect(tables.map((t) => t.name)).toContain("schema_version");
  });

  test("enables WAL mode", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath, { readonly: true });
    const mode = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();

    expect(mode.journal_mode).toBe("wal");
  });

  test("cleanup removes temp directory", async () => {
    handle = createTestDb();
    const dbPath = handle.dbPath;
    const { existsSync } = await import("node:fs");

    expect(existsSync(dbPath)).toBe(true);
    handle.cleanup();
    expect(existsSync(dbPath)).toBe(false);
  });
});

describe("queryTestDb", () => {
  let handle: ReturnType<typeof createTestDb>;

  afterEach(() => {
    if (handle) {
      handle.cleanup();
    }
  });

  test("returns empty array when no sessions", () => {
    handle = createTestDb();
    const rows = queryTestDb(handle.dbPath);
    expect(rows).toEqual([]);
  });

  test("returns all sessions with positive heartbeat", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_1", "idle", now, now, now);

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10002, "ses_2", "idle", 1, now, now);

    db.close();

    const rows = queryTestDb(handle.dbPath);
    expect(rows).toHaveLength(2);
  });

  test("excludes sessions with heartbeat_at = 0", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_alive", "idle", now, now, now);

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10002, "ses_no_heartbeat", "idle", 0, now, now);

    db.close();

    const rows = queryTestDb(handle.dbPath);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe("ses_alive");
  });

  test("sorts by status priority", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_1", "idle", now, now, now);

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10002, "ses_2", "permission_pending", now, now, now);

    db.close();

    const rows = queryTestDb(handle.dbPath);
    expect(rows[0].status).toBe("permission_pending");
    expect(rows[1].status).toBe("idle");
  });

  test("COALESCEs null values to defaults", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, null, "idle", now, now, now);

    db.close();

    const rows = queryTestDb(handle.dbPath);
    expect(rows[0].session_id).toBe("");
    expect(rows[0].project_id).toBe("");
    expect(rows[0].retry_next).toBe(0);
  });
});

describe("waitForDbRow", () => {
  let handle: ReturnType<typeof createTestDb>;

  afterEach(() => {
    if (handle) {
      handle.cleanup();
    }
  });

  test("returns matching row", async () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_target", "idle", now, now, now);

    db.close();

    const row = await waitForDbRow(handle.dbPath, (r) => r.session_id === "ses_target", 1000);
    expect(row.pid).toBe(10001);
  });

  test("rejects on timeout", async () => {
    handle = createTestDb();

    let error: Error | null = null;
    try {
      await waitForDbRow(handle.dbPath, (r) => r.session_id === "nonexistent", 100);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toContain("Timeout waiting for DB row");
  });

  test("polls with configurable timeout", async () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    setTimeout(() => {
      const db2 = new Database(handle.dbPath);
      db2.query(`
        INSERT INTO sessions (
          pid, session_id, status, heartbeat_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(10001, "ses_delayed", "idle", now, now, now);
      db2.close();
    }, 150);

    db.close();

    const row = await waitForDbRow(handle.dbPath, (r) => r.session_id === "ses_delayed", 1000);
    expect(row.session_id).toBe("ses_delayed");
  });
});

describe("assertDbState", () => {
  let handle: ReturnType<typeof createTestDb>;

  afterEach(() => {
    if (handle) {
      handle.cleanup();
    }
  });

  test("passes when expected fields match", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_test", "idle", now, now, now);

    db.close();

    expect(() => {
      assertDbState(handle.dbPath, { pid: 10001, status: "idle" });
    }).not.toThrow();
  });

  test("throws when expected fields do not match", () => {
    handle = createTestDb();
    const db = new Database(handle.dbPath);
    const now = Date.now();

    db.query(`
      INSERT INTO sessions (
        pid, session_id, status, heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(10001, "ses_test", "idle", now, now, now);

    db.close();

    expect(() => {
      assertDbState(handle.dbPath, { status: "error" });
    }).toThrow();
  });

  test("throws when DB is empty", () => {
    handle = createTestDb();

    expect(() => {
      assertDbState(handle.dbPath, { pid: 10001 });
    }).toThrow("Expected at least one row in DB, but found none");
  });
});
