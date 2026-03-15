import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createTestDb, type TestDbHandle } from "../helpers/db.ts";
import {
  createFakeOpenCodeSession,
  createTmuxTestServer,
  type TmuxTestServer,
} from "../helpers/tmux.ts";
import {
  launchTuiInTmux,
  type TuiHandle,
  waitForTuiContent,
} from "../helpers/tui.ts";

function getPanePid(socket: string, session: string): number {
  const result = spawnSync(
    "tmux",
    ["-L", socket, "list-panes", "-t", session, "-F", "#{pane_pid}"],
    { encoding: "utf-8", timeout: 5000 },
  );
  return parseInt(result.stdout.trim().split("\n")[0], 10);
}

function disguisePaneAsOpencode(socket: string, session: string): void {
  spawnSync(
    "tmux",
    ["-L", socket, "send-keys", "-t", session, "exec -a opencode sleep 99999", "Enter"],
    { encoding: "utf-8", timeout: 5000 },
  );
}

async function createSurvivableSession(
  socket: string,
  name: string,
): Promise<{ sessionName: string; paneId: string; pid: number }> {
  const session = createFakeOpenCodeSession(socket, name);
  const pid = getPanePid(socket, name);
  disguisePaneAsOpencode(socket, name);
  await new Promise((r) => setTimeout(r, 200));
  return { ...session, pid };
}

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

;(shouldRun ? describe : describe.skip)("TUI Tmux Navigation", () => {
  let testDb: TestDbHandle;
  let tmuxServer: TmuxTestServer;
  let tui: TuiHandle | null = null;

  beforeEach(() => {
    testDb = createTestDb();
    tmuxServer = createTmuxTestServer(
      `pulse-nav-${process.pid}-${randomBytes(4).toString("hex")}`,
    );
  });

  afterEach(() => {
    try {
      tui?.kill();
    } catch {}
    tui = null;
    try {
      tmuxServer?.cleanup();
    } catch {}
    try {
      testDb?.cleanup();
    } catch {}
  });

  it("enter key exits TUI after selecting session", async () => {
    const session = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-enter",
    );

    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Alpha Session",
      tmux_target: session.sessionName,
      tmux_pane: session.paneId,
      pid: session.pid,
    });

    tui = await launchTuiInTmux({
      socket: tmuxServer.socket,
      sessionName: "tui-enter",
      dbPath: testDb.dbPath,
    });

    const beforeScreen = await waitForTuiContent({
      capture: tui.capture,
      match: "Alpha Session",
      timeoutMs: 10_000,
    });

    expect(beforeScreen).toContain("\u25B8");
    expect(beforeScreen).toContain("j/k: navigate");

    tui.sendKeys("Enter");
    await new Promise((r) => setTimeout(r, 2000));

    const afterScreen = tui.capture();
    expect(afterScreen).not.toContain("j/k: navigate");
  }, 20_000);

  it("j/k moves selection between rows", async () => {
    const sessionA = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-nav-a",
    );
    const sessionB = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-nav-b",
    );

    insertRow(testDb.dbPath, {
      status: "permission_pending",
      title: "Session Alpha",
      tmux_target: sessionA.sessionName,
      tmux_pane: sessionA.paneId,
      pid: sessionA.pid,
    });
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Session Beta",
      tmux_target: sessionB.sessionName,
      tmux_pane: sessionB.paneId,
      pid: sessionB.pid,
    });

    tui = await launchTuiInTmux({
      socket: tmuxServer.socket,
      sessionName: "tui-jk",
      dbPath: testDb.dbPath,
    });

    await waitForTuiContent({
      capture: tui.capture,
      match: "Session Beta",
      timeoutMs: 10_000,
    });

    let screen = tui.capture();
    let lines = screen.split("\n");
    let selectedLine = lines.find((l) => l.includes("\u25B8"));
    expect(selectedLine).toContain("Alpha");

    tui.sendKeys("j");
    await new Promise((r) => setTimeout(r, 500));

    screen = tui.capture();
    lines = screen.split("\n");
    selectedLine = lines.find((l) => l.includes("\u25B8"));
    expect(selectedLine).toContain("Beta");

    tui.sendKeys("k");
    await new Promise((r) => setTimeout(r, 500));

    screen = tui.capture();
    lines = screen.split("\n");
    selectedLine = lines.find((l) => l.includes("\u25B8"));
    expect(selectedLine).toContain("Alpha");
  }, 20_000);

  it("q exits TUI cleanly", async () => {
    const session = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-quit",
    );

    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Quit Test",
      tmux_target: session.sessionName,
      pid: session.pid,
    });

    tui = await launchTuiInTmux({
      socket: tmuxServer.socket,
      sessionName: "tui-quit",
      dbPath: testDb.dbPath,
    });

    await waitForTuiContent({
      capture: tui.capture,
      match: "Quit Test",
      timeoutMs: 10_000,
    });

    const beforeScreen = tui.capture();
    expect(beforeScreen).toContain("j/k: navigate");

    tui.sendKeys("q");
    await new Promise((r) => setTimeout(r, 2000));

    const afterScreen = tui.capture();
    expect(afterScreen).not.toContain("j/k: navigate");
  }, 20_000);

  it("navigation wraps around (k from first row selects last)", async () => {
    const sessionA = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-wrap-a",
    );
    const sessionB = await createSurvivableSession(
      tmuxServer.socket,
      "opencode-wrap-b",
    );

    insertRow(testDb.dbPath, {
      status: "permission_pending",
      title: "Wrap First",
      tmux_target: sessionA.sessionName,
      tmux_pane: sessionA.paneId,
      pid: sessionA.pid,
    });
    insertRow(testDb.dbPath, {
      status: "idle",
      title: "Wrap Last",
      tmux_target: sessionB.sessionName,
      tmux_pane: sessionB.paneId,
      pid: sessionB.pid,
    });

    tui = await launchTuiInTmux({
      socket: tmuxServer.socket,
      sessionName: "tui-wrap",
      dbPath: testDb.dbPath,
    });

    await waitForTuiContent({
      capture: tui.capture,
      match: "Wrap Last",
      timeoutMs: 10_000,
    });

    let screen = tui.capture();
    let lines = screen.split("\n");
    let selectedLine = lines.find((l) => l.includes("\u25B8"));
    expect(selectedLine).toContain("Wrap First");

    tui.sendKeys("k");
    await new Promise((r) => setTimeout(r, 500));

    screen = tui.capture();
    lines = screen.split("\n");
    selectedLine = lines.find((l) => l.includes("\u25B8"));
    expect(selectedLine).toContain("Wrap Last");
  }, 20_000);
});
