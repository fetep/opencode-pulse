import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { createTestDb, type TestDbHandle } from "../helpers/db.ts";
import {
  launchTuiInTmux,
  type TuiHandle,
  waitForTuiContent,
} from "../helpers/tui.ts";

function insertRow(dbPath: string, overrides: Record<string, unknown> = {}) {
  const db = new Database(dbPath);
  const now = Date.now();
  const defaults: Record<string, unknown> = {
    pid: Math.floor(Math.random() * 1_000_000) + 100_000,
    session_id: `ses_test_${randomBytes(6).toString("hex")}`,
    status: "idle",
    directory: "/test/project",
    title: "Test Session",
    todo_total: 0,
    todo_done: 0,
    heartbeat_at: now,
    created_at: now,
    updated_at: now,
  };
  const row = { ...defaults, ...overrides };
  const keys = Object.keys(row);
  db.query(
    `INSERT INTO sessions (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
  ).run(...(Object.values(row) as (string | number | null)[]));
  db.close();
}

const shouldRun = !!process.env.INTEGRATION;

;(shouldRun ? describe : describe.skip)("TUI Rendering", () => {
  let testDb: TestDbHandle;
  let tui: TuiHandle | null = null;
  let socket: string;

  beforeEach(() => {
    testDb = createTestDb();
    socket = `pulse-render-${process.pid}-${randomBytes(4).toString("hex")}`;
  });

  afterEach(() => {
    try {
      tui?.kill();
    } catch {}
    tui = null;
    try {
      testDb?.cleanup();
    } catch {}
  });

  it("renders status icons for all statuses", async () => {
    insertRow(testDb.dbPath, { status: "idle", title: "Alpha", pid: 100001 });
    insertRow(testDb.dbPath, { status: "busy", title: "Bravo", pid: 100002 });
    insertRow(testDb.dbPath, {
      status: "error",
      title: "Charlie",
      error_message: "fail",
      pid: 100003,
    });
    insertRow(testDb.dbPath, {
      status: "retry",
      title: "Delta",
      retry_message: "retrying",
      pid: 100004,
    });
    insertRow(testDb.dbPath, {
      status: "permission_pending",
      title: "Echo",
      pid: 100005,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "icons",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "Permission",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("\u25CF"); // ● idle
    expect(screen).toContain("\u25E6"); // ◦ busy
    expect(screen).toContain("\u2717"); // ✗ error
    expect(screen).toContain("\u21BB"); // ↻ retry
    expect(screen).toContain("\u25B2"); // ▲ permission_pending
  }, 15_000);

  it("sorts permission_pending above idle", async () => {
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Session Alpha",
      pid: 200001,
    });
    insertRow(testDb.dbPath, {
      status: "permission_pending",
      title: "Session Beta",
      pid: 200002,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "sort",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "Permission",
      timeoutMs: 10_000,
    });

    const permIdx = screen.indexOf("Permission");
    const idleIdx = screen.indexOf("Idle");
    expect(permIdx).toBeGreaterThan(-1);
    expect(idleIdx).toBeGreaterThan(-1);
    expect(permIdx).toBeLessThan(idleIdx);
  }, 15_000);

  it("displays todo progress", async () => {
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Todo Test",
      todo_total: 8,
      todo_done: 4,
      pid: 300001,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "todo",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "4/8",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("4/8");
  }, 15_000);

  it("shows empty state when no sessions exist", async () => {
    tui = await launchTuiInTmux({
      socket,
      sessionName: "empty",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "No active sessions",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("No active sessions");
  }, 15_000);

  it("filters stale sessions", async () => {
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Stale Session",
      heartbeat_at: Date.now() - 35_000,
      pid: 400001,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "stale",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "No active sessions",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("No active sessions");
    expect(screen).not.toContain("Stale Session");
  }, 15_000);

  it("displays error message in message column", async () => {
    insertRow(testDb.dbPath, {
      status: "error",
      title: "Error Test",
      error_message: "API rate limit exceeded",
      pid: 500001,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "errmsg",
      dbPath: testDb.dbPath,
      columns: "status,message,title",
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "API rate limit",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("API rate limit");
  }, 15_000);

  it("shows column headers", async () => {
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Header Test",
      pid: 600001,
    });

    tui = await launchTuiInTmux({
      socket,
      sessionName: "headers",
      dbPath: testDb.dbPath,
    });

    const screen = await waitForTuiContent({
      capture: tui.capture,
      match: "STATUS",
      timeoutMs: 10_000,
    });

    expect(screen).toContain("STATUS");
  }, 15_000);
});
