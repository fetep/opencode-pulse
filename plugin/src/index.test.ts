import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origPulseDbPath = process.env.PULSE_DB_PATH;
const origTmuxPane = process.env.TMUX_PANE;

const testDir = mkdtempSync(join(tmpdir(), "pulse-plugin-test-"));
const testDbPath = join(testDir, "test.db");
process.env.PULSE_DB_PATH = testDbPath;
delete process.env.TMUX_PANE;

const { default: createPlugin, summarizeEvent, parseCmdlineFlags } = await import("./index.ts");

interface SessionRow {
  pid: number;
  session_id: string | null;
  status: string;
  title: string | null;
  directory: string | null;
  project_id: string | null;
  opencode_version: string | null;
  retry_message: string | null;
  retry_next: number | null;
  error_message: string | null;
  todo_total: number;
  todo_done: number;
  heartbeat_at: number;
  created_at: number;
  updated_at: number;
}

function createMockInput() {
  const mockShell: any = (_strings: TemplateStringsArray, ..._values: any[]) => ({
    text: () => Promise.resolve(""),
    quiet: () => Promise.resolve(),
  });

  return {
    project: { id: "test-project", worktree: "/tmp/test-project" },
    directory: "/tmp/test-project",
    worktree: "/tmp/test-project",
    serverUrl: "http://localhost:0",
    $: mockShell,
    client: {
      session: {
        get: async () => ({ data: null }),
        list: async () => ({ data: [] }),
        status: async () => ({ data: {} }),
      },
    },
  } as any;
}

function makeEvent(type: string, properties: Record<string, any>) {
  return { type, properties };
}

function getRow(db: Database): SessionRow | null {
  return db.query("SELECT * FROM sessions WHERE pid = ?").get(process.pid) as SessionRow | null;
}

describe("parseCmdlineFlags", () => {
  test("no flags returns defaults", () => {
    const result = parseCmdlineFlags(["opencode"]);
    expect(result.sessionId).toBeNull();
    expect(result.continueMode).toBe(false);
  });

  test("-s flag extracts session id", () => {
    const result = parseCmdlineFlags(["opencode", "-s", "ses_abc123"]);
    expect(result.sessionId).toBe("ses_abc123");
    expect(result.continueMode).toBe(false);
  });

  test("-c flag sets continueMode", () => {
    const result = parseCmdlineFlags(["opencode", "-c"]);
    expect(result.sessionId).toBeNull();
    expect(result.continueMode).toBe(true);
  });

  test("--continue flag sets continueMode", () => {
    const result = parseCmdlineFlags(["opencode", "--continue"]);
    expect(result.continueMode).toBe(true);
  });

  test("-s and -c together", () => {
    const result = parseCmdlineFlags(["opencode", "-s", "ses_xyz", "-c"]);
    expect(result.sessionId).toBe("ses_xyz");
    expect(result.continueMode).toBe(true);
  });

  test("-s at end without value returns null sessionId", () => {
    const result = parseCmdlineFlags(["opencode", "-s"]);
    expect(result.sessionId).toBeNull();
  });

  test("-s with empty string value returns null sessionId", () => {
    const result = parseCmdlineFlags(["opencode", "-s", ""]);
    expect(result.sessionId).toBeNull();
  });

  test("empty args array returns defaults", () => {
    const result = parseCmdlineFlags([]);
    expect(result.sessionId).toBeNull();
    expect(result.continueMode).toBe(false);
  });

  test("no args reads /proc/self/cmdline (smoke test)", () => {
    const result = parseCmdlineFlags();
    expect(result.continueMode).toBe(false);
  });
});

describe("summarizeEvent", () => {
  test("session.diff with file diffs", () => {
    const result = summarizeEvent({
      type: "session.diff",
      properties: {
        sessionID: "s1",
        diff: [
          { file: "src/app.ts", additions: 10, deletions: 3 },
          { file: "README.md", additions: 1, deletions: 0 },
        ],
      },
    });
    expect(result).toContain("session.diff");
    expect(result).toContain("sid=s1");
    expect(result).toContain("src/app.ts(+10/-3)");
    expect(result).toContain("README.md(+1/-0)");
  });

  test("session.diff without diffs", () => {
    const result = summarizeEvent({
      type: "session.diff",
      properties: { sessionID: "s2" },
    });
    expect(result).toBe("session.diff sid=s2");
  });

  test("message.updated with info", () => {
    const result = summarizeEvent({
      type: "message.updated",
      properties: {
        info: { sessionID: "s1", id: "msg1", role: "assistant" },
      },
    });
    expect(result).toContain("message.updated");
    expect(result).toContain("sid=s1");
    expect(result).toContain("msg=msg1");
    expect(result).toContain("role=assistant");
  });

  test("message.updated without info", () => {
    const result = summarizeEvent({
      type: "message.updated",
      properties: { foo: "bar" },
    });
    expect(result).toContain("message.updated");
    expect(result).toContain("foo");
  });

  test("message.part.updated with part and tool", () => {
    const result = summarizeEvent({
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "s1",
          type: "tool_call",
          tool: "bash",
          state: { status: "running" },
        },
      },
    });
    expect(result).toContain("message.part.updated");
    expect(result).toContain("sid=s1");
    expect(result).toContain("type=tool_call");
    expect(result).toContain("tool=bash");
    expect(result).toContain("status=running");
  });

  test("message.part.updated without part", () => {
    const result = summarizeEvent({
      type: "message.part.updated",
      properties: {},
    });
    expect(result).toContain("message.part.updated");
  });

  test("unknown event type uses JSON fallback", () => {
    const result = summarizeEvent({
      type: "some.unknown.event",
      properties: { key: "value" },
    });
    expect(result).toContain("some.unknown.event");
    expect(result).toContain('"key"');
    expect(result).toContain('"value"');
  });
});

describe("plugin event handler", () => {
  let eventHandler: (args: { event: any }) => Promise<void>;
  let verifyDb: Database;

  beforeEach(async () => {
    if (existsSync(testDbPath)) rmSync(testDbPath);
    if (existsSync(`${testDbPath}-wal`)) rmSync(`${testDbPath}-wal`);
    if (existsSync(`${testDbPath}-shm`)) rmSync(`${testDbPath}-shm`);

    const hooks = await createPlugin(createMockInput());
    eventHandler = hooks.event!;
    verifyDb = new Database(testDbPath, { readonly: true });
  });

  afterEach(async () => {
    try {
      await eventHandler({ event: makeEvent("server.instance.disposed", {}) });
    } catch {}
    try {
      verifyDb.close();
    } catch {}
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    if (origPulseDbPath !== undefined) {
      process.env.PULSE_DB_PATH = origPulseDbPath;
    } else {
      delete process.env.PULSE_DB_PATH;
    }
    if (origTmuxPane !== undefined) {
      process.env.TMUX_PANE = origTmuxPane;
    } else {
      delete process.env.TMUX_PANE;
    }
  });

  test("creates initial row on startup", () => {
    const row = getRow(verifyDb);
    expect(row).not.toBeNull();
    expect(row?.pid).toBe(process.pid);
    expect(row?.status).toBe("idle");
    expect(row?.directory).toBe("/tmp/test-project");
    expect(row?.project_id).toBe("test-project");
    expect(row?.todo_total).toBe(0);
    expect(row?.todo_done).toBe(0);
  });

  test("session.status idle updates status and session_id", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("idle");
    expect(row?.session_id).toBe("ses_1");
    expect(row?.retry_message).toBeNull();
    expect(row?.retry_next).toBeNull();
  });

  test("session.status busy updates status", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "busy" },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("busy");
    expect(row?.session_id).toBe("ses_1");
  });

  test("session.status retry updates with retry info", async () => {
    const retryNext = Date.now() + 5000;
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "retry", message: "rate limited", next: retryNext },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("retry");
    expect(row?.retry_message).toBe("rate limited");
    expect(row?.retry_next).toBe(retryNext);
  });

  test("session.idle updates status", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "busy" },
      }),
    });
    await eventHandler({
      event: makeEvent("session.idle", { sessionID: "ses_1" }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("idle");
    expect(row?.session_id).toBe("ses_1");
  });

  test("session.created sets session info and version", async () => {
    await eventHandler({
      event: makeEvent("session.created", {
        info: {
          id: "ses_new",
          projectID: "proj_1",
          directory: "/home/user/project",
          title: "Fix login bug",
          version: "1.2.0",
        },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.session_id).toBe("ses_new");
    expect(row?.project_id).toBe("proj_1");
    expect(row?.directory).toBe("/home/user/project");
    expect(row?.title).toBe("Fix login bug");
    expect(row?.opencode_version).toBe("1.2.0");
    expect(row?.status).toBe("idle");
  });

  test("session.updated updates session info", async () => {
    await eventHandler({
      event: makeEvent("session.updated", {
        info: {
          id: "ses_1",
          projectID: "proj_1",
          directory: "/home/user/project",
          title: "Updated title",
          version: "1.3.0",
        },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.session_id).toBe("ses_1");
    expect(row?.title).toBe("Updated title");
    expect(row?.opencode_version).toBe("1.3.0");
  });

  test("session.deleted clears session info", async () => {
    await eventHandler({
      event: makeEvent("session.created", {
        info: {
          id: "ses_1",
          projectID: "proj_1",
          directory: "/tmp/test",
          title: "My session",
          version: "1.0.0",
        },
      }),
    });

    await eventHandler({ event: makeEvent("session.deleted", {}) });
    const row = getRow(verifyDb);
    expect(row?.session_id).toBeNull();
    expect(row?.title).toBeNull();
    expect(row?.status).toBe("idle");
    expect(row?.todo_total).toBe(0);
    expect(row?.todo_done).toBe(0);
  });

  test("session.error sets error status and message", async () => {
    await eventHandler({
      event: makeEvent("session.error", {
        sessionID: "ses_1",
        error: { message: "API rate limit exceeded", code: 429 },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("error");
    expect(row?.error_message).toContain("rate limit");
  });

  test("session.error with null error", async () => {
    await eventHandler({
      event: makeEvent("session.error", {
        sessionID: "ses_1",
        error: null,
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.status).toBe("error");
    expect(row?.error_message).toBeNull();
  });

  test("permission.asked sets permission_pending", async () => {
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");
  });

  test("permission.replied clears to idle", async () => {
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    await eventHandler({
      event: makeEvent("permission.replied", { requestID: "perm_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("idle");
  });

  test("permission.replied falls back to question_pending", async () => {
    await eventHandler({
      event: makeEvent("question.asked", { id: "q_1" }),
    });
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");

    await eventHandler({
      event: makeEvent("permission.replied", { requestID: "perm_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("question_pending");
  });

  test("question.asked sets question_pending when no permissions", async () => {
    await eventHandler({
      event: makeEvent("question.asked", { id: "q_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("question_pending");
  });

  test("question.asked stays permission_pending when permissions exist", async () => {
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    await eventHandler({
      event: makeEvent("question.asked", { id: "q_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");
  });

  test("question.replied clears to idle", async () => {
    await eventHandler({
      event: makeEvent("question.asked", { id: "q_1" }),
    });
    await eventHandler({
      event: makeEvent("question.replied", { requestID: "q_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("idle");
  });

  test("question.replied keeps permission_pending when permissions exist", async () => {
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    await eventHandler({
      event: makeEvent("question.asked", { id: "q_1" }),
    });
    await eventHandler({
      event: makeEvent("question.replied", { requestID: "q_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");
  });

  test("multiple permissions tracked independently", async () => {
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_1" }),
    });
    await eventHandler({
      event: makeEvent("permission.asked", { id: "perm_2" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");

    await eventHandler({
      event: makeEvent("permission.replied", { requestID: "perm_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("permission_pending");

    await eventHandler({
      event: makeEvent("permission.replied", { requestID: "perm_2" }),
    });
    expect(getRow(verifyDb)?.status).toBe("idle");
  });

  test("todo.updated updates counts", async () => {
    await eventHandler({
      event: makeEvent("todo.updated", {
        todos: [
          { content: "Task 1", status: "completed" },
          { content: "Task 2", status: "in_progress" },
          { content: "Task 3", status: "pending" },
        ],
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.todo_total).toBe(3);
    expect(row?.todo_done).toBe(1);
  });

  test("todo.updated with all completed", async () => {
    await eventHandler({
      event: makeEvent("todo.updated", {
        todos: [
          { content: "Task 1", status: "completed" },
          { content: "Task 2", status: "completed" },
        ],
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.todo_total).toBe(2);
    expect(row?.todo_done).toBe(2);
  });

  test("todo.updated with empty todos", async () => {
    await eventHandler({
      event: makeEvent("todo.updated", { todos: [] }),
    });
    const row = getRow(verifyDb);
    expect(row?.todo_total).toBe(0);
    expect(row?.todo_done).toBe(0);
  });

  test("server.instance.disposed deletes row", async () => {
    expect(getRow(verifyDb)).not.toBeNull();
    await eventHandler({
      event: makeEvent("server.instance.disposed", {}),
    });
    const freshDb = new Database(testDbPath, { readonly: true });
    const row = freshDb.query("SELECT * FROM sessions WHERE pid = ?").get(process.pid);
    freshDb.close();
    expect(row).toBeNull();
  });

  test("heartbeat updates timestamp on event", async () => {
    const initialHeartbeat = getRow(verifyDb)!.heartbeat_at;
    await new Promise((r) => setTimeout(r, 10));

    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    });
    expect(getRow(verifyDb)!.heartbeat_at).toBeGreaterThanOrEqual(initialHeartbeat);
  });

  test("upsert updates existing row, never duplicates", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "busy" },
      }),
    });
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    });
    await eventHandler({
      event: makeEvent("session.created", {
        info: {
          id: "ses_2",
          projectID: "p1",
          directory: "/tmp",
          title: "test",
          version: "1.0",
        },
      }),
    });

    const count = verifyDb.query("SELECT COUNT(*) as cnt FROM sessions").get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  test("full status lifecycle: idle -> busy -> retry -> error -> idle", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    });
    expect(getRow(verifyDb)?.status).toBe("idle");

    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "busy" },
      }),
    });
    expect(getRow(verifyDb)?.status).toBe("busy");

    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "retry", message: "limit", next: 1000 },
      }),
    });
    expect(getRow(verifyDb)?.status).toBe("retry");

    await eventHandler({
      event: makeEvent("session.error", {
        sessionID: "ses_1",
        error: { message: "crash" },
      }),
    });
    expect(getRow(verifyDb)?.status).toBe("error");

    await eventHandler({
      event: makeEvent("session.idle", { sessionID: "ses_1" }),
    });
    expect(getRow(verifyDb)?.status).toBe("idle");
  });

  test("session.status idle clears retry fields", async () => {
    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "retry", message: "rate limit", next: 9999 },
      }),
    });
    expect(getRow(verifyDb)?.retry_message).toBe("rate limit");

    await eventHandler({
      event: makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    });
    const row = getRow(verifyDb);
    expect(row?.retry_message).toBeNull();
    expect(row?.retry_next).toBeNull();
  });
});
